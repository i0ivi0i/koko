# 纯 WebTorrent 媒体高速发送源码热路径设计

日期：2026-05-16
状态：Design / 等待用户审查

关联：

- `docs/superpowers/specs/2026-05-16-上传热路径性能瓶颈消除-design.md`
- `docs/superpowers/specs/2026-05-12-后端WebTorrent零延迟强种子群友-design.md`
- `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`
- `frontend/媒体/媒体发布.ts`
- `frontend/媒体/媒体发布上传事件协作.ts`
- `frontend/媒体/图片预处理.ts`
- `frontend/媒体/视频预处理.ts`
- `src/媒体/上传/外壳/完成上传.rs`
- `src/外壳/协作分发做种.rs`
- `frontend/dev-seeder.mjs`

---

## 1. 大白话结论

用户要的不是“上传进度条会动”，而是微信/Telegram 级别的体感：点选媒体后，消息立刻站到聊天里；小图小视频几乎秒可看；大视频也要尽快进入“服务器强种子 + 群友互帮互助”的 WebTorrent swarm。

本项目的方向不能变：

1. 图片唯一 canonical 格式是 WebP。
2. 视频唯一 canonical 格式是 WebTorrent 友好的 MP4。
3. 服务器必须用大带宽作为 WebTorrent strong seed 参与互帮互助。

当前源码的问题不是这些不变量错了，而是热路径仍有“必须等加工完成才开始下一步”的阻塞点。要把系统从串行加工链，收束成可观测、可取消、有闸门、强种子优先的并行流水线。

---

## 2. 当前已验证事实

### 2.1 前端选择文件后仍有硬等待

`frontend/媒体/媒体发布.ts` 的 `处理选择同类媒体文件` 当前已经把 source hash 和媒体预处理并行：

```text
Promise.all([
  计算源文件SourceHash(...),
  准备待上传媒体文件(...),
])
```

这比旧串行链路更好，但 Tus 上传仍必须等待两个结果都返回：

```text
source file
  -> hash 与 canonical 预制并行
  -> 等二者都完成
  -> source_hash 复用预检
  -> prepare
  -> Uppy addFile
  -> Tus 上传开始
```

所以小图慢、小视频慢，源码层仍可能发生在“上传还没开始”的本地预制阶段。

### 2.2 图片 WebP 预制保证正确，但对所有非 WebP 都重编码

`frontend/媒体/图片预处理.ts` 的 `预制图片为CanonicalWebp` 规则正确：非 WebP 必须变成 `canonical.webp`。

实际链路是：

```text
createImageBitmap(file)
  -> OffscreenCanvas 或 canvas
  -> convertToBlob/toBlob("image/webp", 0.95)
  -> File("canonical.webp")
```

这保证了“图片只有 WebP 真相”，但普通 JPG/PNG 小图也要先完整解码、绘制、重编码后才能上传。OffscreenCanvas 可用时能减轻主线程压力；不可用时会走 DOM canvas，体感更容易卡。

### 2.3 视频 MP4 预制有快路径，但 fast-start 友好性仍不够硬

`frontend/媒体/视频预处理.ts` 的 `预处理待上传视频文件` 先尝试直通，再 Mediabunny 无损整理，再 WebCodecs 转码。

当前直通判断主要是：

```text
文件看起来是 mp4
主 brand 不是 "qt  "
video.canPlayType(mimeType) 非空
```

非直通时使用 Mediabunny：

```text
BufferTarget
Mp4OutputFormat({ fastStart: "in-memory" })
Conversion.execute()
```

这能产出 WebTorrent 友好的 canonical MP4，但 `BufferTarget` 意味着结果会完整落入 JS 内存。大视频下这是明确的 CPU/内存热区。

### 2.4 Tus 成功后前端仍同步等待 complete

`frontend/媒体/媒体发布上传事件协作.ts` 的 `处理媒体上传成功事件` 在 Tus upload-success 后会：

```text
status = processing
await completeMediaUpload(...)
status = ready
```

这保证了 ready 语义真实，但也让用户看到的“上传完成”被后端 complete 重活绑住。complete 内部要校验 canonical、写对象存储、生成 torrent、写库、广播、触发做种。

### 2.5 服务器强种子最终路径已有，但 complete 首发 payload 仍不够强

`src/外壳/协作分发做种.rs` 已经有 `torrent_bytes_base64` 和 `local_seed` 字段，`执行一次协作分发做种对账` 也会补齐：

```text
torrentBytesBase64 = base64(torrent_bytes)
localSeed = 构造本地做种提示(...)
```

但 `complete_media_upload` 立即触发 sidecar 时，调用的是 `从协作分发响应构造做种启动命令`，该函数现在仍返回：

```text
torrent_bytes_base64: None
local_seed: None
```

这意味着首轮强种子启动仍可能不是“本地 hardlink + 权威 torrent bytes”的最快路径，而是等后台对账再补强。

---

## 3. 领域语言与边界

### 3.1 统一语言

- 媒体附件：用户发送到群聊的图片或视频附件。
- source hash：原始文件字节的去重身份，用于判断“这个媒体以前是否发过”。
- canonical 文件：项目承认的正式媒体字节。图片是 WebP，视频是 WebTorrent 友好 MP4。
- transport upload：Tus 只负责把 canonical 文件送到服务器，不代表媒体 ready。
- complete：服务器把上传临时文件收口成附件事实、canonical 存储、torrent 元信息和分发快照。
- strong seed：服务器 sidecar 在同一个 infoHash swarm 内成为完整 WebTorrent seed。

### 3.2 DDD / 六边形边界

| 层 | 能做 | 不能做 |
|---|---|---|
| domain | 表达附件状态、消息成立、媒体种类、业务不变量 | 感知 Tus、WebTorrent、canvas、Mediabunny、local path |
| application | 编排 prepare / complete / reuse 用例，维护 source hash 与附件状态 | 直接操作浏览器预处理、sidecar 文件系统 |
| contract | 暴露稳定附件快照、错误码、分发 locator | 暴露 `localSeed`、sidecar runtime、服务器绝对路径 |
| adapter | Tus、对象存储、SQL、WebTorrent sidecar、浏览器预处理 | 偷做消息成立规则 |
| shell | 连接应用状态、HTTP client、限流、后台对账、日志指标 | 发明第二套媒体真相 |

本 spec 的改动只允许落在 application / adapter / shell 的外圈执行模型，不改变 domain 的业务事实，也不把外部协议细节塞进 contract。

---

## 4. 方案比较

### 4.1 方案 A：放弃 WebP / canonical MP4，先原文件上传

优势：上传最早开始。

失败点：

- 破坏项目“图片统一 WebP、视频统一 WebTorrent 友好格式”的核心真相。
- 服务器和群友会面对多格式媒体，后续播放、缓存、去重、torrent 都更复杂。
- 等于把体验债转移到接收端。

裁决：拒绝。

### 4.2 方案 B：保留 canonical，但继续当前强等待模型

优势：语义简单，当前代码接近这个模型。

失败点：

- 小图小视频也要等本地完整预制、hash、复用、prepare 后才启动 Tus。
- 大视频可能在 `BufferTarget` 阶段占用大量 JS 内存。
- complete 首发 seed 不携带 `localSeed`，服务器强种子晚一拍。

裁决：拒绝作为最终形态，只能作为当前过渡状态。

### 4.3 方案 C：canonical 不变量不变，热路径改成并行流水

核心：

1. source hash、canonical 预制、prepare 资格检查、耗时观测并行推进。
2. 复用命中时取消上传或跳过上传，保持 source hash 价值。
3. Tus 成功后前端进入 `processing` 即允许 pending-first 发送，ready 由 complete 事件收口。
4. complete 首发 seed start 直接携带 `torrentBytesBase64 + localSeed`。
5. 图片/视频预制加 Worker 化、耗时日志、并发闸门和大文件内存保护。

裁决：选中。

---

## 5. 目标链路

### 5.1 选择文件到 Tus 启动

目标不是绕过 canonical，而是减少不可见等待：

```text
用户选择 File
  -> 立即创建本地 draft，显示 pending/preparing
  -> source hash 在 Worker 中读原始文件
  -> canonical 预制在专门预制管线中执行
  -> 记录 image_preprocess / video_preprocess / hash 耗时
  -> hash 先完成则先查复用
  -> canonical 先完成则等待 hash 的短预算
  -> 未命中复用时 prepare + Tus addFile
  -> 命中复用时丢弃预制结果，直接写 reused draft
```

严格约束：

1. source hash 不能删除，因为它是“群友发过就不重传”的业务价值。
2. canonical 不能删除，因为它是媒体字节唯一真相。
3. 可以改变等待方式、线程位置、取消模型和观测能力。

### 5.2 Tus 成功到 ready

```text
Tus upload-success
  -> draft.status = processing
  -> completeMediaUpload 发起
  -> 用户可 pending-first 发送附件引用
  -> complete 成功后广播 ready / locator / torrent 元信息
  -> 前端按 attachment_id 更新 draft 和消息内附件
```

这里的关键是：processing 是诚实状态，不冒充 ready；但消息可以先站住，后续由 ready 事件补齐可播放能力。

### 5.3 complete 到服务器强种子

```text
complete 写入 canonical + torrent bytes
  -> 构造首发 seed start payload
  -> payload 包含 torrentBytesBase64
  -> 本地存储模式 payload 包含 localSeed hardlink hint
  -> sidecar client.add(权威 torrent bytes, { path: stagingRoot, urlList })
  -> 只有 torrent.done true 才写 backend_strong_seed
```

后台对账仍保留，但它应该是补偿 owner，不是首个强路径 owner。

---

## 6. 具体设计约束

### 6.1 图片 WebP 预制

必须保留：

- 所有图片最终上传为 `canonical.webp`。
- HEIC/HEIF 先标准化，再 WebP。
- 后端仍校验 canonical 图片内容。

必须新增或强化：

- 预制耗时日志：文件大小、输入 MIME、是否 WebP 直通、是否 OffscreenCanvas、耗时。
- Worker/OffscreenCanvas 优先路径：浏览器支持时不阻塞主线程。
- 并发闸门：同一会话最多同时预制少量图片，避免用户一次选几十张图打满 CPU。
- 取消语义：source hash 复用命中后，未完成预制应尽量取消或忽略结果，不再推进 Tus。

### 6.2 视频 WebTorrent 友好 MP4 预制

必须保留：

- 视频最终上传为后端可校验的 canonical MP4。
- 非友好视频先 remux，必要时转码。
- 不引入 HLS、DASH、range、原文件直链作为第二主链。

必须新增或强化：

- MP4 fast-start 判定：不仅看 brand，还要能判断 `moov` 是否足够靠前，避免“看似 MP4 但 WebTorrent 不友好”。
- 大视频内存保护：`BufferTarget` 路径必须记录输出大小、峰值风险，并受并发闸门控制。
- 预制耗时日志：passthrough / remux / transcode 分开统计。
- 用户体验状态：超过短阈值显示“正在整理视频为群聊高速格式”，但不能触发失败。

### 6.3 source hash 去重

必须保留：

- hash 基于原始 source file，而不是 canonical 结果。
- hash 用于复用查询，命中时不重新上传。

必须避免：

- hash 和 canonical 任一慢，就让用户毫无反馈地等。
- hash 失败时直接破坏 canonical 上传；hash 失败只能失去秒传复用，不应让合法媒体无法上传，除非错误代表文件不可读。

### 6.4 服务器强种子首发路径

必须修复：

- `complete_media_upload` 首发 seed start 不能只传 runtime_distribution。
- 首发 payload 必须尽可能携带 `torrentBytesBase64`。
- 本地存储模式必须尽可能携带 `localSeed`。
- S3 模式不得伪造本地路径。

必须保持：

- hardlink 成功不等于强种子成立。
- `localSeedReady` 不等于强种子成立。
- 只有 sidecar WebTorrent runtime 的 `torrent.done === true` 才能写 `backend_strong_seed`。

---

## 7. 文件职责

### 7.1 `frontend/媒体/媒体发布.ts`

职责：

- 组织 hash、复用、canonical 预制、prepare、Uppy addFile。
- 增加阶段耗时记录和取消/忽略过期结果。
- 保持 UI draft 与真实上传状态一致。

不负责：

- 图片/视频具体编码细节。
- WebTorrent 做种事实。

### 7.2 `frontend/媒体/图片预处理.ts`

职责：

- 图片 canonical WebP 预制。
- 暴露预制策略结果：webp passthrough、offscreen encode、canvas encode、heic normalize。

不负责：

- 复用查询。
- Tus 上传。

### 7.3 `frontend/媒体/视频预处理.ts`

职责：

- 判断 canonical MP4 是否可直通。
- 执行 Mediabunny remux / WebCodecs transcode。
- 暴露策略、耗时和大文件风险信息。

不负责：

- 生成 WebTorrent metainfo。
- 创建第二个浏览器 seed swarm。

### 7.4 `frontend/媒体/媒体发布上传事件协作.ts`

职责：

- Tus 成功后进入 processing。
- complete 成功后更新 ready。
- complete 失败时只影响对应 draft，不污染其他附件。

可演进：

- 把 complete 响应和实时 ready 事件统一到同一个 attachment_id owner，减少重复状态源。

### 7.5 `src/媒体/上传/外壳/完成上传.rs`

职责：

- complete 权威收口。
- 生成或取得 canonical storage key、torrent bytes、runtime_distribution。
- 首发 seed start 时携带权威 torrent bytes 和 local seed hint。

不负责：

- 判断 sidecar 是否真的已成为强种子。

### 7.6 `src/外壳/协作分发做种.rs`

职责：

- 构造 sidecar 控制面 payload。
- 复用 `构造本地做种提示`。
- 对账补偿。
- 只按 `torrent.done` 裁决 strong seed presence。

不负责：

- 把本地路径暴露给前端 contract。
- 自研 WebTorrent 协议。

---

## 8. TDD 验证规格

### 8.1 前端单元测试

必须覆盖：

1. hash 和 canonical 预制并行启动，不退回串行。
2. source hash 复用命中时，不调用 Tus `addFile`。
3. WebP 输入走 passthrough，不触发 canvas 重编码。
4. JPG/PNG 输入产出 `canonical.webp`。
5. 视频 MP4 fast-start 友好时走 passthrough。
6. QuickTime 或非 fast-start MP4 进入 remux。
7. 预制失败只标记对应 draft failed，不影响其他文件。
8. complete 成功前 draft 保持 processing，不冒充 ready。

### 8.2 Rust 单元测试

必须覆盖：

1. `从协作分发响应构造做种启动命令` 仍只从 runtime_distribution 取公共 transport 事实。
2. 新的 complete 首发命令增强函数能把 `torrentBytesBase64` 注入 payload。
3. 本地存储模式能生成 `localSeed.strategy=hardlink`。
4. S3 模式不生成 `localSeed`。
5. `localSeedReady=true, done=false` 不写 `backend_strong_seed`。
6. `done=true` 才写 `backend_strong_seed`。

### 8.3 Node sidecar 测试

必须覆盖：

1. `torrentBytesBase64` 存在时，`client.add` source 是 Buffer。
2. `localSeed` 存在时执行路径 containment 校验。
3. `torrentFileName` 含路径分隔符时拒绝 hardlink。
4. `fs.link` 出现 `EXDEV` 时降级 WebSeed fallback，不伪造 ready。
5. `torrent.done` 事件到达后才返回或报告 done。

### 8.4 真实烟测

必须覆盖：

1. `run.ps1` 启动完整栈。
2. 上传小 JPG，日志能看到 image preprocess、hash、prepare、Tus、complete 耗时。
3. 上传小 MP4，日志能看到 video preprocess 策略和 complete 耗时。
4. 上传大 MP4，确认不会出现长时间无反馈。
5. 本地存储模式上传完成后，首轮 `/seed/start` payload 已包含 `torrentBytesBase64` 和 `localSeed`。
6. sidecar status 最终 `done=true` 后，数据库出现 `backend_strong_seed`。
7. 第二浏览器同房间通过 WebTorrent 播放，不走 HLS/DASH/原文件直链。

---

## 9. 成功标准

实现完成后，以下句子必须为真：

**用户选择媒体后，系统立即给出诚实的 pending / preparing / processing 反馈；图片仍统一 WebP，视频仍统一 WebTorrent 友好 MP4，source hash 仍负责秒传复用；Tus、complete 和服务器 strong seed 不再被无谓串行放大；服务器在 complete 后首轮就用权威 torrent bytes 和本地 localSeed 加入同一个 WebTorrent swarm。**

可验收指标：

1. 小图上传前的不可见等待有阶段日志可定位。
2. WebP 直通不会重编码。
3. 视频直通必须证明 fast-start 友好。
4. `complete` 首发 seed start 不再等后台对账才补 `torrentBytesBase64/localSeed`。
5. `backend_strong_seed` 仍只由 `torrent.done` 裁决。
6. domain/application/contract 没有被 sidecar runtime 或本地路径污染。

---

## 10. 自审记录

### 第一遍：需求意图

检查：用户要求聚焦源码性能，不要继续把锅推给外部网络；同时三条不变量不能被优化推翻。

修正点：文档明确拒绝原文件直传作为正式路径，保留 WebP、canonical MP4、服务器强 seed，只优化执行模型。

结论：通过。

### 第二遍：架构边界

检查：是否让 WebTorrent、Mediabunny、canvas、localSeed、本地路径污染 domain 或 contract。

修正点：第 3、7 节把所有协议和文件系统细节限制在 adapter/shell；contract 只保留稳定附件与分发 locator。

结论：通过。

### 第三遍：验证闭环

检查：是否覆盖前端预制、source hash 复用、complete、sidecar、本地真实烟测。

修正点：第 8 节补齐前端、Rust、Node、真实浏览器四层测试，并把 `done=true` strong seed 裁决写成硬验收。

结论：通过。

---

## 11. 100% 信心循环

问题：我对当前 spec 是否事实 100% 有信心？

第一轮回答：不是。风险是把“上传更快”误写成“跳过 WebP / MP4 canonical”。

修复：第 1、4、6、9 节明确 canonical 不变量不可动，优化只改等待方式、并发模型、可观测性和强种子首发 payload。

第二轮回答：不是。风险是把 source hash 当成可删优化，破坏秒传复用。

修复：第 5、6、8 节明确 source hash 必须保留，且基于原始文件；命中复用时短路 Tus。

第三轮回答：不是。风险是把 hardlink 或 localSeedReady 误当成强种子成立。

修复：第 5、6、8、9 节反复锁定：只有 sidecar WebTorrent runtime 的 `torrent.done === true` 才能写 `backend_strong_seed`。

第四轮回答：不是。风险是 spec 基于过期结论，忽略当前代码已经并行 hash 与预处理、已有 shared HTTP client、已有 localSeed helper。

修复：第 2 节写入当前源码事实：hash/preprocess 已并行，但 Tus 仍等待二者；localSeed helper 与对账增强已存在，但 complete 首发仍缺增强字段。

第五轮回答：现在有事实信心。该 spec 没有推翻项目核心格式和 WebTorrent 主链，只把下一步收敛到当前源码中仍可证明的热路径瘦颈：前端预制等待、视频 fast-start/内存风险、complete 状态同步、首发 strong seed payload。
