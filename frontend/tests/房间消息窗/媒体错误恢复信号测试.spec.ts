// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { 媒体播放结果 } from "../../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../../媒体/媒体查看器";
import type { 媒体会话信号 } from "../../媒体/媒体会话";
import {
  安装消息窗直达全屏模拟,
  创建媒体消息窗,
  创建媒体消息项,
  等待时间线唯一播放器挂载,
  驱动时间线Canonical就绪,
} from "../common/房间消息窗媒体支架";

describe("房间消息窗媒体查看器 - 媒体错误恢复信号", () => {
  it("统一预算降成冷态且无正式字节时，历史保存位置不能复活真实 preview video", async () => {
    const pane = 创建媒体消息窗();
    const swarmSrc =
      "/webtorrent/2fac1903a210aa9d28426a0d6dad1b8acd431336/content-video.mp4";
    pane.items = [
      {
        ...创建媒体消息项(),
        id: "message-video-1",
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
    pane.inlineAutoplayOwnerAttachmentId = "att-video-2";
    pane.inlineAutoplayPositionByAttachmentId = {
      "att-video-1": {
        src: swarmSrc,
        currentTime: 27.75,
        updatedAt: 1_777_399_000_000,
      },
    };
    (
      pane as unknown as {
        mediaVideoBudgetByAttachmentId: Record<
          string,
          {
            attachmentId: string;
            tier: string;
            reason: string;
            canonicalVideoSrc: string | null;
            previewVideoSrc: string | null;
            allowInlineCanonical: boolean;
            allowPreviewVideo: boolean;
            formalByteSource: string;
          }
        >;
      }
    ).mediaVideoBudgetByAttachmentId = {
      "att-video-1": {
        attachmentId: "att-video-1",
        tier: "cold_expression",
        reason: "inactive",
        canonicalVideoSrc: null,
        previewVideoSrc: null,
        allowInlineCanonical: false,
        allowPreviewVideo: false,
        formalByteSource: "none",
      },
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]:not([data-canonical-player="true"])'
    );
    expect(preview).toBeNull();
    expect(
      pane
        .querySelector<HTMLImageElement>('img.message-video-poster[data-attachment-id="att-video-1"]')
        ?.getAttribute("src")
    ).toBe("http://media.local/poster-video-1");
    expect(
      pane.querySelector(
        '.message-video-card[data-attachment-id="att-video-1"] .message-video-play-indicator'
      )
    ).not.toBeNull();

    pane.remove();
  });

  it("点击非自动播 owner 视频时，仍然继续走查看器冷开请求", async () => {
    const { requestFullscreen, restore } = 安装消息窗直达全屏模拟();
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
        src: "blob:http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    pane.inlineAutoplayOwnerAttachmentId = null;
    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    try {
      document.body.appendChild(pane);
      await pane.updateComplete;

      pane
        .querySelector<HTMLButtonElement>(
          'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
        )
        ?.click();
      await pane.updateComplete;

      expect(requestFullscreen).toHaveBeenCalledTimes(0);
      expect(details).toHaveLength(1);
      expect(details[0]?.startAttachmentId).toBe("att-video-1");
    } finally {
      pane.remove();
      restore();
    }
  });

  it("旧 manifest 播放快照没有 poster 时，查看器也不能继续带着 m3u8 打开", async () => {
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
        mode: "legacy_anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
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

    const previewPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(previewPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    const placeholderSvg = decodeURIComponent(
      previewPoster?.getAttribute("src")?.split(",")[1] ?? ""
    );
    expect(placeholderSvg).not.toContain("<polygon");
    expect(
      pane.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).toBeNull();

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.items).toEqual([
      {
        attachmentId: "att-video-1",
        kind: "video",
        src: "",
        posterSrc: null,
        width: 1280,
        height: 720,
      },
    ]);

    pane.remove();
  });

  it("图片预览加载失败时也会回抛媒体会话信号，而不是继续让旧 src 静默失效", async () => {
    const pane = 创建媒体消息窗();
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLImageElement>(
      'img.message-image[data-attachment-id="att-image-1"]'
    );
    preview?.dispatchEvent(new Event("error"));

    expect(信号记录).toEqual([
      {
        attachmentId: "att-image-1",
        signal: { type: "PLAYER_ERROR" },
      },
    ]);

    pane.remove();
  });

  it("非自动播 owner 的时间线视频触发 error 时，不应广播 PLAYER_ERROR 干扰会话恢复链路", async () => {
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
    pane.inlineAutoplayOwnerAttachmentId = null;
    pane.inlineAutoplayPlaybackByAttachmentId = {};
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview).not.toBeNull();

    preview?.dispatchEvent(new Event("error"));

    expect(信号记录).toEqual([]);

    pane.remove();
  });

  it("自动播 owner 的时间线视频触发 error 时，必须继续广播 PLAYER_ERROR 给媒体会话 owner", async () => {
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
    pane.inlineAutoplayPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/swarm-video-1",
        thumbnailUrl: null,
        hint: null,
      } satisfies 媒体播放结果,
    };
    pane.inlineAutoplayOwnerAttachmentId = "att-video-1";
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;
    await 等待时间线唯一播放器挂载(pane);
    await 驱动时间线Canonical就绪(pane, "att-video-1");
    // 自动播 owner 可能在挂载后立即回抛一次 PLAYER_PLAYING，这里清空只看 error 语义。
    信号记录.length = 0;

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"][data-canonical-player="true"]'
    );
    expect(preview).not.toBeNull();

    preview?.dispatchEvent(new Event("error"));

    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-1",
        signal: { type: "PLAYER_ERROR" },
      },
    ]);

    pane.remove();
  });

  it("视频封面加载失败时会回抛恢复信号并退回静态占位，新 thumbnail 到达后应恢复展示", async () => {
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
        mode: "legacy_anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: "http://media.local/poster-video-1-stale",
        hint: null,
      } satisfies 媒体播放结果,
    };
    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const stalePoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(stalePoster?.getAttribute("src")).toBe("http://media.local/poster-video-1-stale");

    stalePoster?.dispatchEvent(new Event("error"));
    await pane.updateComplete;

    const placeholderPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(placeholderPoster?.getAttribute("src")).toContain("data:image/svg+xml");
    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-1",
        signal: { type: "PLAYER_ERROR" },
      },
    ]);

    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "legacy_anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: "http://media.local/poster-video-1-fresh",
        hint: null,
      } satisfies 媒体播放结果,
    };
    await pane.updateComplete;

    const refreshedPoster = pane.querySelector<HTMLImageElement>(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    );
    expect(refreshedPoster?.getAttribute("src")).toBe("http://media.local/poster-video-1-fresh");

    pane.remove();
  });

  it("视频降级为 no_online_seed 时会显示手动重试入口，并回抛 ENTER_RECOVERING 信号", async () => {
    const pane = 创建媒体消息窗();
    pane.items = [
      {
        ...创建媒体消息项(),
        attachments: [
          {
            kind: "video",
            attachmentId: "att-video-no-seed-1",
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
      "att-video-no-seed-1": {
        mode: "degraded",
        attachmentId: "att-video-no-seed-1",
        kind: "video",
        src: "",
        thumbnailUrl: null,
        reason: "no_online_seed",
        hint: "当前没有在线种子，等待群友上线",
      } satisfies 媒体播放结果,
    };

    const 信号记录: Array<{ attachmentId: string; signal: 媒体会话信号 }> = [];
    pane.addEventListener("room-media-session-signal", (event) => {
      信号记录.push(
        (event as CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>).detail
      );
    });

    document.body.appendChild(pane);
    await pane.updateComplete;

    const retryButton = pane.querySelector<HTMLButtonElement>(
      'button.message-media-retry-trigger[data-attachment-id="att-video-no-seed-1"]'
    );
    expect(retryButton).not.toBeNull();

    retryButton?.click();

    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-no-seed-1",
        signal: { type: "ENTER_RECOVERING" },
      },
    ]);

    pane.remove();
  });

  it("图片只拿到 anchor 冷源时，卡片继续稳定占位，查看器也不会把它抬成正式原图", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-image-1": {
        mode: "legacy_anchor",
        attachmentId: "att-image-1",
        kind: "image",
        src: "http://media.local/blob/att-image-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-1/preview.webp",
        contentHash: "hash-image-1",
        distribution: {
          swarm_id: "swarm-image-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-1/original.png",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        hint: null,
      } satisfies 媒体播放结果,
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    document.body.appendChild(pane);
    await pane.updateComplete;

    const preview = pane.querySelector<HTMLImageElement>(
      'img.message-image[data-attachment-id="att-image-1"]'
    );
    expect(preview?.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.items[0]).toEqual({
      attachmentId: "att-image-1",
      kind: "image",
      src: "",
      alt: "图片附件原图",
      width: 1200,
      height: 800,
    });

    pane.remove();
  });
});
