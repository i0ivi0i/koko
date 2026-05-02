// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import "../后台/壳";
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
  房间快照,
  房间历史页,
} from "../聊天共享/契约";
import { 后台壳 } from "../后台/壳";
import type { 后台应用内核端口 } from "../后台/应用内核";
import type { Socket } from "socket.io-client";

const 空Socket = {
  on() {
    return this;
  },
  emit() {
    return true;
  },
  disconnect() {},
} as unknown as Socket;

function 创建房间快照(roomId = "r-x", latestEventPosition = 0): 房间快照 {
  return {
    room_id: roomId,
    latest_event_position: latestEventPosition,
    last_read_event_position: null,
    first_unread_event_position: null,
    snapshot_messages: [],
    has_more_before: false,
  };
}

class 假后台传输 implements 前端传输端口 {
  async bootstrapAnonymousIdentity(): Promise<匿名身份引导结果> {
    return {
      display_alias: "暴躁的企鹅",
      session_id: "s-x",
    };
  }
  async joinOrCreateRoom(): Promise<房间快照> {
    return 创建房间快照();
  }
  async loadRoomSnapshot(): Promise<房间快照> {
    return 创建房间快照();
  }
  async prepareMediaUpload(
    kind: "image" | "video",
    _sessionId: string,
    file: File,
    _sourceHash?: 媒体SourceHash信息
  ): Promise<媒体上传准备结果> {
    return {
      attachment_id: "att-admin-prepared",
      upload_session_id: "upl-admin-prepared",
      upload_method: "tus",
      tus_endpoint: "http://storage.local/files",
      tus_headers: {
        Authorization: "Bearer admin-upload-token",
      },
      tus_metadata: {
        attachment_id: "att-admin-prepared",
        upload_session_id: "upl-admin-prepared",
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
    const attachmentId = "att-admin-forwarded";
    // 后台壳测试不触发转发；这里保持端口完整，避免假对象成为第二套业务判断。
    return {
      message: {
        type: "message_created",
        room_id: input.target_room_id,
        message_id: "m-admin-forwarded",
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
      kind: "image",
      mime_type: "image/png",
      byte_size: 68,
      width: 120,
      height: 90,
      status: "ready",
    };
  }
  async loadMediaLocator(_sessionId: string, attachmentId: string): Promise<媒体定位结果> {
    const originalUrl = this.buildAttachmentContentUrl(attachmentId, "s-x");
    return {
      attachment_id: attachmentId,
      kind: "image",
      status: "ready",
      thumbnail_url: this.buildAttachmentContentUrl(attachmentId, "s-x", "thumbnail"),
      distribution: null,
      blob_asset: {
        asset_id: attachmentId,
        content_hash: `hash-${attachmentId}`,
        kind: "blob_image",
        variants: {
          canonical: {
            id: "canonical",
            mime_type: "image/png",
            url: originalUrl,
            width: 120,
            height: 90,
          },
        },
        distribution: null,
        origin: {
          original_url: originalUrl,
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only",
        },
      },
    };
  }
  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant: "original" | "thumbnail" = "original"
  ): string {
    return `http://test.local/api/attachments/${attachmentId}/content?session_id=${sessionId}&variant=${variant}`;
  }
  async updateRoomReadAnchor(): Promise<void> {}
  async loadRoomEvents(
    _roomId: string,
    _sessionId: string,
    _from: number
  ): Promise<增量事件快照> {
    return { room_id: "r-x", latest_event_position: 0, events: [] };
  }
  async loadRoomHistory(): Promise<房间历史页> {
    return { room_id: "r-x", messages: [] };
  }
  async loadAdminOverview(): Promise<后台概览> {
    return { room_count: 2, message_count: 5 };
  }
  async adminLogin(): Promise<后台登录结果> {
    return { token: "admin-token" };
  }
  async adminRooms(): Promise<后台房间列表> {
    return { rooms: ["room-A", "room-B"] };
  }
  async adminRoomDetail(_token: string, roomId: string): Promise<后台房间详情> {
    return { room_id: roomId, latest_event_position: 12, message_count: 99 };
  }
  createSocket(_sessionId: string): Socket {
    return 空Socket;
  }
}

describe("后台壳", () => {
  it("可登录并加载概览、房间列表和详情", async () => {
    const el = document.createElement("koko-admin-shell") as 后台壳;
    el.setTransportForTest(new 假后台传输());
    document.body.appendChild(el);
    await el.updateComplete;

    const loginBtn = el.shadowRoot!.querySelector("#adminLoginBtn") as HTMLButtonElement;
    loginBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const overview = el.shadowRoot!.querySelector("#overview")!;
    expect(overview.textContent).toContain("房间 2");

    const firstDetailBtn = el.shadowRoot!.querySelector(".roomDetailBtn") as HTMLButtonElement;
    firstDetailBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    const detail = el.shadowRoot!.querySelector("#roomDetail")!;
    expect(detail.textContent).toContain("room-A");

    el.remove();
  });

  it("登录输入框会通过表单 submit 支持回车登录", async () => {
    const el = document.createElement("koko-admin-shell") as 后台壳;
    el.setTransportForTest(new 假后台传输());
    document.body.appendChild(el);
    await el.updateComplete;

    const userInput = el.shadowRoot!.querySelector("#adminUser") as HTMLInputElement;
    const passInput = el.shadowRoot!.querySelector("#adminPass") as HTMLInputElement;
    const loginForm = el.shadowRoot!.querySelector("#adminLoginForm") as HTMLFormElement | null;

    expect(loginForm).not.toBeNull();
    expect(userInput.getAttribute("enterkeyhint")).toBe("go");
    expect(passInput.getAttribute("enterkeyhint")).toBe("go");

    loginForm!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("#overview")!.textContent).toContain("房间 2");
    el.remove();
  });

  it("后台壳只转发命令并消费内核快照", async () => {
    const commands: Array<Record<string, unknown>> = [];
    let snapshot = {
      username: "admin",
      password: "admin",
      token: "",
      overview: null as { room_count: number; message_count: number } | null,
      roomIds: [] as string[],
      selectedRoomId: "",
      detail: null as { room_id: string; latest_event_position: number; message_count: number } | null,
      roomFilter: "",
    };
    const 假内核: 后台应用内核端口 = {
      snapshot: () => snapshot,
      async dispatch(command) {
        commands.push(command as Record<string, unknown>);
        if (command.type === "LOGIN_REQUESTED") {
          snapshot = {
            ...snapshot,
            token: "admin-token",
            overview: { room_count: 2, message_count: 5 },
            roomIds: ["room-A"],
          };
        }
      },
      setTransportForTest() {},
    };

    const el = document.createElement("koko-admin-shell") as 后台壳;
    el.setKernelForTest(假内核);
    document.body.appendChild(el);
    await el.updateComplete;

    (el.shadowRoot!.querySelector("#adminLoginBtn") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;

    expect(commands).toContainEqual({ type: "LOGIN_REQUESTED" });
    expect(el.shadowRoot!.querySelector("#overview")!.textContent).toContain("房间 2");
    el.remove();
  });
});
