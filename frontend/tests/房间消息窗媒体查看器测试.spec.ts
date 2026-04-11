// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { 媒体播放结果 } from "../媒体/媒体播放";
import type { 媒体查看器打开请求 } from "../媒体/媒体查看器";
import type { 房间消息窗 } from "../房间消息窗";
import "../房间消息窗";

const 空文本布局 = {
  height: 0,
  lineCount: 0,
  naturalWidth: 0,
  maxLineWidth: 0,
  lines: [],
};

describe("房间消息窗媒体查看器", () => {
  it("点击视频入口时只抛出 viewer 意图，并优先使用 WebTorrent swarm 播放源", async () => {
    const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
    pane.items = [
      {
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
      },
    ];
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
    document.body.appendChild(pane);
    await pane.updateComplete;

    pane
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
      )
      ?.click();
    await pane.updateComplete;

    expect(details).toHaveLength(1);
    expect(details[0]?.startAttachmentId).toBe("att-video-1");
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
        src: "blob:http://media.local/webtorrent-video-1",
        posterSrc: "http://media.local/poster-video-1",
        width: 1280,
        height: 720,
      },
    ]);
    expect(pane.querySelector('[data-video-preview="att-video-1"]')).toBeNull();

    pane.remove();
  });
});
