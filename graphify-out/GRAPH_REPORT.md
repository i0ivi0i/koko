# Graph Report - .  (2026-04-12)

## Corpus Check
- 110 files · ~4,527,148 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 283 nodes · 336 edges · 33 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 22 edges
2. `单连接发送到已关闭socket时降级为正常断开()` - 6 edges
3. `构造rustus_hook请求体()` - 6 edges
4. `updateChat()` - 5 edges
5. `exitCurrentRoomView()` - 5 edges
6. `假Socket` - 5 edges
7. `parse_attachment_content_query()` - 5 edges
8. `Pg仓储` - 5 edges
9. `login()` - 4 edges
10. `roomShellState()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `prepare_media_upload()` --calls--> `断言媒体准备结果是Tus契约()`  [EXTRACTED]
  src\房间外壳.rs → tests\测试支撑\媒体.rs
- `写入rustus测试文件()` --calls--> `包装url主机()`  [EXTRACTED]
  tests\测试支撑\媒体.rs → src\房间外壳.rs
- `handle_rustus_hook()` --calls--> `构造rustus_hook请求体()`  [EXTRACTED]
  src\房间外壳.rs → tests\测试支撑\媒体.rs
- `文本布局测试` --calls--> `文本布局`  [EXTRACTED]
  frontend/tests/文本布局测试.spec.ts → frontend/文本布局.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (18): AdminLoginBody, AdminLoginResp, ApiError, BootstrapBody, CompleteMediaUploadBody, JoinBody, ParsedAttachmentContentQuery, ParsedEventsQuery (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (1): FakeWebTorrent

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (1): HttpRealtime传输

### Community 3 - "Community 3"
Cohesion: 0.17
Nodes (13): buildRoomViewResetPatch(), clearMediaPublisherState(), exitCurrentRoomView(), handleShellConsolePrimaryInput(), joinHistoryRoom(), leaveCurrentRoomView(), render(), renderShellConsole() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.22
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 6 - "Community 6"
Cohesion: 0.25
Nodes (5): handle_rustus_hook(), handle_rustus_hook_post_finish(), handle_rustus_hook_pre_create(), 构造rustus_hook请求体(), 读取rustus_metadata字段()

### Community 7 - "Community 7"
Cohesion: 0.47
Nodes (1): 单连接发送到已关闭socket时降级为正常断开()

### Community 8 - "Community 8"
Cohesion: 0.33
Nodes (6): 构造content_range值(), load_attachment_content(), load_media_locator(), load_media_torrent(), parse_attachment_content_query(), update_media_distribution_presence()

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (0):

### Community 10 - "Community 10"
Cohesion: 0.4
Nodes (5): loadOverview(), loadRooms(), login(), submitLoginForm(), submitRoomSearchForm()

### Community 11 - "Community 11"
Cohesion: 0.5
Nodes (1): 假Socket

### Community 12 - "Community 12"
Cohesion: 0.5
Nodes (4): prepare_media_upload(), 写入rustus测试文件(), 断言媒体准备结果是Tus契约(), 包装url主机()

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (3): renderMessageAttachments(), renderMessageBody(), renderVirtualMessageItem()

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (3): err_resp(), 渲染前端入口_html(), load_frontend_index()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (2): dispatchPointerScrollIntent(), dispatchScrollIntent()

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (2): buildAttachmentContentUrl(), loadMediaLocator()

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (2): load_room_events(), parse_events_query()

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (2): load_room_history(), parse_history_query()

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (2): 最小mp4字节(), 插入ready图片附件记录()

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (2): 等待complete所需运输回执(), complete_media_upload()

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0):

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0):

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0):

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0):

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0):

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0):

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0):

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0):

## Knowledge Gaps
- **22 isolated node(s):** `frontend/存储.ts`, `frontend/房间内核.ts`, `文本布局`, `文本布局测试`, `协作分发torrent元信息写入请求` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (2 nodes): `dispatchPointerScrollIntent()`, `dispatchScrollIntent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `buildAttachmentContentUrl()`, `loadMediaLocator()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `load_room_events()`, `parse_events_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `load_room_history()`, `parse_history_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `最小mp4字节()`, `插入ready图片附件记录()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `等待complete所需运输回执()`, `complete_media_upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `media-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `构造rustus_hook请求体()` connect `Community 6` to `Community 0`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `frontend/存储.ts`, `frontend/房间内核.ts`, `文本布局` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
