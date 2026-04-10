# Graph Report - .  (2026-04-11)

## Corpus Check
- 72 files · ~1,483,257 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 247 nodes · 326 edges · 27 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 22 edges
2. `send_json()` - 22 edges
3. `构造rustus_hook请求体()` - 8 edges
4. `写入rustus测试文件()` - 7 edges
5. `单连接发送到已关闭socket时降级为正常断开()` - 6 edges
6. `complete图片上传会把prepared附件升级成ready并写入缩略图()` - 6 edges
7. `updateChat()` - 5 edges
8. `exitCurrentRoomView()` - 5 edges
9. `假Socket` - 5 edges
10. `rustus_post_finish会登记上传回执()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `handle_rustus_hook_post_finish()` --calls--> `写入rustus测试文件()`  [EXTRACTED]
  src\房间外壳.rs → tests\集成测试.rs
- `complete_media_upload()` --calls--> `写入rustus测试文件()`  [EXTRACTED]
  src\房间外壳.rs → tests\集成测试.rs
- `handle_rustus_hook()` --calls--> `构造rustus_hook请求体()`  [EXTRACTED]
  src\房间外壳.rs → tests\集成测试.rs
- `文本布局测试` --calls--> `文本布局`  [EXTRACTED]
  frontend/tests/文本布局测试.spec.ts → frontend/文本布局.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (17): AdminLoginBody, AdminLoginResp, ApiError, BootstrapBody, CompleteMediaUploadBody, JoinBody, ParsedAttachmentContentQuery, ParsedEventsQuery (+9 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (1): 假Socket

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (29): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), 没有上传回执时complete媒体上传会返回attachment_not_ready(), complete图片上传遇到非图片原图会返回attachment_type_not_allowed(), complete_media_upload(), complete图片上传会把prepared附件升级成ready并写入缩略图(), 非成员不能通过events接口拉取房间增量() (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.17
Nodes (1): HttpRealtime传输

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (13): buildRoomViewResetPatch(), clearMediaPublisherState(), exitCurrentRoomView(), handleShellConsolePrimaryInput(), joinHistoryRoom(), leaveCurrentRoomView(), render(), renderShellConsole() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 7 - "Community 7"
Cohesion: 0.47
Nodes (1): 单连接发送到已关闭socket时降级为正常断开()

### Community 8 - "Community 8"
Cohesion: 0.4
Nodes (5): loadOverview(), loadRooms(), login(), submitLoginForm(), submitRoomSearchForm()

### Community 9 - "Community 9"
Cohesion: 0.67
Nodes (4): handle_rustus_hook(), handle_rustus_hook_post_finish(), handle_rustus_hook_pre_create(), 读取rustus_metadata字段()

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (3): load_attachment_content(), load_media_locator(), parse_attachment_content_query()

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (3): err_resp(), 渲染前端入口_html(), load_frontend_index()

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (2): load_room_events(), parse_events_query()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (2): buildAttachmentContentUrl(), loadMediaLocator()

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (2): load_room_history(), parse_history_query()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (1): frontend/房间滚动器.ts

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): frontend/阅读推进编排.ts

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **24 isolated node(s):** `frontend/存储.ts`, `frontend/房间内核.ts`, `frontend/房间恢复编排.ts`, `frontend/房间滚动器.ts`, `文本布局` (+19 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 12`** (2 nodes): `load_room_events()`, `parse_events_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (2 nodes): `buildAttachmentContentUrl()`, `loadMediaLocator()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (2 nodes): `load_room_history()`, `parse_history_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (1 nodes): `Pg仓储`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `frontend/房间滚动器.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `frontend/阅读推进编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `frontend/存储.ts`, `frontend/房间内核.ts`, `frontend/房间恢复编排.ts` to the rest of the system?**
  _24 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._