import type { 媒体定位结果, 媒体种类 } from "../../契约.js";
import type { 媒体运行时事件 } from "../../媒体运行时.js";
import type {
  预览缓存端口,
  视频预览状态,
  从媒体源抓取视频预览,
} from "../index.js";

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

type 当前视频预览播放源 = {
  src: string;
  contentHash: string | null;
};

type 视频预览协作依赖 = {
  读取附件条目(attachmentId: string): 媒体附件条目 | null;
  读取会话播放源版本(attachmentId: string): number;
  读取当前视频预览播放源(attachmentId: string): 当前视频预览播放源 | null;
  获取媒体定位(
    attachmentId: string,
    options?: { forceRefresh?: boolean }
  ): Promise<媒体定位结果>;
  解析协作分发预览源(input: {
    attachmentId: string;
    locator: 媒体定位结果;
    consumerId: string;
  }): Promise<{ src: string } | null>;
  释放协作分发消费者(input: { attachmentId: string; consumerId: string }): void;
  预览缓存: 预览缓存端口;
  抓取视频预览: typeof 从媒体源抓取视频预览;
  接收媒体运行时事实(event: 媒体运行时事件): void;
  请求重渲染(): void;
  同步当前查看器请求(): void;
  构造预览ConsumerId(attachmentId: string): string;
};

export interface 视频预览协作端口 {
  读取视频预览状态表(): Record<string, 视频预览状态>;
  读取视频预览状态(attachmentId: string): 视频预览状态 | null;
  解析视频预览(
    attachmentId: string,
    input?: { trigger?: "default" | "visible_candidate" }
  ): void;
  删除视频预览状态(attachmentId: string): void;
  清空(): void;
}

/**
 * 视频预览协作只拥有“视频 poster 的缺源阻断、缓存复用与抓帧重试”：
 * 1. 真正的媒体会话真相仍来自会话 owner；
 * 2. 这里只把 preview 当作附属体验态，避免回声第二条播放链；
 * 3. 协作分发 preview 也必须复用同一附件主链，而不是再偷偷开服务器冷源旁路。
 */
export function 创建视频预览协作(
  deps: 视频预览协作依赖
): 视频预览协作端口 {
  const 视频预览状态表 = new Map<string, 视频预览状态>();
  const 视频预览解析代次表 = new Map<string, number>();
  const 视频预览缺源阻断版本表 = new Map<string, number>();
  const 视频预览缺源可见重试记录表 = new Map<
    string,
    {
      sourceVersion: number;
      attemptedAtMs: number;
    }
  >();
  const 视频预览抓帧任务表 = new Map<
    string,
    Promise<Awaited<ReturnType<typeof deps.抓取视频预览>>>
  >();
  const 可见候选缺源重试最小间隔毫秒 = 600;

  const 构造视频预览抓帧任务键 = (
    contentHash: string | null,
    previewSource: string
  ): string => {
    return contentHash ? `content:${contentHash}` : `src:${previewSource}`;
  };

  const 读取或创建视频预览抓帧任务 = (
    taskKey: string,
    previewSource: string
  ): Promise<Awaited<ReturnType<typeof deps.抓取视频预览>>> => {
    const existing = 视频预览抓帧任务表.get(taskKey);
    if (existing) {
      return existing;
    }
    /**
     * 抓帧是 poster 体验态，不是 WebTorrent 正式补齐/做种链。
     * 同一内容在消息流里出现多次时，只允许一个隐藏 video/streamURL 读流探针；
     * 其他附件共享这次结果，避免把 WebTorrent torrent 的 `verified` 监听器堆成假泄漏告警。
     */
    const task = deps.抓取视频预览({ src: previewSource }).finally(() => {
      if (视频预览抓帧任务表.get(taskKey) === task) {
        视频预览抓帧任务表.delete(taskKey);
      }
    });
    视频预览抓帧任务表.set(taskKey, task);
    return task;
  };

  const 写入视频预览状态 = (
    attachmentId: string,
    nextState: 视频预览状态
  ): void => {
    const previous = 视频预览状态表.get(attachmentId);
    if (JSON.stringify(previous ?? null) === JSON.stringify(nextState)) {
      return;
    }
    视频预览状态表.set(attachmentId, nextState);
    deps.请求重渲染();
    deps.同步当前查看器请求();
  };

  const 清除视频预览缺源阻断 = (attachmentId: string): void => {
    视频预览缺源阻断版本表.delete(attachmentId);
    视频预览缺源可见重试记录表.delete(attachmentId);
  };

  const 标记视频预览缺源 = (attachmentId: string): void => {
    // missing_source 只在“当前 sourceVersion”上阻断；一旦会话重裁决出新版本，会允许重试一次。
    视频预览缺源阻断版本表.set(
      attachmentId,
      deps.读取会话播放源版本(attachmentId)
    );
    写入视频预览状态(attachmentId, { phase: "missing_source" });
  };

  return {
    读取视频预览状态表(): Record<string, 视频预览状态> {
      return Object.fromEntries(视频预览状态表);
    },

    读取视频预览状态(attachmentId: string): 视频预览状态 | null {
      return 视频预览状态表.get(attachmentId) ?? null;
    },

    解析视频预览(
      attachmentId: string,
      input: { trigger?: "default" | "visible_candidate" } = {}
    ): void {
      const attachment = deps.读取附件条目(attachmentId);
      const currentPreview = 视频预览状态表.get(attachmentId) ?? { phase: "idle" as const };
      const 当前会话源版本 = deps.读取会话播放源版本(attachmentId);
      const 缺源阻断版本 = 视频预览缺源阻断版本表.get(attachmentId);
      const 当前预览播放源 = deps.读取当前视频预览播放源(attachmentId);
      const trigger = input.trigger ?? "default";
      const 当前缺源可见重试记录 = 视频预览缺源可见重试记录表.get(attachmentId) ?? null;
      const 正在加载但已有更强播放源 =
        currentPreview.phase === "loading" && Boolean(当前预览播放源);
      const 允许可见候选突破同版缺源阻断 =
        trigger === "visible_candidate" &&
        currentPreview.phase === "missing_source" &&
        缺源阻断版本 === 当前会话源版本 &&
        !当前预览播放源 &&
        (() => {
          if (
            !当前缺源可见重试记录 ||
            当前缺源可见重试记录.sourceVersion !== 当前会话源版本
          ) {
            return true;
          }
          return (
            Date.now() - 当前缺源可见重试记录.attemptedAtMs >=
            可见候选缺源重试最小间隔毫秒
          );
        })();
      if (
        !attachment ||
        attachment.kind !== "video" ||
        (currentPreview.phase === "loading" && !正在加载但已有更强播放源) ||
        currentPreview.phase === "ready" ||
        /**
         * `missing_source` 只应该阻断“这一版会话里仍然完全没有可抓帧源”的重复空转：
         * 1. 如果当前连 swarm playback 都还没出来，同一 sourceVersion 下继续重试只会重复打一轮 locator/空抓帧；
         * 2. 但一旦当前会话已经握住正式 swarm 源，即使还是同一 sourceVersion，也必须允许重试；
         * 3. 真实浏览器里，swarm URL 首轮经常只是“源地址到了，但块还没热到可抓帧”，这时把 `missing_source`
         *    永久锁死，就会让 newcomer 一直没有视频预览，只能在首次 autoplay 时现场卡一下。
         */
        (currentPreview.phase === "missing_source" &&
          缺源阻断版本 === 当前会话源版本 &&
          !当前预览播放源 &&
          !允许可见候选突破同版缺源阻断)
      ) {
        return;
      }
      if (允许可见候选突破同版缺源阻断) {
        视频预览缺源可见重试记录表.set(attachmentId, {
          sourceVersion: 当前会话源版本,
          attemptedAtMs: Date.now(),
        });
      }
      /**
       * 可见候选重试和正式 playback 到位可能前后脚抵达：
       * 1. 前者会先把状态打到 `loading`，同时跑一轮 locator/swarm 预览探测；
       * 2. 如果后者更快拿到了正式 swarm `playback.src`，这其实是更强、更接近可见真相的信号；
       * 3. 因此只要当前已经出现更强播放源，就允许新一轮解析代次直接抢占旧 loading，避免预览真相继续卡在上一拍。
       */
      const 当前代次 = (视频预览解析代次表.get(attachmentId) ?? 0) + 1;
      视频预览解析代次表.set(attachmentId, 当前代次);
      写入视频预览状态(attachmentId, { phase: "loading" });

      void (async () => {
        let shouldReleasePreviewConsumer = false;
        try {
          let contentHash = 当前预览播放源?.contentHash ?? null;
          if (contentHash) {
            await deps.预览缓存.写入附件索引(attachmentId, contentHash);
            const cachedPreview = await deps.预览缓存.按内容读取(contentHash);
            if (cachedPreview?.objectUrl) {
              if (视频预览解析代次表.get(attachmentId) !== 当前代次) {
                return;
              }
              清除视频预览缺源阻断(attachmentId);
              写入视频预览状态(attachmentId, {
                phase: "ready",
                src: cachedPreview.objectUrl,
                source: "cache",
              });
              return;
            }
          }

          let previewSource = 当前预览播放源?.src ?? null;
          if (!previewSource) {
            const startedAt = performance.now();
            deps.接收媒体运行时事实({ type: "LOCATOR_REQUEST_STARTED" });
            const shouldForceRefreshLocator =
              trigger === "visible_candidate" &&
              currentPreview.phase === "missing_source" &&
              缺源阻断版本 === 当前会话源版本 &&
              !当前预览播放源;
            let locator: 媒体定位结果;
            try {
              locator = await deps.获取媒体定位(attachmentId, {
                forceRefresh: shouldForceRefreshLocator,
              });
            } finally {
              deps.接收媒体运行时事实({
                type: "LOCATOR_REQUEST_FINISHED",
                durationMs: performance.now() - startedAt,
              });
            }
            if (locator.status !== "ready" || locator.kind !== "video") {
              if (视频预览解析代次表.get(attachmentId) !== 当前代次) {
                return;
              }
              标记视频预览缺源(attachmentId);
              return;
            }
            contentHash = locator.file_asset?.content_hash ?? locator.distribution?.content_hash ?? null;
            if (contentHash) {
              await deps.预览缓存.写入附件索引(attachmentId, contentHash);
              const cachedPreview = await deps.预览缓存.按内容读取(contentHash);
              if (cachedPreview?.objectUrl) {
                if (视频预览解析代次表.get(attachmentId) !== 当前代次) {
                  return;
                }
                清除视频预览缺源阻断(attachmentId);
                写入视频预览状态(attachmentId, {
                  phase: "ready",
                  src: cachedPreview.objectUrl,
                  source: "cache",
                });
                return;
              }
            }
            /**
             * 视频预览也必须服从“只认 WebTorrent 一条正式字节主链”：
             * 1. 有协作分发片段时，只允许复用同一 swarm 会话；
             * 2. 没有 swarm 片段，就直接进入 missing_source，说真话；
             * 3. 不再因为 legacy 形状偷偷回退 canonical/original 冷源。
             */
            if (locator.distribution) {
              const swarmSource = await deps.解析协作分发预览源({
                attachmentId,
                locator,
                consumerId: deps.构造预览ConsumerId(attachmentId),
              });
              if (swarmSource?.src) {
                previewSource = swarmSource.src;
                shouldReleasePreviewConsumer = true;
              }
            }
          }

          if (!previewSource) {
            if (视频预览解析代次表.get(attachmentId) !== 当前代次) {
              return;
            }
            标记视频预览缺源(attachmentId);
            return;
          }

          const preview = await 读取或创建视频预览抓帧任务(
            构造视频预览抓帧任务键(contentHash, previewSource),
            previewSource
          );
          if (shouldReleasePreviewConsumer) {
            deps.释放协作分发消费者({
              attachmentId,
              consumerId: deps.构造预览ConsumerId(attachmentId),
            });
          }
          if (
            视频预览解析代次表.get(attachmentId) !== 当前代次 ||
            preview.source === "none" ||
            !preview.objectUrl
          ) {
            if (视频预览解析代次表.get(attachmentId) === 当前代次) {
              标记视频预览缺源(attachmentId);
            }
            return;
          }
          if (contentHash) {
            await deps.预览缓存.写入附件索引(attachmentId, contentHash);
            await deps.预览缓存.保存({
              contentHash,
              objectUrl: preview.objectUrl,
              source: preview.source,
              width: preview.width,
              height: preview.height,
              updatedAt: Date.now(),
            });
          }
          清除视频预览缺源阻断(attachmentId);
          写入视频预览状态(attachmentId, {
            phase: "ready",
            src: preview.objectUrl,
            source: preview.source,
          });
        } catch {
          if (shouldReleasePreviewConsumer) {
            deps.释放协作分发消费者({
              attachmentId,
              consumerId: deps.构造预览ConsumerId(attachmentId),
            });
          }
          if (视频预览解析代次表.get(attachmentId) !== 当前代次) {
            return;
          }
          标记视频预览缺源(attachmentId);
        }
      })();
    },

    删除视频预览状态(attachmentId: string): void {
      视频预览缺源阻断版本表.delete(attachmentId);
      视频预览缺源可见重试记录表.delete(attachmentId);
      if (!视频预览状态表.delete(attachmentId)) {
        return;
      }
      deps.请求重渲染();
      deps.同步当前查看器请求();
    },

    清空(): void {
      视频预览状态表.clear();
      视频预览解析代次表.clear();
      视频预览缺源阻断版本表.clear();
      视频预览缺源可见重试记录表.clear();
      视频预览抓帧任务表.clear();
    },
  };
}
