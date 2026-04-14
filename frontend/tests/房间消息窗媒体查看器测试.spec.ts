// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { 媒体播放结果 } from "../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器";
import type { 媒体会话信号 } from "../媒体/媒体会话";
import type { 房间消息窗 } from "../房间消息窗";
import type { 消息展示项 } from "../视图";
import "../房间消息窗";

const 空文本布局 = {
  height: 0,
  lineCount: 0,
  naturalWidth: 0,
  maxLineWidth: 0,
  lines: [],
};

const 创建媒体消息项 = (): 消息展示项 => ({
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
      thumbnailSrc: "http://media.local/thumb-image-1",
      originalSrc: "http://media.local/original-image-1",
    },
    {
      kind: "video",
      attachmentId: "att-video-1",
      width: 1280,
      height: 720,
      displayWidth: 320,
      displayHeight: 180,
      originalSrc: "http://media.local/original-video-1",
      posterSrc: "http://media.local/poster-video-1",
    },
  ],
});

const 创建媒体消息窗 = (): 房间消息窗 => {
  // 阶段 0 的保护测试共用同一条“图片 + 视频”消息，防止两条入口的 fixture 漂移。
  const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
  pane.items = [创建媒体消息项()];
  return pane;
};

describe("房间消息窗媒体查看器", () => {
  it("点击图片和视频入口时只抛出 viewer 意图，并优先使用 WebTorrent swarm 播放源", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-video-1",
        thumbnailUrl: "http://media.local/poster-video-1",
        hint: null,
      } satisfies 媒体播放结果,
    };

    const details: 媒体查看器打开请求[] = [];
    pane.addEventListener("room-open-media-viewer", (event) => {
      details.push((event as CustomEvent<媒体查看器打开请求>).detail);
    });
    const scrollIntentEvents: Event[] = [];
    pane.addEventListener("room-scroll-intent", (event) =>
      scrollIntentEvents.push(event)
    );
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.click();
    await pane.updateComplete;

    const expectedItems = [
      {
        attachmentId: "att-image-1",
        kind: "image",
        src: "http://media.local/original-image-1",
        alt: "图片附件原图",
        width: 1200,
        height: 800,
      },
      {
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-video-1",
        posterSrc: "http://media.local/poster-video-1",
        width: 1280,
        height: 720,
      },
    ];
    expect(details).toHaveLength(2);
    expect(details.map((detail) => detail.startAttachmentId)).toEqual([
      "att-video-1",
      "att-image-1",
    ]);
    expect(details.map((detail) => detail.items)).toEqual([
      expectedItems,
      expectedItems,
    ]);
    expect(scrollIntentEvents).toHaveLength(0);
    expect(pane.querySelector('[data-video-preview="att-video-1"]')).toBeNull();

    pane.remove();
  });

  it("点击媒体入口后，消息窗内部仍然不会偷偷创建正式播放器壳", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "manifest",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: "http://media.local/poster-video-1",
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
        },
        hint: null,
      } satisfies 媒体播放结果,
    };

    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    // 消息窗只负责预览与查看器意图，不允许自己长成第二套正式播放器实现。
    expect(pane.querySelector("video-player[data-player-shell='videojs']")).toBeNull();

    pane.remove();
  });

  it("点按媒体入口不应被误判成滚动意图，避免触发顶部补历史", async () => {
    const pane = 创建媒体消息窗();

    const scrollIntentEvents: Event[] = [];
    pane.addEventListener("room-scroll-intent", (event) =>
      scrollIntentEvents.push(event)
    );
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    pane
      .querySelector<HTMLButtonElement>(
        'button.message-image-preview-trigger[data-attachment-id="att-image-1"]'
      )
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));

    expect(scrollIntentEvents).toHaveLength(0);

    pane
      .querySelector<HTMLElement>("#messageScroll")
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));

    expect(scrollIntentEvents).toHaveLength(1);

    pane.remove();
  });

  it("视频预览运行时信号会抛给应用层，而不是继续困在 DOM/video 元素里", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "anchor",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/original-video-1",
        thumbnailUrl: "http://media.local/poster-video-1",
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

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    preview?.dispatchEvent(new Event("playing"));
    preview?.dispatchEvent(new Event("waiting"));

    expect(信号记录).toEqual([
      {
        attachmentId: "att-video-1",
        signal: { type: "PLAYER_PLAYING" },
      },
      {
        attachmentId: "att-video-1",
        signal: { type: "PLAYER_WAITING" },
      },
    ]);

    pane.remove();
  });

  it("视频已经切到 HLS manifest 主链时，消息卡片继续用 poster 占位，但查看器要拿到 manifest 地址", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "manifest",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: "http://media.local/poster-video-1",
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
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

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview?.getAttribute("src")).toBeNull();
    expect(preview?.getAttribute("poster")).toBe("http://media.local/poster-video-1");

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.items).toEqual([
      {
        attachmentId: "att-image-1",
        kind: "image",
        src: "http://media.local/original-image-1",
        alt: "图片附件原图",
        width: 1200,
        height: 800,
      },
      {
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        posterSrc: "http://media.local/poster-video-1",
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
        },
        width: 1280,
        height: 720,
      },
    ]);

    pane.remove();
  });

  it("视频已经切到 HLS manifest 主链且没有 poster 时，消息卡片会退到静态占位，而不是把 m3u8 塞给原生 video", async () => {
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
            originalSrc: "http://media.local/original-video-1",
            posterSrc: null,
          },
        ],
      },
    ];
    pane.mediaPlaybackByAttachmentId = {
      "att-video-1": {
        mode: "manifest",
        attachmentId: "att-video-1",
        kind: "video",
        src: "http://media.local/stream/att-video-1/master.m3u8",
        thumbnailUrl: null,
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
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

    const preview = pane.querySelector<HTMLVideoElement>(
      'video.message-video-preview[data-attachment-id="att-video-1"]'
    );
    expect(preview?.getAttribute("src")).toBeNull();
    expect(preview?.getAttribute("poster")).toContain("data:image/svg+xml");

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
        src: "http://media.local/stream/att-video-1/master.m3u8",
        posterSrc: null,
        streamingDistribution: {
          swarm_id: "swarm-hash-video-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/web-seed-video-1",
          join_ticket: null,
        },
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

  it("图片已经切到 Blob 资产主链时，卡片继续吃 preview，查看器会拿 full 主链", async () => {
    const pane = 创建媒体消息窗();
    pane.mediaPlaybackByAttachmentId = {
      "att-image-1": {
        mode: "blob",
        attachmentId: "att-image-1",
        kind: "image",
        src: "http://media.local/blob/att-image-1/preview.webp",
        viewerSrc: "http://media.local/blob/att-image-1/full.webp",
        thumbnailUrl: "http://media.local/blob/att-image-1/preview.webp",
        contentHash: "hash-image-1",
        distribution: {
          swarm_id: "swarm-image-1",
          announce_urls: ["wss://tracker.koko.local/announce"],
          web_seed_url: "http://media.local/blob/att-image-1/original.png",
          join_ticket: null,
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
    expect(preview?.getAttribute("src")).toBe(
      "http://media.local/blob/att-image-1/preview.webp"
    );

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
      src: "http://media.local/blob/att-image-1/full.webp",
      contentHash: "hash-image-1",
      distribution: {
        swarm_id: "swarm-image-1",
        announce_urls: ["wss://tracker.koko.local/announce"],
        web_seed_url: "http://media.local/blob/att-image-1/original.png",
        join_ticket: null,
      },
      alt: "图片附件原图",
      width: 1200,
      height: 800,
    });

    pane.remove();
  });
});
