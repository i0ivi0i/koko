# Graph Report - .  (2026-04-10)

## Corpus Check
- 66 files · ~1,193,752 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 218 nodes · 266 edges · 27 communities detected
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 19 edges
2. `send_json()` - 16 edges
3. `单连接发送到已关闭socket时降级为正常断开()` - 6 edges
4. `updateChat()` - 5 edges
5. `exitCurrentRoomView()` - 5 edges
6. `假Socket` - 5 edges
7. `login()` - 4 edges
8. `roomShellState()` - 4 edges
9. `leaveCurrentRoomView()` - 4 edges
10. `http冷路径闭环()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `文本布局测试` --calls--> `文本布局`  [EXTRACTED]
  frontend/tests/文本布局测试.spec.ts → frontend/文本布局.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (13): ApiError, BootstrapBody, CompleteImageUploadBody, JoinBody, ParsedAttachmentContentQuery, ParsedEventsQuery, ParsedHistoryQuery, PrepareImageUploadBody (+5 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (0): 

### Community 2 - "Community 2"
Cohesion: 0.19
Nodes (1): HttpRealtime传输

### Community 3 - "Community 3"
Cohesion: 0.11
Nodes (17): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), complete图片上传遇到非图片原图会返回attachment_type_not_allowed(), complete图片上传会把prepared附件升级成ready并写入缩略图(), 非成员不能通过events接口拉取房间增量(), 成员通过events接口只会拿到from之后的事件(), 不存在的房间通过events接口会返回room_not_found() (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (13): buildRoomViewResetPatch(), clearImageUploaderState(), exitCurrentRoomView(), handleShellConsolePrimaryInput(), joinHistoryRoom(), leaveCurrentRoomView(), render(), renderShellConsole() (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.24
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
Cohesion: 0.5
Nodes (1): 假Socket

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (3): err_resp(), 渲染前端入口_html(), load_frontend_index()

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (2): load_room_history(), parse_history_query()

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (2): load_attachment_content(), parse_attachment_content_query()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (2): load_room_events(), parse_events_query()

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (1): frontend/房间滚动器.ts

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (1): frontend/阅读推进编排.ts

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): src/后台外壳.rs

## Knowledge Gaps
- **21 isolated node(s):** `frontend/存储.ts`, `frontend/房间内核.ts`, `frontend/房间恢复编排.ts`, `frontend/房间滚动器.ts`, `文本布局` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 11`** (2 nodes): `load_room_history()`, `parse_history_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (2 nodes): `load_attachment_content()`, `parse_attachment_content_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (2 nodes): `load_room_events()`, `parse_events_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (1 nodes): `Pg仓储`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `frontend/房间滚动器.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `frontend/阅读推进编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `src/后台外壳.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `假Socket` connect `Community 9` to `Community 1`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `frontend/存储.ts`, `frontend/房间内核.ts`, `frontend/房间恢复编排.ts` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._