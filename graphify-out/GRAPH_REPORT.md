# Graph Report - .  (2026-04-16)

## Corpus Check
- 162 files · ~208,997 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 369 nodes · 448 edges · 28 communities detected
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
4. `写入tus测试文件()` - 6 edges
5. `假Socket` - 5 edges
6. `handle_tus_hook()` - 5 edges
7. `parse_attachment_content_query()` - 5 edges
8. `Pg仓储` - 5 edges
9. `handle_tus_hook_pre_create()` - 4 edges
10. `handle_tus_hook_post_finish()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `dispatchScroll()` --calls--> `dispatch()`  [EXTRACTED]
  frontend\房间消息窗.ts → frontend\聊天应用内核.ts
- `updated()` --calls--> `dispatch()`  [EXTRACTED]
  frontend\房间消息窗.ts → frontend\聊天应用内核.ts
- `abandon_media_upload()` --calls--> `写入tus测试文件()`  [EXTRACTED]
  src\媒体上传外壳.rs → tests\测试支撑\媒体.rs
- `写入tus测试文件()` --calls--> `包装url主机()`  [EXTRACTED]
  tests\测试支撑\媒体.rs → src\媒体上传外壳.rs
- `返回tus_hook拒绝termination响应()` --calls--> `内部tus_hook入口应使用协议命名而不是供应商命名()`  [EXTRACTED]
  src\tus_hook外壳.rs → tests\媒体上传测试\tus_hook.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (9): abandon会先写业务abandoned再协调官方termination(), 最小mp4字节(), 插入ready图片附件记录(), 构造tus_concatenation_hook请求体(), 构造tus_hook请求体(), 解析_tus_hook回传_http响应体(), 启动假tus_termination侧车(), 断言TusHook已接受() (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (42): abandon_media_upload(), AbandonMediaUploadBody, ApiError, Blob媒体资产响应参数, BootstrapBody, 等待complete所需运输回执(), complete_media_upload(), CompleteMediaUploadBody (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (17): dispatch(), dispatchPointerScrollIntent(), dispatchScroll(), dispatchScrollIntent(), dispose(), exitCurrentRoomView(), leaveCurrentRoomView(), 附件owner不匹配时拒绝创建消息() (+9 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (0):

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (5): buildAttachmentContentUrl(), buildBlobAssetUrl(), createFakeStorage(), loadMediaLocator(), 单连接发送到已关闭socket时降级为正常断开()

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (13): AdminLoginBody, AdminLoginResp, 尝试加载dotenv(), 读取exif方向(), ffprobe检测首音轨是否存在(), flush(), make_writer(), 安装panic日志钩子() (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (1): HttpRealtime传输

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (16): handle_tus_hook(), handle_tus_hook_post_finish(), handle_tus_hook_post_terminate(), handle_tus_hook_pre_create(), handle_tus_hook_pre_terminate(), 判定tus运输角色(), 内部tus_hook入口应使用协议命名而不是供应商命名(), 返回tus_hook拒绝termination响应() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (2): FakeWebTorrent, 假Socket

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (2): Assert-ServicesStopped(), Test-TcpPortOpen()

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 12 - "Community 12"
Cohesion: 0.5
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
- **28 isolated node(s):** `frontend/房间内核.ts`, `文本布局`, `文本布局测试`, `TusHookBody`, `TusUploadBody` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (2 nodes): `向受控页面广播后台补发请求()`, `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `Assert-True()`, `启动器脚本检查.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `图片资产描述包含_preview_full_original_而不是普通附件直链()`, `blob媒体资产契约测试.rs`
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

- **Why does `构造tus_hook请求体()` connect `Community 0` to `Community 7`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `HttpRealtime传输` connect `Community 6` to `Community 2`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `写入tus测试文件()` connect `Community 1` to `Community 0`, `Community 2`, `Community 5`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **What connects `frontend/房间内核.ts`, `文本布局`, `文本布局测试` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
