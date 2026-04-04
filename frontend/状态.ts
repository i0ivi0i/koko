import type { 消息事件 } from "./契约";

export interface 聊天状态 {
  sessionId: string;
  roomId: string;
  roomCodeInput: string;
  messageInput: string;
  latestEventPosition: number;
  messages: 消息事件[];
  pending: boolean;
}

export const 初始聊天状态: 聊天状态 = {
  sessionId: "",
  roomId: "",
  roomCodeInput: "",
  messageInput: "",
  latestEventPosition: 0,
  messages: [],
  pending: false,
};
