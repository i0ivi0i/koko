import type { Socket } from "socket.io-client";
import type { 前端传输端口 } from "../../平台/传输";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台概览,
  后台登录结果,
  后台房间列表,
  后台房间详情,
  媒体附件上传结果,
  媒体附件转发请求,
  媒体附件转发结果,
  媒体定位结果,
  媒体SourceHash信息,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  房间历史页,
  房间快照,
} from "../../聊天共享/契约";
import { 假Socket } from "./假实时.js";

type 假媒体上传准备结果 = {
  attachment_id: string;
  upload_session_id: string;
  upload_method: "tus";
  tus_endpoint: string;
  tus_headers: Record<string, string>;
  tus_metadata: Record<string, string>;
  expires_at: string;
};

export function 创建房间快照(
  roomId = "r-test",
  latestEventPosition = 1,
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

/**
 * 假传输端口只表达网络边界返回什么契约，不表达聊天壳或媒体编排该如何消费这些契约。
 * 这样测试仍然遵守“业务编排在 owner、IO 只是受控输入”的边界。
 */
export class 假传输 implements 前端传输端口 {
  readonly socket = new 假Socket();
  loadRoomSnapshotCalls = 0;
  loadRoomEventsCalls = 0;
  loadRoomHistoryCalls = 0;
  bootstrapTokens: string[] = [];
  joinCalls: Array<{ sessionId: string; roomCode: string }> = [];
  loadRoomSnapshotArgs: Array<{ roomId: string; sessionId: string }> = [];
  loadRoomEventsArgs: Array<{ roomId: string; sessionId: string; from: number }> = [];
  loadRoomHistoryArgs: Array<{
    roomId: string;
    sessionId: string;
    beforeEventPosition: number;
    limit: number;
  }> = [];
  socketSessionIds: string[] = [];
  prepareMediaCalls: Array<{
    kind: "image" | "video";
    sessionId: string;
    fileName: string;
    sourceHash?: 媒体SourceHash信息;
  }> = [];
  sourceHashReuseCalls: Array<{
    kind: "image" | "video";
    input: 媒体SourceHash复用请求;
  }> = [];
  forwardMediaCalls: Array<{
    kind: "image" | "video";
    input: 媒体附件转发请求;
  }> = [];
  completeMediaCalls: Array<{ sessionId: string; attachmentId: string }> = [];
  bootstrapResult: 匿名身份引导结果 = {
    display_alias: "暴躁的企鹅",
    session_id: "s-test",
  };
  bootstrapQueue: Array<匿名身份引导结果 | Error> = [];
  joinQueue: Array<房间快照 | Error> = [];
  snapshotQueue: Array<房间快照 | Error> = [];
  eventsQueue: Array<增量事件快照 | Error> = [];
  historyQueue: Array<房间历史页 | Error> = [];
  prepareQueue: Array<假媒体上传准备结果 | Error> = [];
  completeQueue: Array<媒体附件上传结果 | Error> = [];
  readAnchorUpdates: Array<{
    roomId: string;
    sessionId: string;
    lastReadEventPosition: number;
  }> = [];
  readAnchorUpdateQueue: Array<Error | null> = [];
  snapshotRoomId = "r-test";
  joinRoomId = "r-test";

  async bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果> {
    this.bootstrapTokens.push(deviceToken);
    const queued = this.bootstrapQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return this.bootstrapResult;
  }

  async joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照> {
    this.joinCalls.push({ sessionId, roomCode });
    this.joinRoomId = roomCode === "ROOM02" ? "r-room-2" : "r-test";
    const queued = this.joinQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return 创建房间快照(this.joinRoomId);
  }

  async loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照> {
    this.loadRoomSnapshotCalls += 1;
    this.loadRoomSnapshotArgs.push({ roomId, sessionId });
    const queued = this.snapshotQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    this.snapshotRoomId = roomId;
    return 创建房间快照(roomId);
  }

  async prepareMediaUpload(
    kind: "image" | "video",
    sessionId: string,
    file: File,
    sourceHash?: 媒体SourceHash信息
  ): Promise<假媒体上传准备结果> {
    this.prepareMediaCalls.push({
      kind,
      sessionId,
      fileName: file.name,
      ...(sourceHash ? { sourceHash } : {}),
    });
    const queued = this.prepareQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return {
      attachment_id: "att-prepared-test",
      upload_session_id: "upl-prepared-test",
      upload_method: "tus",
      tus_endpoint: "http://storage.local/files",
      tus_headers: {
        Authorization: "Bearer test-upload-token",
      },
      tus_metadata: {
        attachment_id: "att-prepared-test",
        upload_session_id: "upl-prepared-test",
        file_name: file.name,
        mime_type: file.type || (kind === "video" ? "video/mp4" : "image/png"),
        byte_size: String(file.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    };
  }

  async reuseMediaBySourceHash(
    kind: "image" | "video",
    input: 媒体SourceHash复用请求
  ): Promise<媒体SourceHash复用结果> {
    this.sourceHashReuseCalls.push({ kind, input });
    return { status: "miss" };
  }

  async forwardMediaAttachment(
    kind: "image" | "video",
    input: 媒体附件转发请求
  ): Promise<媒体附件转发结果> {
    this.forwardMediaCalls.push({ kind, input });
    const attachmentId = `att-forward-${this.forwardMediaCalls.length}`;
    // 转发测试桩只表达“新消息绑定同一类 ready 附件”，不模拟重新上传、source_hash 或旧消息复制。
    return {
      message: {
        type: "message_created",
        room_id: input.target_room_id,
        message_id: `m-forward-${this.forwardMediaCalls.length}`,
        client_message_id: input.client_message_id,
        sender_session_id: input.session_id,
        sender_display_alias: "暴躁的企鹅",
        text: input.text ?? "",
        attachments: [
          {
            kind,
            attachment_id: attachmentId,
            width: kind === "video" ? 1280 : 1,
            height: kind === "video" ? 720 : 1,
          },
        ],
        event_position: this.forwardMediaCalls.length,
      },
      attachment: {
        attachment_id: attachmentId,
        kind,
        mime_type: kind === "video" ? "video/mp4" : "image/png",
        byte_size: 68,
        width: kind === "video" ? 1280 : 1,
        height: kind === "video" ? 720 : 1,
        status: "ready",
      },
    };
  }

  async abandonMediaUpload(_sessionId: string, _attachmentId: string): Promise<void> {}

  async completeMediaUpload(
    sessionId: string,
    attachmentId: string
  ): Promise<媒体附件上传结果> {
    this.completeMediaCalls.push({ sessionId, attachmentId });
    const queued = this.completeQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return {
      attachment_id: attachmentId,
      kind: attachmentId.includes("video") ? "video" : "image",
      mime_type: attachmentId.includes("video") ? "video/mp4" : "image/png",
      byte_size: 68,
      width: attachmentId.includes("video") ? 1280 : 1,
      height: attachmentId.includes("video") ? 720 : 1,
      status: "ready",
    };
  }

  async loadMediaLocator(_sessionId: string, attachmentId: string): Promise<媒体定位结果> {
    if (!attachmentId.includes("video")) {
      const sessionId = "s-test";
      const originalUrl = this.buildAttachmentContentUrl(attachmentId, sessionId);
      return {
        attachment_id: attachmentId,
        kind: "image",
        status: "ready",
        thumbnail_url: null,
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
              width: 1,
              height: 1,
            },
          },
          distribution: null,
          // 测试支架也要显式保留冷备 origin，确保前端不会把它误用成正式 blob 主链。
          origin: {
            original_url: originalUrl,
            expires_at_epoch_seconds: 1775942400,
            available: true,
            role: "cold_backup_only",
          },
        },
      };
    }
    return {
      attachment_id: attachmentId,
      kind: "video",
      status: "ready",
      thumbnail_url: null,
      distribution: null,
      file_asset: {
        asset_id: attachmentId,
        content_hash: `hash-${attachmentId}`,
        kind: "file_video",
        variants: {
          canonical: {
            id: "canonical",
            mime_type: "video/mp4",
            url: this.buildAttachmentContentUrl(attachmentId, "s-test"),
            width: 1280,
            height: 720,
          },
        },
        distribution: {
          swarm_id: `swarm-${attachmentId}`,
          announce_urls: [],
          web_seed_url: null,
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted",
        },
        origin: {
          original_url: this.buildAttachmentContentUrl(attachmentId, "s-test"),
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only",
        },
      },
    };
  }

  buildBlobAssetUrl(
    attachmentId: string,
    sessionId: string,
    variant: "preview" | "full" | "original"
  ): string {
    return `http://test.local/api/media/${attachmentId}/blob/${variant}?session_id=${sessionId}`;
  }

  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant: "original" | "thumbnail" = "original"
  ): string {
    return `http://test.local/api/attachments/${attachmentId}/content?session_id=${sessionId}&variant=${variant}`;
  }

  async updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void> {
    const queued = this.readAnchorUpdateQueue.shift();
    if (queued instanceof Error) {
      throw queued;
    }
    this.readAnchorUpdates.push({ roomId, sessionId, lastReadEventPosition });
  }

  async loadRoomEvents(
    roomId: string,
    sessionId: string,
    from: number
  ): Promise<增量事件快照> {
    this.loadRoomEventsCalls += 1;
    this.loadRoomEventsArgs.push({ roomId, sessionId, from });
    const queued = this.eventsQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return {
      room_id: roomId,
      latest_event_position: 1,
      events: [
        {
          type: "message_created",
          room_id: roomId,
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-test",
          sender_display_alias: "暴躁的企鹅",
          text: "hello",
          attachments: [],
          event_position: 1,
        },
      ],
    };
  }

  async loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页> {
    this.loadRoomHistoryCalls += 1;
    this.loadRoomHistoryArgs.push({ roomId, sessionId, beforeEventPosition, limit });
    const queued = this.historyQueue.shift();
    if (queued instanceof Error) throw queued;
    if (queued) return queued;
    return { room_id: roomId, messages: [] };
  }

  async loadAdminOverview(): Promise<后台概览> {
    return { room_count: 1, message_count: 1 };
  }

  async adminLogin(): Promise<后台登录结果> {
    return { token: "admin-token" };
  }

  async adminRooms(): Promise<后台房间列表> {
    return { rooms: ["r-test"] };
  }

  async adminRoomDetail(): Promise<后台房间详情> {
    return { room_id: "r-test", latest_event_position: 1, message_count: 1 };
  }

  createSocket(sessionId: string, _powToken?: string): Socket {
    this.socketSessionIds.push(sessionId);
    return this.socket as unknown as Socket;
  }

  释放Socket(socket: Socket): void {
    // 测试桩也要走和正式传输端口一致的释放协议，避免房间退出场景退化成“只清引用不真正断链”。
    socket.disconnect();
  }
}

export function 创建传输错误(status: number, code: string, message = code): Error {
  const error = new Error(message) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  return error;
}
import "./测试原型补丁.js";
