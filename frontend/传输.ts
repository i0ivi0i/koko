import { io, type Socket } from "socket.io-client";
import type { 会话快照, 增量事件快照, 房间快照, 后台概览 } from "./契约";

export interface 前端传输端口 {
  bootstrapSession(displayName: string): Promise<会话快照>;
  joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照>;
  loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照>;
  loadRoomEvents(roomId: string, from: number): Promise<增量事件快照>;
  loadAdminOverview(token: string): Promise<后台概览>;
  createSocket(): Socket;
}

export class HttpRealtime传输 implements 前端传输端口 {
  constructor(private readonly baseUrl: string) {}

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

  createSocket(): Socket {
    return io(this.baseUrl, { transports: ["websocket"] });
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
