/**
 * 设备级匿名身份快照。
 * 约束：
 * 1. 内部身份与花名必须分离；
 * 2. Web 只能消费这个快照，不能自造永久身份真相；
 * 3. 未来注册只能链接到内部身份，而不是替换它。
 */
export interface 匿名身份快照 {
  anonymous_identity_id: string;
  display_alias: string;
}

/**
 * 匿名身份引导结果。
 * 当前 MVP 需要同时带回：
 * 1. 稳定匿名内部身份；
 * 2. 展示花名；
 * 3. 现有冷/热路径继续复用的 session 锚点。
 */
export interface 匿名身份引导结果 extends 匿名身份快照 {
  session_id: string;
}

export interface 房间快照 {
  room_id: string;
  latest_event_position: number;
  /**
   * 房间当前可直接阅读的最近消息基线。
   * 设计原因：
   * 1. 刷新回房后，前端不能只拿 latest_event_position 就假装历史还在；
   * 2. 首次进入已有历史的房间时，也应该立刻看到最近聊到哪。
   */
  recent_messages: 消息事件[];
}

export interface 消息事件 {
  type: "message_created";
  room_id: string;
  message_id: string;
  client_message_id: string;
  sender_session_id: string;
  sender_display_alias: string;
  body: string;
  event_position: number;
}

export interface 增量事件快照 {
  room_id: string;
  latest_event_position: number;
  events: 消息事件[];
}

export interface 后台概览 {
  room_count: number;
  message_count: number;
}

export interface 后台登录结果 {
  token: string;
}

export interface 后台房间列表 {
  rooms: string[];
}

export interface 后台房间详情 {
  room_id: string;
  latest_event_position: number;
  message_count: number;
}
