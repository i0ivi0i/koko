import type {
  匿名身份引导结果,
  增量事件快照,
  房间历史页,
  房间快照,
} from "../../契约.js";

/**
 * 聊天房间传输端口只暴露房间 HTTP 主链：
 * 1. 匿名引导与入房；
 * 2. 快照、增量、历史页；
 * 3. 已读锚点提交。
 *
 * 它不承载 socket 生命周期、媒体上传或后台管理接口。
 */
export interface 聊天房间传输端口 {
  bootstrapAnonymousIdentity(deviceToken: string): Promise<匿名身份引导结果>;
  joinOrCreateRoom(sessionId: string, roomCode: string): Promise<房间快照>;
  loadRoomSnapshot(roomId: string, sessionId: string): Promise<房间快照>;
  loadRoomEvents(roomId: string, sessionId: string, from: number): Promise<增量事件快照>;
  loadRoomHistory(
    roomId: string,
    sessionId: string,
    beforeEventPosition: number,
    limit: number
  ): Promise<房间历史页>;
  updateRoomReadAnchor(
    roomId: string,
    sessionId: string,
    lastReadEventPosition: number
  ): Promise<void>;
}
