/**
 * 真正的前端稳定共享契约 owner 收进本文件：
 * 1. 根级 `frontend/契约.ts` 已删除；
 * 2. 这里统一承接前后端共享的稳定 command/query/event/snapshot/error 表面；
 * 3. 业务展示、平台流程和壳层文案禁止继续回流到根目录共享契约。
 */

/**
 * 设备级匿名身份快照。
 * 约束：
 * 1. 内部身份与花名必须分离；
 * 2. Web 只能消费这个快照，不能自造永久身份真相；
 * 3. 未来注册只能链接到内部身份，而不是替换它。
 */
export interface 匿名身份快照 {
  display_alias: string;
}

/**
 * 匿名身份引导结果。
 * 当前 MVP 需要同时带回：
 * 1. 展示花名；
 * 2. 现有冷/热路径继续复用的 session 锚点。
 */
export interface 匿名身份引导结果 extends 匿名身份快照 {
  session_id: string;
  /** 当前服务端是否要求 realtime 建连前完成 PoW。 */
  pow_required?: boolean;
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
  /** 统一消息模型下的唯一文本字段。 */
  text: string;
  /**
   * 附件列表属于权威消息事实，不再让前端靠本地上传态猜。
   * 当前最小媒体切片先放开图片和视频，其余媒体类型仍沿后续主链逐步接入。
   */
  attachments?: 附件快照[];
  event_position: number;
}

/**
 * preview_asset 是消息流和 locator 共用的静态封面协议面。
 * 它只表达“当前可以拿哪张权威封面”，不承载播放器状态或壳层流程字段。
 */
export interface 预览资源描述 {
  still_url: string;
}

/** 广播路径可选携带的分发线索，让接收端提前预热 swarm 连接。
 *  稳定字段（content_hash/swarm_id/torrent_info_hash/web_seed_until）始终存在；
 *  运行态字段（join_ticket/announce_urls/torrent_url/ice_servers）仅广播路径附带，
 *  历史/重播路径为 undefined。前端检测到运行态字段时可跳过 HTTP locator 直接预热。 */
export interface 附件分发线索 {
  content_hash: string;
  swarm_id: string;
  torrent_info_hash: string;
  web_seed_until: number;
  // ── 广播路径运行态字段（可选）──
  /** 短时入群票据，用于 torrent_url 鉴权和 tracker announce */
  join_ticket?: string;
  /** join_ticket 过期时间（RFC 3339） */
  ticket_expires_at?: string;
  /** tracker WebSocket announce URL 列表 */
  announce_urls?: string[];
  /** torrent 文件下载地址（含 ticket 鉴权参数） */
  torrent_url?: string;
  /** 广播路径固定为 null（per-session 鉴权无法共享），prefetch 不需要 web_seed */
  web_seed_url?: string | null;
  /** STUN/TURN ICE servers */
  ice_servers?: unknown[];
}

/** pending-first：附件槽位可能的权威状态。 */
export type 附件槽位状态 = "pending" | "uploading" | "processing" | "ready" | "failed";

export interface 图片附件快照 {
  kind: "image";
  attachment_id: string;
  width: number;
  height: number;
  /** pending-first：附件槽位的权威状态，ready 才允许消费 distribution_hint。 */
  status?: 附件槽位状态;
  has_preview_asset?: boolean;
  preview_asset?: 预览资源描述 | null;
  distribution_hint?: 附件分发线索;
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
  /** pending-first：附件槽位的权威状态，ready 才允许消费 distribution_hint。 */
  status?: 附件槽位状态;
  has_preview_asset?: boolean;
  preview_asset?: 预览资源描述 | null;
  distribution_hint?: 附件分发线索;
}

export type 附件快照 = 图片附件快照 | 视频附件快照;

/** pending-first：complete 成功/失败后后端广播的附件状态升级事件。 */
export interface 附件状态变更事件 {
  type: "attachment_status_changed";
  room_id: string;
  message_id: string;
  attachment_id: string;
  status: 附件槽位状态;
  attachment?: 附件快照;
  error_code?: string;
  event_position: number;
}

/** 房间事件 union：消息创建 + 附件状态升级。 */
export type 房间事件 = 消息事件 | 附件状态变更事件;

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
  preview_asset?: 预览资源描述 | null;
  media_asset?: 单文件视频资产描述 | Blob媒体资产描述 | null;
}

export type 图片附件上传结果 = 媒体附件上传结果;

/**
 * 媒体上传 prepare 结果只回答“下一步该往哪儿传”。
 * 它不声明消息已成立，也不提前伪造 ready 元数据。
 */
export interface 媒体上传准备结果 {
  attachment_id: string;
  upload_session_id: string;
  upload_method: "tus";
  tus_endpoint: string;
  tus_headers: Record<string, string>;
  tus_metadata: Record<string, string>;
  expires_at: string;
}

export type 媒体上传恢复结果 =
  | {
      status: "completed";
      attachment: 媒体附件上传结果;
    }
  | {
      status: "resumable";
      attachment_id: string;
      upload_session_id: string;
      upload_method: "tus";
      tus_endpoint: string;
      tus_headers: Record<string, string>;
      tus_metadata: Record<string, string>;
      expires_at: string;
    }
  | {
      status: "failed" | "expired" | "needs_reselect";
      attachment_id: string;
      error_code: string;
    };

export type 图片上传准备结果 = 媒体上传准备结果;

/**
 * source_hash 只描述用户选择的原始 File 字节身份。
 * 它服务上传前精确去重，不表达肉眼相似、转码等价或播放器状态。
 */
export interface 媒体SourceHash信息 {
  source_hash: string;
  source_byte_size: number;
  source_file_name?: string;
}

/**
 * source_hash 复用请求必须带 room_id：
 * room_id 是目标房间发送裁决锚点，不是媒体资产身份边界。
 * 后端只能在当前身份有权复用的资产内命中，禁止返回全站存在性信号。
 */
export interface 媒体SourceHash复用请求 extends 媒体SourceHash信息 {
  session_id: string;
  room_id: string;
}

export type 媒体SourceHash复用结果 =
  | { status: "miss" }
  | { status: "reused"; attachment: 媒体附件上传结果 };

/**
 * 媒体转发以“当前会话可见源附件 + 目标房间可发送”为授权来源。
 * 它不依赖 source_hash，也不要求客户端持有原始 File 字节。
 */
export interface 媒体附件转发请求 {
  session_id: string;
  target_room_id: string;
  source_attachment_id: string;
  client_message_id: string;
  text?: string;
}

export interface 媒体附件转发结果 {
  message: 消息事件;
  attachment: 媒体附件上传结果;
}

/**
 * locator 只暴露当前客户端下一步该去哪里读媒体。
 * 业务权限、房间成员真相仍然由后端用例层裁决，不下放给 Web 壳猜。
 */
export interface 媒体协作分发定位片段 {
  /**
   * content_id 是 attachment_id 之上的稳定分发锚点。
   * 第一版先不把它伪装成 info_hash，避免 Phase 1 就把 metainfo 语义写死。
   */
  content_id: string;
  content_hash: string;
  swarm_id: string;
  /**
   * 继续沿用“秒数字符串”而不是 Date 对象：
   * 1. 和现有 expires_at 心智一致；
   * 2. contract 不绑定具体运行时时间类型；
   * 3. 前端缓存 / 多壳读取都更稳定。
   */
  web_seed_until: string;
  torrent_url: string | null;
  torrent_info_hash: string | null;
  /**
   * announce 线索属于 runtime transport，不属于业务真相：
   * 1. 后端可以下发同源相对 `/api/swarm/announce`；
   * 2. 前端 adapter 必须把它收口成浏览器可用的 `ws/wss` tracker 地址；
   * 3. 这里禁止把 announce 当普通 HTTP fetch URL 继续往下传。
   */
  announce_urls: string[];
  /** web seed 是 24 小时保底源地址；前端可以继续把相对地址收口成绝对地址。 */
  web_seed_url: string | null;
  /** presence 仍然是后端裁决链的一部分，前端只负责按受控 URL 上报活跃，不自己判过期。 */
  presence_url?: string | null;
  join_ticket: string | null;
  ticket_expires_at: string | null;
  /** 稳定媒体状态语义，跨端只认 code，不认壳层文案。 */
  media_state: {
    code:
      | "MEDIA_READY"
      | "MEDIA_CONNECTING_TO_PEERS"
      | "MEDIA_NO_ONLINE_SEED"
      | "MEDIA_DELETED";
    retry_after_ms: number | null;
  };
  survival_mode: "server_assisted" | "peer_only_after_expiry";
  /** 后端按需下发 STUN/TURN 服务器列表，用于 WebRTC NAT 穿透。空数组 = 无 TURN。 */
  ice_servers?: { urls: string; username?: string; credential?: string }[];
}

/**
 * 冷源描述明确把“原始附件还剩多少保底能力”收口成稳定契约。
 * 播放器只能消费这个事实，不能自行把原始附件重新拔回正式主链。
 */
export interface 媒体冷源描述 {
  original_url: string | null;
  expires_at_epoch_seconds: number;
  available: boolean;
  role: "cold_backup_only";
}

/**
 * 资产级分发表面比旧 locator.runtime 分发片段更克制：
 * 这里只保留共享协议需要的 swarm 线索，不把 Web 专属 presence/torrent 运行态混进来。
 */
export interface 媒体资产分发表面 {
  swarm_id: string;
  announce_urls: string[];
  web_seed_url: string | null;
  join_ticket: string | null;
  ticket_expires_at: string | null;
  survival_mode: "server_assisted" | "peer_only_after_expiry";
  /** 后端按需下发 STUN/TURN 服务器列表，用于 WebRTC NAT 穿透。空数组 = 无 TURN。 */
  ice_servers?: { urls: string; username?: string; credential?: string }[];
}

export interface 单文件视频资产描述 {
  asset_id: string;
  content_hash: string;
  kind: "file_video";
  variants: {
    canonical: Blob媒体变体描述 | null;
  };
  distribution: 媒体资产分发表面;
  origin: 媒体冷源描述;
}

export interface Blob媒体变体描述 {
  id: string;
  mime_type: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface Blob媒体资产描述 {
  asset_id: string;
  content_hash: string;
  kind: "blob_image";
  variants: {
    canonical: Blob媒体变体描述 | null;
  };
  distribution: 媒体资产分发表面 | null;
  origin: 媒体冷源描述;
}

export interface 媒体定位结果 {
  attachment_id: string;
  kind: 媒体种类;
  status: "ready" | "degraded" | "deleted";
  /**
   * 顶层 locator 不再重复暴露 original_url：
   * 1. 冷源锚点已经收口到 nested asset 的 origin；
   * 2. 运行态 transport 继续留在顶层 distribution；
   * 3. 这样播放链不会再被顶层旧别名绑出第二份冷源真相。
   */
  preview_asset?: 预览资源描述 | null;
  thumbnail_url: string | null;
  distribution: 媒体协作分发定位片段 | null;
  file_asset?: 单文件视频资产描述 | null;
  blob_asset?: Blob媒体资产描述 | null;
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
