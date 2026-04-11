# Graph Report - .  (2026-04-11)

## Corpus Check
- 84 files · ~3,988,624 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 271 nodes · 378 edges · 31 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `send_json()` - 31 edges
2. `HttpRealtime传输` - 22 edges
3. `构造rustus_hook请求体()` - 13 edges
4. `写入rustus测试文件()` - 12 edges
5. `最小mp4字节()` - 7 edges
6. `单连接发送到已关闭socket时降级为正常断开()` - 6 edges
7. `ready附件会落协作分发元数据()` - 6 edges
8. `complete图片上传会把prepared附件升级成ready并写入缩略图()` - 6 edges
9. `torrent接口会返回稳定metainfo并与locator对齐()` - 6 edges
10. `原图内容接口支持标准range读取()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `写入rustus测试文件()` --calls--> `包装url主机()`  [EXTRACTED]
  tests\集成测试.rs → src\房间外壳.rs
- `handle_rustus_hook()` --calls--> `构造rustus_hook请求体()`  [EXTRACTED]
  src\房间外壳.rs → tests\集成测试.rs
- `prepare_media_upload()` --calls--> `数据库真相模型包含媒体Tus运输记录表()`  [EXTRACTED]
  src\房间外壳.rs → tests\集成测试.rs
- `文本布局测试` --calls--> `文本布局`  [EXTRACTED]
  frontend/tests/文本布局测试.spec.ts → frontend/文本布局.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (18): AdminLoginBody, AdminLoginResp, ApiError, BootstrapBody, CompleteMediaUploadBody, JoinBody, ParsedAttachmentContentQuery, ParsedEventsQuery (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (38): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), 没有上传回执时complete媒体上传会返回attachment_not_ready(), complete图片上传遇到非图片原图会返回attachment_type_not_allowed(), complete图片上传会把prepared附件升级成ready并写入缩略图(), 非成员不能通过events接口拉取房间增量(), 成员通过events接口只会拿到from之后的事件() (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (2): FakeWebTorrent, 假Socket

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
Cohesion: 0.4
Nodes (5): 构造content_range值(), load_attachment_content(), load_media_locator(), load_media_torrent(), parse_attachment_content_query()

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (4): handle_rustus_hook(), handle_rustus_hook_post_finish(), handle_rustus_hook_pre_create(), 读取rustus_metadata字段()

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (3): err_resp(), 渲染前端入口_html(), load_frontend_index()

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (2): 等待complete所需运输回执(), complete_media_upload()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (2): load_room_events(), parse_events_query()

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (2): load_room_history(), parse_history_query()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (2): prepare_media_upload(), 数据库真相模型包含媒体Tus运输记录表()

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (2): buildAttachmentContentUrl(), loadMediaLocator()

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 2.0
Nodes (1): Pg仓储

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (1): frontend/房间滚动器.ts

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (1): frontend/阅读推进编排.ts

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **25 isolated node(s):** `frontend/存储.ts`, `frontend/房间内核.ts`, `frontend/房间恢复编排.ts`, `frontend/房间滚动器.ts`, `文本布局` (+20 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 12`** (2 nodes): `等待complete所需运输回执()`, `complete_media_upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (2 nodes): `load_room_events()`, `parse_events_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (2 nodes): `load_room_history()`, `parse_history_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `prepare_media_upload()`, `数据库真相模型包含媒体Tus运输记录表()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `buildAttachmentContentUrl()`, `loadMediaLocator()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `Pg仓储`, `.写入协作分发torrent元信息_异步()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `media-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `frontend/房间滚动器.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `frontend/阅读推进编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `frontend/存储.ts`, `frontend/房间内核.ts`, `frontend/房间恢复编排.ts` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._