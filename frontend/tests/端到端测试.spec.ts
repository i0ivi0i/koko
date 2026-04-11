// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import "../聊天壳";
import "../后台壳";
import { 聊天壳 } from "../聊天壳";
import { 后台壳 } from "../后台壳";
import { 安装测试文本测量画布 } from "./common/聊天测试支架";
import type { 前端传输端口 } from "../传输";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台房间列表,
  后台房间详情,
  后台概览,
  后台登录结果,
  媒体附件上传结果,
  媒体定位结果,
  媒体上传准备结果,
  房间历史页,
  房间快照,
} from "../契约";
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
        body: text,
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

  async bootstrapAnonymousIdentity(): Promise<匿名身份引导结果> {
    return {
      anonymous_identity_id: "a-e2e",
      display_alias: "暴躁的企鹅",
      session_id: "s-e2e",
    };
  }
  async joinOrCreateRoom(): Promise<房间快照> {
    return 创建房间快照();
  }
  async loadRoomSnapshot(): Promise<房间快照> {
    return 创建房间快照("r-e2e", 1, {
      snapshot_messages: [
        {
          type: "message_created",
          room_id: "r-e2e",
          message_id: "m-e2e",
          client_message_id: "c-e2e",
          sender_session_id: "s-e2e",
          sender_display_alias: "暴躁的企鹅",
          text: "e2e-hello",
          body: "e2e-hello",
          attachments: [],
          event_position: 1,
        },
      ],
    });
  }
  async prepareMediaUpload(
    kind: "image" | "video",
    _sessionId: string,
    file: File
  ): Promise<媒体上传准备结果> {
    return {
      attachment_id: "att-e2e-prepared",
      upload_method: "tus",
      tus_endpoint: "http://storage.local/files",
      tus_headers: {
        Authorization: "Bearer e2e-upload-token",
      },
      tus_metadata: {
        attachment_id: "att-e2e-prepared",
        file_name: file.name,
        mime_type: file.type || (kind === "video" ? "video/mp4" : "image/png"),
        byte_size: String(file.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    };
  }
  async completeMediaUpload(
    _sessionId: string,
    attachmentId: string
  ): Promise<媒体附件上传结果> {
    return {
      attachment_id: attachmentId,
      kind: "image",
      mime_type: "image/png",
      byte_size: 68,
      width: 120,
      height: 90,
      status: "ready",
    };
  }
  async loadMediaLocator(_sessionId: string, attachmentId: string): Promise<媒体定位结果> {
    return {
      attachment_id: attachmentId,
      kind: "image",
      status: "ready",
      original_url: this.buildAttachmentContentUrl(attachmentId, "s-e2e"),
      thumbnail_url: this.buildAttachmentContentUrl(attachmentId, "s-e2e", "thumbnail"),
      distribution: null,
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
          body: "e2e-hello",
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

    const chat = document.createElement("koko-chat-shell") as 聊天壳;
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
});
