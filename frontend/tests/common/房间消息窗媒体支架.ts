import { vi } from "vitest";
import { 读取默认全局唯一播放器 } from "../../媒体/全局唯一播放器";
import { 创建VideoJs播放器壳 } from "../../媒体/videojs播放器壳.js";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import type { 消息展示项 } from "../../房间消息窗/视图";
import "../../房间消息窗/壳";

export const 安装消息窗直达全屏模拟 = () => {
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
  const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "requestFullscreen"
  );
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  const requestFullscreen = vi.fn(function (this: Element) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  const restore = () => {
    if (fullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", fullscreenDescriptor);
    } else {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
    if (exitFullscreenDescriptor) {
      Object.defineProperty(document, "exitFullscreen", exitFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(document, "exitFullscreen");
    }
    if (requestFullscreenDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", requestFullscreenDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    }
  };
  return { requestFullscreen, exitFullscreen, restore };
};

export const 空文本布局 = {
  height: 0,
  lineCount: 0,
  naturalWidth: 0,
  maxLineWidth: 0,
  lines: [],
};

export const 创建媒体消息项 = (): 消息展示项 => ({
  kind: "message",
  id: "m-1",
  owner: "other",
  body: "",
  hasText: false,
  layout: 空文本布局,
  bubbleWidth: 320,
  senderDisplayAlias: "冷静的水獭",
  showAlias: true,
  eventPosition: 1,
  attachments: [
    {
      kind: "image",
      attachmentId: "att-image-1",
      width: 1200,
      height: 800,
      displayWidth: 320,
      displayHeight: 213,
    },
    {
      kind: "video",
      attachmentId: "att-video-1",
      width: 1280,
      height: 720,
      displayWidth: 320,
      displayHeight: 180,
      posterSrc: "http://media.local/poster-video-1",
    },
  ],
});

export const 创建五附件拼贴消息项 = (): 消息展示项 => ({
  kind: "message",
  id: "m-collage-1",
  owner: "other",
  body: "",
  hasText: false,
  layout: 空文本布局,
  bubbleWidth: 384,
  senderDisplayAlias: "冷静的水獭",
  showAlias: true,
  eventPosition: 1,
  attachmentLayout: {
    template: "hero-strip",
    columnCount: 2,
    gap: 8,
    rowHeight: 240,
    contentWidth: 384,
  },
  attachments: [
    {
      kind: "image",
      attachmentId: "att-hero",
      width: 1200,
      height: 800,
      gridColumnStart: 1,
      gridColumnSpan: 1,
      gridRowStart: 1,
      gridRowSpan: 2,
      displayWidth: 188,
      displayHeight: 488,
    },
    {
      kind: "video",
      attachmentId: "att-video-2",
      width: 1280,
      height: 720,
      gridColumnStart: 2,
      gridColumnSpan: 1,
      gridRowStart: 1,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
      posterSrc: "http://media.local/poster-video-2",
    },
    {
      kind: "image",
      attachmentId: "att-image-3",
      width: 1200,
      height: 800,
      gridColumnStart: 2,
      gridColumnSpan: 1,
      gridRowStart: 2,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
    },
    {
      kind: "video",
      attachmentId: "att-video-4",
      width: 1280,
      height: 720,
      gridColumnStart: 1,
      gridColumnSpan: 1,
      gridRowStart: 3,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
      posterSrc: "http://media.local/poster-video-4",
    },
    {
      kind: "image",
      attachmentId: "att-image-5",
      width: 1200,
      height: 800,
      gridColumnStart: 2,
      gridColumnSpan: 1,
      gridRowStart: 3,
      gridRowSpan: 1,
      displayWidth: 188,
      displayHeight: 240,
    },
  ],
});

export const 创建单视频消息项 = (attachmentId: string, eventPosition: number): 消息展示项 => ({
  kind: "message",
  id: `m-${attachmentId}`,
  owner: "other",
  body: "",
  hasText: false,
  layout: 空文本布局,
  bubbleWidth: 320,
  senderDisplayAlias: "冷静的水獭",
  showAlias: true,
  eventPosition,
  attachments: [
    {
      kind: "video",
      attachmentId,
      width: 1280,
      height: 720,
      displayWidth: 320,
      displayHeight: 180,
      posterSrc: `http://media.local/poster-${attachmentId}`,
    },
  ],
});

export const 创建媒体消息窗 = (
  options: {
    createVideoJsPlayerShell?: typeof 创建VideoJs播放器壳;
  } = {}
): 房间消息窗 => {
  const 全局唯一播放器 = 读取默认全局唯一播放器();
  全局唯一播放器.销毁();
  if (options.createVideoJsPlayerShell) {
    全局唯一播放器.配置壳工厂((initialSource, deps = {}) =>
      options.createVideoJsPlayerShell!(initialSource, deps)
    );
  } else {
    全局唯一播放器.配置壳工厂((initialSource, deps = {}) => {
      const video = document.createElement("video");
      const container = document.createElement("div");
      const 挂载到宿主 = (mountTarget: HTMLElement): void => {
        mountTarget.append(container);
        if (!container.contains(video)) {
          container.append(video);
        }
      };
      const 同步源 = (source = initialSource): void => {
        video.src = source.src;
        if (source.posterSrc) {
          video.poster = source.posterSrc;
        } else {
          video.removeAttribute("poster");
        }
      };
      if (deps.mountTarget) {
        挂载到宿主(deps.mountTarget);
      }
      同步源(initialSource);
      return {
        destroy() {
          video.pause();
          container.remove();
        },
        同步: 同步源,
        挂载到宿主,
        进入全屏: async () => "standard",
        读取视频元素: () => video,
        读取容器元素: () => container,
      };
    });
  }
  // 阶段 0 的保护测试共用同一条“图片 + 视频”消息，防止两条入口的 fixture 漂移。
  const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
  pane.items = [创建媒体消息项()];
  return pane;
};

export const 等待时间线唯一播放器挂载 = async (
  pane: 房间消息窗,
  maxTurns = 40
): Promise<void> => {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    await pane.updateComplete;
    if (
      pane.querySelector("koko-video-skin") &&
      pane.querySelector('video.message-video-preview[data-canonical-player="true"]')
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

export const 驱动时间线Canonical就绪 = async (
  pane: 房间消息窗,
  attachmentId: string
): Promise<HTMLVideoElement | null> => {
  const canonicalVideo = pane.querySelector<HTMLVideoElement>(
    `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
  );
  if (!canonicalVideo) {
    return null;
  }
  Object.defineProperty(canonicalVideo, "readyState", {
    configurable: true,
    value: 3,
  });
  canonicalVideo.dispatchEvent(new Event("loadedmetadata"));
  canonicalVideo.dispatchEvent(new Event("seeked"));
  canonicalVideo.dispatchEvent(new Event("canplay"));
  await pane.updateComplete;
  await 等待时间线唯一播放器挂载(pane);
  return pane.querySelector<HTMLVideoElement>(
    `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
  );
};
