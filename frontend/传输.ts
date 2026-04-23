import type { Socket } from "socket.io-client";
import type {
  附件快照,
  匿名身份引导结果,
  增量事件快照,
  消息事件,
  媒体附件上传结果,
  媒体定位结果,
  媒体上传准备结果,
  媒体种类,
  预览资源描述,
  房间历史页,
  房间快照,
  后台概览,
  后台房间列表,
  后台房间详情,
  后台登录结果,
} from "./契约.js";
import { 实时连接适配 } from "./聊天实时/适配/实时连接适配.js";
import type {
  聊天房间传输端口,
} from "./聊天共享/适配/聊天房间传输端口.js";
import type {
  聊天实时连接端口,
  实时连接运行时策略,
} from "./聊天共享/适配/聊天实时连接端口.js";
import { 房间HTTP接口 } from "./聊天恢复/适配/房间HTTP接口.js";
import { 媒体HTTP接口 } from "./媒体/适配/媒体HTTP接口.js";
import { 后台HTTP接口 } from "./操作台/适配/后台HTTP接口.js";

type 接口错误响应 = {
  code?: string;
  message?: string;
};

/**
 * HTTP 失败要把状态码和稳定错误码一起带回壳层。
 * 这样恢复分类器才能区分“硬失效”与“临时失败”，而不是只看到一串模糊字符串。
 */
export class Http接口错误 extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "Http接口错误";
  }
}

/**
 * 媒体传输端口只承接上传、定位和附件内容地址构建。
 * 这里继续保留最薄的 adapter 语义，不倒灌聊天房间或后台管理能力。
 */
export interface 媒体传输端口 {
  prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File
  ): Promise<媒体上传准备结果>;
  abandonMediaUpload(sessionId: string, attachmentId: string): Promise<void>;
  completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  loadMediaLocator(sessionId: string, attachmentId: string): Promise<媒体定位结果>;
  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant?: "original" | "thumbnail"
  ): string;
}

/**
 * 后台查询传输端口只承接后台只读查询。
 * 登录留在单独窄口，避免后台调用方又退回“全拿一份巨型 transport”。
 */
export interface 后台查询传输端口 {
  loadAdminOverview(token: string): Promise<后台概览>;
  adminRooms(token: string): Promise<后台房间列表>;
  adminRoomDetail(token: string, roomId: string): Promise<后台房间详情>;
}

/**
 * 后台会话传输端口只承接登录。
 * 这样后台会话编排不会顺手看到概览/房间详情等查询能力。
 */
export interface 后台会话传输端口 {
  adminLogin(username: string, password: string): Promise<后台登录结果>;
}

/**
 * 正式组合根仍然是 `前端传输端口`。
 * 但调用侧不该再默认抱住整张表，而要通过下面的投影函数拿自己那一小截能力。
 */
export interface 前端传输端口
  extends 聊天房间传输端口,
    聊天实时连接端口,
    媒体传输端口,
    后台查询传输端口,
    后台会话传输端口 {}

export type { 聊天房间传输端口, 聊天实时连接端口, 实时连接运行时策略 };

/**
 * 这些投影函数故意只是“身份收窄”：
 * 1. 不创建第二个 transport；
 * 2. 不包一层新的共享状态；
 * 3. 只把 TypeScript 视角收回到调用方真正需要的那一小截。
 */
export const 投影聊天房间传输端口 = (
  transport: 前端传输端口
): 聊天房间传输端口 => transport;

export const 投影聊天实时连接端口 = (
  transport: 前端传输端口
): 聊天实时连接端口 => transport;

export const 投影媒体传输端口 = (
  transport: 前端传输端口
): 媒体传输端口 => transport;

export const 投影后台查询传输端口 = (
  transport: 前端传输端口
): 后台查询传输端口 => transport;

export const 投影后台会话传输端口 = (
  transport: 前端传输端口
): 后台会话传输端口 => transport;

/**
 * HttpRealtime传输 现在只保留“组合根”职责：
 * - socket 生命周期交给 realtime 适配；
 * - 聊天房间 HTTP 主链交给房间接口；
 * - 媒体上传/定位交给媒体接口；
 * - 后台冷路径交给操作台接口。
 *
 * 这样 transport 不再继续吸 media/admin 细节，只负责把几条已存在的稳定主链拼起来。
 */
export class HttpRealtime传输 implements 前端传输端口 {
  private readonly 实时连接: 实时连接适配;
  private readonly 房间HTTP接口: 房间HTTP接口;
  private readonly 媒体HTTP接口: 媒体HTTP接口;
  private readonly 后台HTTP接口: 后台HTTP接口;

  constructor(private readonly baseUrl: string) {
    this.实时连接 = new 实时连接适配(baseUrl);
    this.房间HTTP接口 = new 房间HTTP接口({
      get: this.get.bind(this),
      post: this.post.bind(this),
      解析房间快照: (snapshot) => this.解析房间快照(snapshot),
      解析增量事件快照: (snapshot) => this.解析增量事件快照(snapshot),
      解析房间历史页: (page) => this.解析房间历史页(page),
    });
    this.媒体HTTP接口 = new 媒体HTTP接口({
      get: this.get.bind(this),
      post: this.post.bind(this),
      解析绝对地址: (pathOrUrl) => this.解析绝对地址(pathOrUrl),
      解析预览资源: (preview) => this.解析预览资源(preview),
    });
    this.后台HTTP接口 = new 后台HTTP接口({
      get: this.get.bind(this),
      post: this.post.bind(this),
    });
  }

  /**
   * 后端在本地回环模式下会返回相对地址，例如 `/files`。
   * 浏览器里的 adapter 必须先收口成绝对地址，避免后续上传/预览直接用错主机。
   */
  private 解析绝对地址(pathOrUrl: string): string {
    return new URL(pathOrUrl, this.baseUrl).href;
  }

  private 解析预览资源(preview: 预览资源描述 | null | undefined): 预览资源描述 | null {
    if (!preview) {
      return null;
    }
    return {
      ...preview,
      still_url: this.解析绝对地址(preview.still_url),
    };
  }

  private 解析附件快照(attachment: 附件快照): 附件快照 {
    return {
      ...attachment,
      preview_asset: this.解析预览资源(attachment.preview_asset),
    };
  }

  private 解析消息事件(event: 消息事件): 消息事件 {
    const attachments = event.attachments?.map((attachment) => this.解析附件快照(attachment));
    return {
      ...event,
      /**
       * `消息事件.attachments` 在共享契约里是“可选字段”，不是“必有但值可为 undefined”。
       * 这里按 contract 原语义投影，避免 exactOptionalPropertyTypes 下长出脏形状。
       */
      ...(attachments ? { attachments } : {}),
    };
  }

  private 解析房间快照(snapshot: 房间快照): 房间快照 {
    return {
      ...snapshot,
      snapshot_messages: snapshot.snapshot_messages.map((event) => this.解析消息事件(event)),
    };
  }

  private 解析增量事件快照(snapshot: 增量事件快照): 增量事件快照 {
    return {
      ...snapshot,
      events: snapshot.events.map((event) => this.解析消息事件(event)),
    };
  }

  private 解析房间历史页(page: 房间历史页): 房间历史页 {
    return {
      ...page,
      messages: page.messages.map((event) => this.解析消息事件(event)),
    };
  }

  async bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果> {
    return this.房间HTTP接口.bootstrapAnonymousIdentity(deviceToken);
  }

  async joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照> {
    return this.房间HTTP接口.joinOrCreateRoom(sessionId, roomCode);
  }

  async loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照> {
    return this.房间HTTP接口.loadRoomSnapshot(roomId, sessionId);
  }

  async prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File
  ): Promise<媒体上传准备结果> {
    return this.媒体HTTP接口.prepareMediaUpload(kind, sessionId, file);
  }

  async abandonMediaUpload(sessionId: string, attachmentId: string): Promise<void> {
    return this.媒体HTTP接口.abandonMediaUpload(sessionId, attachmentId);
  }

  async completeMediaUpload(
    sessionId: string,
    attachmentId: string
  ): Promise<媒体附件上传结果> {
    return this.媒体HTTP接口.completeMediaUpload(sessionId, attachmentId);
  }

  async loadMediaLocator(sessionId: string, attachmentId: string): Promise<媒体定位结果> {
    return this.媒体HTTP接口.loadMediaLocator(sessionId, attachmentId);
  }

  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant: "original" | "thumbnail" = "original"
  ): string {
    const params = new URLSearchParams({
      session_id: sessionId,
      variant,
    });
    return `${this.baseUrl}/api/attachments/${attachmentId}/content?${params.toString()}`;
  }

  async updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void> {
    return this.房间HTTP接口.updateRoomReadAnchor(roomId, sessionId, lastReadEventPosition);
  }

  async loadRoomEvents(
    roomId: string,
    sessionId: string,
    from: number
  ): Promise<增量事件快照> {
    return this.房间HTTP接口.loadRoomEvents(roomId, sessionId, from);
  }

  async loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页> {
    return this.房间HTTP接口.loadRoomHistory(
      roomId,
      sessionId,
      beforeEventPosition,
      limit
    );
  }

  async loadAdminOverview(token: string): Promise<后台概览> {
    return this.后台HTTP接口.loadAdminOverview(token);
  }

  async adminLogin(username: string, password: string): Promise<后台登录结果> {
    return this.后台HTTP接口.adminLogin(username, password);
  }

  async adminRooms(token: string): Promise<后台房间列表> {
    return this.后台HTTP接口.adminRooms(token);
  }

  async adminRoomDetail(token: string, roomId: string): Promise<后台房间详情> {
    return this.后台HTTP接口.adminRoomDetail(token, roomId);
  }

  createSocket(sessionId: string): Socket {
    return this.实时连接.createSocket(sessionId);
  }

  接收运行时策略(policy: 实时连接运行时策略): void {
    this.实时连接.接收运行时策略(policy);
  }

  读取运行时策略(): 实时连接运行时策略 {
    return this.实时连接.读取运行时策略();
  }

  释放Socket(socket: Socket): void {
    this.实时连接.释放Socket(socket);
  }

  private async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      throw await this.buildHttpError("GET", path, response);
    }
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await this.buildHttpError("POST", path, response);
    }
    return (await response.json()) as T;
  }

  private async buildHttpError(
    method: "GET" | "POST",
    path: string,
    response: Response
  ): Promise<Http接口错误> {
    let code = `http_${response.status}`;
    let message = `${method} ${path} failed: ${response.status}`;
    try {
      const payload = (await response.json()) as 接口错误响应;
      if (typeof payload.code === "string" && payload.code.trim()) {
        code = payload.code;
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // 某些 5xx 可能没有 JSON；此时退回通用 HTTP 错误即可。
    }
    return new Http接口错误(response.status, code, message);
  }
}
