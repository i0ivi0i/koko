import type { 媒体定位结果, 媒体种类 } from "../../聊天共享/契约.js";
import type { 媒体运行时事件 } from "../运行时.js";
import type { 预览缓存端口 } from "../预览缓存.js";
import type { 视频预览状态, 从媒体源抓取视频预览 } from "../视频预览.js";

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
  type 视频预览抓帧任务记录 = {
    promise: Promise<Awaited<ReturnType<typeof deps.抓取视频预览>>>;
    abortController: AbortController;
    consumers: Set<string>;
  };
  const 视频预览抓帧任务表 = new Map<
    string,
    视频预览抓帧任务记录
  >();
  const 视频预览抓帧消费者任务索引 = new Map<string, string>();
  const 视频预览抓帧附件消费者索引 = new Map<string, Set<string>>();
  const 可见候选缺源重试最小间隔毫秒 = 600;

  const 构造视频预览抓帧任务键 = (
    contentHash: string | null,
    previewSource: string
  ): string => {
    return contentHash ? `content:${contentHash}` : `src:${previewSource}`;
  };

  const 构造视频预览抓帧消费者键 = (attachmentId: string, generation: number): string =>
    `${attachmentId}#${generation}`;

  const 绑定视频预览抓帧消费者 = (
    attachmentId: string,
    consumerKey: string,
    taskKey: string
  ): void => {
    视频预览抓帧消费者任务索引.set(consumerKey, taskKey);
    let attachmentConsumers = 视频预览抓帧附件消费者索引.get(attachmentId);
    if (!attachmentConsumers) {
      attachmentConsumers = new Set<string>();
      视频预览抓帧附件消费者索引.set(attachmentId, attachmentConsumers);
    }
    attachmentConsumers.add(consumerKey);
  };

  const 释放视频预览抓帧消费者 = (consumerKey: string): void => {
    const taskKey = 视频预览抓帧消费者任务索引.get(consumerKey);
    if (!taskKey) {
      return;
    }
    视频预览抓帧消费者任务索引.delete(consumerKey);
    const attachmentId = consumerKey.split("#")[0];
    if (!attachmentId) {
      return;
    }
    const attachmentConsumers = 视频预览抓帧附件消费者索引.get(attachmentId);
    attachmentConsumers?.delete(consumerKey);
    if (attachmentConsumers && attachmentConsumers.size === 0) {
      视频预览抓帧附件消费者索引.delete(attachmentId);
    }
    const task = 视频预览抓帧任务表.get(taskKey);
    if (!task) {
      return;
    }
    task.consumers.delete(consumerKey);
    if (task.consumers.size === 0) {
      /**
       * 共享抓帧任务只有在“最后一个附件引用也退场”后才允许 abort：
       * 1. 同内容多附件仍可共享同一条隐藏 probe；
       * 2. 但一旦没有任何附件还在等它，就必须立刻停流，不准继续拖着旧 `/webtorrent/...`；
       * 3. 这样附件退场与后台抓帧之间终于是一条同进同退的真相链。
       */
      task.abortController.abort();
      视频预览抓帧任务表.delete(taskKey);
    }
  };

  const 释放附件全部视频预览抓帧消费者 = (attachmentId: string): void => {
    const attachmentConsumers = Array.from(
      视频预览抓帧附件消费者索引.get(attachmentId) ?? []
    );
    for (const consumerKey of attachmentConsumers) {
      释放视频预览抓帧消费者(consumerKey);
    }
  };

  const 读取或创建视频预览抓帧任务 = (
    taskKey: string,
    previewSource: string,
    attachmentId: string,
    generation: number
  ): Promise<Awaited<ReturnType<typeof deps.抓取视频预览>>> => {
    const consumerKey = 构造视频预览抓帧消费者键(attachmentId, generation);
    const existing = 视频预览抓帧任务表.get(taskKey);
    if (existing) {
      existing.consumers.add(consumerKey);
      绑定视频预览抓帧消费者(attachmentId, consumerKey, taskKey);
      return existing.promise;
    }
    /**
     * 抓帧是 poster 体验态，不是 WebTorrent 正式补齐/做种链。
     * 同一内容在消息流里出现多次时，只允许一个隐藏 video/streamURL 读流探针；
     * 其他附件共享这次结果，避免把 WebTorrent torrent 的 `verified` 监听器堆成假泄漏告警。
     */
    const abortController = new AbortController();
    const taskRecord: 视频预览抓帧任务记录 = {
      abortController,
      consumers: new Set<string>([consumerKey]),
      promise: deps
        .抓取视频预览({
          src: previewSource,
          signal: abortController.signal,
        })
        .finally(() => {
          if (视频预览抓帧任务表.get(taskKey) === taskRecord) {
            视频预览抓帧任务表.delete(taskKey);
          }
        }),
    };
    绑定视频预览抓帧消费者(attachmentId, consumerKey, taskKey);
    视频预览抓帧任务表.set(taskKey, taskRecord);
    return taskRecord.promise;
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

  const 广播自动播稳定表面已就绪 = (attachmentId: string): void => {
    deps.接收媒体运行时事实({
      type: "INLINE_AUTOPLAY_STABLE_SURFACE_READY",
      attachmentId,
      surface: "bridge",
    });
  };

  const 广播自动播稳定表面已失效 = (attachmentId: string): void => {
    deps.接收媒体运行时事实({
      type: "INLINE_AUTOPLAY_STABLE_SURFACE_INVALIDATED",
      attachmentId,
    });
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
    /**
     * 一旦当前附件重新落回 `missing_source`，runtime 侧就不能再沿用旧 bridge-ready 结论：
     * 1. 这通常意味着这轮 sourceVersion 下已经没有可承接的稳定帧；
     * 2. 如果不清掉，pending owner 可能会误以为自己仍然握有 bridge，提前切走旧 owner；
     * 3. 因而缺源本身就是一条显式失效事实，而不是纯 UI 状态。
     */
    广播自动播稳定表面已失效(attachmentId);
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
      const 当前缺源可见重试记录 =
        视频预览缺源可见重试记录表.get(attachmentId) ?? null;
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
        /**
         * loading 是当前附件唯一进行中的 preview owner。
         * 滚动可见信号不能用“已有播放源”再次顶掉旧代次；否则同一个附件会在
         * locator / swarm preview / 抓帧之间反复开关。真正的更强播放源重试
         * 已经由 missing_source + sourceVersion 规则接管。
         */
        currentPreview.phase === "loading" ||
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
       * 预览与正式播放共享同一条 swarm 平面，但帮助资格必须严格分层：
       * 1. preview 允许单独探测 locator / swarm preview source，保证消息流 poster 不回退冷源；
       * 2. 但 preview consumer 只属于“预览体验态”，不能因此晋升为帮助者或 presence；
       * 3. 真正的帮助资格仍只来自 autoplay / viewer / backfill，会在协作分发运行时里另行收口。
       */
      const 当前代次 = (视频预览解析代次表.get(attachmentId) ?? 0) + 1;
      视频预览解析代次表.set(attachmentId, 当前代次);
      写入视频预览状态(attachmentId, { phase: "loading" });

      void (async () => {
        const 当前抓帧消费者键 = 构造视频预览抓帧消费者键(attachmentId, 当前代次);
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
              广播自动播稳定表面已就绪(attachmentId);
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
                广播自动播稳定表面已就绪(attachmentId);
                return;
              }
            }
            /**
             * 视频预览只允许走两条表面：
             * 1. 已有正式播放源；
             * 2. 同一附件协作分发 locator 里声明过的 swarm preview source。
             *
             * 这里仍然禁止回退 canonical/original 冷源，让 preview 和正式主链继续保持同一字节真相。
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
            previewSource,
            attachmentId,
            当前代次
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
          /**
           * preview 协作拿到的不是第二条视频真相，而是“这张卡已经至少握有一张同源稳定 bridge”：
           * 1. runtime 只用它决定 pending 是否可以平滑接管；
           * 2. 真正的 live reveal 仍然只认 canonical player 自己后续的 committed frame；
           * 3. 这样状态机和渲染层终于吃到同一条稳定表面事实。
           */
          广播自动播稳定表面已就绪(attachmentId);
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
        } finally {
          释放视频预览抓帧消费者(当前抓帧消费者键);
        }
      })();
    },

    删除视频预览状态(attachmentId: string): void {
      释放附件全部视频预览抓帧消费者(attachmentId);
      视频预览缺源阻断版本表.delete(attachmentId);
      视频预览缺源可见重试记录表.delete(attachmentId);
      /**
       * 单附件退场不只是“把当前状态删掉”：
       * 1. 进行中的 locator / swarm / 抓帧异步链可能稍后才回来；
       * 2. 如果不同时作废解析代次，旧任务会把 `ready/missing_source` 再写回已退场附件；
       * 3. 因此这里要显式剪断 attachment 级解析真相，确保退场就是退场。
       */
      视频预览解析代次表.delete(attachmentId);
      广播自动播稳定表面已失效(attachmentId);
      if (!视频预览状态表.delete(attachmentId)) {
        return;
      }
      deps.请求重渲染();
      deps.同步当前查看器请求();
    },

    清空(): void {
      for (const task of 视频预览抓帧任务表.values()) {
        task.abortController.abort();
      }
      for (const attachmentId of 视频预览状态表.keys()) {
        广播自动播稳定表面已失效(attachmentId);
      }
      视频预览状态表.clear();
      视频预览解析代次表.clear();
      视频预览缺源阻断版本表.clear();
      视频预览缺源可见重试记录表.clear();
      视频预览抓帧消费者任务索引.clear();
      视频预览抓帧附件消费者索引.clear();
      视频预览抓帧任务表.clear();
    },
  };
}
