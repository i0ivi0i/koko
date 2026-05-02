import { 视频地址属于旧流媒体清单 } from "../媒体/媒体播放.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import { 读取默认全局唯一播放器 } from "../媒体/全局唯一播放器.js";

interface 时间线播放器宿主Owner依赖 {
  读取宿主根: () => ParentNode;
  恢复播放位置: (attachmentId: string, video: HTMLVideoElement) => void;
  标记首帧已就绪: (attachmentId: string, currentSrc: string | null) => void;
  标记可见接管已就绪: (attachmentId: string, video: HTMLVideoElement) => void;
  广播播放位置: (
    attachmentId: string,
    video: HTMLVideoElement,
    force?: boolean,
    allowReleasedOwner?: boolean
  ) => void;
  广播媒体会话信号: (attachmentId: string, signal: 媒体会话信号) => void;
}

/**
 * 时间线播放器宿主 owner 只负责“唯一播放器挂到哪一个 DOM 宿主”。
 *
 * 房间消息窗仍然渲染 host 节点，但不能直接拥有 Video.js 生命周期；
 * 这里把合法 source 校验、隐藏宿主优先级和唯一播放器同步收进一个 owner，
 * 避免壳组件重新长出播放器管理逻辑。
 */
export class 时间线播放器宿主Owner {
  constructor(private readonly 依赖: 时间线播放器宿主Owner依赖) {}

  同步(ownerAttachmentId: string | null): void {
    const 全局唯一播放器 = 读取默认全局唯一播放器();
    if (!ownerAttachmentId) {
      全局唯一播放器.同步时间线自动播(null);
      return;
    }

    const root = this.依赖.读取宿主根();
    const visibleHost = root.querySelector<HTMLElement>(
      `.message-video-canonical-host[data-attachment-id="${ownerAttachmentId}"]`
    );
    const stageHost = root.querySelector<HTMLElement>(
      `.message-video-canonical-stage-host[data-attachment-id="${ownerAttachmentId}"]`
    );
    const host = visibleHost ?? stageHost;
    const src = host?.dataset.videoSrc?.trim() ?? "";
    const kind = host?.dataset.videoKind === "file" ? "file" : null;
    const width = Number(host?.dataset.videoWidth ?? "0");
    const height = Number(host?.dataset.videoHeight ?? "0");

    if (!host || !host.isConnected || !src) {
      // owner 仍存在但虚拟宿主暂不在 DOM 时，不把唯一播放器误翻译成“停止播放”。
      全局唯一播放器.暂停当前时间线播放();
      return;
    }
    if (
      !kind ||
      视频地址属于旧流媒体清单(src) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      全局唯一播放器.同步时间线自动播(null);
      return;
    }

    全局唯一播放器.同步时间线自动播({
      attachmentId: ownerAttachmentId,
      mountTarget: host,
      source: {
        kind,
        src,
        posterSrc: host.dataset.videoPoster?.trim() || null,
        width,
        height,
      },
      回调: {
        恢复播放位置: (video) => {
          this.依赖.恢复播放位置(ownerAttachmentId, video);
        },
        标记首帧已就绪: (currentSrc) => {
          this.依赖.标记首帧已就绪(ownerAttachmentId, currentSrc);
        },
        标记可见接管已就绪: (video) => {
          this.依赖.标记可见接管已就绪(ownerAttachmentId, video);
        },
        广播播放位置: (video, force = false, allowReleasedOwner = false) => {
          this.依赖.广播播放位置(ownerAttachmentId, video, force, allowReleasedOwner);
        },
        广播媒体会话信号: (signal) => {
          this.依赖.广播媒体会话信号(ownerAttachmentId, signal);
        },
      },
    });
  }

  停止(): void {
    读取默认全局唯一播放器().同步时间线自动播(null);
  }

  冲刷当前播放位置(): void {
    读取默认全局唯一播放器().冲刷当前时间线播放位置();
  }
}
