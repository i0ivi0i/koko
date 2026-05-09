import type { Socket } from "socket.io-client";
import type { 实时连接运行时策略 } from "../../聊天实时/适配/实时连接适配.js";

/**
 * 聊天 realtime 连接端口只承接 socket 生命周期与平台运行时策略。
 * 这里不夹带房间恢复、媒体上传或后台查询行为。
 */
export interface 聊天实时连接端口 {
  createSocket(sessionId: string, powToken?: string): Socket;
  接收运行时策略?(policy: 实时连接运行时策略): void;
  读取运行时策略?(): 实时连接运行时策略;
  释放Socket?(socket: Socket): void;
  /** PoW 门禁令牌获取（防御启用时由组合根注入）。 */
  获取PowToken?(): Promise<string>;
}

export type { 实时连接运行时策略 } from "../../聊天实时/适配/实时连接适配.js";
