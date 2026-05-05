<goal>
把 koko 的新附件正式媒体字节彻底纯化为唯一 WebTorrent 主链：删除新附件的 anchor 正式消费、切掉消息窗 originalSrc/thumbnailSrc/posterSrc 正式入口、让新图片不再依赖 blob canonical 正式面，并物理清理 attachment_streaming_manifests 历史残留。
</goal>

<context>
先读：
- E:\koko\docs\superpowers\specs\2026-04-23-WebTorrent满血协同分发要求.md
- E:\koko\docs\superpowers\plans\2026-05-05-纯WebTorrent主链收尾清理执行计划.md
- E:\koko\frontend\媒体\媒体播放.ts
- E:\koko\frontend\媒体\壳层\快照投影协作.ts
- E:\koko\frontend\房间消息窗\视图.ts
- E:\koko\frontend\房间消息窗\附件渲染.ts
- E:\koko\frontend\房间消息窗\图片附件渲染.ts
- E:\koko\frontend\媒体\运行时.ts
- E:\koko\frontend\媒体\播放会话\应用.ts
- E:\koko\frontend\媒体\适配\媒体HTTP接口.ts
- E:\koko\frontend\媒体\媒体协作分发.ts
- E:\koko\frontend\平台\传输.ts
- E:\koko\frontend\media-sw.ts
- E:\koko\src\媒体\资产\外壳.rs
- E:\koko\src\媒体\资产\响应投影.rs
- E:\koko\src\媒体\上传\外壳\完成上传.rs
- E:\koko\migrations\0001_当前数据库基线.sql

优先检索：
- `rg -n --fixed-strings "anchor" frontend src tests migrations`
- `rg -n --fixed-strings "originalSrc" frontend src tests migrations`
- `rg -n --fixed-strings "thumbnailSrc" frontend src tests migrations`
- `rg -n --fixed-strings "posterSrc" frontend src tests migrations`
- `rg -n --fixed-strings "buildAttachmentContentUrl" frontend src tests migrations`
- `rg -n --fixed-strings "blob/canonical" frontend src tests migrations`
- `rg -n --fixed-strings "attachment_streaming_manifests" frontend src tests migrations`
- `rg -n --fixed-strings "hls_master_storage_key" frontend src tests migrations`
- `rg -n --fixed-strings "dash_mpd_storage_key" frontend src tests migrations`

优先测试集：
- E:\koko\frontend\tests\媒体播放\主链与swarm裁决测试.spec.ts
- E:\koko\frontend\tests\媒体播放\过期与锚点降级测试.spec.ts
- E:\koko\frontend\tests\blob媒体资产测试.spec.ts
- E:\koko\frontend\tests\传输媒体定位与地址收口测试.spec.ts
- E:\koko\frontend\tests\媒体服务工作线程测试.spec.ts
- E:\koko\frontend\tests\房间消息窗
- E:\koko\tests\媒体上传测试\单文件主链.rs
- E:\koko\tests\媒体上传测试\complete_视频与类型守卫.rs
- E:\koko\tests\协作分发测试
- E:\koko\tests\启动与迁移测试.rs
</context>

<constraints>
- 严格服从 DDD / Onion / Hexagonal 边界：只允许在 contract / adapter / shell 清理第二主链，禁止把业务真相塞回 adapter 或 UI。
- WebSeed 仍属于 swarm 内正式分发平面；禁止把 WebSeed 误删成“为了纯而纯”。
- `.torrent`、metainfo、join ticket、announce、presence、availability、delete 继续是控制面；禁止把控制面误判成第二播放主链。
- 新附件视频和图片都必须只剩一个正式字节 owner；legacy 附件若保留兼容路径，必须显式隔离到 legacy owner，不能被新附件默认消费。
- `anchor` 只能留在显式 legacy/迁移壳；若无法显式隔离，就直接删除，不允许继续混进新附件的 playback/result/runtime/message shell。
- `originalSrc / thumbnailSrc / posterSrc / buildAttachmentContentUrl(...)` 不得再作为新附件正式字节入口；只能保留给显式 preview UI 或 legacy 附件。
- `attachment_streaming_manifests / hls_master_storage_key / dash_mpd_storage_key` 不得继续存在于新主链 owner、当前生产写入链或默认迁移真相中。
- 严格 TDD：每个子阶段先写最小失败测试，再做最小实现转绿，再清理重复和注释；禁止先写实现再补测试。
- 代码注释必须用中文，只解释职责、边界、数据流和为什么；禁止解释显而易见的语法动作。
- 不扩大到消息、身份、房间、权限等无关 bounded context；只修“纯 WebTorrent 正式主链”直接相关链路。
</constraints>

<done_when>
- 新附件视频播放结果不再返回或消费 `mode = "anchor"`；新附件视频正式播放只会是 `swarm` 或统一 degraded/no-seed/deleted。
- 新附件视频 `locator.file_asset.variants.canonical` 仍为 `null`，且任何新附件正式视频链路都不再消费 `origin.original_url` 或 `/api/attachments/{attachment}/content?...`。
- 新附件图片正式显示不再依赖 `/api/media/{attachment}/blob/canonical`、`media-sw.ts`、`buildAttachmentContentUrl(...)` 或 anchor 正式面；swarm 不可得时进入稳定占位或 contract 降级。
- `originalSrc / thumbnailSrc / posterSrc` 不再作为新附件正式字节入口；消息窗、查看器、全屏对新附件只消费 runtime owner 已裁决的正式结果。
- `attachment_streaming_manifests` 表及其 `hls_master_storage_key / dash_mpd_storage_key` 不再处于新主链 owner、生产写入链、默认启动迁移真相或生产测试前提中；若保留，仅能在显式 legacy 隔离面出现。
- `pnpm --dir frontend test` 通过。
- `pnpm --dir frontend typecheck` 通过。
- `pnpm --dir frontend build` 通过。
- `cargo test -j 1` 通过。
- `graphify update .` 通过，且没有新的 owner 继续把 `anchor/blob canonical/manifest` 当正式主链。
- 真实烟测在房间 `1234b` 证明：新视频 `currentSrc` 命中 `/webtorrent/...`；新图片不再命中 `blob/canonical` 正式面；后 `24 小时` 与删除态仍说真话。
- 最终 `git status --short` 为空，并有中文 commit 记录第二阶段彻底纯化完成。
</done_when>

<workflow>
1. 先做代码审计收口：确认当前 residual path 只剩 `anchor`、消息窗地址表、blob canonical legacy 面、manifest schema 残留；把这些都映射到明确 owner。
2. RED 第一阶段：先为新附件视频写失败测试，要求新附件视频任何入口都不再消费 `anchor`、`origin.original_url`、`content?...`。
3. GREEN 第一阶段：删除新附件视频 playback/result/runtime/message-shell 对 `anchor` 的正式消费，只保留显式 legacy 隔离面或直接删除。
4. RED 第二阶段：为新附件图片写失败测试，要求正式显示不再依赖 `blob/canonical`、`buildAttachmentContentUrl(...)`、`media-sw.ts`。
5. GREEN 第二阶段：把图片正式显示完全收口到 swarm source / stable placeholder；把消息窗地址表压回 preview/legacy 专用面。
6. RED 第三阶段：为 `attachment_streaming_manifests` 与基线 schema 写失败测试，要求它不再是新主链 owner 的默认存在。
7. GREEN 第三阶段：清掉 manifest 历史残留与迁移前提，保持 legacy 隔离明确。
8. REFACTOR：删重复判断、死代码、兼容注释噪音，保持注释只解释边界和为什么。
9. 跑定向测试，再跑全量测试、typecheck、build、cargo、graphify。
10. 做真实浏览器烟测，证明“正式主链彻底纯化”是用户可观察事实，而不是测试里自说自话。
</workflow>

<verification_loop>
- 每个子阶段先跑对应定向测试，确认先红后绿：
  - `pnpm --dir frontend test -- frontend/tests/媒体播放/主链与swarm裁决测试.spec.ts frontend/tests/媒体播放/过期与锚点降级测试.spec.ts`
  - `pnpm --dir frontend test -- frontend/tests/blob媒体资产测试.spec.ts frontend/tests/传输媒体定位与地址收口测试.spec.ts frontend/tests/媒体服务工作线程测试.spec.ts`
  - `pnpm --dir frontend test -- frontend/tests/房间消息窗`
  - `cargo test --test 媒体上传测试 单文件主链 -- --nocapture`
  - `cargo test --test 媒体上传测试 complete_视频与类型守卫 -- --nocapture`
  - `cargo test --test 启动与迁移测试 -- --nocapture`
- 全量验证：
  - `pnpm --dir frontend test`
  - `pnpm --dir frontend typecheck`
  - `pnpm --dir frontend build`
  - `cargo test -j 1`
  - `graphify update .`
- 真实烟测：
  - `pwsh -File run.ps1`
  - 用浏览器 CLI 链路进入 `http://127.0.0.1:8080/` 房间 `1234b`
  - 上传新视频与新图片，验证新视频 `<video>.currentSrc` 命中 `/webtorrent/...`
  - 采样网络请求，确认新图片正式面不命中 `/api/media/{attachment}/blob/canonical`
  - 验证删除态 / 无在线种子态文案与 contract 一致
- 若任何验证失败：禁止补丁式绕过；回到对应 owner 重新审计，再继续 RED -> GREEN -> REFACTOR。
</verification_loop>

<execution_rules>
- Check git status before edits。
- Preserve unrelated user changes。
- Prefer `rg` over `grep`。
- 优先用 Serena 做符号级理解；纯文本快扫用 `rg`。
- Read context files before implementation。
- Batch independent reads in parallel。
- Run focused tests before broad tests。
- Do not paper over failures。
- Do not widen scope。
- 手工编辑使用补丁工具。
- 每轮完成后用中文 commit，说明改了什么、为什么、影响了什么边界。
- 最终答复保持简洁，先给结论、证据、剩余风险。
</execution_rules>

<output_contract>
- 产出或更新：
  - `E:\koko\GOAL.md`
  - 必要的测试与实现文件
- 最终回复必须包含：
  - 本轮清理掉的第二主链/兼容壳清单
  - 仍保留但被显式隔离的 legacy 面清单
  - 关键验证命令与结果
  - 真实烟测证据
  - 中文 commit id
- 完成信号：
  - 新附件正式媒体字节只剩 WebTorrent 主链
  - `git status --short` 为空
</output_contract>
