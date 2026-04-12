// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { 媒体播放结果 } from "../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器";
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
});
