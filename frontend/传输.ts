import { io, type Socket } from "socket.io-client";
import type {
  匿名身份引导结果,
  会话快照,
  增量事件快照,
  房间快照,
  后台概览,
  后台房间列表,
  后台房间详情,
  后台登录结果,
} from "./契约.js";

export interface 前端传输端口 {
  bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果>;
  bootstrapSession(displayName: string): Promise<会话快照>;
  joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照>;
  loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照>;
  loadRoomEvents(roomId: string, from: number): Promise<增量事件快照>;
  loadAdminOverview(token: string): Promise<后台概览>;
  adminLogin(username: string, password: string): Promise<后台登录结果>;
  adminRooms(token: string): Promise<后台房间列表>;
  adminRoomDetail(token: string, roomId: string): Promise<后台房间详情>;
  createSocket(sessionId: string): Socket;
}

export class HttpRealtime传输 implements 前端传输端口 {
  constructor(private readonly baseUrl: string) {}

  async bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果> {
    return this.post("/api/session/bootstrap", {
      device_anonymous_token: deviceToken,
    });
  }

  async bootstrapSession(displayName: string): Promise<会话快照> {
    return this.post("/api/session/bootstrap", { display_name: displayName });
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

  async loadRoomEvents(roomId: string, from: number): Promise<增量事件快照> {
    return this.get(`/api/rooms/${roomId}/events?from=${from}`);
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
    return io(this.baseUrl, {
      transports: ["websocket"],
      auth: { session_id: sessionId },
    });
  }

  private async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      throw new Error(`GET ${path} failed: ${response.status}`);
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
      throw new Error(`POST ${path} failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
