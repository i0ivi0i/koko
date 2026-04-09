# Graph Report - .  (2026-04-09)

## Corpus Check
- 121 files · ~101,564 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 313 nodes · 519 edges · 23 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 89 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `整理笔记分馆地图` - 19 edges
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
- `本地存储端口` --conceptually_related_to--> `frontend/存储.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-07-前端房间编排内核重构-design.md → frontend/存储.ts
- `socketioxide 实时适配器` --conceptually_related_to--> `src/实时外壳.rs`  [INFERRED]
  DESIGN.md → src/实时外壳.rs
- `前端房间编排内核重构` --rationale_for--> `frontend/存储.ts`  [EXTRACTED]
  docs/superpowers/plans/2026-04-07-前端房间编排内核重构.md → frontend/存储.ts
- `锚点恢复补偿` --conceptually_related_to--> `frontend/房间滚动器.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-09-房间消息窗口独立化与历史补偿重构-design.md → frontend/房间滚动器.ts
- `房间消息窗口独立化与历史补偿重构` --rationale_for--> `frontend/阅读推进编排.ts`  [EXTRACTED]
  docs/superpowers/plans/2026-04-09-房间消息窗口独立化与历史补偿重构.md → frontend/阅读推进编排.ts

## Hyperedges (group relationships)
- **消息几何与气泡渲染管线** — text_layout, view_presenters, chat_shell, room_message_pane [INFERRED 0.86]
- **Reading stability chain** — concept_room_kernel_ts, concept_room_scroller_ts, concept_viewport_mode, concept_candidate_read_anchor, concept_anchor_based_history_compensation [INFERRED 0.88]
- **Frontend orchestration triad** — concept_room_recovery_orchestrator, concept_room_realtime_orchestrator, concept_read_progress_orchestrator [INFERRED 0.92]
- **Backend shell split triad** — concept_room_shell, concept_admin_shell, concept_realtime_shell [INFERRED 0.90]
- **Web 前端全面 Pretext 化闭环** — concept_pretext_text_sovereignty, concept_text_layout_core, concept_message_window_line_rendering, concept_pretext_rich_inline, concept_dom_viewport_boundary, rationale_remove_dual_text_system, rationale_preserve_runtime_boundaries [INFERRED 0.95]
- **graphify 自动化边界与人工更新闭环** — concept_graphify_pipeline, concept_graphify_doc_update_boundary, concept_graphify_feedback_loop, concept_graphify_watch_bug, concept_graphify_source_precedence, rationale_use_manual_doc_updates, rationale_keep_graph_clean [INFERRED 0.93]
- **Telegram update integrity axes** — telegram_pts_sequence, telegram_seq_sequence, telegram_qts_sequence [EXTRACTED 1.00]
- **领域主权 + 边界 + 适配层模式** — domain_sovereignty, bounded_context, ports_and_adapters, socketioxide_realtime_adapter [INFERRED 0.88]
- **学习资料驱动设计与实施** — doc_pretext_research, doc_design_pretext_2026_04_09, doc_plan_pretext_2026_04_09, citation_pretext_official_evidence, doc_graphify_overview, doc_graphify_versions [INFERRED 0.88]
- **同步锚点与恢复闭环模式** — event_position_anchor, gap_repair_snapshot_fallback, connection_state_recovery_buffer [INFERRED 0.90]
- **唯一壳级操作台模式** — single_form_shell_console, lit_render_purity, native_form_submit_semantics, disabled_inert_semantics [EXTRACTED 0.92]
- **命令送达与消息成立分层模式** — ack_is_not_message_created, command_delivery_retries, broadcast_after_commit [INFERRED 0.85]
- **设备级匿名身份升级模式** — device_anonymous_token, localstorage_device_persistence, anonymous_identity_upgrade [EXTRACTED 0.90]

## Communities

### Community 0 - "实时边界笔记"
Cohesion: 0.1
Nodes (42): ACK 不是消息成立, 活跃房间优先补洞, 匿名身份可升级, axum 共享状态, client_message_id 幂等键, 命令送达重试, connection state recovery 缓冲垫, 设备匿名 token (+34 more)

### Community 1 - "加密存储协议"
Cohesion: 0.06
Nodes (37): Anonymous Credentials System, Application State Sync, Attachment Unlinkability, Automatic Device Verification, Baseline Message Secrecy, Client-Centric Architecture, Client Fanout, Companion Devices (+29 more)

### Community 2 - "Rust 闭环测试"
Cohesion: 0.08
Nodes (18): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), 非成员不能通过events接口拉取房间增量(), 成员通过events接口只会拿到from之后的事件(), 不存在的房间通过events接口会返回room_not_found(), 非成员不能通过history接口读取更早消息(), http冷路径闭环() (+10 more)

### Community 3 - "Pretext 前端文本主权"
Cohesion: 0.1
Nodes (26): graphify CLI/源码/tests/CHANGELOG 证据链, Pretext 官方 README/demo/API 证据链, DOM 只保留渲染后视口观测, graphify 用于跨来源关联而非替代物理目录, 文档变更需要手动 graphify --update, graphify-out/memory 反馈回路, graphify detect -> extract -> build -> cluster -> analyze -> report -> export 管线, graphify 资料信任顺序以 CLI 和源码优先 (+18 more)

### Community 4 - "Rust 外壳适配层"
Cohesion: 0.19
Nodes (20): 权威房间事件, Bounded Context, 提交后广播, 代码宪法, contract 契约边界, DDD 领域主权与乐高式可插拔系统理解笔记, 领域主权, 乐观态与权威态分层 (+12 more)

### Community 5 - "前端房间内核"
Cohesion: 0.26
Nodes (19): 锚点恢复补偿, 候选已读锚点, frontend/阅读推进编排.ts, frontend/房间内核.ts, frontend/房间滚动器.ts, 前端同步编排, 历史加载局部性, 本地存储端口 (+11 more)

### Community 6 - "前端壳与存储"
Cohesion: 0.35
Nodes (17): disabled / inert 交互语义, 固定底部操作台, frontend/存储.ts, 首页群列表, Lit render 纯函数, 原生表单提交语义, 反网页化, 单壳单操作台 (+9 more)

### Community 7 - "HTTP 实时传输"
Cohesion: 0.23
Nodes (1): HttpRealtime传输

### Community 8 - "Socketioxide API"
Cohesion: 0.29
Nodes (15): SocketRef, Socket struct, SocketIo handle, Acknowledgements, Adapter trait, Socketioxide API docs, Broadcast operators, Socketioxide crate metadata (+7 more)

### Community 9 - "页面骨架测试"
Cohesion: 0.17
Nodes (0): 

### Community 10 - "Socket.IO 可靠性"
Cohesion: 0.23
Nodes (13): Ack Timeout Retries, Acknowledgement Callback, Connection State Recovery, Delivery Guarantees, Emitting Events, Message Ordering, Room Broadcasting, Rooms (+5 more)

### Community 11 - "Telegram 更新流"
Cohesion: 0.33
Nodes (11): Channel difference polling, Channel update state, Gap recovery, pts sequence, qts sequence, Telegram 分馆地图, seq sequence, Update state fetching (+3 more)

### Community 12 - "前端文本布局"
Cohesion: 0.38
Nodes (10): 聊天壳, 聊天壳阅读与消息测试, 聊天壳测试, 聊天测试支架, 端到端测试, 输入区布局测试, 房间消息窗, 文本布局 (+2 more)

### Community 13 - "真实链路测试"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 14 - "Windows 启动脚本"
Cohesion: 0.28
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 15 - "匿名设备安全基线"
Cohesion: 0.4
Nodes (5): 设备级花名匿名身份最小群聊 MVP, bootstrap 接口限流与告警, 设备入口凭证轮换, 备忘, 传输层安全基线

### Community 16 - "学习目录图书馆化"
Cohesion: 0.4
Nodes (5): graphify 负责跨来源关联, 学习目录图书馆化整理设计, 学习目录图书馆化整理 Implementation Plan, 学习目录图书馆化整理, 物理目录靠 README 承担真相

### Community 17 - "程序入口"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Graphify 会话规则"
Cohesion: 1.0
Nodes (2): 先读 GRAPH_REPORT, graphify Codex 规则

### Community 19 - "启动入口脚本"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "房间实时编排"
Cohesion: 1.0
Nodes (1): frontend/房间实时编排.ts

### Community 21 - "房间恢复编排"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 22 - "库入口"
Cohesion: 1.0
Nodes (0): 

## Ambiguous Edges - Review These
- `Web 前端全面 Pretext 化 Implementation Plan` → `graphify watch._rebuild_code 结构性 bug`  [AMBIGUOUS]
  docs/superpowers/plans/2026-04-09-Web前端全面Pretext化.md · relation: conflicts_with

## Knowledge Gaps
- **55 isolated node(s):** `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `src/后台外壳.rs`, `src/房间外壳.rs`, `graphify Codex 规则` (+50 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `程序入口`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Graphify 会话规则`** (2 nodes): `先读 GRAPH_REPORT`, `graphify Codex 规则`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `启动入口脚本`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `房间实时编排`** (1 nodes): `frontend/房间实时编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `房间恢复编排`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `库入口`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Web 前端全面 Pretext 化 Implementation Plan` and `graphify watch._rebuild_code 结构性 bug`?**
  _Edge tagged AMBIGUOUS (relation: conflicts_with) - confidence is low._
- **Why does `整理笔记分馆地图` connect `实时边界笔记` to `加密存储协议`, `Rust 外壳适配层`, `前端壳与存储`, `Socketioxide API`, `Socket.IO 可靠性`, `Telegram 更新流`, `学习目录图书馆化`?**
  _High betweenness centrality (0.257) - this node is a cross-community bridge._
- **Why does `WhatsApp / Meta 分馆地图` connect `加密存储协议` to `实时边界笔记`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `event_position 同步锚点` connect `实时边界笔记` to `Rust 外壳适配层`, `前端房间内核`, `匿名设备安全基线`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `send_json()` (e.g. with `领域测试.rs` and `http冷路径闭环()`) actually correct?**
  _`send_json()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **What connects `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `src/后台外壳.rs` to the rest of the system?**
  _55 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `实时边界笔记` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._