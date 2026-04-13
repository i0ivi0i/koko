import { io, type Socket } from "socket.io-client";
import type {
  Blob媒体资产描述,
  Blob媒体变体描述,
  匿名身份引导结果,
  增量事件快照,
  流媒体资产描述,
  媒体冷源描述,
  媒体资产分发表面,
  媒体附件上传结果,
  媒体定位结果,
  媒体上传准备结果,
  媒体种类,
  阅读推进请求,
  房间历史页,
  房间快照,
  后台概览,
  后台房间列表,
  后台房间详情,
  后台登录结果,
} from "./契约.js";

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

export interface 前端传输端口 {
  bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果>;
  joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照>;
  loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照>;
  prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File
  ): Promise<媒体上传准备结果>;
  completeMediaUpload(sessionId: string, attachmentId: string): Promise<媒体附件上传结果>;
  loadMediaLocator(sessionId: string, attachmentId: string): Promise<媒体定位结果>;
  buildAttachmentContentUrl(
    attachmentId: string,
    sessionId: string,
    variant?: "original" | "thumbnail"
  ): string;
  updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void>;
  loadRoomEvents(roomId: string, sessionId: string, from: number): Promise<增量事件快照>;
  loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页>;
  loadAdminOverview(token: string): Promise<后台概览>;
  adminLogin(username: string, password: string): Promise<后台登录结果>;
  adminRooms(token: string): Promise<后台房间列表>;
  adminRoomDetail(token: string, roomId: string): Promise<后台房间详情>;
  接收运行时策略?(policy: 实时连接运行时策略): void;
  读取运行时策略?(): 实时连接运行时策略;
  释放Socket?(socket: Socket): void;
  createSocket(sessionId: string): Socket;
}

export interface 实时连接运行时策略 {
  intent: "resume" | "suspend";
  reconnection: boolean;
  reason: "active" | "background" | "page_hidden";
}

const 默认实时连接运行时策略: 实时连接运行时策略 = {
  intent: "resume",
  reconnection: true,
  reason: "active",
};

export class HttpRealtime传输 implements 前端传输端口 {
  private 当前运行时策略: 实时连接运行时策略 = 默认实时连接运行时策略;
  private readonly 活跃Socket表 = new Map<Socket, { 由运行时挂起: boolean }>();

  constructor(private readonly baseUrl: string) {}

  /**
   * 后端在本地回环模式下会返回相对 Tus endpoint，例如 `/files`。
   * Uppy Tus 会直接拿这个地址去发 `POST/HEAD/PATCH`，所以前端必须先收口成绝对地址，
   * 否则浏览器端的 resumable 上传会在构造请求时直接失败。
   */
  private 解析绝对地址(pathOrUrl: string): string {
    return new URL(pathOrUrl, this.baseUrl).href;
  }

  /**
   * 共享资产分发表面只做地址收口，不夹带 Web 私有运行态。
   * 这样后续 iOS/Android/CLI 接同一契约时，不会被浏览器页面字段污染。
   */
  private 解析媒体资产分发表面(
    distribution: 媒体资产分发表面
  ): 媒体资产分发表面 {
    return {
      ...distribution,
      announce_urls: distribution.announce_urls.map((url) =>
        this.解析绝对地址(url)
      ),
      web_seed_url: distribution.web_seed_url
        ? this.解析绝对地址(distribution.web_seed_url)
        : null,
    };
  }

  private 解析媒体冷源描述(origin: 媒体冷源描述): 媒体冷源描述 {
    return {
      ...origin,
      original_url: origin.original_url
        ? this.解析绝对地址(origin.original_url)
        : null,
    };
  }

  private 解析Blob媒体变体(variant: Blob媒体变体描述): Blob媒体变体描述 {
    return {
      ...variant,
      url: this.解析绝对地址(variant.url),
    };
  }

  private 解析流媒体资产(asset: 流媒体资产描述): 流媒体资产描述 {
    return {
      ...asset,
      manifest: {
        hls_master_url: asset.manifest.hls_master_url
          ? this.解析绝对地址(asset.manifest.hls_master_url)
          : null,
        dash_mpd_url: asset.manifest.dash_mpd_url
          ? this.解析绝对地址(asset.manifest.dash_mpd_url)
          : null,
      },
      distribution: this.解析媒体资产分发表面(asset.distribution),
      origin: this.解析媒体冷源描述(asset.origin),
    };
  }

  private 解析Blob媒体资产(asset: Blob媒体资产描述): Blob媒体资产描述 {
    return {
      ...asset,
      preview: asset.preview ? this.解析Blob媒体变体(asset.preview) : null,
      full: asset.full ? this.解析Blob媒体变体(asset.full) : null,
      original: asset.original ? this.解析Blob媒体变体(asset.original) : null,
      distribution: asset.distribution
        ? this.解析媒体资产分发表面(asset.distribution)
        : null,
      origin: this.解析媒体冷源描述(asset.origin),
    };
  }

  private 解析媒体上传结果(result: 媒体附件上传结果): 媒体附件上传结果 {
    if (!result.media_asset) {
      return result;
    }
    if (result.media_asset.kind === "blob_image") {
      return {
        ...result,
        media_asset: this.解析Blob媒体资产(result.media_asset),
      };
    }
    return {
      ...result,
      media_asset: this.解析流媒体资产(result.media_asset),
    };
  }

  async bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果> {
    return this.post("/api/session/bootstrap", {
      device_anonymous_token: deviceToken,
    });
  }

  async joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照> {
    return this.post("/api/rooms/join-or-create", {
      session_id: sessionId,
      room_code: roomCode,
    });
  }

  async loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照> {
    return this.get(`/api/rooms/${roomId}/snapshot?session_id=${sessionId}`);
  }

  /**
   * prepare 只向 Rust 申请权威 media 占位和浏览器直传参数。
   * 真正的媒体字节不会经过聊天主服务主链。
   */
  async prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File
  ): Promise<媒体上传准备结果> {
    const prepared = await this.post<媒体上传准备结果>(`/api/media/${kind}/prepare`, {
      session_id: sessionId,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
    });
    return {
      ...prepared,
      tus_endpoint: this.解析绝对地址(prepared.tus_endpoint),
    };
  }

  /**
   * complete 负责把 prepared 附件升级成 ready。
   * 只有这里成功后，壳层才允许把草稿显示成“可发送”。
   */
  async completeMediaUpload(
    sessionId: string,
    attachmentId: string
  ): Promise<媒体附件上传结果> {
    const result = await this.post<媒体附件上传结果>(`/api/media/${attachmentId}/complete`, {
      session_id: sessionId,
    });
    return this.解析媒体上传结果(result);
  }

  async loadMediaLocator(
    sessionId: string,
    attachmentId: string
  ): Promise<媒体定位结果> {
    const locator = await this.get<媒体定位结果>(
      `/api/media/${attachmentId}/locator?session_id=${sessionId}`
    );
    return {
      ...locator,
      original_url: this.解析绝对地址(locator.original_url),
      thumbnail_url: locator.thumbnail_url
        ? this.解析绝对地址(locator.thumbnail_url)
        : null,
      distribution: locator.distribution
        ? {
            ...locator.distribution,
            announce_urls: locator.distribution.announce_urls.map((url) =>
              this.解析绝对地址(url)
            ),
            torrent_url: locator.distribution.torrent_url
              ? this.解析绝对地址(locator.distribution.torrent_url)
              : null,
            web_seed_url: this.解析绝对地址(
              locator.distribution.web_seed_url
            ),
          }
        : null,
      streaming_asset: locator.streaming_asset
        ? this.解析流媒体资产(locator.streaming_asset)
        : null,
      blob_asset: locator.blob_asset
        ? this.解析Blob媒体资产(locator.blob_asset)
        : null,
    };
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
    const payload: 阅读推进请求 = {
      session_id: sessionId,
      last_read_event_position: lastReadEventPosition,
    };
    // 阅读推进属于冷路径写接口：
    // 它只上报“这个身份已确认读到哪里”，不借道 realtime，也不和进房快照混用。
    await this.post(`/api/rooms/${roomId}/read-anchor`, payload);
  }

  async loadRoomEvents(
    roomId: string,
    sessionId: string,
    from: number
  ): Promise<增量事件快照> {
    return this.get(`/api/rooms/${roomId}/events?session_id=${sessionId}&from=${from}`);
  }

  async loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页> {
    return this.get(
      `/api/rooms/${roomId}/history?session_id=${sessionId}&before_event_position=${beforeEventPosition}&limit=${limit}`
    );
  }

  async loadAdminOverview(token: string): Promise<后台概览> {
    return this.get("/api/admin/overview", { "x-admin-token": token });
  }

  async adminLogin(username: string, password: string): Promise<后台登录结果> {
    return this.post("/api/admin/login", { username, password });
  }

  async adminRooms(token: string): Promise<后台房间列表> {
    return this.get("/api/admin/rooms", { "x-admin-token": token });
  }

  async adminRoomDetail(token: string, roomId: string): Promise<后台房间详情> {
    return this.get(`/api/admin/rooms/${roomId}`, { "x-admin-token": token });
  }

  createSocket(sessionId: string): Socket {
    // 这里先只显式声明“当前协议下可以安全开启”的连接策略：
    // 1. 保持 websocket-only，继续贴合现在的 realtime 主通道；
    // 2. 显式保留自动重连，便于断线后继续走 snapshot + 补洞恢复链；
    // 3. 暂时不启用 retries / ackTimeout。
    //
    // 原因不是忘了配，而是 Socket.IO 官方文档明确要求：
    // `retries` 必须和服务端 ack 配套使用；否则客户端会重发命令。
    // 我们当前的 create_message / subscribe_room_stream 还没有 ack 协议，
    // 可靠性仍然由 latest_event_position + snapshot + 增量补洞保证，
    // 不能为了“看起来更可靠”而把同一条命令重放多次。
    const socket = io(this.baseUrl, {
      transports: ["websocket"],
      reconnection: this.当前运行时策略.reconnection,
      autoConnect: this.当前运行时策略.intent !== "suspend",
      auth: { session_id: sessionId },
    });
    this.活跃Socket表.set(socket, { 由运行时挂起: false });
    return socket;
  }

  接收运行时策略(policy: 实时连接运行时策略): void {
    this.当前运行时策略 = { ...policy };
    for (const [socket, state] of this.活跃Socket表.entries()) {
      if (policy.intent === "suspend") {
        if (!state.由运行时挂起) {
          state.由运行时挂起 = true;
          socket.disconnect();
        }
        continue;
      }
      if (state.由运行时挂起 && typeof socket.connect === "function") {
        state.由运行时挂起 = false;
        socket.connect();
      }
    }
  }

  读取运行时策略(): 实时连接运行时策略 {
    return { ...this.当前运行时策略 };
  }

  释放Socket(socket: Socket): void {
    this.活跃Socket表.delete(socket);
    socket.disconnect();
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
