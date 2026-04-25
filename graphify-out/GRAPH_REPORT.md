# Graph Report - koko  (2026-04-25)

## Corpus Check
- 230 files · ~302,714 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 597 nodes · 1260 edges · 14 communities detected
- Extraction: 63% EXTRACTED · 37% INFERRED · 0% AMBIGUOUS · INFERRED: 463 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `as_str()` - 93 edges
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
- `读取媒体文件选择类型集合()` --calls--> `joinOrCreateRoom()`  [INFERRED]
  frontend\tests\附件能力注册测试.spec.ts → frontend\tests\common\聊天测试支架.ts
- `读取媒体文件选择类型集合()` --calls--> `loadRoomSnapshot()`  [INFERRED]
  frontend\tests\附件能力注册测试.spec.ts → frontend\tests\common\聊天测试支架.ts
- `attachments_to_json()` --calls--> `as_str()`  [INFERRED]
  src\外壳.rs → src\适配.rs
- `旧图片上传路由已移除()` --calls--> `send_multipart_response()`  [INFERRED]
  tests\媒体上传测试\prepare.rs → tests\测试支撑\http.rs
- `推导默认shaka_packager命令()` --calls--> `as_str()`  [INFERRED]
  src\总装.rs → src\适配.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (94): 是64位小写hex(), AbandonMediaUploadBody, admin_login(), admin_overview(), admin_room_detail(), admin_rooms(), AdminLoginBody, AdminLoginResp (+86 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (56): 备份并清空环境变量(), 构造统一媒体文件Accept(), acquire_timeout(), 创建资产协作分发Actor(), 向受控页面广播后台补发请求(), 新模块会拒绝非canonical_webp字节(), 预制图片为CanonicalWebp(), connect_timeout() (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (59): active_backend_strong_seed会让同swarm过期附件保持ready(), announce_url(), 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), 空body_presence不会把无种子附件抬成media_ready(), bootstrap匿名身份时设备凭证与花名不会混成同一个字段(), 视频complete在iso5_brand_mp4输入下不应返回500(), 视频complete会触发seeder_start命令() (+51 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (20): 插入0018前脏匿名身份与视频附件(), 图片complete后只保留一份canonical对象(), 视频complete后不再返回hls_dash_manifest(), createSocket(), 读取做种监听器预算(), 归一化InfoHash(), 读取JoinTicket(), main() (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (53): 原始冷源超过24小时后会被后台清理并写入删除时间(), abandon会先写业务abandoned再协调官方termination(), abandon_media_upload(), 放弃媒体上传会清掉当前会话下所有partial临时文件(), 放弃媒体上传会同时标记附件与transport为abandoned并清掉已登记的临时文件(), 启动假tus_termination侧车(), as_str(), 共享canonical资产超过24小时只删除一次并同步标记所有引用附件() (+45 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (16): Ensure-FrontendDependenciesInstalled(), Get-ListeningPortProcessRecords(), Invoke-LauncherCleanup(), New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Resolve-PwshPath(), Resolve-StaleLauncherSidecar() (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (6): handleSummary(), 提取静态资源路径(), 创建房间HTTP接口(), send_multipart_response(), 静态壳入口会no_cache且hashed静态资源会长缓存(), summarizeTrend()

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (5): buildAttachmentContentUrl(), createFakeStorage(), joinOrCreateRoom(), loadMediaLocator(), loadRoomSnapshot()

### Community 8 - "Community 8"
Cohesion: 0.21
Nodes (18): Build-CaddyAutoStartCommand(), Build-CaddyfileContent(), Enable-CaddyTrustAndAutoStart(), Ensure-CaddyAutoStartTask(), Ensure-CaddyBinary(), Get-LanIPv4Addresses(), Invoke-HttpsBootstrap(), Resolve-AppPortFromEnvContent() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (12): Assert-ServicesStopped(), Clear-CleanupTarget(), Clear-DirectoryContents(), Get-ListeningPortProcessRecords(), Get-StartupArtifactOptimizationTargets(), Get-WorkspaceStorageReclaimTargets(), Invoke-CargoWorkspaceClean(), Resolve-CommandPath() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.24
Nodes (16): collect_result(), ensure_http_url(), find_command(), 读取JSON(), LauncherHandle, main(), now_iso(), parse_concurrency_levels() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (9): 看起来像Promise(), 映射VideoJs播放源(), 注册KokoVideoSkin元素(), 看起来像Promise(), 兼容RemotePlayback异步契约(), get(), 假Hls构造器, set() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.25
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 13 - "Community 13"
Cohesion: 0.7
Nodes (4): 转成仓库相对路径(), 平台内层Import违规(), 检查Owner注册表(), 检查未登记XStateOwner()

## Knowledge Gaps
- **29 isolated node(s):** `TusHookBody`, `TusUploadBody`, `TusHookEventBody`, `TusHttpRequestBody`, `TusUploadStorageBody` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 12`** (9 nodes): `realtime真实链路.spec.ts`, `allocatePort()`, `ensureBackendBinaryPrepared()`, `expectNoEvent()`, `getJson()`, `postJson()`, `startBackend()`, `uniqueRoomCode()`, `waitForServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `备份并清空环境变量()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 10`?**
  _High betweenness centrality (0.180) - this node is a cross-community bridge._
- **Why does `get()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `as_str()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 6`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Are the 92 inferred relationships involving `as_str()` (e.g. with `handle_tus_hook()` and `handle_tus_hook_pre_create()`) actually correct?**
  _`as_str()` has 92 INFERRED edges - model-reasoned connections that need verification._
- **Are the 77 inferred relationships involving `send_json()` (e.g. with `locator会返回协作分发片段但不泄漏仓储私货()` and `备份并清空环境变量()`) actually correct?**
  _`send_json()` has 77 INFERRED edges - model-reasoned connections that need verification._
- **Are the 26 inferred relationships involving `备份并清空环境变量()` (e.g. with `创建房间HTTP接口()` and `get()`) actually correct?**
  _`备份并清空环境变量()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **Are the 54 inferred relationships involving `get()` (e.g. with `读取做种监听器预算()` and `备份并清空环境变量()`) actually correct?**
  _`get()` has 54 INFERRED edges - model-reasoned connections that need verification._