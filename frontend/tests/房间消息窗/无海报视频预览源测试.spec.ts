// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../../媒体/媒体查看器";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import { 创建VideoJs播放器壳 } from "../../媒体/videojs播放器壳.js";
import {
  创建媒体消息窗,
  创建媒体消息项,
  等待时间线唯一播放器挂载,
  驱动时间线Canonical就绪,
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 - 无海报视频预览源", () => {
  it("无 poster 视频在首帧未就绪时应先显示轻量 guard，并在首帧事件后再揭开视频像素", async () => {
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
    const firstFrameGuard = pane.querySelector<HTMLImageElement>(
      'img.message-video-first-frame-guard[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).not.toBeNull();
    expect(previewVideo?.classList.contains("message-video-preview--gated")).toBe(true);
    expect(firstFrameGuard).not.toBeNull();
    expect(firstFrameGuard?.getAttribute("src")).toContain("data:image/svg+xml");

    Object.defineProperty(previewVideo!, "readyState", {
      configurable: true,
      value: 4,
    });
    previewVideo?.dispatchEvent(new Event("loadeddata"));
    await Promise.resolve();
    await pane.updateComplete;

    expect(
      pane.querySelector('img.message-video-first-frame-guard[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(previewVideo?.classList.contains("message-video-preview--gated")).toBe(false);

    pane.remove();
  });

  it("非自动播视频在没有 poster 但已解析 runtime preview 时，应直接显示 preview 图而不是继续等待 autoplay owner", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<
          string,
          { phase: "ready"; src: string; source: "cache" | "embedded_hint" | "early_frame" | "rvfc" }
        >;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-1": {
        phase: "ready",
        src: "blob:preview-att-video-1",
        source: "early_frame",
      },
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toBe("blob:preview-att-video-1");

    pane.remove();
  });

  it("无 poster 视频已命中 runtime preview 且 playback 可用时，非 owner 必须继续显示 runtime preview overlay，而不是裸露 swarm 冷帧", async () => {
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
    (
      pane as 房间消息窗 & {
        mediaPreviewByAttachmentId: Record<
          string,
          { phase: "ready"; src: string; source: "cache" | "embedded_hint" | "early_frame" | "rvfc" }
        >;
      }
    ).mediaPreviewByAttachmentId = {
      "att-video-1": {
        phase: "ready",
        src: "blob:preview-att-video-1",
        source: "early_frame",
      },
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const beforeOwnerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const beforeOwnerPreviewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(beforeOwnerVideo).not.toBeNull();
    expect(beforeOwnerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(beforeOwnerPreviewPoster).not.toBeNull();
    expect(beforeOwnerPreviewPoster?.getAttribute("src")).toBe("blob:preview-att-video-1");

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

    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();

    const ownerVideo = await 驱动时间线Canonical就绪(pane, "att-video-1");
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane.remove();
  });

  it("时间线 owner 复用 canonical player 时，会把统一壳标记成 inline 消息流表面", async () => {
    const pane = 创建媒体消息窗({
      createVideoJsPlayerShell: 创建VideoJs播放器壳,
    });
    pane.items = [
      {
        ...创建媒体消息项(),
        id: "m-inline-skin-owner-1",
        attachments: [
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
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-inline-skin-owner-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/swarm-inline-skin-owner-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    document.body.appendChild(pane);
    await 等待时间线唯一播放器挂载(pane);

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const skin = pane.querySelector<HTMLElement>("koko-video-skin");

    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.controls).toBe(false);
    expect(skin).not.toBeNull();
    expect(skin?.dataset.presentation).toBe("inline");

    pane.remove();
  });

  it("非自动播视频在没有 poster 且尚未注入 playback 时，会保持静态占位而不是读取 originalSrc", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    pane.remove();
  });

  it("非自动播视频即使当前只拿到 anchor playback，也必须继续保持静态占位而不是偷吃旧冷源", async () => {
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
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewVideo).toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(pane.querySelector(".message-video-play-indicator")).not.toBeNull();

    pane.remove();
  });

  it("无 poster 视频在 playback 首次解析到 swarm 后，会从静态占位升级为 swarm 首帧预览", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    document.body.appendChild(pane);
    await pane.updateComplete;

    const previewBeforeUpgrade = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    const posterBeforeUpgrade = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewBeforeUpgrade).toBeNull();
    expect(posterBeforeUpgrade).not.toBeNull();

    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: "正在协作分发",
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const previewAfterUpgrade = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(previewAfterUpgrade).not.toBeNull();
    expect(previewAfterUpgrade?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(previewAfterUpgrade?.autoplay).toBe(false);

    pane.remove();
  });

  it("视频在没有 playback 真相时，抛出的 viewer request 不会偷带 originalSrc", async () => {
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
    pane.mediaPlaybackByAttachmentId = {};
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      startAttachmentId: "att-video-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "",
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    });

    pane.remove();
  });

  it("新附件视频即使当前只拿到 anchor playback，抛出的 viewer request 也不能把它当成正式源", async () => {
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
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/anchor-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      startAttachmentId: "att-video-1",
      items: [
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "",
          posterSrc: null,
          width: 1280,
          height: 720,
        },
      ],
    });

    pane.remove();
  });

  it("图片在没有 playback 真相时，抛出的 viewer request 也不会偷带 originalSrc", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "image",
            attachmentId: "att-image-1",
            width: 1200,
            height: 800,
            displayWidth: 320,
            displayHeight: 213,
            thumbnailSrc: "http://media.local/thumb-image-1",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {};
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      startAttachmentId: "att-image-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-1",
          src: "",
          alt: "图片附件原图",
          width: 1200,
          height: 800,
        },
      ],
    });

    pane.remove();
  });

  it("新附件图片即使当前只拿到 anchor playback，也不能把它当成正式查看源", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "image",
            attachmentId: "att-image-1",
            width: 1200,
            height: 800,
            displayWidth: 320,
            displayHeight: 213,
            thumbnailSrc: "http://media.local/thumb-image-1",
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-image-1": {
        mode: "anchor",
        attachmentId: "att-image-1",
        kind: "image",
        src: "http://media.local/blob-canonical-image-1",
        thumbnailUrl: "http://media.local/blob-thumb-image-1",
        hint: null,
      } satisfies 媒体播放结果,
    };
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({
      startAttachmentId: "att-image-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-1",
          src: "",
          alt: "图片附件原图",
          width: 1200,
          height: 800,
        },
      ],
    });

    pane.remove();
  });

  it("同屏多个视频时，当前自动播 owner 仍只有一颗 canonical video，但在揭帘前允许保留自己的 preview overlay", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      创建媒体消息项(),
      {
        ...创建媒体消息项(),
        id: "m-2",
        eventPosition: 2,
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-2",
            width: 1280,
            height: 720,
            displayWidth: 320,
            displayHeight: 180,
            posterSrc: "http://media.local/poster-video-2",
          },
        ],
      },
    ];
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayOwnerAttachmentId = "att-video-2";
    (pane as 房间消息窗 & {
      inlineAutoplayOwnerAttachmentId: string | null;
      inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
    }).inlineAutoplayPlaybackByAttachmentId = {
      "att-video-2": {
        mode: "swarm",
        attachmentId: "att-video-2",
        kind: "video",
        src: "http://media.local/swarm-video-2",
        thumbnailUrl: "http://media.local/poster-video-2",
        hint: null,
      } satisfies 媒体播放结果,
    };
    document.body.appendChild(pane);
    await pane.updateComplete;

    const inlineVideos = pane.querySelectorAll<HTMLVideoElement>("video.message-video-preview");
    const canonicalVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"][data-canonical-player="true"]'
    );
    const previewSurface = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-2"]:not([data-canonical-player="true"])'
    );
    expect(inlineVideos).toHaveLength(1);
    expect(canonicalVideo).not.toBeNull();
    expect(previewSurface).toBeNull();
    expect(canonicalVideo?.loop).toBe(true);
    expect(canonicalVideo?.hasAttribute("disablepictureinpicture")).toBe(true);
    expect(canonicalVideo?.hasAttribute("disableremoteplayback")).toBe(true);
    expect(canonicalVideo?.getAttribute("controlslist")).toBe(
      "nodownload nofullscreen noremoteplayback"
    );
    expect(canonicalVideo?.getAttribute("tabindex")).toBe("-1");
    expect(canonicalVideo?.getAttribute("aria-hidden")).toBe("true");
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-1"]')
    ).not.toBeNull();
    expect(
      pane.querySelector('img.message-video-poster[data-attachment-id="att-video-2"]')
    ).not.toBeNull();

    pane.remove();
  });

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

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(ownerVideo?.getAttribute("poster")).toBeNull();
    expect(pane.querySelector(".message-video-play-indicator")).toBeNull();

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

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
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

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
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

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

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

    const ownerVideo = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(ownerVideo).not.toBe(beforeOwnerVideo);
    expect(ownerVideo?.dataset.canonicalPlayer).toBe("true");
    expect(ownerVideo?.getAttribute("src")).toBe("http://media.local/swarm-video-1");
    expect(ownerVideo?.autoplay).toBe(true);
    expect(playSpy).toHaveBeenCalledTimes(1);

    playSpy.mockRestore();
    pane.remove();
  });
});
