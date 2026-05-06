// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import {
  创建媒体消息窗,
  创建媒体消息项,
  等待时间线唯一播放器挂载,
  驱动时间线Canonical就绪,
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 - 无海报视频自动播接管", () => {
  it("无 poster 视频从首帧预览切到自动播 owner 时应复用同一 video 节点，避免闪烁重建", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.autoplay).toBe(false);
    expect(beforeOwnerVideo?.getAttribute("poster")).toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-1";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const ownerWarmupVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerWarmupVideo).toBe(beforeOwnerVideo);
    expect(ownerWarmupVideo?.dataset.canonicalPlayer).toBeUndefined();
    expect(ownerWarmupVideo?.autoplay).toBe(false);
    expect(ownerWarmupVideo?.getAttribute("poster")).toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-host[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.autoplay).toBe(true);

    pane.remove();
  });

  it("无 poster 视频在自动播 owner 释放后应保持已解析预览源，避免回切原始源闪烁", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(previewVideo?.autoplay).toBe(false);

    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-1";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const ownerWarmupVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerWarmupVideo).toBe(previewVideo);
    expect(ownerWarmupVideo?.dataset.canonicalPlayer).toBeUndefined();
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo).not.toBe(previewVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);

    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = null;
    await pane.updateComplete;

    const releasedVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(releasedVideo).toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    pane.remove();
  });

  it("无 poster 视频进入自动播 owner 时应优先复用当前 swarm 预览源，避免切源闪烁", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerVideo?.autoplay).toBe(false);

    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-1";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const ownerWarmupVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerWarmupVideo).toBe(beforeOwnerVideo);
    expect(ownerWarmupVideo?.dataset.canonicalPlayer).toBeUndefined();
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);

    pane.remove();
  });

  it("无 poster 视频切到自动播 owner 且沿用同一条 swarm 预览源时，会显式触发 play 以避免 autoplay 失效", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-1",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerVideo?.autoplay).toBe(false);

    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-1";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);

    const ownerWarmupVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerWarmupVideo).toBe(beforeOwnerVideo);
    expect(ownerWarmupVideo?.dataset.canonicalPlayer).toBeUndefined();
    expect(
      pane.querySelector('.message-video-canonical-stage-host[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(playSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    playSpy.mockRestore();
    pane.remove();
  });
});
