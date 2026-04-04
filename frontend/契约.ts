export interface 会话快照 {
  session_id: string;
  display_name: string;
}

export interface 房间快照 {
  room_id: string;
  latest_event_position: number;
}

export interface 消息事件 {
  type: "message_created";
  room_id: string;
  message_id: string;
  client_message_id: string;
  sender_session_id: string;
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
