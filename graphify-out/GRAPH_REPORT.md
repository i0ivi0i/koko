# Graph Report - .  (2026-04-13)

## Corpus Check
- 143 files · ~160,101 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 288 nodes · 346 edges · 22 communities detected
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

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 24 edges
2. `单连接发送到已关闭socket时降级为正常断开()` - 7 edges
3. `构造rustus_hook请求体()` - 7 edges
4. `假Socket` - 5 edges
5. `parse_attachment_content_query()` - 5 edges
6. `Pg仓储` - 5 edges
7. `dispatch()` - 4 edges
8. `断言媒体准备结果是Tus契约()` - 4 edges
9. `写入rustus测试文件()` - 4 edges
10. `handle_rustus_hook()` - 4 edges

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
Cohesion: 0.03
Nodes (11): AdminLoginBody, AdminLoginResp, ApiError, err_resp(), 渲染前端入口_html(), load_frontend_index(), 最小mp4字节(), 插入ready图片附件记录() (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (35): BootstrapBody, 等待complete所需运输回执(), complete_media_upload(), CompleteMediaUploadBody, 构造content_range值(), 读取exif方向(), handle_rustus_hook(), handle_rustus_hook_post_finish() (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (14): dispatch(), dispatchPointerScrollIntent(), dispatchScrollIntent(), dispose(), exitCurrentRoomView(), leaveCurrentRoomView(), render(), renderMessageAttachments() (+6 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (0): 

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (4): buildAttachmentContentUrl(), createFakeStorage(), loadMediaLocator(), 单连接发送到已关闭socket时降级为正常断开()

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (1): HttpRealtime传输

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (0): 

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (2): FakeWebTorrent, 假Socket

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 10 - "Community 10"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (0): 

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **21 isolated node(s):** `frontend/存储.ts`, `frontend/房间内核.ts`, `文本布局`, `文本布局测试`, `AdminLoginBody` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 11`** (2 nodes): `向受控页面广播后台补发请求()`, `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (2 nodes): `图片资产描述包含_preview_full_original_而不是普通附件直链()`, `blob媒体资产契约测试.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `media-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 5` to `Community 2`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 4` to `Community 0`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `构造rustus_hook请求体()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `frontend/存储.ts`, `frontend/房间内核.ts`, `文本布局` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._