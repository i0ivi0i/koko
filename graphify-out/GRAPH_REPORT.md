# Graph Report - koko  (2026-04-25)

## Corpus Check
- 229 files · ~296,900 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 601 nodes · 1265 edges · 15 communities detected
- Extraction: 64% EXTRACTED · 36% INFERRED · 0% AMBIGUOUS · INFERRED: 461 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `as_str()` - 92 edges
2. `send_json()` - 78 edges
3. `备份并清空环境变量()` - 61 edges
4. `get()` - 55 edges
5. `读取媒体文件选择类型集合()` - 39 edges
6. `提取媒体上传授权头()` - 30 edges
7. `err_resp()` - 30 edges
8. `断言TusHook已接受()` - 24 edges
9. `写入tus测试文件()` - 22 edges
10. `构造tus_hook请求体()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `同源tracker代理入口会响应websocket握手而不是404()` --calls--> `send_bytes()`  [INFERRED]
  tests\协作分发测试.rs → tests\测试支撑\http.rs
- `读取活跃会话快照()` --calls--> `get()`  [INFERRED]
  frontend\dev-seeder.mjs → frontend\tests\视频元数据测试.spec.ts
- `读取活跃会话快照()` --calls--> `set()`  [INFERRED]
  frontend\dev-seeder.mjs → frontend\tests\视频元数据测试.spec.ts
- `备份并清空环境变量()` --calls--> `createFakeStorage()`  [EXTRACTED]
  tests\测试支撑\环境.rs → frontend\tests\common\聊天测试支架.ts
- `备份并清空环境变量()` --calls--> `创建房间HTTP接口()`  [INFERRED]
  tests\测试支撑\环境.rs → frontend\聊天恢复\适配\房间HTTP接口.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (87): 插入0018前脏匿名身份与视频附件(), 是64位小写hex(), abandon_media_upload(), AbandonMediaUploadBody, admin_login(), admin_overview(), admin_room_detail(), admin_rooms() (+79 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (80): 原始冷源超过24小时后会被后台清理并写入删除时间(), active_backend_strong_seed会让同swarm过期附件保持ready(), announce_url(), as_str(), attachments_to_json(), 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), 空body_presence不会把无种子附件抬成media_ready() (+72 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (55): 备份并清空环境变量(), 构造统一媒体文件Accept(), acquire_timeout(), 创建资产协作分发Actor(), 向受控页面广播后台补发请求(), 新模块会拒绝非canonical_webp字节(), 预制图片为CanonicalWebp(), connectedCallback() (+47 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (10): buildAttachmentContentUrl(), createFakeStorage(), createSocket(), joinOrCreateRoom(), loadMediaLocator(), loadRoomSnapshot(), 读取媒体文件选择类型集合(), FakeWebTorrent (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (35): abandon会先写业务abandoned再协调官方termination(), 放弃媒体上传会清掉当前会话下所有partial临时文件(), 放弃媒体上传会同时标记附件与transport为abandoned并清掉已登记的临时文件(), 启动假tus_termination侧车(), complete图片上传遇到非图片原图会返回attachment_type_not_allowed(), complete视频上传会写入canonical并返回file_asset(), complete会优先消费当前会话的final回执而不是single回执(), complete在只有partial没有final时会返回attachment_not_ready() (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (19): Ensure-FrontendDependenciesInstalled(), Get-ListeningPortProcessRecords(), Invoke-LauncherCleanup(), New-ManagedProcess(), New-StreamState(), Parse-CloudflareTunnelPublicUrlFromLogLine(), Read-NewLogLines(), Resolve-PwshPath() (+11 more)

### Community 6 - "Community 6"
Cohesion: 0.21
Nodes (18): Build-CaddyAutoStartCommand(), Build-CaddyfileContent(), Enable-CaddyTrustAndAutoStart(), Ensure-CaddyAutoStartTask(), Ensure-CaddyBinary(), Get-LanIPv4Addresses(), Invoke-HttpsBootstrap(), Resolve-AppPortFromEnvContent() (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (12): Assert-ServicesStopped(), Clear-CleanupTarget(), Clear-DirectoryContents(), Get-ListeningPortProcessRecords(), Get-StartupArtifactOptimizationTargets(), Get-WorkspaceStorageReclaimTargets(), Invoke-CargoWorkspaceClean(), Resolve-CommandPath() (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (8): 读取活跃会话快照(), 归一化InfoHash(), 读取JoinTicket(), main(), 读取WebTorrent构造器(), ensureBackendBinaryPrepared(), once(), startBackend()

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (15): handle_tus_hook(), handle_tus_hook_post_finish(), handle_tus_hook_post_terminate(), handle_tus_hook_pre_create(), handle_tus_hook_pre_terminate(), 判定tus运输角色(), 返回tus_hook拒绝termination响应(), 读取可选tus_metadata字段() (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.24
Nodes (16): collect_result(), ensure_http_url(), find_command(), 读取JSON(), LauncherHandle, main(), now_iso(), parse_concurrency_levels() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (9): 看起来像Promise(), 映射VideoJs播放源(), 注册KokoVideoSkin元素(), 看起来像Promise(), 兼容RemotePlayback异步契约(), get(), 假Hls构造器, set() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (1): 创建房间HTTP接口()

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (2): handleSummary(), summarizeTrend()

### Community 14 - "Community 14"
Cohesion: 0.7
Nodes (4): 转成仓库相对路径(), 平台内层Import违规(), 检查Owner注册表(), 检查未登记XStateOwner()

## Knowledge Gaps
- **29 isolated node(s):** `TusHookBody`, `TusUploadBody`, `TusHookEventBody`, `TusHttpRequestBody`, `TusUploadStorageBody` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 12`** (13 nodes): `创建房间HTTP接口()`, `.abandonMediaUpload()`, `.adminLogin()`, `.adminRoomDetail()`, `.adminRooms()`, `.解析Blob媒体资产()`, `.completeMediaUpload()`, `.constructor()`, `.forwardMediaAttachment()`, `.loadAdminOverview()`, `.loadMediaLocator()`, `.prepareMediaUpload()`, `.reuseMediaBySourceHash()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (7 nodes): `buildTusMetadata()`, `handleSummary()`, `jsonHeaders()`, `mustParseJson()`, `resolveTusLocation()`, `媒体上传并发压测.js`, `summarizeTrend()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `备份并清空环境变量()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 10`, `Community 12`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Why does `get()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `as_str()` connect `Community 1` to `Community 0`, `Community 9`, `Community 2`, `Community 4`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Are the 91 inferred relationships involving `as_str()` (e.g. with `handle_tus_hook()` and `handle_tus_hook_pre_create()`) actually correct?**
  _`as_str()` has 91 INFERRED edges - model-reasoned connections that need verification._
- **Are the 77 inferred relationships involving `send_json()` (e.g. with `locator会返回协作分发片段但不泄漏仓储私货()` and `备份并清空环境变量()`) actually correct?**
  _`send_json()` has 77 INFERRED edges - model-reasoned connections that need verification._
- **Are the 26 inferred relationships involving `备份并清空环境变量()` (e.g. with `创建房间HTTP接口()` and `get()`) actually correct?**
  _`备份并清空环境变量()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 54 inferred relationships involving `get()` (e.g. with `读取活跃会话快照()` and `备份并清空环境变量()`) actually correct?**
  _`get()` has 54 INFERRED edges - model-reasoned connections that need verification._