# Graph Report - .  (2026-04-23)

## Corpus Check
- 220 files · ~269,884 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 547 nodes · 701 edges · 35 communities detected
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
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]

## God Nodes (most connected - your core abstractions)
1. `HttpRealtime传输` - 24 edges
2. `房间HTTP接口` - 19 edges
3. `Invoke-HttpsBootstrap()` - 10 edges
4. `单连接发送到已关闭socket时降级为正常断开()` - 9 edges
5. `假Hls构造器` - 7 edges
6. `提取媒体上传授权头()` - 7 edges
7. `Start-AppViaRunScriptIfNeeded()` - 6 edges
8. `update_status()` - 6 edges
9. `load_streaming_asset_content()` - 6 edges
10. `Write-ManagedProcessLogs()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `预制图片为CanonicalWebp()` --calls--> `最小webp字节()`  [EXTRACTED]
  frontend\媒体\图片预处理.ts → src\房间外壳.rs
- `abandon_media_upload()` --calls--> `提取媒体上传授权头()`  [EXTRACTED]
  src\媒体上传外壳.rs → tests\测试支撑\媒体\tus.rs
- `提取媒体上传授权头()` --calls--> `包装url主机()`  [EXTRACTED]
  tests\测试支撑\媒体\tus.rs → src\媒体协作分发.rs
- `默认Mediabunny可无损整理()` --calls--> `新模块会给最小_mp4_返回展示尺寸()`  [EXTRACTED]
  frontend\媒体\视频预处理.ts → src\房间外壳.rs
- `返回tus_hook拒绝termination响应()` --calls--> `内部tus_hook入口应使用协议命名而不是供应商命名()`  [EXTRACTED]
  src\tus_hook外壳.rs → tests\媒体上传测试\tus_hook.rs

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (60): abandon_media_upload(), AbandonMediaUploadBody, ApiError, axum_ws_message_to_tungstenite(), Blob媒体资产响应参数, BootstrapBody, Canonical图片校验结果, 新模块会拒绝非canonical_webp字节() (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (41): 创建资产协作分发Actor(), AdminLoginBody, AdminLoginResp, 预制图片为CanonicalWebp(), dispatch(), dispatchPointerScrollIntent(), dispatchScrollIntent(), dispose() (+33 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (6): 视频complete会触发seeder_start命令(), partial_peer不能冒充available_ready来源(), 写入指定类型peer存活记录(), recent_partial_peer会让过期附件保持connecting而不是直接no_seed(), 启动假seeder侧车(), stale_partial_peer不会把附件永久抬在connecting()

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (0): 

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (5): buildAttachmentContentUrl(), createFakeStorage(), createSocket(), loadMediaLocator(), 单连接发送到已关闭socket时降级为正常断开()

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (15): Get-ListeningPortProcessRecords(), Invoke-LauncherCleanup(), New-ManagedProcess(), New-StreamState(), Parse-CloudflareTunnelPublicUrlFromLogLine(), Read-NewLogLines(), Resolve-PwshPath(), Resolve-StaleLauncherSidecar() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (16): handle_tus_hook(), handle_tus_hook_post_finish(), handle_tus_hook_post_terminate(), handle_tus_hook_pre_create(), handle_tus_hook_pre_terminate(), 判定tus运输角色(), 内部tus_hook入口应使用协议命名而不是供应商命名(), 返回tus_hook拒绝termination响应() (+8 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (1): HttpRealtime传输

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (2): FakeWebTorrent, 假Socket

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (1): 房间HTTP接口

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (15): collect_result(), ensure_http_url(), find_command(), 读取JSON(), LauncherHandle, now_iso(), parse_concurrency_levels(), round_or_none() (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (16): Build-CaddyAutoStartCommand(), Build-CaddyfileContent(), Ensure-CaddyAutoStartTask(), Ensure-CaddyBinary(), Get-LanIPv4Addresses(), Invoke-HttpsBootstrap(), Resolve-AppPortFromEnvContent(), Resolve-AppPortFromEnvFile() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.19
Nodes (5): Assert-ServicesStopped(), Get-ListeningPortProcessRecords(), Resolve-RecognizedProjectService(), Stop-RecognizedProjectServices(), Test-TcpPortOpen()

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (2): handleSummary(), summarizeTrend()

### Community 14 - "Community 14"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 15 - "Community 15"
Cohesion: 0.25
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 0.39
Nodes (3): get(), 假Hls构造器, set()

### Community 17 - "Community 17"
Cohesion: 0.43
Nodes (5): 构造tus_concatenation_hook请求体(), 构造tus_hook请求体(), 解析_tus_hook回传_http响应体(), 断言TusHook已接受(), 断言TusHook拒绝Termination()

### Community 18 - "Community 18"
Cohesion: 0.4
Nodes (2): iso5品牌mp4字节(), 最小mp4字节()

### Community 19 - "Community 19"
Cohesion: 0.5
Nodes (2): abandon会先写业务abandoned再协调官方termination(), 启动假tus_termination侧车()

### Community 20 - "Community 20"
Cohesion: 0.6
Nodes (3): 未来冷源到期时间戳秒(), 生成测试content_hash(), 插入ready图片附件记录()

### Community 21 - "Community 21"
Cohesion: 0.5
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.5
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): Pg仓储

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
Nodes (2): 文本布局, 文本布局测试

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **31 isolated node(s):** `文本布局`, `文本布局测试`, `TusHookBody`, `TusUploadBody`, `TusHookEventBody` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 25`** (2 nodes): `向受控页面广播后台补发请求()`, `app-sw.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `图片资产描述只暴露canonical而不是服务端派生多版本()`, `blob媒体资产契约测试.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `Assert-True()`, `启动器脚本检查.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `文本布局`, `文本布局测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `css.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `blob媒体资产测试.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `webtorrent.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Community 4` to `Community 0`, `Community 1`, `Community 10`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `HttpRealtime传输` connect `Community 7` to `Community 1`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `提取媒体上传授权头()` connect `Community 0` to `Community 1`, `Community 2`, `Community 17`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `文本布局`, `文本布局测试`, `TusHookBody` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._