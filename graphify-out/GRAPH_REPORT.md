# Graph Report - .  (2026-04-15)

## Corpus Check
- 162 files · ~196,707 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 349 nodes · 425 edges · 28 communities detected
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

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 25 edges
2. `单连接发送到已关闭socket时降级为正常断开()` - 7 edges
3. `dispatch()` - 6 edges
4. `断言媒体准备结果是Tus契约()` - 6 edges
5. `假Socket` - 5 edges
6. `handle_rustus_hook_post_finish()` - 5 edges
7. `parse_attachment_content_query()` - 5 edges
8. `Pg仓储` - 5 edges
9. `handle_rustus_hook()` - 4 edges
10. `handle_rustus_hook_pre_create()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `dispatchScroll()` --calls--> `dispatch()`  [EXTRACTED]
  frontend\房间消息窗.ts → frontend\聊天应用内核.ts
- `updated()` --calls--> `dispatch()`  [EXTRACTED]
  frontend\房间消息窗.ts → frontend\聊天应用内核.ts
- `prepare_media_upload()` --calls--> `断言媒体准备结果是Tus契约()`  [EXTRACTED]
  src\媒体上传外壳.rs → tests\测试支撑\媒体.rs
- `handle_rustus_hook_pre_create()` --calls--> `构造rustus_hook请求体()`  [EXTRACTED]
  src\rustus_hook外壳.rs → tests\测试支撑\媒体.rs
- `handle_rustus_hook_post_finish()` --calls--> `构造rustus_hook请求体()`  [EXTRACTED]
  src\rustus_hook外壳.rs → tests\测试支撑\媒体.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (42): AbandonMediaUploadBody, ApiError, Blob媒体资产响应参数, BootstrapBody, 等待complete所需运输回执(), complete_media_upload(), CompleteMediaUploadBody, 构造content_range值() (+34 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (3): 最小mp4字节(), 插入ready图片附件记录(), 会话所属匿名身份返回内部uuid而不是兼容旧串()

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (19): dispatch(), dispatchPointerScrollIntent(), dispatchScroll(), dispatchScrollIntent(), dispose(), exitCurrentRoomView(), leaveCurrentRoomView(), 附件owner不匹配时拒绝创建消息() (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (11): AdminLoginBody, AdminLoginResp, 尝试加载dotenv(), 读取exif方向(), ffprobe检测首音轨是否存在(), flush(), make_writer(), 安装panic日志钩子() (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (0): 

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (5): buildAttachmentContentUrl(), buildBlobAssetUrl(), createFakeStorage(), loadMediaLocator(), 单连接发送到已关闭socket时降级为正常断开()

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (1): HttpRealtime传输

### Community 7 - "Community 7"
Cohesion: 0.2
Nodes (9): 构造rustus_hook请求体(), handle_rustus_hook(), handle_rustus_hook_post_finish(), handle_rustus_hook_pre_create(), 解析rustus临时文件路径(), 读取rustus_hook名称(), 读取rustus_metadata字段(), RustusHookBody (+1 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (2): FakeWebTorrent, 假Socket

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (2): Assert-ServicesStopped(), Test-TcpPortOpen()

### Community 12 - "Community 12"
Cohesion: 0.33
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (1): 假Hls构造器

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (1): Pg仓储

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (2): 文本布局, 文本布局测试

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

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

## Knowledge Gaps
- **23 isolated node(s):** `frontend/房间内核.ts`, `文本布局`, `文本布局测试`, `RustusHookBody`, `RustusUploadBody` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (2 nodes): `向受控页面广播后台补发请求()`, `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `图片资产描述包含_preview_full_original_而不是普通附件直链()`, `blob媒体资产契约测试.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `Assert-True()`, `启动器脚本检查.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `blob媒体资产测试.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `Community 6` to `Community 2`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `断言媒体准备结果是Tus契约()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 5` to `Community 0`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `frontend/房间内核.ts`, `文本布局`, `文本布局测试` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._