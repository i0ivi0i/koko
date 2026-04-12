# Graph Report - .  (2026-04-13)

## Corpus Check
- 134 files · ~4,542,636 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 280 nodes · 331 edges · 30 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 22 edges
2. `单连接发送到已关闭socket时降级为正常断开()` - 7 edges
3. `构造rustus_hook请求体()` - 6 edges
4. `假Socket` - 5 edges
5. `parse_attachment_content_query()` - 5 edges
6. `Pg仓储` - 5 edges
7. `dispatch()` - 4 edges
8. `handle_rustus_hook()` - 4 edges
9. `render()` - 3 edges
10. `snapshot()` - 3 edges

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
Cohesion: 0.1
Nodes (10): constructor(), dispatch(), dispose(), exitCurrentRoomView(), leaveCurrentRoomView(), render(), renderShellConsole(), revokeDraftPreviewUrl() (+2 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (4): buildAttachmentContentUrl(), createFakeStorage(), loadMediaLocator(), 单连接发送到已关闭socket时降级为正常断开()

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (1): HttpRealtime传输

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 6 - "Community 6"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 7 - "Community 7"
Cohesion: 0.25
Nodes (5): handle_rustus_hook(), handle_rustus_hook_post_finish(), handle_rustus_hook_pre_create(), 构造rustus_hook请求体(), 读取rustus_metadata字段()

### Community 8 - "Community 8"
Cohesion: 0.33
Nodes (1): 假Socket

### Community 9 - "Community 9"
Cohesion: 0.33
Nodes (6): 构造content_range值(), load_attachment_content(), load_media_locator(), load_media_torrent(), parse_attachment_content_query(), update_media_distribution_presence()

### Community 10 - "Community 10"
Cohesion: 0.5
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 0.5
Nodes (4): prepare_media_upload(), 写入rustus测试文件(), 断言媒体准备结果是Tus契约(), 包装url主机()

### Community 12 - "Community 12"
Cohesion: 0.67
Nodes (3): err_resp(), 渲染前端入口_html(), load_frontend_index()

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (3): renderMessageAttachments(), renderMessageBody(), renderVirtualMessageItem()

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (2): 等待complete所需运输回执(), complete_media_upload()

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (2): dispatchPointerScrollIntent(), dispatchScrollIntent()

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (2): load_room_events(), parse_events_query()

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (2): load_room_history(), parse_history_query()

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (2): 最小mp4字节(), 插入ready图片附件记录()

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

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
Nodes (0): 

## Knowledge Gaps
- **22 isolated node(s):** `frontend/存储.ts`, `frontend/房间内核.ts`, `文本布局`, `文本布局测试`, `协作分发torrent元信息写入请求` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (2 nodes): `等待complete所需运输回执()`, `complete_media_upload()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `dispatchPointerScrollIntent()`, `dispatchScrollIntent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `load_room_events()`, `parse_events_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `load_room_history()`, `parse_history_query()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `最小mp4字节()`, `插入ready图片附件记录()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `media-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 4` to `Community 0`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `构造rustus_hook请求体()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `frontend/存储.ts`, `frontend/房间内核.ts`, `文本布局` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._