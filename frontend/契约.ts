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
   * 当前身份上次已读到的事件位置。
   * 设计原因：
   * 1. 这是真实的阅读锚点，不是滚动条像素位置；
   * 2. `null` 表示这个身份在当前房间还没有建立过阅读真相；
   * 3. Web/iOS/Android/CLI 都必须消费同一语义，不能各猜各的。
   */
  last_read_event_position: number | null;
  /**
   * 当前首屏里的第一条未读事件位置。
   * `null` 表示本次恢复不需要画未读分隔条。
   */
  first_unread_event_position: number | null;
  /**
   * 后端围绕未读起点或最近消息窗口返回的首屏消息。
   * 它已经是权威恢复基线，不再叫 `recent_messages`，避免误导成“总是最近消息”。
   */
  snapshot_messages: 消息事件[];
  /**
   * 当前首屏上方是否仍然存在更早历史。
   * 这是真实查询结果，前端不该再靠长度猜。
   */
  has_more_before: boolean;
}

/**
 * 阅读推进请求。
 * 壳层只能汇报“已读到哪个事件位置”，不能把 UI 像素滚动值当成阅读真相上传。
 */
export interface 阅读推进请求 {
  session_id: string;
  last_read_event_position: number;
}

export interface 消息事件 {
  type: "message_created";
  room_id: string;
  message_id: string;
  client_message_id: string;
  sender_session_id: string;
  sender_display_alias: string;
  /**
   * 统一消息模型下的文本字段。
   * 当前后端为了平滑迁移仍同时回 body，前端读取时优先消费 text。
   */
  text?: string;
  /**
   * 兼容旧纯文本链的过渡字段。
   * 等所有前端入口都切到 text 后，再整体删除。
   */
  body: string;
  /**
   * 附件列表属于权威消息事实，不再让前端靠本地上传态猜。
   * 当前最小媒体切片先放开图片和视频，其余媒体类型仍沿后续主链逐步接入。
   */
  attachments?: 附件快照[];
  event_position: number;
}

export interface 图片附件快照 {
  kind: "image";
  attachment_id: string;
  width: number;
  height: number;
}

/**
 * 视频附件快照先只暴露时间线渲染需要的最小稳定事实。
 * 时长、locator、peer 等运行态后续由媒体模块单独承接，不混进共享事件契约。
 */
export interface 视频附件快照 {
  kind: "video";
  attachment_id: string;
  width: number;
  height: number;
}

export type 附件快照 = 图片附件快照 | 视频附件快照;

export type 媒体种类 = 附件快照["kind"];

/**
 * 媒体 ready 快照只承接上传主链完成后的稳定元数据。
 * 它不夹带播放策略、P2P 运行态或权限语义。
 */
export interface 媒体附件上传结果 {
  attachment_id: string;
  kind: 媒体种类;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  status: "ready";
}

export type 图片附件上传结果 = 媒体附件上传结果;

/**
 * 媒体上传 prepare 结果只回答“下一步该往哪儿传”。
 * 它不声明消息已成立，也不提前伪造 ready 元数据。
 */
export interface 媒体上传准备结果 {
  attachment_id: string;
  upload_method: "PUT";
  upload_url: string;
  upload_headers: Record<string, string>;
  expires_at: string;
}

export type 图片上传准备结果 = 媒体上传准备结果;

/**
 * locator 只暴露当前客户端下一步该去哪里读媒体。
 * 业务权限、房间成员真相仍然由后端用例层裁决，不下放给 Web 壳猜。
 */
export interface 媒体定位结果 {
  attachment_id: string;
  kind: 媒体种类;
  status: "ready" | "degraded" | "deleted";
  original_url: string;
  thumbnail_url: string | null;
}

export interface 增量事件快照 {
  room_id: string;
  latest_event_position: number;
  events: 消息事件[];
}

export interface 房间历史页 {
  room_id: string;
  messages: 消息事件[];
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
