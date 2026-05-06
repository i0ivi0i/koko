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
import {
  安装聊天壳直达全屏模拟,
  查询查看器关闭按钮,
  注册聊天壳集成测试基线,
  等待查看器壳出现,
  等待查看器壳消失,
} from "./测试支撑";

describe("聊天壳集成 / 查看器与自动播", () => {
  注册聊天壳集成测试基线();

  it("点击视频附件时会把 WebTorrent 播放源交给页面级媒体查看器", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-viewer-1",
            client_message_id: "c-video-viewer-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "看协作分发视频",
            attachments: [{ kind: "video", attachment_id: "att-video-viewer-1", width: 1280, height: 720 }],
            event_position: 1,
          },
        ],
      }),
    ];
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-viewer-1",
        kind: "video",
        src: "blob:http://localhost/webtorrent-viewer-video-1",
        thumbnailUrl: null,
        hint: null,
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-viewer-1"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-viewer-1",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-viewer-1",
            kind: "video",
            src: "blob:http://localhost/webtorrent-viewer-video-1",
          }),
        ],
      })
    );
    el.remove();
  });

  it("点击当前自动播 owner 视频时，也走统一查看器入口，不再让时间线原生 video 直达全屏", async () => {
    const { requestFullscreen, restore } = 安装聊天壳直达全屏模拟();
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-direct-fullscreen",
            client_message_id: "c-video-inline-direct-fullscreen",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              {
                kind: "video",
                attachment_id: "att-video-inline-direct-fullscreen",
                width: 1280,
                height: 720,
              },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体查看器供测试(el, viewer);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-inline-direct-fullscreen",
        kind: "video",
        src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
        thumbnailUrl: null,
        hint: null,
      }),
    });
    try {
      document.body.appendChild(el);
      await 等待组件稳定(el);

      输入房间短码到操作台(el, "ROOM01");
      读取操作台主动作(el).click();
      await 等待组件稳定(el);
      await 等待组件稳定(el);

      const pane = el.shadowRoot!.querySelector("koko-room-message-pane") as 房间消息窗 | null;
      expect(pane).not.toBeNull();
      pane!.mediaPlaybackByAttachmentId = {
        "att-video-inline-direct-fullscreen": {
          mode: "swarm",
          attachmentId: "att-video-inline-direct-fullscreen",
          kind: "video",
          src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          thumbnailUrl: null,
          hint: null,
        },
      };
      pane!.inlineAutoplayPlaybackByAttachmentId = {
        "att-video-inline-direct-fullscreen": {
          mode: "swarm",
          attachmentId: "att-video-inline-direct-fullscreen",
          kind: "video",
          src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          thumbnailUrl: null,
          hint: null,
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
        "att-video-inline-direct-fullscreen": {
          attachmentId: "att-video-inline-direct-fullscreen",
          tier: "heavy_playback",
          reason: "inline_autoplay_owner",
          canonicalVideoSrc: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          previewVideoSrc: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
          allowInlineCanonical: true,
          allowPreviewVideo: true,
          formalByteSource: "webtorrent_official_stream",
        },
      };
      pane!.inlineAutoplayOwnerAttachmentId = "att-video-inline-direct-fullscreen";
      await pane!.updateComplete;

      const preview = el.shadowRoot!.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-inline-direct-fullscreen"]'
      );
      const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-inline-direct-fullscreen"]'
      );
      expect(preview).not.toBeNull();
      expect(trigger).not.toBeNull();

      trigger?.click();
      await pane!.updateComplete;

      expect(requestFullscreen).toHaveBeenCalledTimes(0);
      expect(viewer.打开).toHaveBeenCalledWith(
        expect.objectContaining({
          startAttachmentId: "att-video-inline-direct-fullscreen",
          items: [
            expect.objectContaining({
              attachmentId: "att-video-inline-direct-fullscreen",
              kind: "video",
              src: "blob:http://localhost/webtorrent-inline-direct-fullscreen",
            }),
          ],
        })
      );
      expect(document.body.querySelector("video-player[data-player-shell='videojs']")).toBeNull();
      expect(pane!.inlineAutoplayOwnerAttachmentId).toBe("att-video-inline-direct-fullscreen");
    } finally {
      el.remove();
      restore();
    }
  });

  it("真实查看器打开后切到另一条视频时，会继续复用同一颗 Video.js 壳", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-switch-1",
            client_message_id: "c-video-switch-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [{ kind: "video", attachment_id: "att-video-switch-1", width: 1280, height: 720 }],
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-switch-2",
            client_message_id: "c-video-switch-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [{ kind: "video", attachment_id: "att-video-switch-2", width: 720, height: 1280 }],
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn(async ({ attachmentId, kind }) => ({
        mode: "legacy_anchor",
        attachmentId,
        kind,
        src: `http://media.local/original-${attachmentId}`,
        thumbnailUrl: `http://media.local/poster-${attachmentId}`,
        hint: null,
      }) satisfies import("../../媒体/媒体播放").媒体播放结果),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-switch-1"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 初始壳 = await 等待查看器壳出现();
    const 初始视频 = document.body.querySelector("video");
    expect(初始壳).not.toBeNull();
    expect(初始视频).not.toBeNull();

    const kernel = (el as unknown as {
      kernel: {
        dispatch(command: {
          type: "MEDIA_OPEN_REQUESTED";
          request: {
            startAttachmentId: string;
            items: Array<{
              attachmentId: string;
              kind: "video";
              src: string;
              posterSrc: string;
              width: number;
              height: number;
            }>;
          };
        }): Promise<void>;
      };
    }).kernel;

    await kernel.dispatch({
      type: "MEDIA_OPEN_REQUESTED",
      request: {
        startAttachmentId: "att-video-switch-2",
        items: [
          {
            attachmentId: "att-video-switch-1",
            kind: "video",
            src: "http://media.local/original-att-video-switch-1",
            posterSrc: "http://media.local/poster-att-video-switch-1",
            width: 1280,
            height: 720,
          },
          {
            attachmentId: "att-video-switch-2",
            kind: "video",
            src: "http://media.local/original-att-video-switch-2",
            posterSrc: "http://media.local/poster-att-video-switch-2",
            width: 720,
            height: 1280,
          },
        ],
      },
    });
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const 当前壳 = await 等待查看器壳出现();
    const 当前视频 = document.body.querySelector("video");
    expect(当前壳).toBe(初始壳);
    expect(当前视频).toBe(初始视频);
    expect((当前视频 as HTMLVideoElement | null)?.poster).toBe(
      "http://media.local/poster-att-video-switch-2"
    );

    el.remove();
  });

  it("关闭真实视频查看器后，再点另一条视频仍会重新打开正式查看器", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-reopen-1",
            client_message_id: "c-video-reopen-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [{ kind: "video", attachment_id: "att-video-reopen-1", width: 1280, height: 720 }],
            event_position: 1,
          },
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-reopen-2",
            client_message_id: "c-video-reopen-2",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [{ kind: "video", attachment_id: "att-video-reopen-2", width: 720, height: 1280 }],
            event_position: 2,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn(async ({ attachmentId, kind }) => ({
        mode: "legacy_anchor",
        attachmentId,
        kind,
        src: `http://media.local/original-${attachmentId}`,
        thumbnailUrl: `http://media.local/poster-${attachmentId}`,
        hint: null,
      }) satisfies import("../../媒体/媒体播放").媒体播放结果),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-reopen-1"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    expect(await 等待查看器壳出现()).not.toBeNull();

    查询查看器关闭按钮()?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    await 等待查看器壳消失();

    expect(document.body.querySelector("video-player[data-player-shell='videojs']")).toBeNull();
    expect(document.body.querySelector("video")).toBeNull();

    el.shadowRoot!
      .querySelector<HTMLButtonElement>(
        'button.message-video-preview-trigger[data-attachment-id="att-video-reopen-2"]'
      )
      ?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const reopenedShell = await 等待查看器壳出现();
    const reopenedVideo = document.body.querySelector<HTMLVideoElement>("video");
    expect(reopenedShell).not.toBeNull();
    expect(reopenedVideo).not.toBeNull();
    expect(document.body.querySelectorAll("video-player[data-player-shell='videojs']")).toHaveLength(
      1
    );

    el.remove();
  });

  it("媒体播放结果是 expired 时，时间线会统一显示内容已过期", async () => {
    const transport = new 假传输();
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-expired-1",
            client_message_id: "c-video-expired-1",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "过期视频",
            attachments: [{ kind: "video", attachment_id: "att-video-expired-1", width: 1280, height: 720 }],
            event_position: 1,
          },
        ],
      }),
    ];
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "expired",
        attachmentId: "att-video-expired-1",
        kind: "video",
        src: "",
        thumbnailUrl: null,
        hint: "内容已过期",
      }),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const previewTrigger = el.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-expired-1"]'
    ) as HTMLButtonElement | null;
    expect(previewTrigger).not.toBeNull();

    previewTrigger?.click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);

    const hint = el.shadowRoot!.querySelector(
      '[data-media-hint="att-video-expired-1"]'
    ) as HTMLElement | null;
    expect(hint?.textContent).toContain("内容已过期");
    el.remove();
  });

  it("可见自动播候选在真正成为 owner 前仍保持 poster，canonical ready 后才揭开正式 video 节点", async () => {
    const transport = new 假传输();
    const intersectionObserverDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "IntersectionObserver"
    );
    transport.joinQueue = [
      创建房间快照("r-test", 1, {
        snapshot_messages: [
          {
            type: "message_created",
            room_id: "r-test",
            message_id: "m-video-inline-shell",
            client_message_id: "c-video-inline-shell",
            sender_session_id: "s-other",
            sender_display_alias: "冷静的水獭",
            text: "",
            attachments: [
              { kind: "video", attachment_id: "att-video-inline-shell", width: 1280, height: 720 },
            ],
            event_position: 1,
          },
        ],
      }),
    ];
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
    const el = document.createElement("koko-chat-shell") as 聊天壳;
    el.setTransportForTest(transport);
    注入媒体播放器供测试(el, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-inline-shell",
        kind: "video",
        src: "blob:http://media.local/swarm-att-video-inline-shell",
        thumbnailUrl: null,
        hint: null,
      }),
      释放附件播放资源: vi.fn(),
    });
    document.body.appendChild(el);
    await 等待组件稳定(el);

    输入房间短码到操作台(el, "ROOM01");
    读取操作台主动作(el).click();
    await 等待组件稳定(el);
    await 等待组件稳定(el);
    try {
      const pane = el.shadowRoot!.querySelector(
        "koko-room-message-pane"
      ) as HTMLElement & { updateComplete?: Promise<unknown> };
      const scrollContainer = el.shadowRoot!.querySelector("#messageScroll") as HTMLElement | null;
      const previewButton = el.shadowRoot!.querySelector(
        'button.message-video-preview-trigger[data-attachment-id="att-video-inline-shell"]'
      ) as HTMLButtonElement | null;
      expect(scrollContainer).not.toBeNull();
      expect(previewButton).not.toBeNull();
      vi.spyOn(scrollContainer!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 300));
      vi.spyOn(previewButton!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 180));
      scrollContainer!.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
      await Promise.resolve();
      await el.updateComplete;
      await pane.updateComplete;

      const beforeOwnerVideo = el.shadowRoot!.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-inline-shell"]'
      );
      expect(beforeOwnerVideo).toBeNull();
      expect(
        el.shadowRoot!.querySelector(
          'img.message-video-poster[data-attachment-id="att-video-inline-shell"]'
        )
      ).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 121));
      await Promise.resolve();
      await Promise.resolve();
      await el.updateComplete;
      await pane.updateComplete;

      const ownerVideo = el.shadowRoot!.querySelector<HTMLVideoElement>(
        'video.message-video-preview[data-attachment-id="att-video-inline-shell"]'
      );
      expect(ownerVideo).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector(
          'img.message-video-poster--canonical-cover[data-attachment-id="att-video-inline-shell"]'
        )
      ).not.toBeNull();

      Object.defineProperty(ownerVideo!, "readyState", {
        configurable: true,
        value: 3,
      });
      ownerVideo!.dispatchEvent(new Event("loadedmetadata"));
      ownerVideo!.dispatchEvent(new Event("canplay"));
      await 等待组件稳定(el);
      await pane.updateComplete;

      expect(
        el.shadowRoot!.querySelector(
          'img.message-video-poster[data-attachment-id="att-video-inline-shell"]'
        )
      ).toBeNull();
    } finally {
      if (intersectionObserverDescriptor) {
        Object.defineProperty(globalThis, "IntersectionObserver", intersectionObserverDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "IntersectionObserver");
      }
      el.remove();
    }
  });
});
