<goal>
在不引入新 bug、不断业务的前提下，完成 koko 纯 WebTorrent 主链第三阶段收尾：清理剩余 legacy 兼容壳、基线 schema 残留和混淆命名，但保住仍然属于 swarm 传输面、控制面或纯预览面的必要路径。
</goal>

<context>
先读：
- E:\koko\docs\superpowers\specs\2026-04-23-WebTorrent满血协同分发要求.md
- E:\koko\docs\superpowers\plans\2026-05-05-纯WebTorrent主链收尾清理执行计划.md
- E:\koko\graphify-out\GRAPH_REPORT.md
- E:\koko\frontend\媒体\媒体协作分发.ts
- E:\koko\frontend\媒体\适配\媒体HTTP接口.ts
- E:\koko\frontend\媒体\媒体播放.ts
- E:\koko\frontend\媒体\壳层\查看器会话协作.ts
- E:\koko\frontend\媒体\壳层\快照投影协作.ts
- E:\koko\frontend\房间消息窗\视图.ts
- E:\koko\frontend\房间消息窗\附件渲染.ts
- E:\koko\frontend\房间消息窗\视频附件渲染.ts
- E:\koko\frontend\房间消息窗\时间线媒体基类.ts
- E:\koko\migrations\0001_当前数据库基线.sql
- E:\koko\src\媒体\资产\响应投影.rs
- E:\koko\qingli.ps1
- E:\koko\tests\启动与迁移测试.rs
- E:\koko\tests\启动器脚本检查.ps1

优先检索：
- `rg -n "origin.original_url|web_seed_url|variants.canonical|blob/canonical" frontend src tests migrations`
- `rg -n "originalSrc|thumbnailSrc|posterSrc|mode: \"anchor\"|anchor_unavailable" frontend tests`
- `rg -n "attachment_streaming_manifests|hls_master_storage_key|dash_mpd_storage_key" src tests migrations docs`

当前已确认的三类残留：
1. legacy 播放行为残留：`frontend/媒体/媒体播放.ts` 仍保留 `legacy_anchor`、`读取锚点地址(...)`、`anchor_unavailable` 这组迁移壳；`frontend/媒体/适配/媒体HTTP接口.ts` 仍保留 `origin.original_url` 的 legacy 解析面。
2. 基线 schema 残留：`migrations/0001_当前数据库基线.sql` 仍声明 `attachment_streaming_manifests / hls_master_storage_key / dash_mpd_storage_key`。
3. legacy 图片读取面残留：`src/媒体/资产/外壳.rs` 仍暴露 `/api/media/{attachment}/blob/canonical`；它只能继续作为明确隔离的 legacy/迁移读取面，不能再被新附件正式面消费。
</context>

<constraints>
- 严格服从 DDD / Onion / Hexagonal：domain/application 不动；本轮只清 contract / adapter / shell / migration / test。
- 禁止按“名字像旧链路”直接删代码；每个删除动作都要先判它属于：
  - 正式字节面
  - swarm 内传输面
  - 控制面
  - 纯预览 UI 面
  - legacy 隔离面
  - 仅测试支架
- `/api/attachments/{attachment}/content?...`、`distribution.web_seed_url`、`origin.original_url` 若仍被 swarm / WebSeed / 冷备控制面使用，不得为了“看起来更纯”误删。
- `posterSrc` 若只服务视频首帧海报、Video.js 壳层显示或 viewer 视觉连续性，不得误删成业务回归。
- `anchor_unavailable` 这种诊断 reason 若仍承担统一降级语义，可保留为错误码/测试词汇；只有当它继续驱动正式消费路径时才应删除。
- 基线 schema `0001_当前数据库基线.sql` 是新环境单一真相；如果 live migration 已删表，基线必须同步，不允许“线上删了、基线还建”。
- 所有清理必须先写 characterization / regression 测试证明“不该再存在”或“只能留在 legacy/pure-preview 面”，再动实现。
- 中文注释只解释职责、边界、为什么；不解释显而易见动作。
- 不扩大到身份、房间、权限、消息治理等无关 bounded context。
</constraints>

<done_when>
- `frontend/媒体/媒体播放.ts` 的 `legacy_anchor` 行为面被删除或继续缩到明确 legacy 隔离层；新附件正式播放结果不再落到任何 `legacy_anchor / origin.original_url / canonical` 兼容路径。
- `migrations/0001_当前数据库基线.sql` 不再创建 `attachment_streaming_manifests` 及其 `hls_master_storage_key / dash_mpd_storage_key`，并且新环境启动/迁移测试仍通过。
- 新附件生产代码里，`originalSrc / thumbnailSrc` 只剩 preview/legacy 含义，不再有任何正式播放/正式查看消费者。
- `posterSrc` 若保留，只能是显示元数据；不再被误写成“正式字节入口”。
- `/api/media/{attachment}/blob/canonical` 若继续保留，只能被 legacy 附件或明确迁移测试消费；新附件正式图片显示不再走这条读取面。
- 与本轮清理直接相关的定向测试先红后绿，再通过全量验证。
- `pnpm --dir frontend test` 通过。
- `pnpm --dir frontend typecheck` 通过。
- `pnpm --dir frontend build` 通过。
- `cargo test -j 1` 通过。
- `pwsh -File tests/启动器脚本检查.ps1` 通过。
- `pwsh -File qingli.ps1 -Apply -Force` 通过。
- `graphify update .` 通过。
- 真实烟测房间 `1234b` 继续通过：新视频 `currentSrc` 命中 `/webtorrent/...`；新图片正式面不回 `blob/canonical`；进房、发图、发视频、查看器都不回归。
- 最终 `git status --short` 为空，并有中文 commit。
</done_when>

<workflow>
1. 先做残留分类审计：把每个旧词/旧路径判成“正式字节面 / 传输面 / 控制面 / 纯预览面 / legacy 面 / 测试支架”。
2. RED 第一阶段：给基线 schema 与清理脚本补失败测试，要求 removed manifest 不再出现在基线真相和清理 SQL 中。
3. GREEN 第一阶段：同步清掉基线 schema 残留，保持启动与迁移链路全绿。
4. RED 第二阶段：给 `legacy_anchor / 读取锚点地址 / anchor_unavailable` 补失败测试，要求新附件不再落入任何正式兼容锚点路径。
5. GREEN 第二阶段：把前端 legacy 播放降级面继续删除或压缩到明确隔离层，避免第二真相重新长回来。
6. RED 第三阶段：给图片 `blob/canonical` legacy 读取面和 presenter 元数据补失败测试，要求 `originalSrc / thumbnailSrc` 只作为 preview/legacy 数据存在，新附件正式图片不再消费 canonical 读取面。
7. GREEN 第三阶段：删除或隔离仍会把它们当正式入口的生产消费者；保留必要的 `posterSrc` 视觉连续性用法。
8. REFACTOR：删重复判断、误导性命名和已无消费者的 legacy 胶水；不碰无关 context。
9. 跑全量验证与真实烟测；若失败，回到唯一 owner/唯一真相处修，不打表面补丁。
</workflow>

<verification_loop>
- 基线/清理定向：
  - `cargo test --test 启动与迁移测试 -- --nocapture`
  - `pwsh -File tests/启动器脚本检查.ps1`
  - `pwsh -File qingli.ps1 -Apply -Force`
- 前端定向：
  - `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
  - `pnpm --dir frontend test -- frontend/tests/房间消息窗`
  - `pnpm --dir frontend test -- frontend/tests/媒体运行时测试.spec.ts frontend/tests/媒体会话测试.spec.ts`
- 全量：
  - `pnpm --dir frontend test`
  - `pnpm --dir frontend typecheck`
  - `pnpm --dir frontend build`
  - `cargo test -j 1`
  - `graphify update .`
- 真实烟测：
  - `pwsh -File run.ps1`
  - 浏览器进入 `http://127.0.0.1:8080/` 房间 `1234b`
  - 上传新图片与新视频
  - 采样网络与 DOM，确认：
    - 新视频 `currentSrc` 为 `/webtorrent/...`
    - 新图片正式面不请求 `/api/media/{attachment}/blob/canonical`
    - 查看器、自动播、进房、发送都不回归
</verification_loop>

<progress_log>
- 2026-05-06：
  - 已完成第三阶段一条实质收口：生产展示模型 `图片附件展示项 / 视频附件展示项` 删除 `originalSrc`，消息窗快照与测试夹具不再把它当成生产字段。
  - `originalSrc` 现阶段仅允许留在测试文案、legacy 语义描述或历史检索词里，不再作为生产对象字面量字段存在。
  - `thumbnailSrc / posterSrc` 继续保留，但当前只承担 preview / poster 显示元数据语义。
  - 已继续删除图片展示模型里永远写空且无消费者的 `thumbnailSrc` 字段；图片时间线卡片现在只保留几何信息，正式源继续等待后续 swarm 投影。
  - 已把内部快照投影里的 `contentUrlByAttachmentId / 附件内容地址表` 收口成 `previewUrlByAttachmentId / 附件预览地址表`，避免壳层命名继续伪装成正式内容真相。
  - 已把 `媒体播放.ts` 中误导性的 `读取图片Blob主链` 改成 `图片具备LegacyCanonical锚点`，明确它只是历史 canonical 兼容壳存在性判断，不是正式主链。
  - 已把播放结果里的 `mode: \"anchor\"` 收口成 `mode: \"legacy_anchor\"`，让迁移壳在类型系统和测试里显式带上 legacy 语义，不再伪装成正式播放模式。
</progress_log>

<execution_rules>
- Check git status before edits。
- Preserve unrelated user changes。
- Prefer `rg` over `grep`。
- 先做分类审计，再做删除；禁止“看见旧词就删”。
- 用 Serena 做符号级理解；文本快扫用 `rg`。
- Focused tests before broad tests。
- 不接受“应该没问题”；每一步都要新鲜验证。
- Do not widen scope。
- 手工编辑使用补丁工具。
- 最终中文 commit，描述清楚删了什么、为什么能删、哪些东西被保留为 preview/transport。
</execution_rules>

<output_contract>
- 更新 `E:\koko\GOAL.md`
- 必要时更新测试、实现、基线迁移与文档
- 最终回复必须明确列出：
  - 这轮“安全删除”的残留
  - 这轮“不能删、只能隔离保留”的残留
  - 验证证据
  - 真实烟测证据
  - 中文 commit id
</output_contract>
