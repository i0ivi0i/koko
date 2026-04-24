import { expect, vi } from "vitest";
import "../../聊天壳";
import { 创建浏览器存储 } from "../../存储";
import type { 前端传输端口 } from "../../传输";
import type { 媒体附件草稿 as 图片附件草稿 } from "../../媒体/媒体草稿";
import { 创建房间内核, 派生房间壳外观 } from "../../房间内核";
import {
  创建房间时间线Actor,
  投影时间线快照到聊天时间线状态,
  type 房间时间线事件,
} from "../../房间时间线运行时";
import { 初始聊天状态, type 聊天状态 } from "../../状态";
import type {
  媒体查看器打开请求,
  媒体播放结果,
} from "../../媒体/index.js";
import type {
  匿名身份引导结果,
  增量事件快照,
  后台概览,
  消息事件,
  媒体附件上传结果,
  媒体定位结果,
  媒体SourceHash信息,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  房间历史页,
  房间快照,
  后台登录结果,
  后台房间列表,
  后台房间详情,
} from "../../契约";
import { 聊天壳 } from "../../聊天壳";
import type { Socket } from "socket.io-client";

type 假媒体上传准备结果 = {
  attachment_id: string;
  upload_session_id: string;
  upload_method: "tus";
  tus_endpoint: string;
  tus_headers: Record<string, string>;
  tus_metadata: Record<string, string>;
  expires_at: string;
};

/**
 * Pretext 在测试进程里也需要一个可用的测量上下文。
 *
 * 当前 happy-dom 不提供真正的 canvas 2D context，所以这里补一个最小 OffscreenCanvas shim：
 * 1. 只实现 Pretext 会读取的 `font` 和 `measureText()`；
 * 2. 只用于验证“我们的前端封装有没有把数据流接对”；
 * 3. 不把测试用近似测量混进运行时代码。
 */
export function 安装测试文本测量画布(): void {
  class 假二维上下文 {
    font = "16px Microsoft YaHei";

    measureText(text: string): { width: number } {
      const px = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "16");
      return { width: text.length * px * 0.58 };
    }
  }

  class 假OffscreenCanvas {
    getContext(kind: string): 假二维上下文 | null {
      if (kind !== "2d") {
        return null;
      }
      return new 假二维上下文();
    }
  }

  Object.defineProperty(globalThis, "OffscreenCanvas", {
    value: 假OffscreenCanvas,
    configurable: true,
    writable: true,
  });
}

安装测试文本测量画布();

/**
 * 聊天测试支架只承接假对象、场景构造器和 DOM 辅助器。
 * 这样壳层集成与编排器直测共享同一套测试基础设施，
 * 不再把多种职责继续堆在一个超大 spec 文件里。
 */
export function createFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

export class 假Socket {
  private handlers = new Map<string, Array<(payload: unknown) => void>>();
  public sentEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
  public subscribeResults: Array<Record<string, unknown>> = [];

  on(event: string, handler: (payload: unknown) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload: Record<string, unknown>): boolean {
    this.sentEvents.push({ event, payload });
    if (event === "subscribe_room_stream") {
      if (this.subscribeResults.length > 0) {
        this.fire("control_result", this.subscribeResults.shift()!);
      } else if (payload.from === 99) {
        this.fire("control_result", {
          kind: "need_snapshot_reload",
          room_id: payload.room_id,
          expected_position: 99,
        });
      } else {
        this.fire("control_result", {
          kind: "subscribed",
          room_id: payload.room_id,
          latest_event_position: Number(payload.from ?? 0),
        });
      }
    }
    if (event === "create_message" || event === "send_text_message") {
      const text =
        typeof payload.text === "string"
          ? payload.text
          : typeof payload.body === "string"
            ? payload.body
            : "";
      const attachmentIds = Array.isArray(payload.attachment_ids)
        ? payload.attachment_ids
        : [];
      this.fire("room_event", {
        type: "message_created",
        room_id: "r-test",
        message_id: "m-1",
        client_message_id: payload.client_message_id,
        sender_session_id: "s-test",
        sender_display_alias: "暴躁的企鹅",
        text,
        attachments: attachmentIds.map((attachmentId) => ({
          kind: String(attachmentId).includes("video") ? ("video" as const) : ("image" as const),
          attachment_id: String(attachmentId),
          width: String(attachmentId).includes("video") ? 1280 : 120,
          height: String(attachmentId).includes("video") ? 720 : 90,
          has_preview_asset: String(attachmentId).includes("video"),
        })),
        event_position: 1,
      });
    }
    return true;
  }

  disconnect(): void {}

  trigger(event: string, payload: unknown): void {
    this.fire(event, payload);
  }

  private fire(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

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

  async bootstrapAnonymousIdentity(
    deviceToken: string
  ): Promise<匿名身份引导结果> {
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
        manifest: null,
        lifecycle: null,
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
  createSocket(_sessionId: string): Socket {
    this.socketSessionIds.push(_sessionId);
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

export async function 等待组件稳定(el: 聊天壳): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/**
 * 绝大多数聊天壳集成都先需要一个“已经入房”的壳。
 * 这里把重复的 DOM 挂载、假传输注入、进房动作收口成一个测试辅助器，
 * 避免每个 spec 自己再拼一遍样板流程。
 */
export async function 创建已入房聊天壳(
  transport = new 假传输(),
  roomCode = "ROOM01"
): Promise<聊天壳> {
  const el = document.createElement("koko-chat-shell") as 聊天壳;
  el.setTransportForTest(transport);
  document.body.appendChild(el);
  await 等待组件稳定(el);
  输入房间短码到操作台(el, roomCode);
  读取操作台主动作(el).click();
  await 等待组件稳定(el);
  await 等待组件稳定(el);
  return el;
}

type 聊天壳测试内核 = {
  snapshot(): 聊天状态;
  写入视口调试状态供测试(
    patch: Partial<
      Pick<
        聊天状态,
        | "lastReadEventPosition"
        | "firstUnreadEventPosition"
        | "initialUnreadSettled"
        | "scrollPhase"
        | "hasUserScrollIntent"
        | "pendingReadAnchorPosition"
        | "historyLoadThrottleUntil"
        | "viewportMode"
      >
    >
  ): void;
  读取房间滚动器供测试(): unknown;
};

function 读取聊天壳测试内核(el: 聊天壳): 聊天壳测试内核 {
  return (el as unknown as { kernel: 聊天壳测试内核 }).kernel;
}

type 聊天媒体测试端口 = {
  设置媒体播放器供测试(player: {
    解析播放结果(input: {
      attachmentId: string;
      kind: "image" | "video";
      surface?: "viewer" | "inline_autoplay";
      consumerId?: string;
    }): Promise<媒体播放结果>;
    释放附件播放资源?(input: {
      attachmentId: string;
      consumerId?: string;
      丢弃未完成补齐?: boolean;
    }): void;
  }): void;
  设置媒体查看器供测试(viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  写入媒体草稿列表供测试(drafts: 图片附件草稿[]): void;
};

/**
 * 这里故意只把测试替身注入到“媒体编排”这一层。
 * 正式壳层和内核表面不再暴露这些 setter，避免测试缝重新长回生产入口。
 */
function 读取聊天媒体编排供测试(el: 聊天壳): 聊天媒体测试端口 {
  return (读取聊天壳测试内核(el) as unknown as { 媒体编排: 聊天媒体测试端口 }).媒体编排;
}

/**
 * 集成测试以后统一从内核快照读状态，不再偷摸壳层私有字段。
 * 这样测试也跟真实分层保持一致：壳层只渲染，真相在内核。
 */
export function 读取聊天快照供测试(el: 聊天壳): 聊天状态 {
  return 读取聊天壳测试内核(el).snapshot();
}

export function 读取房间滚动器供测试<T = unknown>(el: 聊天壳): T {
  return 读取聊天壳测试内核(el).读取房间滚动器供测试() as T;
}

/**
 * 媒体草稿属于前端本地体验态，测试里不需要真的走上传器。
 * 这里直接注入草稿，只为了锁住 presenter 和渲染结果，
 * 不把测试耦合到 Uppy 的内部事件细节。
 */
export function 注入媒体草稿(el: 聊天壳, draft: 图片附件草稿): void {
  const 当前草稿 =
    (读取聊天壳测试内核(el) as unknown as {
      snapshot(): 聊天状态 & { composerMediaDrafts?: 图片附件草稿[] };
    }).snapshot?.().composerMediaDrafts ?? [];
  读取聊天媒体编排供测试(el).写入媒体草稿列表供测试([
    ...当前草稿.filter((item) => item.localId !== draft.localId),
    draft,
  ]);
}

export function 注入图片草稿(el: 聊天壳, draft: 图片附件草稿): void {
  注入媒体草稿(el, draft);
}

export function 注入媒体播放器供测试(
  el: 聊天壳,
  player: {
    解析播放结果(input: {
      attachmentId: string;
      kind: "image" | "video";
      surface?: "viewer" | "inline_autoplay";
      consumerId?: string;
    }): Promise<媒体播放结果>;
    释放附件播放资源?(input: {
      attachmentId: string;
      consumerId?: string;
      丢弃未完成补齐?: boolean;
    }): void;
  }
): void {
  读取聊天媒体编排供测试(el).设置媒体播放器供测试(player);
}

export function 注入媒体查看器供测试(
  el: 聊天壳,
  viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }
): void {
  读取聊天媒体编排供测试(el).设置媒体查看器供测试(viewer);
}

export function 注入媒体发布器供测试(
  el: 聊天壳,
  publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }
): void {
  读取聊天媒体编排供测试(el).设置媒体发布器供测试(publisher);
}

export function 读取操作台主输入(
  el: 聊天壳
): HTMLTextAreaElement | HTMLInputElement {
  const input = el.shadowRoot!.querySelector(
    "#shellConsolePrimaryInput"
  ) as HTMLTextAreaElement | HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

export function 读取操作台主动作(el: 聊天壳): HTMLButtonElement {
  const action = el.shadowRoot!.querySelector(
    "#shellConsolePrimaryAction"
  ) as HTMLButtonElement | null;
  expect(action).not.toBeNull();
  return action!;
}

export function 读取操作台表单(el: 聊天壳): HTMLFormElement {
  const form = el.shadowRoot!.querySelector("#shellConsoleForm") as HTMLFormElement | null;
  expect(form).not.toBeNull();
  return form!;
}

export function 读取附件入口按钮(el: 聊天壳): HTMLButtonElement {
  const button = el.shadowRoot!.querySelector(
    "#composerMediaPickerBtn"
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  return button!;
}

export function 读取统一媒体文件输入(el: 聊天壳): HTMLInputElement {
  const input = el.shadowRoot!.querySelector(
    "#composerMediaFileInput"
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input!;
}

export function 输入房间短码到操作台(el: 聊天壳, roomCode: string): void {
  const input = 读取操作台主输入(el);
  input.value = roomCode;
  input.dispatchEvent(new Event("input"));
}

export function 输入消息到操作台(el: 聊天壳, message: string): void {
  const input = 读取操作台主输入(el);
  input.value = message;
  input.dispatchEvent(new Event("input"));
}

export function 设置测试滚动阶段(
  el: 聊天壳,
  patch: {
    lastReadEventPosition?: number | null;
    initialUnreadSettled?: boolean;
    firstUnreadEventPosition?: number | null;
    scrollPhase?: 聊天状态["scrollPhase"];
    hasUserScrollIntent?: boolean;
    pendingReadAnchorPosition?: number | null;
    historyLoadThrottleUntil?: number;
    viewportMode?: 聊天状态["viewportMode"];
  }
): void {
  读取聊天壳测试内核(el).写入视口调试状态供测试(patch);
}

export function 模拟用户滚动意图(scroll: HTMLElement): void {
  scroll.dispatchEvent(new Event("pointerdown"));
}

export function 模拟消息滚动视口(
  el: 聊天壳,
  scroll: HTMLElement,
  rows: Array<{ eventPosition: number; top: number; bottom: number }>
): void {
  const byPosition = new Map(rows.map((row) => [row.eventPosition, row]));
  Object.defineProperty(scroll, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 300,
      width: 320,
      height: 300,
      toJSON: () => ({}),
    }),
  });
  const elements = Array.from(
    el.shadowRoot!.querySelectorAll("[data-event-position]")
  ) as HTMLElement[];
  for (const element of elements) {
    const eventPosition = Number(element.dataset.eventPosition);
    const row = byPosition.get(eventPosition) ?? {
      eventPosition,
      top: 1000 + eventPosition * 10,
      bottom: 1040 + eventPosition * 10,
    };
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: row.top,
        top: row.top,
        left: 0,
        right: 320,
        bottom: row.bottom,
        width: 320,
        height: row.bottom - row.top,
        toJSON: () => ({}),
      }),
    });
  }
}

export async function 读取房间恢复编排工厂(): Promise<(deps: Record<string, unknown>) => Record<string, unknown>> {
  let 创建房间恢复编排: unknown;
  try {
    // 公共测试支架已经下沉到 tests/common，动态导入要同步回到 frontend 根上的真实模块位置。
    const modulePath = "../../房间恢复编排";
    ({ 创建房间恢复编排 } = await import(/* @vite-ignore */ modulePath));
  } catch {
    创建房间恢复编排 = undefined;
  }
  expect(typeof 创建房间恢复编排).toBe("function");
  return 创建房间恢复编排 as (deps: Record<string, unknown>) => Record<string, unknown>;
}

function 创建房间壳补丁(roomKernel: ReturnType<typeof 创建房间内核>): Partial<聊天状态> {
  const roomShell = 派生房间壳外观(roomKernel.getSnapshot());
  return {
    sessionId: roomShell.sessionId,
    displayAlias: roomShell.displayAlias,
    roomId: roomShell.roomId,
    roomDisplayTitle: roomShell.roomDisplayTitle,
    latestEventPosition: roomShell.latestEventPosition,
    recoveryState: roomShell.recoveryState,
    lastRecoveryErrorCode: roomShell.lastRecoveryErrorCode,
  };
}

function 创建会同步房间壳补丁的房间内核端口(
  roomKernel: ReturnType<typeof 创建房间内核>,
  同步房间壳补丁: () => void
): {
  send(event: Parameters<ReturnType<typeof 创建房间内核>["send"]>[0]): void;
} {
  return {
    send(event) {
      roomKernel.send(event);
      同步房间壳补丁();
    },
  };
}

function 创建会同步时间线补丁的时间线端口(
  updateState: (patch: Partial<聊天状态>) => void,
  input: {
    messages?: 消息事件[];
    latestEventPosition?: number;
    hasMoreBefore?: boolean;
  } = {}
): {
  send(event: 房间时间线事件): void;
} {
  const actor = 创建房间时间线Actor();
  const 同步时间线补丁 = (): void => {
    const snapshot = actor.getSnapshot();
    updateState({
      ...投影时间线快照到聊天时间线状态(snapshot),
      latestEventPosition: snapshot.context.latestEventPosition,
    });
  };

  if (
    (input.messages?.length ?? 0) > 0 ||
    (input.latestEventPosition ?? 0) > 0 ||
    (input.hasMoreBefore ?? false)
  ) {
    actor.send({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      messages: input.messages ?? [],
      latestEventPosition: input.latestEventPosition ?? 0,
      hasMoreBefore: input.hasMoreBefore ?? false,
    });
  }
  同步时间线补丁();

  return {
    send(event) {
      actor.send(event);
      同步时间线补丁();
    },
  };
}

function 创建房间视图重置补丁(): Partial<聊天状态> {
  return {
    messageInput: "",
    lastReadEventPosition: null,
    firstUnreadEventPosition: null,
    hasMoreBefore: false,
    initialUnreadSettled: true,
    scrollPhase: "idle",
    hasUserScrollIntent: false,
    pendingReadAnchorPosition: null,
    viewportMode: "离底浏览",
    candidateReadAnchorPosition: null,
    hasUnreadNewerMessages: false,
    historyLoadThrottleUntil: 0,
    messages: [],
    pending: false,
    historyLoading: false,
    historyErrorCode: "",
  };
}

export function 创建恢复编排测试场景(input: {
  roomId?: string;
  roomCode?: string;
  sessionId?: string;
  displayAlias?: string;
  homeSessionItems?: Array<{ roomId: string; roomCode: string; lastEnteredAt: number }>;
  skipInitialBootstrap?: boolean;
} = {}) {
  const rawStorage = createFakeStorage();
  const storage = 创建浏览器存储(rawStorage);
  const roomId = input.roomId ?? "";
  const roomCode = input.roomCode ?? "";
  if (roomId) {
    rawStorage.setItem("koko_current_room_id", roomId);
  }
  if (roomCode) {
    rawStorage.setItem("koko_current_room_code", roomCode);
  }
  for (const item of input.homeSessionItems ?? []) {
    storage.写入或更新首页房间历史条目(item);
  }

  const roomKernel = 创建房间内核();
  let state: 聊天状态 = {
    ...初始聊天状态,
    sessionId: input.sessionId ?? "s-test",
    displayAlias: input.displayAlias ?? "暴躁的企鹅",
    homeSessionItems: storage.读取首页房间历史(),
  };

  if (!input.skipInitialBootstrap) {
    roomKernel.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: state.sessionId,
      displayAlias: state.displayAlias,
      roomId,
    });
    state = {
      ...state,
      ...创建房间壳补丁(roomKernel),
    };
  }

  const transport = new 假传输();
  const ensureRealtimeSocketCalls: string[] = [];
  const subscribeCalls: number[] = [];
  let shouldPrimeReadAnchorAfterInitialSettle = false;
  const roomScroller = {
    安排首屏定位: vi.fn(),
    取消挂起滚动副作用: vi.fn(),
  };
  const disconnectRealtime = vi.fn();
  const cancelPendingReadAnchorFlush = vi.fn();
  const cancelPendingFollowLatestReadSample = vi.fn();

  const updateState = (patch: Partial<聊天状态>): void => {
    state = { ...state, ...patch };
  };
  const 同步房间壳补丁 = (): void => {
    updateState(创建房间壳补丁(roomKernel));
  };
  const roomKernelPort = 创建会同步房间壳补丁的房间内核端口(roomKernel, 同步房间壳补丁);
  const roomTimelinePort = 创建会同步时间线补丁的时间线端口(updateState);

  const deps = {
    读取恢复状态: () => state,
    写入恢复状态: updateState,
    接收时间线事实: (event: 房间时间线事件) => roomTimelinePort.send(event),
    transport,
    storage,
    roomKernel: roomKernelPort,
    roomScroller,
    ensureRealtimeSocket: (sessionId: string) => {
      ensureRealtimeSocketCalls.push(sessionId);
    },
    subscribeRoom: (from: number) => {
      subscribeCalls.push(from);
    },
    cancelPendingReadAnchorFlush,
    cancelPendingFollowLatestReadSample,
    exitCurrentRoomView: (
      opts: {
        keepRoomCodeCache?: boolean;
      } = {}
    ) => {
      storage.清除当前房间标识();
      if (!opts.keepRoomCodeCache) {
        storage.清除当前房间短码();
      }
      updateState(创建房间视图重置补丁());
    },
    disconnectRealtime: () => {
      disconnectRealtime();
    },
    写入恢复补锚标记: (value: boolean) => {
      shouldPrimeReadAnchorAfterInitialSettle = value;
    },
    等待壳渲染完成: async () => {},
    读取恢复补锚标记: () => shouldPrimeReadAnchorAfterInitialSettle,
  };

  return {
    transport,
    storage,
    rawStorage,
    roomKernel,
    roomScroller,
    ensureRealtimeSocketCalls,
    subscribeCalls,
    disconnectRealtime,
    cancelPendingReadAnchorFlush,
    cancelPendingFollowLatestReadSample,
    读取状态: () => state,
    deps,
  };
}

export async function 读取房间实时编排工厂(): Promise<(deps: Record<string, unknown>) => Record<string, unknown>> {
  let 创建房间实时编排: unknown;
  try {
    // 这里保持和恢复编排相同的相对路径规则，避免测试支架迁移后继续指向旧目录。
    const modulePath = "../../房间实时编排";
    ({ 创建房间实时编排 } = await import(/* @vite-ignore */ modulePath));
  } catch {
    创建房间实时编排 = undefined;
  }
  expect(typeof 创建房间实时编排).toBe("function");
  return 创建房间实时编排 as (deps: Record<string, unknown>) => Record<string, unknown>;
}

export function 创建实时编排测试场景(input: {
  roomId?: string;
  roomDisplayTitle?: string;
  sessionId?: string;
  displayAlias?: string;
  latestEventPosition?: number;
  viewportMode?: 聊天状态["viewportMode"];
  messages?: 消息事件[];
  messageInput?: string;
} = {}) {
  const transport = new 假传输();
  const roomKernel = 创建房间内核();
  let state: 聊天状态 = {
    ...初始聊天状态,
    sessionId: input.sessionId ?? "s-test",
    displayAlias: input.displayAlias ?? "暴躁的企鹅",
    messageInput: input.messageInput ?? "",
    messages: input.messages ?? [],
  };

  roomKernel.send({
    type: "BOOTSTRAP_SUCCEEDED",
    sessionId: state.sessionId,
    displayAlias: state.displayAlias,
    roomId: input.roomId ?? "",
  });
  if (input.roomId) {
    roomKernel.send({
      type: "SNAPSHOT_LOADED",
      roomId: input.roomId,
      roomDisplayTitle: input.roomDisplayTitle ?? "ROOM01",
      latestEventPosition: input.latestEventPosition ?? 0,
    });
  }
  state = {
    ...state,
    ...创建房间壳补丁(roomKernel),
    latestEventPosition: input.latestEventPosition ?? 0,
    viewportMode: input.viewportMode ?? "离底浏览",
  };

  const transportErrors: Array<Record<string, unknown>> = [];
  const recoveryFailures: Array<{ error: unknown; keepRoomVisible: boolean }> = [];
  const followLatestCalls: number[] = [];
  const realtimeSessionEvents: Array<Record<string, unknown>> = [];

  const updateState = (patch: Partial<聊天状态>): void => {
    state = { ...state, ...patch };
  };
  const 同步房间壳补丁 = (): void => {
    updateState(创建房间壳补丁(roomKernel));
  };
  const roomKernelPort = 创建会同步房间壳补丁的房间内核端口(roomKernel, 同步房间壳补丁);
  const roomTimelinePort = 创建会同步时间线补丁的时间线端口(updateState, {
    messages: input.messages ?? [],
    latestEventPosition: input.latestEventPosition ?? 0,
  });

  const deps = {
    读取实时状态: () => state,
    写入实时状态: updateState,
    接收时间线事实: (event: 房间时间线事件) => roomTimelinePort.send(event),
    接收实时会话事实: (event: Record<string, unknown>) => {
      realtimeSessionEvents.push(event);
    },
    transport,
    roomKernel: roomKernelPort,
    上报Transport异常: async (error: Record<string, unknown>) => {
      transportErrors.push(error);
    },
    处理恢复失败: (error: unknown, keepRoomVisible: boolean) => {
      recoveryFailures.push({ error, keepRoomVisible });
    },
    跟随最新消息追加后刷新视口: async () => {
      followLatestCalls.push(Date.now());
    },
  };

  return {
    transport,
    roomKernel,
    读取状态: () => state,
    transportErrors,
    recoveryFailures,
    followLatestCalls,
    realtimeSessionEvents,
    deps,
  };
}

export async function 读取阅读推进编排工厂(): Promise<(deps: Record<string, unknown>) => Record<string, unknown>> {
  let 创建阅读推进编排: unknown;
  try {
    // 阅读推进编排和前两者一样，都位于 frontend 根目录，不再沿用旧 spec 文件的相对路径。
    const modulePath = "../../阅读推进编排";
    ({ 创建阅读推进编排 } = await import(/* @vite-ignore */ modulePath));
  } catch {
    创建阅读推进编排 = undefined;
  }
  expect(typeof 创建阅读推进编排).toBe("function");
  return 创建阅读推进编排 as (deps: Record<string, unknown>) => Record<string, unknown>;
}

export function 创建阅读推进测试场景(input: {
  roomId?: string;
  roomDisplayTitle?: string;
  sessionId?: string;
  displayAlias?: string;
  latestEventPosition?: number;
  viewportMode?: 聊天状态["viewportMode"];
  lastReadEventPosition?: number | null;
  firstUnreadEventPosition?: number | null;
  initialUnreadSettled?: boolean;
  hasMoreBefore?: boolean;
  messages?: 消息事件[];
} = {}) {
  const transport = new 假传输();
  const roomKernel = 创建房间内核();
  let state: 聊天状态 = {
    ...初始聊天状态,
    sessionId: input.sessionId ?? "s-test",
    displayAlias: input.displayAlias ?? "暴躁的企鹅",
    lastReadEventPosition: input.lastReadEventPosition ?? null,
    firstUnreadEventPosition: input.firstUnreadEventPosition ?? null,
    initialUnreadSettled: input.initialUnreadSettled ?? true,
    hasMoreBefore: input.hasMoreBefore ?? false,
    messages: input.messages ?? [],
  };

  roomKernel.send({
    type: "BOOTSTRAP_SUCCEEDED",
    sessionId: state.sessionId,
    displayAlias: state.displayAlias,
    roomId: input.roomId ?? "",
  });
  if (input.roomId) {
    roomKernel.send({
      type: "SNAPSHOT_LOADED",
      roomId: input.roomId,
      roomDisplayTitle: input.roomDisplayTitle ?? "ROOM01",
      latestEventPosition: input.latestEventPosition ?? 0,
    });
  }
  state = {
    ...state,
    ...创建房间壳补丁(roomKernel),
    latestEventPosition: input.latestEventPosition ?? 0,
    viewportMode: input.viewportMode ?? "离底浏览",
  };

  const 历史补偿调用: Array<{
    context: {
      旧滚动高度: number;
      锚点消息位置: number | null;
      锚点距容器顶部: number | null;
    };
    inserted: boolean;
  }> = [];
  const 滚到最新调用: number[] = [];
  const roomScroller = {
    读取当前可见阅读锚点: vi.fn(() => 8),
    读取当前是否接近底部: vi.fn(() => false),
    读取历史补偿上下文: vi.fn(() => ({
      旧滚动高度: 320,
      锚点消息位置: 2,
      锚点距容器顶部: 18,
    })),
    应用历史补偿: vi.fn(
      async (
        context: {
          旧滚动高度: number;
          锚点消息位置: number | null;
          锚点距容器顶部: number | null;
        },
        inserted: boolean
      ) => {
        历史补偿调用.push({ context, inserted });
      }
    ),
  };

  const updateState = (patch: Partial<聊天状态>): void => {
    state = { ...state, ...patch };
  };
  const 同步房间壳补丁 = (): void => {
    updateState(创建房间壳补丁(roomKernel));
  };
  const roomKernelPort = 创建会同步房间壳补丁的房间内核端口(roomKernel, 同步房间壳补丁);
  const roomTimelinePort = 创建会同步时间线补丁的时间线端口(updateState, {
    messages: input.messages ?? [],
    latestEventPosition: input.latestEventPosition ?? 0,
    hasMoreBefore: input.hasMoreBefore ?? false,
  });

  const deps = {
    读取阅读状态: () => state,
    写入阅读状态: updateState,
    接收时间线事实: (event: 房间时间线事件) => roomTimelinePort.send(event),
    transport,
    roomScroller,
    withSessionRefreshOnInvalid: async <T,>(operation: (sessionId: string) => Promise<T>) =>
      operation(state.sessionId),
    等待壳渲染完成: async () => {},
    滚到最新位置: async () => {
      滚到最新调用.push(Date.now());
    },
  };

  return {
    transport,
    roomKernel,
    roomScroller,
    历史补偿调用,
    滚到最新调用,
    读取状态: () => state,
    deps,
  };
}


