import type {
  匿名身份引导结果,
  增量事件快照,
  房间历史页,
  房间快照,
  阅读推进请求,
} from "../../契约.js";

type 读取JSON = <T>(path: string, headers?: Record<string, string>) => Promise<T>;
type 提交JSON = <T>(path: string, body: object) => Promise<T>;

export interface 房间HTTP接口依赖 {
  get: 读取JSON;
  post: 提交JSON;
  解析房间快照(snapshot: 房间快照): 房间快照;
  解析增量事件快照(snapshot: 增量事件快照): 增量事件快照;
  解析房间历史页(page: 房间历史页): 房间历史页;
}

/**
 * 这个适配器只承载“聊天房间 HTTP 主链”的 endpoint 组合。
 * 它不碰 socket 生命周期，也不解释恢复 owner 该怎么裁决。
 */
export class 房间HTTP接口 {
  constructor(private readonly deps: 房间HTTP接口依赖) {}

  async bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果> {
    return this.deps.post("/api/session/bootstrap", {
      device_anonymous_token: deviceToken,
    });
  }

  async joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照> {
    const snapshot = await this.deps.post<房间快照>("/api/rooms/join-or-create", {
      session_id: sessionId,
      room_code: roomCode,
    });
    return this.deps.解析房间快照(snapshot);
  }

  async loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照> {
    const snapshot = await this.deps.get<房间快照>(
      `/api/rooms/${roomId}/snapshot?session_id=${sessionId}`
    );
    return this.deps.解析房间快照(snapshot);
  }

  async loadRoomEvents(
    roomId: string,
    sessionId: string,
    from: number
  ): Promise<增量事件快照> {
    const snapshot = await this.deps.get<增量事件快照>(
      `/api/rooms/${roomId}/events?session_id=${sessionId}&from=${from}`
    );
    return this.deps.解析增量事件快照(snapshot);
  }

  async loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页> {
    const page = await this.deps.get<房间历史页>(
      `/api/rooms/${roomId}/history?session_id=${sessionId}&before_event_position=${beforeEventPosition}&limit=${limit}`
    );
    return this.deps.解析房间历史页(page);
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
    // 阅读推进继续只走 HTTP 冷路径，不和 realtime 主通道混 owner。
    await this.deps.post(`/api/rooms/${roomId}/read-anchor`, payload);
  }
}
