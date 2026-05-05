// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { 房间消息窗 } from "../../房间消息窗/壳";
import { 聊天壳 } from "../../应用根/聊天壳";
import {
  假传输,
  创建房间快照,
  等待组件稳定,
  输入房间短码到操作台,
  读取操作台主动作,
  注入媒体播放器供测试,
  注入媒体查看器供测试,
} from "../common/聊天测试支架";
import { 创建大量消息展示项, 注册聊天壳集成测试基线 } from "./测试支撑";

describe("聊天壳集成 / 消息舞台与媒体投影", () => {
  注册聊天壳集成测试基线();

  it("进入房间后会通过独立消息窗口组件承接消息区，但保留现有滚动查询入口", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 2, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-1",
            client_message_id: "c-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "消息-1",
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-2",
            client_message_id: "c-2",
            sender_session_id: "s-test",
            sender_display_alias: "暴躁的企鹅",
            text: "消息-2",
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(el.shadowRoot!.querySelector("koko-room-message-pane")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#messageScroll")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#messageList")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".message-body [data-line-index='0']")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".message-bubble")?.getAttribute("style")).toContain(
      "width:"
    );
    el.remove();
  });

  it("万人消息窗口只渲染当前虚拟窗口内的消息 DOM，但仍保留 event_position 定位入口", async () => {
    const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
    pane.items = 创建大量消息展示项(10_000);
    document.body.appendChild(pane);
    await pane.updateComplete;

    const renderedRows = pane.querySelectorAll("#messageList [data-event-position]");

    expect(renderedRows.length).toBeLessThanOrEqual(120);
    expect(renderedRows[0]?.getAttribute("data-event-position")).toBe("1");
    pane.remove();
  });

  it("万人消息恢复到靠后的未读位置时，虚拟窗口仍保留未读定位节点", async () => {
    const pane = document.createElement("koko-room-message-pane") as 房间消息窗;
    const items = 创建大量消息展示项(10_000);
    items.splice(8_999, 0, {
      kind: "unread-divider",
      id: "unread-divider",
      label: "未读消息",
    });
    pane.items = items;
    document.body.appendChild(pane);
    await pane.updateComplete;

    const renderedRows = pane.querySelectorAll("#messageList [data-event-position]");

    expect(renderedRows.length).toBeLessThanOrEqual(122);
    expect(pane.querySelector("#unreadDivider")).not.toBeNull();
    expect(pane.querySelector('[data-event-position="9000"]')).not.toBeNull();
    pane.remove();
  });

  it("纯图片权威消息会像 IM 一样直接展示原图媒体，不再套气泡底板", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-img-1",
            client_message_id: "c-img-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [{ kind: "image", attachment_id: "att-1", width: 1200, height: 800 }],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const image = el.shadowRoot!.querySelector(
      'img[data-attachment-id="att-1"]'
    ) as HTMLImageElement | null;
    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-image-preview-trigger[data-attachment-id="att-1"]'
    ) as HTMLButtonElement | null;
    const mediaSurface = el.shadowRoot!.querySelector(
      ".message-surface.media-message"
    ) as HTMLElement | null;
    expect(image).not.toBeNull();
    expect(image?.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(el.shadowRoot!.querySelector(".message-body")).toBeNull();
    expect(mediaSurface).not.toBeNull();
    expect(mediaSurface?.classList.contains("message-bubble")).toBe(false);
    expect(mediaSurface?.getAttribute("style")).toContain("width: 320px");
    expect(el.shadowRoot!.querySelector(".message-image-link")).toBeNull();
    expect(previewTrigger).not.toBeNull();

    previewTrigger!.click();
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-1",
            kind: "image",
              src: "",
          }),
        ],
      })
    );

    expect(el.shadowRoot!.querySelector('[data-image-preview="att-1"]')).toBeNull();
    el.remove();
  });

  it("带文字的媒体消息也使用媒体容器，不能因为有 caption 就退回气泡底板", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-img-caption-1",
            client_message_id: "c-img-caption-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "这是一张图片说明",
            attachments: [
              { kind: "image", attachment_id: "att-caption-image-1", width: 1200, height: 800 },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const mediaSurface = el.shadowRoot!.querySelector(
      ".message-surface.media-message"
    ) as HTMLElement | null;
    expect(mediaSurface).not.toBeNull();
    expect(mediaSurface?.classList.contains("message-bubble")).toBe(false);
    expect(mediaSurface?.querySelector(".message-body")?.textContent).toContain("这是一张图片说明");
    expect(el.shadowRoot!.querySelector(".message-bubble .message-image-card")).toBeNull();
    el.remove();
  });

  it("带视频附件的权威消息会在消息流里只渲染预览入口，点开后才播放", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-1",
            client_message_id: "c-video-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "看视频",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-1",
                width: 1280,
                height: 720,
                preview_asset: {
                  still_url:
                    "/api/attachments/att-video-1/content?session_id=s-test&variant=thumbnail",
                },
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-1",
        kind: "video",
        src: "blob:http://media.local/webtorrent-video-1",
        thumbnailUrl: "/api/attachments/att-video-1/content?session_id=s-test&variant=thumbnail",
        hint: "正在协作分发",
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-1"]'
    ) as HTMLButtonElement | null;
    const previewPoster = el.shadowRoot!.querySelector(
      'img.message-video-poster[data-attachment-id="att-video-1"]'
    ) as HTMLImageElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain(
      "/api/attachments/att-video-1/content?session_id=s-test&variant=thumbnail"
    );
    expect(
      el.shadowRoot!.querySelector('video.message-video-preview[data-attachment-id="att-video-1"]')
    ).toBeNull();

    previewTrigger!.click();
    await 等待组件稳定(el);
    await vi.waitFor(() => {
      expect(viewer.打开).toHaveBeenCalled();
    });

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-1",
            kind: "video",
            src: "blob:http://media.local/webtorrent-video-1",
          }),
        ],
      })
    );

    expect(el.shadowRoot!.querySelector('[data-video-preview="att-video-1"]')).toBeNull();
    el.remove();
  });

  it("带视频附件的权威消息会显示协作分发提示，而不是只把裸 originalSrc 塞给 video", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-swarm-1",
            client_message_id: "c-video-swarm-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "看协作分发视频",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-swarm-1",
                width: 1280,
                height: 720,
                preview_asset: {
                  still_url:
                    "/api/attachments/att-video-swarm-1/content?session_id=s-test&variant=thumbnail",
                },
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-swarm-1",
        kind: "video",
        src: "blob:http://localhost/swarm-video-1",
        thumbnailUrl: null,
        hint: "正在协作分发",
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-swarm-1"]'
    ) as HTMLButtonElement | null;
    const previewPoster = el.shadowRoot!.querySelector(
      'img.message-video-poster[data-attachment-id="att-video-swarm-1"]'
    ) as HTMLImageElement | null;
    const hint = el.shadowRoot!.querySelector(
      '[data-media-hint="att-video-swarm-1"]'
    ) as HTMLElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain(
      "/api/attachments/att-video-swarm-1/content?session_id=s-test&variant=thumbnail"
    );
    expect(
      el.shadowRoot!.querySelector(
        'video.message-video-preview[data-attachment-id="att-video-swarm-1"]'
      )
    ).toBeNull();
    expect(hint).toBeNull();

    previewTrigger!.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-swarm-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-swarm-1",
            kind: "video",
            src: "blob:http://localhost/swarm-video-1",
          }),
        ],
      })
    );
    el.remove();
  });
});
