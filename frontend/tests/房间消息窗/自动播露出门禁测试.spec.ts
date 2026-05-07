// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { 媒体播放结果 } from "../../媒体/媒体播放.js";
import { 创建媒体消息窗, 创建单视频消息项 } from "../common/房间消息窗媒体支架.js";

describe("房间消息窗 / 自动播露出门禁", () => {
  it("可见宿主先提交了错位帧时，不能提前记成已出可见帧", async () => {
    const pane = 创建媒体消息窗();
    const attachmentId = "att-video-visible-misaligned-frame";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "http://media.local/swarm-visible-misaligned-frame",
      thumbnailUrl: "http://media.local/poster-visible-misaligned-frame",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建单视频消息项(attachmentId, 1)];
    pane.mediaPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = attachmentId;
    pane.inlineAutoplayPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      [attachmentId]: {
        src: playback.src,
        currentTime: 18,
        updatedAt: 1_715_000_000_002,
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const visibleCanonical = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"][data-canonical-player="true"]`
    );
    expect(visibleCanonical).not.toBeNull();
    Object.defineProperty(visibleCanonical!, "readyState", {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(visibleCanonical!, "currentTime", {
      configurable: true,
      value: 0.16,
    });

    (
      pane as unknown as {
        时间线唯一播放器可见宿主已出帧源: Map<string, string>;
        标记时间线唯一播放器可见宿主已出帧: (
          attachmentId: string,
          video: HTMLVideoElement
        ) => void;
        读取时间线唯一播放器可见宿主是否已出帧: (
          attachmentId: string,
          src: string | null
        ) => boolean;
      }
    ).时间线唯一播放器可见宿主已出帧源.delete(attachmentId);
    (
      pane as unknown as {
        标记时间线唯一播放器可见宿主已出帧: (
          attachmentId: string,
          video: HTMLVideoElement
        ) => void;
      }
    ).标记时间线唯一播放器可见宿主已出帧(attachmentId, visibleCanonical!);

    expect(
      (
        pane as unknown as {
          读取时间线唯一播放器可见宿主是否已出帧: (
            attachmentId: string,
            src: string | null
          ) => boolean;
        }
      ).读取时间线唯一播放器可见宿主是否已出帧(attachmentId, playback.src)
    ).toBe(false);

    pane.remove();
  });

  it("只有保存续播点但还没出可见帧时，poster 必须继续挡住 covered canonical", async () => {
    const pane = 创建媒体消息窗();
    const attachmentId = "att-video-hidden-handoff";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "http://media.local/swarm-hidden-handoff",
      thumbnailUrl: "http://media.local/poster-hidden-handoff",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建单视频消息项(attachmentId, 1)];
    pane.mediaPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayOwnerAttachmentId = attachmentId;
    pane.inlineAutoplayPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      [attachmentId]: {
        src: playback.src,
        currentTime: 18,
        updatedAt: 1_715_000_000_000,
      },
    };
    (
      pane as unknown as {
        时间线隐藏接管附件Id: string | null;
      }
    ).时间线隐藏接管附件Id = attachmentId;

    document.body.appendChild(pane);
    await pane.updateComplete;

    expect(
      pane.querySelector(
        `.message-video-canonical-host[data-attachment-id="${attachmentId}"]`
      )
    ).not.toBeNull();
    expect(
      pane.querySelector(
        `.message-video-canonical-stage-host[data-attachment-id="${attachmentId}"]`
      )
    ).toBeNull();
    expect(
      pane.querySelector(`img.message-video-poster[data-attachment-id="${attachmentId}"]`)
    ).not.toBeNull();

    pane.remove();
  });

  it("现有 preview 视频还停在旧时间点时，仍可先作为 cover 承接，不能退回 poster 或 stage host", async () => {
    const pane = 创建媒体消息窗();
    const attachmentId = "att-video-wrong-preview-frame";
    const playback = {
      mode: "swarm",
      attachmentId,
      kind: "video",
      src: "http://media.local/swarm-wrong-preview-frame",
      thumbnailUrl: "http://media.local/poster-wrong-preview-frame",
      hint: null,
    } satisfies 媒体播放结果;

    pane.items = [创建单视频消息项(attachmentId, 1)];
    pane.mediaPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
    );
    expect(previewVideo).not.toBeNull();
    Object.defineProperty(previewVideo!, "readyState", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(previewVideo!, "currentTime", {
      configurable: true,
      value: 0,
    });
    previewVideo!.dataset.previewReadySrc = playback.src;
    previewVideo!.dataset.previewSrc = playback.src;

    pane.inlineAutoplayOwnerAttachmentId = attachmentId;
    pane.inlineAutoplayPlaybackByAttachmentId = {
      [attachmentId]: playback,
    };
    pane.inlineAutoplayPositionByAttachmentId = {
      [attachmentId]: {
        src: playback.src,
        currentTime: 18,
        updatedAt: 1_715_000_000_001,
      },
    };
    (
      pane as unknown as {
        时间线隐藏接管附件Id: string | null;
      }
    ).时间线隐藏接管附件Id = attachmentId;
    await pane.updateComplete;

    expect(
      pane.querySelector(
        `video.message-video-preview[data-attachment-id="${attachmentId}"]:not([data-canonical-player="true"])`
      )
    ).not.toBeNull();
    expect(
      pane.querySelector(`img.message-video-poster[data-attachment-id="${attachmentId}"]`)
    ).toBeNull();
    expect(
      pane.querySelector(
        `.message-video-canonical-host[data-attachment-id="${attachmentId}"]`
      )
    ).not.toBeNull();
    expect(
      pane.querySelector(
        `.message-video-canonical-stage-host[data-attachment-id="${attachmentId}"]`
      )
    ).toBeNull();

    pane.remove();
  });
});
