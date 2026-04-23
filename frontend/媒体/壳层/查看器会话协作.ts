import type {
  媒体会话快照,
  媒体会话端口,
  媒体查看器打开请求,
  视频预览状态,
} from "../index.js";

type 查看器会话协作依赖 = {
  读取当前查看器请求(): 媒体查看器打开请求 | null;
  读取查看器是否已打开(): boolean;
  读取媒体会话快照(attachmentId: string): 媒体会话快照 | null;
  读取媒体会话(attachmentId: string): 媒体会话端口 | null;
  读取视频预览状态(attachmentId: string): 视频预览状态 | null;
  更新当前查看器请求(request: 媒体查看器打开请求): void;
  确认查看器已打开(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步查看器(request: 媒体查看器打开请求): void;
  登记程序滚动来源(source: "media_viewer_open"): void;
  清除程序滚动来源(source: "media_viewer_open"): void;
};

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
      if (
        playback?.mode === "blob" ||
        playback?.mode === "swarm" ||
        playback?.mode === "anchor" ||
        playback?.mode === "manifest"
      ) {
        if (item.kind === "video") {
          return {
            ...item,
            src: playback.src,
            ...(playback.mode === "manifest" && playback.fallbackSrc
              ? {
                  fallbackSrc: playback.fallbackSrc,
                }
              : {}),
            posterSrc: playback.thumbnailUrl ?? item.posterSrc,
            ...(playback.mode === "manifest" && playback.streamingDistribution
              ? {
                  streamingDistribution: playback.streamingDistribution,
                }
              : {}),
          };
        }
        return {
          ...item,
          src: playback.mode === "blob" ? playback.viewerSrc ?? playback.src : playback.src,
          ...((playback.mode === "blob" || playback.mode === "swarm") &&
          ("contentHash" in playback || "distribution" in playback)
            ? {
                contentHash: playback.contentHash ?? null,
                distribution: playback.distribution ?? null,
              }
            : {}),
        };
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
     * 本地完整度可能先于 playback hydrate 恢复；这时先等会话真相一拍，
     * 避免查看器拿静态 HLS/original src 先打一轮冷源请求。
     * manifest 只重裁一次，防止为了 P2P 复用把查看器卡进无限等待。
     */
    if (sessionSnapshot.playback.mode !== "manifest") {
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
      if (JSON.stringify(nextRequest) !== JSON.stringify(当前查看器请求)) {
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
      deps.同步查看器(nextRequest);
    },

    处理查看器请求已清空(): void {
      待重裁决的本地完整视频附件标识 = null;
      deps.清除程序滚动来源("media_viewer_open");
    },

    重置(): void {
      待重裁决的本地完整视频附件标识 = null;
    },
  };
}
