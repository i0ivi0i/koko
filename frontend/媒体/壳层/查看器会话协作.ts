import type {
  媒体会话快照,
  媒体会话端口,
  媒体播放结果,
  媒体查看器打开请求,
  视频预览状态,
} from "../index.js";
import { 视频地址属于旧流媒体清单 } from "../index.js";

type 查看器会话协作依赖 = {
  读取当前查看器请求(): 媒体查看器打开请求 | null;
  读取查看器是否已打开(): boolean;
  读取媒体会话快照(attachmentId: string): 媒体会话快照 | null;
  读取媒体会话(attachmentId: string): 媒体会话端口 | null;
  读取自动播播放结果?(attachmentId: string): 媒体播放结果 | null;
  读取视频预览状态(attachmentId: string): 视频预览状态 | null;
  更新当前查看器请求(request: 媒体查看器打开请求): void;
  确认查看器已打开(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步查看器(request: 媒体查看器打开请求): void;
  登记程序滚动来源(source: "media_viewer_open"): void;
  清除程序滚动来源(source: "media_viewer_open"): void;
};

type 可投影媒体播放结果 = Extract<
  媒体播放结果,
  { mode: "swarm" | "anchor" }
>;

type 自动播查看器交接缓存 = {
  playback: 可投影媒体播放结果;
  updatedAt: number;
};

const 自动播查看器交接缓存有效毫秒 = 2_000;

export interface 查看器会话协作端口 {
  投影查看器请求到当前播放真相(request: 媒体查看器打开请求): 媒体查看器打开请求;
  同步当前查看器请求(): void;
  处理查看器请求已清空(): void;
  重置(): void;
}

/**
 * 查看器会话协作只拥有“查看器 request 如何贴齐当前媒体会话真相”这件事：
 * 1. 根据当前 playback / preview 把 request 投影成最新可展示输入；
 * 2. 决定正式查看器现在能不能打开，还是要继续等待恢复；
 * 3. 维护打开查看器这条交互链自己的短暂等待态。
 *
 * 它不直接创建会话、不持有时间线集合，也不接手媒体播放解析。
 */
export function 创建查看器会话协作(
  deps: 查看器会话协作依赖
): 查看器会话协作端口 {
  let 待重裁决的本地完整视频附件标识: string | null = null;
  let 上次已交付查看器请求摘要: string | null = null;
  const 自动播查看器交接播放结果 = new Map<string, 自动播查看器交接缓存>();

  const 序列化查看器请求 = (request: 媒体查看器打开请求): string =>
    JSON.stringify(request);

  const 是否可投影播放结果 = (
    playback: 媒体播放结果 | null | undefined
  ): playback is 可投影媒体播放结果 =>
    (playback?.mode === "swarm" || playback?.mode === "anchor") &&
    !(
      playback?.kind === "video" &&
      视频地址属于旧流媒体清单(playback.src)
    );

  const 读取未过期自动播交接播放结果 = (
    attachmentId: string
  ): 可投影媒体播放结果 | null => {
    const cached = 自动播查看器交接播放结果.get(attachmentId);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.updatedAt > 自动播查看器交接缓存有效毫秒) {
      自动播查看器交接播放结果.delete(attachmentId);
      return null;
    }
    return cached.playback;
  };

  const 读取可投影播放结果 = (
    attachmentId: string,
    sessionPlayback: 媒体播放结果 | null | undefined
  ): 可投影媒体播放结果 | null => {
    if (是否可投影播放结果(sessionPlayback)) {
      return sessionPlayback;
    }
    const autoplayPlayback = deps.读取自动播播放结果?.(attachmentId) ?? null;
    if (是否可投影播放结果(autoplayPlayback)) {
      /**
       * 自动播 owner 打开查看器时，runtime 会在同一拍把 inline owner 清空。
       * 这里短暂缓存的只是已经裁决过的播放源字符串，用来完成 viewer 交接；
       * 它不是第二播放器 owner，也不保留新的 reader / swarm consumer。
       */
      自动播查看器交接播放结果.set(attachmentId, {
        playback: autoplayPlayback,
        updatedAt: Date.now(),
      });
      return autoplayPlayback;
    }
    return 读取未过期自动播交接播放结果(attachmentId);
  };

  const 投影播放结果到查看器项目 = (
    item: 媒体查看器打开请求["items"][number],
    playback: 可投影媒体播放结果
  ): 媒体查看器打开请求["items"][number] => {
    if (item.kind === "video") {
      return {
        ...item,
        src: playback.src,
        posterSrc: playback.thumbnailUrl ?? item.posterSrc,
      };
    }
    return {
      ...item,
      src: playback.src,
      ...((playback.mode === "anchor" || playback.mode === "swarm") &&
      ("contentHash" in playback || "distribution" in playback)
        ? {
            contentHash: playback.contentHash ?? null,
            distribution: playback.distribution ?? null,
          }
        : {}),
    };
  };

  const 投影查看器请求到当前播放真相 = (
    request: 媒体查看器打开请求
  ): 媒体查看器打开请求 => ({
    startAttachmentId: request.startAttachmentId,
    items: request.items.map((item) => {
      const sessionSnapshot = deps.读取媒体会话快照(item.attachmentId);
      const playback = sessionSnapshot?.playback;
      if (item.kind === "video" && sessionSnapshot?.status === "recovering") {
        const preview = deps.读取视频预览状态(item.attachmentId);
        /**
         * 显式重开查看器时，会话可能正从旧 source 重裁到删除态 / 新 ticket / 新主链。
         * 这段窗口绝不能再把旧 playback.src 投回查看器，否则旧视频会在新真相到达前先抢跑。
         */
        return {
          ...item,
          src: "",
          posterSrc: preview?.phase === "ready" ? preview.src : item.posterSrc,
        };
      }
      const 可投影播放结果 = 读取可投影播放结果(item.attachmentId, playback);
      if (可投影播放结果) {
        return 投影播放结果到查看器项目(item, 可投影播放结果);
      }
      if (item.kind === "video") {
        const preview = deps.读取视频预览状态(item.attachmentId);
        /**
         * 查看器 request 的视频 `src` 不允许继续携带旧静态地址。
         * 当会话 playback 尚未裁决完成时，这里明确清空旧值，
         * 让查看器只等待 owner 后续同步出来的正式播放源。
         */
        return {
          ...item,
          src: "",
          posterSrc: preview?.phase === "ready" ? preview.src : item.posterSrc,
        };
      }
      return item;
    }),
  });

  const 起始视频会话当前不可打开 = (request: 媒体查看器打开请求): boolean => {
    const startItem = request.items.find(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (!startItem || startItem.kind !== "video") {
      return false;
    }
    const sessionSnapshot = deps.读取媒体会话快照(startItem.attachmentId);
    if (sessionSnapshot?.status === "recovering") {
      return true;
    }
    const playback = sessionSnapshot?.playback;
    return playback?.mode === "expired" || playback?.mode === "degraded";
  };

  const 是否应等待本地完整视频会话真相 = (
    request: 媒体查看器打开请求
  ): boolean => {
    const startItem = request.items.find(
      (item) => item.attachmentId === request.startAttachmentId
    );
    if (!startItem || startItem.kind !== "video") {
      待重裁决的本地完整视频附件标识 = null;
      return false;
    }
    const session = deps.读取媒体会话(startItem.attachmentId);
    const sessionSnapshot = session?.snapshot();
    if (
      startItem.src.length > 0 &&
      读取未过期自动播交接播放结果(startItem.attachmentId)
    ) {
      /**
       * 当前自动播视频被点开时，viewer 已拿到同一条热播放源。
       * 此时再等待“查看器会话 playback”只会把真全屏入口卡死成没反应。
       */
      待重裁决的本地完整视频附件标识 = null;
      return false;
    }
    if (!sessionSnapshot?.playback) {
      return true;
    }
    if (!sessionSnapshot.locallyComplete) {
      if (待重裁决的本地完整视频附件标识 === startItem.attachmentId) {
        待重裁决的本地完整视频附件标识 = null;
      }
      return false;
    }
    /**
     * 本地完整度先于正式 swarm source hydrate 恢复时，查看器必须等待重裁一拍：
     * 1. 只要当前 playback 还不是 `swarm`，就说明唯一正式链还没真正站稳；
     * 2. 这时绝不能把旧 manifest/original src 再投回查看器抢跑；
     * 3. 同附件只重裁一次，避免把等待唯一主链放大成无限循环。
     */
    if (sessionSnapshot.playback.mode === "swarm") {
      待重裁决的本地完整视频附件标识 = null;
      return false;
    }
    if (待重裁决的本地完整视频附件标识 !== startItem.attachmentId) {
      待重裁决的本地完整视频附件标识 = startItem.attachmentId;
      session?.send({ type: "PLAYER_WAITING" });
      return true;
    }
    if (sessionSnapshot.status === "recovering") {
      return true;
    }
    待重裁决的本地完整视频附件标识 = null;
    return false;
  };

  const 正式打开查看器 = (request: 媒体查看器打开请求): void => {
    deps.登记程序滚动来源("media_viewer_open");
    /**
     * `确认查看器已打开` 可能同步触发新一轮 runtime 投影；
     * 因此要先记住这次已经交付给 viewer 的 request，避免同一拍里又被当成“需要同步一次”的新输入。
     */
    上次已交付查看器请求摘要 = 序列化查看器请求(request);
    deps.打开查看器(request);
    deps.确认查看器已打开();
  };

  return {
    投影查看器请求到当前播放真相,

    同步当前查看器请求(): void {
      const 当前查看器请求 = deps.读取当前查看器请求();
      if (!当前查看器请求) {
        return;
      }
      const nextRequest = 投影查看器请求到当前播放真相(当前查看器请求);
      const nextRequest摘要 = 序列化查看器请求(nextRequest);
      if (nextRequest摘要 !== 序列化查看器请求(当前查看器请求)) {
        deps.更新当前查看器请求(nextRequest);
        return;
      }
      if (!deps.读取查看器是否已打开()) {
        if (起始视频会话当前不可打开(nextRequest)) {
          return;
        }
        if (是否应等待本地完整视频会话真相(nextRequest)) {
          return;
        }
        正式打开查看器(nextRequest);
        return;
      }
      if (上次已交付查看器请求摘要 === nextRequest摘要) {
        return;
      }
      /**
       * `同步查看器` 里允许先 flush 旧附件的最新播放位置，再切到下一条视频。
       * 这次 flush 会同步回流到媒体运行时，进而重入 `同步当前查看器请求()`。
       *
       * 如果摘要要等 `同步查看器` 返回后才更新，同一条 nextRequest 在重入窗口里
       * 仍会被误判成“尚未交付”，于是再次触发 `同步查看器`，最终把查看器切源链递归打爆。
       *
       * 因此这里必须像 `正式打开查看器` 一样，先把“这次 request 已经交付”写入本地摘要，
       * 再进入底层 viewer sync；这样重入只会看到同一条摘要并立刻停住。
       */
      上次已交付查看器请求摘要 = nextRequest摘要;
      deps.同步查看器(nextRequest);
    },

    处理查看器请求已清空(): void {
      待重裁决的本地完整视频附件标识 = null;
      上次已交付查看器请求摘要 = null;
      /**
       * 返回群聊后用户可能立刻再点同一个自动播视频。
       * 这段极短窗口只保留源字符串，不保留重媒体对象；过期后自然失效。
       */
      deps.清除程序滚动来源("media_viewer_open");
    },

    重置(): void {
      待重裁决的本地完整视频附件标识 = null;
      上次已交付查看器请求摘要 = null;
      自动播查看器交接播放结果.clear();
    },
  };
}
