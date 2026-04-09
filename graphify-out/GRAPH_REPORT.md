# Graph Report - .  (2026-04-09)

## Corpus Check
- 111 files · ~93,996 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 310 nodes · 516 edges · 23 communities detected
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 91 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `整理笔记分馆地图` - 21 edges
2. `HttpRealtime传输` - 16 edges
3. `send_json()` - 13 edges
4. `Socketioxide API docs` - 12 edges
5. `WhatsApp Multi-Device` - 12 edges
6. `event_position 同步锚点` - 11 edges
7. `已读锚点稳定化与首屏停靠` - 10 edges
8. `唯一壳级操作台` - 10 edges
9. `固定底部操作台` - 10 edges
10. `发送热路径与多房间实时回流优化设计` - 10 edges

## Surprising Connections (you probably didn't know these)
- `socketioxide 实时适配器` --conceptually_related_to--> `src/实时外壳.rs`  [INFERRED]
  DESIGN.md → src/实时外壳.rs
- `前端首页群列表与双态控制台` --rationale_for--> `frontend/存储.ts`  [EXTRACTED]
  docs/superpowers/plans/2026-04-08-前端首页群列表与双态控制台.md → frontend/存储.ts
- `本地存储端口` --conceptually_related_to--> `frontend/存储.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-07-前端房间编排内核重构-design.md → frontend/存储.ts
- `前端首页群列表与双态控制台设计` --rationale_for--> `frontend/存储.ts`  [EXTRACTED]
  docs/superpowers/specs/2026-04-08-前端首页群列表与双态控制台-design.md → frontend/存储.ts
- `frontend/房间消息窗.ts` --conceptually_related_to--> `历史加载局部性`  [INFERRED]
  frontend/房间消息窗.ts → docs/superpowers/specs/2026-04-09-房间消息窗口独立化与历史补偿重构-design.md

## Hyperedges (group relationships)
- **Reading stability chain** — concept_room_kernel_ts, concept_room_scroller_ts, concept_viewport_mode, concept_candidate_read_anchor, concept_anchor_based_history_compensation [INFERRED 0.88]
- **Frontend orchestration triad** — concept_room_recovery_orchestrator, concept_room_realtime_orchestrator, concept_read_progress_orchestrator [INFERRED 0.92]
- **Backend shell split triad** — concept_room_shell, concept_admin_shell, concept_realtime_shell [INFERRED 0.90]
- **Telegram update integrity axes** — telegram_pts_sequence, telegram_seq_sequence, telegram_qts_sequence [EXTRACTED 1.00]
- **设备级匿名身份升级模式** — device_anonymous_token, localstorage_device_persistence, anonymous_identity_upgrade [EXTRACTED 0.90]
- **领域主权 + 边界 + 适配层模式** — domain_sovereignty, bounded_context, ports_and_adapters, socketioxide_realtime_adapter [INFERRED 0.88]
- **同步锚点与恢复闭环模式** — event_position_anchor, gap_repair_snapshot_fallback, connection_state_recovery_buffer [INFERRED 0.90]
- **唯一壳级操作台模式** — single_form_shell_console, lit_render_purity, native_form_submit_semantics, disabled_inert_semantics [EXTRACTED 0.92]
- **命令送达与消息成立分层模式** — ack_is_not_message_created, command_delivery_retries, broadcast_after_commit [INFERRED 0.85]

## Communities

### Community 0 - "send_json()"
Cohesion: 0.06
Nodes (18): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), 非成员不能通过events接口拉取房间增量(), 成员通过events接口只会拿到from之后的事件(), 不存在的房间通过events接口会返回room_not_found(), 非成员不能通过history接口读取更早消息(), http冷路径闭环() (+10 more)

### Community 1 - "整理笔记分馆地图"
Cohesion: 0.1
Nodes (40): ACK 不是消息成立, 活跃房间优先补洞, axum 共享状态, client_message_id 幂等键, 命令送达重试, connection state recovery 缓冲垫, event_position 同步锚点, gap repair + snapshot 兜底 (+32 more)

### Community 2 - "WhatsApp Multi-Device"
Cohesion: 0.06
Nodes (37): Anonymous Credentials System, Application State Sync, Attachment Unlinkability, Automatic Device Verification, Baseline Message Secrecy, Client-Centric Architecture, Client Fanout, Companion Devices (+29 more)

### Community 3 - "已读锚点稳定化与首屏停靠"
Cohesion: 0.24
Nodes (21): 锚点恢复补偿, 候选已读锚点, frontend/阅读推进编排.ts, frontend/房间内核.ts, frontend/房间消息窗.ts, frontend/房间滚动器.ts, frontend/存储.ts, 前端同步编排 (+13 more)

### Community 4 - "学习资料总地图"
Cohesion: 0.13
Nodes (21): ack 不是消息成立, graphify 负责跨来源关联, 断线恢复必须靠事件位置补洞, 前端不能替后端宣布消息已成立, 学习资料总地图, 学习目录图书馆化整理设计, 学习目录图书馆化整理 Implementation Plan, 学习目录图书馆化整理 (+13 more)

### Community 5 - "发送热路径与多房间实时回流优化设计"
Cohesion: 0.19
Nodes (20): 权威房间事件, Bounded Context, 提交后广播, 代码宪法, contract 契约边界, DDD 领域主权与乐高式可插拔系统理解笔记, 领域主权, 乐观态与权威态分层 (+12 more)

### Community 6 - "假Socket"
Cohesion: 0.12
Nodes (1): 假Socket

### Community 7 - "固定底部操作台"
Cohesion: 0.35
Nodes (17): disabled / inert 交互语义, 固定底部操作台, frontend/视图.ts, 首页群列表, Lit render 纯函数, 原生表单提交语义, 反网页化, 单壳单操作台 (+9 more)

### Community 8 - "HttpRealtime传输"
Cohesion: 0.23
Nodes (1): HttpRealtime传输

### Community 9 - "Socketioxide API docs"
Cohesion: 0.29
Nodes (15): SocketRef, Socket struct, SocketIo handle, Acknowledgements, Adapter trait, Socketioxide API docs, Broadcast operators, Socketioxide crate metadata (+7 more)

### Community 10 - "socket.io 分馆地图"
Cohesion: 0.23
Nodes (13): Ack Timeout Retries, Acknowledgement Callback, Connection State Recovery, Delivery Guarantees, Emitting Events, Message Ordering, Room Broadcasting, Rooms (+5 more)

### Community 11 - "ensureBackendBinaryPrepa"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 12 - "New-ManagedProcess()"
Cohesion: 0.28
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 13 - "假Socket"
Cohesion: 0.47
Nodes (1): 假Socket

### Community 14 - "备忘"
Cohesion: 0.4
Nodes (5): 设备级花名匿名身份最小群聊 MVP, bootstrap 接口限流与告警, 设备入口凭证轮换, 备忘, 传输层安全基线

### Community 15 - "设备级花名匿名身份 MVP 官方资料与设计启发"
Cohesion: 0.83
Nodes (4): 匿名身份可升级, 设备匿名 token, 设备级花名匿名身份 MVP 官方资料与设计启发, localStorage 设备持久化

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "先读 GRAPH_REPORT"
Cohesion: 1.0
Nodes (2): 先读 GRAPH_REPORT, graphify Codex 规则

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "frontend/房间实时编排.ts"
Cohesion: 1.0
Nodes (1): frontend/房间实时编排.ts

### Community 20 - "frontend/房间恢复编排.ts"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 21 - "聊天壳首页与控制台集成测试"
Cohesion: 1.0
Nodes (1): 聊天壳首页与控制台集成测试

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **53 isolated node(s):** `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `聊天壳首页与控制台集成测试`, `src/后台外壳.rs`, `src/房间外壳.rs` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `先读 GRAPH_REPORT`** (2 nodes): `先读 GRAPH_REPORT`, `graphify Codex 规则`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend/房间实时编排.ts`** (1 nodes): `frontend/房间实时编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend/房间恢复编排.ts`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `聊天壳首页与控制台集成测试`** (1 nodes): `聊天壳首页与控制台集成测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `整理笔记分馆地图` connect `整理笔记分馆地图` to `WhatsApp Multi-Device`, `学习资料总地图`, `发送热路径与多房间实时回流优化设计`, `固定底部操作台`, `Socketioxide API docs`, `socket.io 分馆地图`, `设备级花名匿名身份 MVP 官方资料与设计启发`?**
  _High betweenness centrality (0.261) - this node is a cross-community bridge._
- **Why does `WhatsApp / Meta 分馆地图` connect `WhatsApp Multi-Device` to `整理笔记分馆地图`, `学习资料总地图`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `event_position 同步锚点` connect `整理笔记分馆地图` to `已读锚点稳定化与首屏停靠`, `发送热路径与多房间实时回流优化设计`, `备忘`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `send_json()` (e.g. with `领域测试.rs` and `http冷路径闭环()`) actually correct?**
  _`send_json()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **What connects `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `聊天壳首页与控制台集成测试` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `send_json()` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `整理笔记分馆地图` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._