// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "../应用根/聊天壳";
import "../后台/壳";
import { 聊天壳 } from "../应用根/聊天壳";
import { 后台壳 } from "../后台/壳";
import {
  安装测试文本测量画布,
  createFakeStorage,
  注入媒体播放器供测试,
  注入媒体查看器供测试,
  等待组件稳定,
} from "./common/聊天测试支架";
import type { 前端传输端口 } from "../平台/传输";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台房间列表,
  后台房间详情,
  后台概览,
  后台登录结果,
  媒体附件上传结果,
  媒体附件转发请求,
  媒体附件转发结果,
  媒体定位结果,
  媒体SourceHash信息,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  媒体上传准备结果,
  房间历史页,
  房间快照,
} from "../聊天共享/契约";
import type { Socket } from "socket.io-client";

/**
 * 端到端冒烟 spec 没有复用聊天测试支架里的房间场景构造，
 * 但现在聊天壳首屏和输入区都会直接走 Pretext。
 *
 * 所以这里也要显式补上同一份测试测量宿主，避免：
 * 1. 集成 spec 是绿的；
 * 2. 独立 e2e spec 却因为缺测量上下文直接炸掉。
 */
安装测试文本测量画布();

beforeEach(() => {
  /**
   * 端到端冒烟同样会触发聊天壳的恢复链。
   * 这里必须显式接管 `window.localStorage`，避免 happy-dom 在 Node 里回退到
   * 自带 Web Storage 并打印 `--localstorage-file` 警告。
   */
  Object.defineProperty(window, "localStorage", {
    value: createFakeStorage(),
    configurable: true,
  });
});

describe("端到端测试环境", () => {
  it("会先接管浏览器 localStorage，而不是落回 Node 默认 Web Storage", () => {
    window.localStorage.setItem("smoke", "ok");
    expect(window.localStorage.getItem("smoke")).toBe("ok");
  });
});

class 假Socket {
  private handlers = new Map<string, Array<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload: Record<string, unknown>): boolean {
    if (event === "subscribe_room_stream") {
      this.fire("control_result", {
        kind: "subscribed",
        room_id: payload.room_id,
        latest_event_position: 0,
      });
    }
    if (event === "create_message" || event === "send_text_message") {
      const text =
        typeof payload.text === "string"
          ? payload.text
          : typeof payload.body === "string"
            ? payload.body
            : "";
      this.fire("room_event", {
        type: "message_created",
        room_id: "r-e2e",
        message_id: "m-e2e",
        client_message_id: payload.client_message_id,
        sender_session_id: "s-e2e",
        sender_display_alias: "暴躁的企鹅",
        text,
        attachments: [],
        event_position: 1,
      });
    }
    return true;
  }

  disconnect(): void {}

  private fire(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

function 创建房间快照(
  roomId = "r-e2e",
  latestEventPosition = 0,
  patch: Partial<房间快照> = {}
): 房间快照 {
  return {
    room_id: roomId,
    latest_event_position: latestEventPosition,
    last_read_event_position: null,
    first_unread_event_position: null,
    snapshot_messages: [],
    has_more_before: false,
    ...patch,
  };
}

class 端到端假传输 implements 前端传输端口 {
  private readonly socket = new 假Socket();
  /**
   * e2e 冒烟要能在同一份假传输里切换“空房间 / 带媒体消息的房间”。
   * 这里直接把 join 和 snapshot 都绑到同一份权威快照，避免测试再手搓第二套房间真相。
   */
  roomSnapshot: 房间快照 = 创建房间快照();

  async bootstrapAnonymousIdentity(): Promise<匿名身份引导结果> {
    return {
      display_alias: "暴躁的企鹅",
      session_id: "s-e2e",
    };
  }
  async joinOrCreateRoom(): Promise<房间快照> {
    return this.roomSnapshot;
  }
  async loadRoomSnapshot(): Promise<房间快照> {
    return this.roomSnapshot;
  }
  async prepareMediaUpload(
    kind: "image" | "video",
    _sessionId: string,
    file: File,
    _sourceHash?: 媒体SourceHash信息
  ): Promise<媒体上传准备结果> {
    return {
      attachment_id: "att-e2e-prepared",
      upload_session_id: "upl-e2e-prepared",
      upload_method: "tus",
      tus_endpoint: "http://storage.local/files",
      tus_headers: {
        Authorization: "Bearer e2e-upload-token",
      },
      tus_metadata: {
        attachment_id: "att-e2e-prepared",
        upload_session_id: "upl-e2e-prepared",
        file_name: file.name,
        mime_type: file.type || (kind === "video" ? "video/mp4" : "image/png"),
        byte_size: String(file.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    };
  }
  async reuseMediaBySourceHash(
    _kind: "image" | "video",
    _input: 媒体SourceHash复用请求
  ): Promise<媒体SourceHash复用结果> {
    return { status: "miss" };
  }
  async forwardMediaAttachment(
    kind: "image" | "video",
    input: 媒体附件转发请求
  ): Promise<媒体附件转发结果> {
    const attachmentId = "att-e2e-forwarded";
    // e2e 假传输只补齐共享端口，不在浏览器壳里伪造转发授权或旧消息复制逻辑。
    return {
      message: {
        type: "message_created",
        room_id: input.target_room_id,
        message_id: "m-e2e-forwarded",
        client_message_id: input.client_message_id,
        sender_session_id: input.session_id,
        sender_display_alias: "暴躁的企鹅",
        text: input.text ?? "",
        attachments: [
          {
            kind,
            attachment_id: attachmentId,
            width: kind === "video" ? 1280 : 120,
            height: kind === "video" ? 720 : 90,
          },
        ],
        event_position: 1,
      },
      attachment: {
        attachment_id: attachmentId,
        kind,
        mime_type: kind === "video" ? "video/mp4" : "image/png",
        byte_size: 68,
        width: kind === "video" ? 1280 : 120,
        height: kind === "video" ? 720 : 90,
        status: "ready",
      },
    };
  }
  async abandonMediaUpload(_sessionId: string, _attachmentId: string): Promise<void> {}
  async completeMediaUpload(
    _sessionId: string,
    attachmentId: string
  ): Promise<媒体附件上传结果> {
    return {
      attachment_id: attachmentId,
      kind: attachmentId.includes("video") ? "video" : "image",
      mime_type: attachmentId.includes("video") ? "video/mp4" : "image/png",
      byte_size: 68,
      width: attachmentId.includes("video") ? 1280 : 120,
      height: attachmentId.includes("video") ? 720 : 90,
      status: "ready",
    };
  }
  async loadMediaLocator(_sessionId: string, attachmentId: string): Promise<媒体定位结果> {
    if (attachmentId.includes("video")) {
      return {
        attachment_id: attachmentId,
        kind: "video",
        status: "ready",
        thumbnail_url: null,
        distribution: {
          content_id: `content_${attachmentId}`,
          content_hash: `hash-${attachmentId}`,
          swarm_id: `swarm-hash-${attachmentId}`,
          web_seed_until: "1775942400",
          torrent_url: `http://test.local/api/media/${attachmentId}/torrent?session_id=s-e2e`,
          torrent_info_hash: `torrent-hash-${attachmentId}`,
          announce_urls: ["wss://tracker.test.local/announce"],
          web_seed_url: this.buildAttachmentContentUrl(attachmentId, "s-e2e"),
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted",
        },
        blob_asset: null,
      };
    }
    return {
      attachment_id: attachmentId,
      kind: "image",
      status: "ready",
      thumbnail_url: this.buildAttachmentContentUrl(attachmentId, "s-e2e", "thumbnail"),
      distribution: null,
      blob_asset: {
        asset_id: attachmentId,
        content_hash: `hash-${attachmentId}`,
        kind: "blob_image",
        variants: {
          canonical: {
            id: "canonical",
            mime_type: "image/png",
            url: this.buildAttachmentContentUrl(attachmentId, "s-e2e"),
            width: 1200,
            height: 800,
          },
        },
        distribution: null,
        origin: {
          original_url: this.buildAttachmentContentUrl(attachmentId, "s-e2e"),
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only",
        },
      },
    };
  }
  async updateRoomReadAnchor(): Promise<void> {}
  async loadRoomEvents(
    _roomId: string,
    _sessionId: string,
    _from: number
  ): Promise<增量事件快照> {
    return {
      room_id: "r-e2e",
      latest_event_position: 1,
      events: [
        {
          type: "message_created",
          room_id: "r-e2e",
          message_id: "m-e2e",
          client_message_id: "c-e2e",
          sender_session_id: "s-e2e",
          sender_display_alias: "暴躁的企鹅",
          text: "e2e-hello",
          attachments: [],
          event_position: 1,
        },
      ],
    };
  }
  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant: "original" | "thumbnail" = "original"
  ): string {
    return `http://test.local/api/attachments/${attachmentId}/content?session_id=${sessionId}&variant=${variant}`;
  }
  async loadRoomHistory(): Promise<房间历史页> {
    return { room_id: "r-e2e", messages: [] };
  }
  async loadAdminOverview(): Promise<后台概览> {
    return { room_count: 1, message_count: 1 };
  }
  async adminLogin(): Promise<后台登录结果> {
    return { token: "admin-token" };
  }
  async adminRooms(): Promise<后台房间列表> {
    return { rooms: ["r-e2e"] };
  }
  async adminRoomDetail(): Promise<后台房间详情> {
    return { room_id: "r-e2e", latest_event_position: 1, message_count: 1 };
  }
  createSocket(_sessionId: string): Socket {
    return this.socket as unknown as Socket;
  }
}

function 读取聊天操作台主输入(chat: 聊天壳): HTMLTextAreaElement | HTMLInputElement {
  const input = chat.shadowRoot!.querySelector(
    "#shellConsolePrimaryInput"
  ) as HTMLTextAreaElement | HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

function 读取聊天操作台主动作(chat: 聊天壳): HTMLButtonElement {
  const action = chat.shadowRoot!.querySelector(
    "#shellConsolePrimaryAction"
  ) as HTMLButtonElement | null;
  expect(action).not.toBeNull();
  return action!;
}

describe("前后台壳端到端冒烟", () => {
  it("聊天壳和后台壳都能走完主流程", async () => {
    const transport = new 端到端假传输();
    transport.roomSnapshot = 创建房间快照("r-e2e", 1, {
      snapshot_messages: [
        {
          type: "message_created",
          room_id: "r-e2e",
          message_id: "m-e2e",
          client_message_id: "c-e2e",
          sender_session_id: "s-e2e",
          sender_display_alias: "暴躁的企鹅",
          text: "e2e-hello",
          attachments: [],
          event_position: 1,
        },
      ],
    });

    const chat = document.createElement("koko-chat-shell") as 聊天壳;
    expect("媒体发布器" in (chat as object)).toBe(false);
    expect("媒体定位器" in (chat as object)).toBe(false);
    chat.setTransportForTest(transport);
    document.body.appendChild(chat);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chat.updateComplete;

    expect(chat.shadowRoot!.querySelector("#homeView")).not.toBeNull();
    expect(chat.shadowRoot!.querySelector("#roomView")).toBeNull();
    expect(chat.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();
    expect(chat.shadowRoot!.querySelector("#alias")!.textContent).toContain("暴躁的企鹅");
    expect(读取聊天操作台主输入(chat).getAttribute("placeholder")).toBe("房间短码");
    expect(chat.shadowRoot!.textContent).not.toContain("session:");

    const roomInput = 读取聊天操作台主输入(chat);
    roomInput.value = "E2E01";
    roomInput.dispatchEvent(new Event("input"));
    读取聊天操作台主动作(chat).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chat.updateComplete;

    expect(chat.shadowRoot!.querySelector("#homeView")).toBeNull();
    expect(chat.shadowRoot!.querySelector("#roomView")).not.toBeNull();
    expect(chat.shadowRoot!.querySelector("#shellConsole")).not.toBeNull();

    const msgInput = 读取聊天操作台主输入(chat);
    msgInput.value = "hello";
    msgInput.dispatchEvent(new Event("input"));
    读取聊天操作台主动作(chat).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chat.updateComplete;
    expect(chat.shadowRoot!.querySelector("#messageList")!.textContent).toContain("hello");
    expect(chat.shadowRoot!.querySelector('[data-owner="mine"]')).not.toBeNull();
    expect(chat.shadowRoot!.querySelector("#messageList")!.textContent).not.toContain("[1]");

    const admin = document.createElement("koko-admin-shell") as 后台壳;
    admin.setTransportForTest(transport);
    document.body.appendChild(admin);
    await admin.updateComplete;
    (admin.shadowRoot!.querySelector("#adminLoginBtn") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await admin.updateComplete;
    expect(admin.shadowRoot!.querySelector("#overview")!.textContent).toContain("房间 1");

    chat.remove();
    admin.remove();
  });

  it("视频没有 poster 时，时间线不会把播放源塞给原生 video，查看器仍能拿到受控 WebTorrent 主链", async () => {
    const transport = new 端到端假传输();
    transport.roomSnapshot = 创建房间快照("r-e2e", 1, {
      snapshot_messages: [
        {
          type: "message_created",
          room_id: "r-e2e",
          message_id: "m-video-e2e",
          client_message_id: "c-video-e2e",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "",
           attachments: [
             {
               kind: "video",
               attachment_id: "att-video-e2e",
               width: 1280,
               height: 720,
               preview_asset: {
                 still_url:
                   "/api/attachments/att-video-e2e/content?session_id=s-e2e&variant=thumbnail",
               },
             },
           ],
          event_position: 1,
        },
      ],
    });

    const viewer = {
      打开: vi.fn(),
      销毁: vi.fn(),
    };
    const chat = document.createElement("koko-chat-shell") as 聊天壳;
    chat.setTransportForTest(transport);
    注入媒体查看器供测试(chat, viewer);
    注入媒体播放器供测试(chat, {
      解析播放结果: vi.fn().mockResolvedValue({
        mode: "swarm",
        attachmentId: "att-video-e2e",
        kind: "video",
        src: "blob:http://test.local/webtorrent-att-video-e2e",
        thumbnailUrl:
          "/api/attachments/att-video-e2e/content?session_id=s-e2e&variant=thumbnail",
        hint: "正在协作分发",
      }),
    });
    document.body.appendChild(chat);
    await 等待组件稳定(chat);

    const roomInput = 读取聊天操作台主输入(chat);
    roomInput.value = "E2E01";
    roomInput.dispatchEvent(new Event("input"));
    读取聊天操作台主动作(chat).click();
    await 等待组件稳定(chat);
    await 等待组件稳定(chat);

    const previewTrigger = chat.shadowRoot!.querySelector(
      'button.message-video-preview-trigger[data-attachment-id="att-video-e2e"]'
    ) as HTMLButtonElement | null;
    const previewPoster = chat.shadowRoot!.querySelector(
      'img.message-video-poster[data-attachment-id="att-video-e2e"]'
    ) as HTMLImageElement | null;
    expect(previewTrigger).not.toBeNull();
    expect(previewPoster).not.toBeNull();
    expect(previewPoster?.getAttribute("src")).toContain(
      "/api/attachments/att-video-e2e/content?session_id=s-e2e&variant=thumbnail"
    );
    expect(
      chat.shadowRoot!.querySelector(
        'video.message-video-preview[data-attachment-id="att-video-e2e"]'
      )
    ).toBeNull();

    previewTrigger?.click();
    await 等待组件稳定(chat);
    await 等待组件稳定(chat);
    // 打开查看器会穿过 AppRuntime 与媒体会话 owner；端到端断言等待事实成立，避免全量并发下靠固定 tick 竞速。
    await vi.waitFor(() => {
      expect(viewer.打开).toHaveBeenCalled();
    });

    expect(viewer.打开).toHaveBeenCalledWith(
      expect.objectContaining({
        startAttachmentId: "att-video-e2e",
        items: [
          expect.objectContaining({
            attachmentId: "att-video-e2e",
            kind: "video",
            src: "blob:http://test.local/webtorrent-att-video-e2e",
            posterSrc:
              "/api/attachments/att-video-e2e/content?session_id=s-e2e&variant=thumbnail",
          }),
        ],
      })
    );

    chat.remove();
  });
});
