# 后端 WebTorrent 零延迟强种子群友设计

日期：2026-05-12
状态：Design / Ready for implementation plan
继承：`docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`
关联：

- `docs/superpowers/plans/2026-05-12-后端WebTorrent强种子生产化闭环.md`
- `src/外壳/协作分发做种.rs`
- `src/媒体/协作分发/共享语义.rs`
- `src/媒体/协作分发/适配.rs`
- `src/外壳/mod.rs`
- `frontend/dev-seeder.mjs`
- `frontend/package.json`

---

## 1. 结论

当前代码已经让后端具备“最终成为 WebTorrent 强种子群友”的框架：

1. Rust 生成权威 `.torrent` 元信息。
2. Rust 暴露 WebTorrent 内部可用的 `webSeedUrl`。
3. Node sidecar 用 `webtorrent ^2.8.5` 加入 swarm。
4. Rust 只在 sidecar 返回 `torrent.done === true` 后写 `backend_strong_seed` presence。

但它还不是“上传完成瞬间就在群里互帮互助”的强种子。

根因是 sidecar 当前通过 `client.add(torrentUrl, { urlList: [webSeedUrl] })` 启动，它必须先从 Rust HTTP WebSeed 把完整文件下载到 WebTorrent store，再变成完整 seed。

```text
当前：
Rust attachment_store 已有 canonical bytes
  -> sidecar client.add(torrentUrl, { urlList: [webSeedUrl] })
  -> sidecar 通过 HTTP WebSeed 下载同一份 bytes
  -> WebTorrent 校验完成
  -> torrent.done = true
  -> Rust 写 backend_strong_seed presence
```

这条链路说真话，但慢。200MB 视频会把“后端强群友入群”延迟到秒级甚至更久。

本设计选择：**继续复用成熟 WebTorrent，不手搓 WebRTC / BitTorrent 协议；用 Rust 权威 torrent bytes + 本地硬链接 staging，让 sidecar 的 `client.add()` 直接校验本机已有文件，消除 HTTP 重下载。**

```text
目标：
Rust attachment_store 已有 canonical bytes
  -> Rust 下发权威 torrent bytes + 本地 seed hint
  -> sidecar 按 WebTorrent 实测 store 布局建立硬链接：torrent 内部文件名 -> canonical{ext}
  -> sidecar client.add(torrentBytes, { path: characterized staging root, announce, urlList })
  -> WebTorrent 校验本地已有文件
  -> torrent.done = true
  -> Rust 写 backend_strong_seed presence
  -> 浏览器群友只通过 WebTorrent swarm 收 bytes
```

这不是绕过 WebTorrent。硬链接只是在后端和 sidecar 同机部署时，把本地对象存储文件接入 WebTorrent store。对浏览器、房间、消息、播放器来说，正式媒体字节仍只来自 WebTorrent whole-file swarm；`webSeedUrl` 仍只是 WebTorrent BEP19 内部 bootstrap 源，不是前端直链主链。

---

## 2. 已验证事实

### 2.1 当前代码事实

GitNexus 和文件精读确认：

1. `src/外壳/协作分发做种.rs` 的 `执行一次协作分发做种对账` 会拉取待做种附件，构造 sidecar start payload，并只在 `/seed/start` 返回 `done: true` 时写 `backend_strong_seed`。
2. `frontend/dev-seeder.mjs` 的 `启动做种会话` 使用 `client.add(source, options)`，当前 source 优先是 `torrentUrl`，并把 `webSeedUrl` 放进 `urlList`。
3. `src/媒体/协作分发/共享语义.rs` 的 `生成附件torrent元信息` 固定 torrent 内部文件名为 `content-{content_hash}{稳定扩展名}`。
4. canonical 本地对象 key 是 `media-assets/{content_hash}/canonical{extension}`，由 `构造canonical内容寻址存储键` 生成。
5. 本地对象存储由 `object_store::local::LocalFileSystem::new_with_prefix(attachment_storage_dir)` 管理；S3 模式没有本地文件路径。
6. `frontend/package.json` 使用 `webtorrent ^2.8.5`，`node-datachannel` 在 `pnpm.onlyBuiltDependencies` 中，Node sidecar 已具备 WebRTC 能力。

### 2.2 WebTorrent 官方能力

WebTorrent 官方 API 支持：

1. `client.add(torrentId, opts, callback)` 接收 `.torrent` bytes、magnet、URL 等 torrent id。
2. Node 端 `client.add` 支持 `path` 选项，表示 torrent 文件保存/查找目录。
3. `urlList` / `torrent.addWebSeed(url)` 是 WebTorrent 对 BEP19 WebSeed 的支持。
4. `torrent.done` 是 torrent 完整下载并可作为完整 seed 的运行时事实。
5. `wire.type` 可区分 `webrtc`、`webSeed`、TCP/uTP 等连接类型。

因此最小正确优化不是 `client.seed(filePath)`，而是 `client.add(权威torrentBytes, { path: stagingRoot })`。

关键约束：WebTorrent 官方文档只承诺 `path` 是 Node 端保存目录，没有明确单文件 torrent 复用已有文件时的精确磁盘布局。实现前必须先用 `webtorrent ^2.8.5` 写 characterization 测试，观察同一 torrent 在本项目配置下实际查找的文件路径。下文的 `staging/<infoHash>/<torrentFileName>` 表示逻辑 staging 根，不是允许无测试硬编码的最终布局。

### 2.3 轮子裁决

纯 Rust WebTorrent seeder 目前没有成熟现成轮子。可复用的 Rust 组件只覆盖局部：

| 组件 | 能力 | 不足 |
|---|---|---|
| `aquatic_ws_protocol` | WebTorrent tracker WebSocket 消息结构 | 不是 WebTorrent peer/seeder |
| `datachannel-rs` | WebRTC DataChannel 绑定 | 不含 BitTorrent wire protocol |
| `rqbit` | Rust BitTorrent 客户端 | 不支持浏览器 WebTorrent WebRTC peer |

手搓纯 Rust seeder 等于自研 tracker signaling、WebRTC peer 生命周期、BitTorrent wire protocol、piece 调度、浏览器兼容测试。它会重复造 WebTorrent 生态已经打磨过的轮子。

本项目的正确复用方式是：**业务真相、torrent 元信息、对象存储 owner 仍在 Rust；WebTorrent 协议执行继续交给 `webtorrent` runtime。**

---

## 3. 目标

把后端从“sidecar eventually 变成 seed”提升为“本地部署下上传完成后几乎立即成为 WebTorrent 强种子群友”。

完成后必须满足：

1. 浏览器正式媒体字节仍只走 WebTorrent whole-file swarm。
2. 不新增 HLS、DASH、原文件直链、CDN、range 静态预览作为第二主链。
3. 不用 `client.seed()` 重新生成 torrent，避免 infoHash 分叉。
4. 不手搓 WebTorrent / WebRTC / BitTorrent 协议。
5. Rust 继续是 torrent bytes 和对象存储事实 owner。
6. sidecar 继续是 WebTorrent runtime 事实 owner。
7. 只有 `torrent.done === true` 才能写 `backend_strong_seed`。
8. 本地硬链接失败时说真话：降级到现有 WebSeed 下载路径，不伪造强种子。
9. S3 对象存储模式不伪造本地路径，不破坏对象存储边界。

---

## 4. 非目标

1. 不改 domain/application 的媒体业务语义。
2. 不把本地文件路径放进 room event、locator、frontend contract。
3. 不把 sidecar runtime 字段暴露给业务 contract。
4. 不把 WebSeed 变成前端播放直链。
5. 不重命名 canonical 存储主链来迎合 `client.seed()`。
6. 不引入纯 Rust WebTorrent seeder 自研协议栈。
7. 不在 S3 模式下假装可以硬链接。
8. 不用复制完整大文件作为默认优化路径。
9. 不用 sleep 或盲目延长 retry 掩盖 readiness 事实。
10. 不做 BEP16 super-seeding 自研调度；WebTorrent 没有稳定公开开关，本轮只确保强种子尽早完整入群。

---

## 5. 方案比较

### 5.1 方案 A：`client.seed(filePath)`

优势：

- WebTorrent 官方直接做种 API。
- 理论上不需要先下载。

失败点：

- `client.seed()` 会用 JS `create-torrent` 重新生成 metainfo。
- 本地文件名是 `canonical{ext}`，Rust torrent 内部文件名是 `content-{content_hash}{ext}`。
- 文件名、piece length、private flag、bencode 细节任一不同，infoHash 都会不同。
- infoHash 不同就不是同一个 swarm，浏览器群友找不到后端这个 peer。

裁决：拒绝。

### 5.2 方案 B：纯 Rust WebTorrent seeder

优势：

- 架构看起来最纯。
- 后端可以直接从对象存储读 piece。

失败点：

- 没有成熟 Rust WebTorrent peer/seeder 轮子。
- 需要自研 WebTorrent tracker signaling + WebRTC DataChannel + BitTorrent wire protocol。
- 浏览器兼容和协议维护成本高。
- 与“基础设施默认复用成熟方案”冲突。

裁决：拒绝当前落地，保留为远期生态成熟后的替换方向。

### 5.3 方案 C：Rust torrent bytes + sidecar 硬链接 staging + `client.add()`

优势：

- 不重新生成 torrent，infoHash 由 Rust 权威 bytes 保证。
- 不复制媒体文件，硬链接是同卷 O(1) 元数据操作。
- WebTorrent runtime 仍负责校验、tracker、WebRTC、piece 上传。
- 浏览器仍只看到 WebTorrent peer。
- 失败可安全降级到现有 WebSeed 路径。

代价：

- 只在本地对象存储模式可用。
- NTFS/文件系统硬链接要求源文件和 staging 目录在同一卷。
- `torrent.done` 仍需等待 WebTorrent 对已有文件做 piece verification；这是磁盘顺序读，不再是 HTTP 重下载。

裁决：选中。

---

## 6. 新数据流

### 6.1 当前链路

```text
upload complete
  -> Rust writes canonical bytes to attachment_store
  -> Rust writes torrent_bytes / torrent_info_hash
  -> Rust POST /seed/start {
       infoHash,
       torrentUrl,
       webSeedUrl,
       announceUrls,
       joinTicket
     }
  -> sidecar client.add(torrentUrl, { urlList: [webSeedUrl] })
  -> sidecar downloads bytes from Rust WebSeed
  -> torrent.done true
  -> Rust writes backend_strong_seed presence
```

瓶颈：sidecar 明明和 Rust 在同一台机器，却通过 HTTP 重新下载完整文件。

### 6.2 目标链路

```text
upload complete
  -> Rust writes canonical bytes to attachment_store
  -> Rust writes torrent_bytes / torrent_info_hash
  -> Rust resolves local seed hint when storage driver is local
  -> Rust POST /seed/start {
       infoHash,
       torrentBytesBase64,
       torrentUrl,
       webSeedUrl,
       announceUrls,
       joinTicket,
       localSeed: {
         strategy: "hardlink",
         rootPath,
         stagingRoot,
         canonicalFilePath,
         torrentFileName
       }
     }
  -> sidecar validates canonicalFilePath is under rootPath
  -> sidecar hardlinks canonicalFilePath to WebTorrent 实测需要的 staging 目标路径
  -> sidecar client.add(torrentBytes, {
       path: staging root verified by characterization test,
       announce,
       urlList: [webSeedUrl],
       getAnnounceOpts
     })
  -> WebTorrent verifies existing file
  -> torrent.done true
  -> Rust writes backend_strong_seed presence
  -> browsers receive pieces from WebTorrent swarm
```

`urlList` 保留为 WebTorrent BEP19 内部兜底：硬链接失败、文件被清理、校验未完成时，sidecar 仍能通过 WebTorrent 自身的 web seed 机制补齐。它不是前端正式播放直链。

`stagingRoot` 默认由 Rust 设置为 `attachment_storage_dir/.swarm-seeder-staging`，保证和 canonical 文件同卷，避免 NTFS/文件系统硬链接跨卷失败。运维显式设置 `SWARM_SEEDER_STAGING_DIR` 时，Rust 必须检查它仍在同一存储根或接受 `EXDEV` fallback，不得把跨卷 fallback 说成零延迟。

### 6.3 S3 模式链路

```text
MEDIA_STORAGE_DRIVER=s3
  -> Rust cannot produce canonicalFilePath
  -> localSeed omitted
  -> sidecar uses existing client.add(torrentBytes/torrentUrl, { urlList })
  -> only after torrent.done true write backend_strong_seed
```

S3 模式不伪造零延迟。后续如果需要 S3 零下载延迟，应单独设计 object-store-backed WebTorrent store，而不是把 S3 临时下载成第二套媒体主链。

---

## 7. 控制面契约

### 7.1 Rust -> sidecar `/seed/start`

新增字段只属于 shell / adapter 控制面，不进入前端 contract。

```json
{
  "infoHash": "40hex",
  "announceUrls": ["ws://127.0.0.1:8080/api/swarm/announce"],
  "webSeedUrl": "http://127.0.0.1:8080/api/attachments/.../content?...",
  "torrentUrl": "http://127.0.0.1:8080/api/media/.../torrent?...",
  "torrentBytesBase64": "...",
  "joinTicket": "redacted-runtime-token",
  "readinessWaitMs": 1500,
  "localSeed": {
    "strategy": "hardlink",
    "rootPath": "E:\\koko\\data\\attachments",
    "stagingRoot": "E:\\koko\\data\\attachments\\.swarm-seeder-staging",
    "canonicalFilePath": "E:\\koko\\data\\attachments\\media-assets\\<hash>\\canonical.mp4",
    "torrentFileName": "content-<hash>.mp4"
  }
}
```

字段规则：

1. `torrentBytesBase64` 优先于 `torrentUrl`，保证 sidecar 使用 Rust 权威 metainfo。
2. `torrentUrl` 保留为诊断和 fallback 入口，不作为零延迟主路径。
3. `localSeed` 只在 `MEDIA_STORAGE_DRIVER=local` 且 canonical 文件路径可证明存在时下发。
4. `stagingRoot` 默认在 `rootPath/.swarm-seeder-staging`，保证硬链接同卷；显式覆盖时必须接受跨卷 fallback。
5. `rootPath`、`stagingRoot` 和 `canonicalFilePath` 仅在 loopback 控制面传输，日志必须脱敏或只打印相对路径。
6. `readinessWaitMs` 是 sidecar 等待本地验证完成的短预算，不是写 presence 的替代事实。
7. `torrentFileName` 是 torrent 内部单文件名，不等于最终磁盘路径；最终硬链接目标必须由 WebTorrent store layout characterization 测试锁定。

### 7.2 sidecar -> Rust `/seed/start` 响应

```json
{
  "ok": true,
  "created": true,
  "refreshedTicket": false,
  "sourceChanged": false,
  "infoHash": "40hex",
  "done": true,
  "progress": 1,
  "capability": "hybrid",
  "activeCount": 1,
  "localSeedMode": "hardlink",
  "localSeedReady": true,
  "localSeedFallbackReason": null
}
```

响应规则：

1. `done` 仍只读 `session.torrent.done`。
2. `localSeedReady` 只能表示 staging 已准备好，不能替代 `done`。
3. `localSeedMode` 可为 `hardlink`、`unavailable`、`fallback_webseed`。
4. `localSeedFallbackReason` 只能记录非敏感枚举，例如 `missing_local_seed`、`cross_device_link`、`unsupported_storage_driver`、`hardlink_failed`。
5. Rust 仍只按 `done == true` 写 `backend_strong_seed`。

### 7.3 `/seed/status`

上一版 spec 已提出 status endpoint。本设计保留并明确用途：

```json
{
  "ok": true,
  "found": true,
  "infoHash": "40hex",
  "done": true,
  "progress": 1,
  "capability": "hybrid",
  "numPeers": 12,
  "uploaded": 104857600,
  "downloaded": 0,
  "localSeedMode": "hardlink",
  "localSeedReady": true
}
```

`/seed/start` 可以短等本地 verification；超过预算仍返回 not ready。Rust 后续通过 reconcile 或 `/seed/status` 观察真实 `done`，不得因为 `localSeedReady` 提前写 presence。

---

## 8. 文件与职责边界

### 8.1 Rust shell：`src/外壳/协作分发做种.rs`

新增职责：

1. 从待做种项拿到 canonical storage key、torrent bytes、torrent file name 所需事实。
2. 在本地存储模式下构造 `localSeed` 控制面 hint。
3. 把 `torrentBytesBase64` 下发给 sidecar，避免 sidecar 再 HTTP 拉 `.torrent`。
4. 继续按 `done` 门控 presence。

禁止职责：

1. Rust 不判断 WebTorrent 是否真的已入群。
2. Rust 不把 `localSeedReady` 当 strong seed。
3. Rust 不把本地路径放进业务 contract。

### 8.2 Rust media adapter：`src/媒体/协作分发/适配.rs`

新增或调整待做种查询输出：

1. 继续筛选 ready、未删除、未过期、torrent 元信息完整的附件。
2. 增加 `torrent_bytes` 到 `待做种协作分发项`，避免 sidecar 再拉 torrent URL。
3. 增加 canonical `storage_key` 或足够构造本地 canonical path 的字段。
4. 不在 adapter 里拼绝对本地路径；绝对路径属于 shell 运行态。

### 8.3 Rust shared semantics：`src/媒体/协作分发/共享语义.rs`

新增纯函数能力：

1. 从 `content_hash` 和 canonical storage key 推导 `torrentFileName`。
2. 或从 metainfo 诊断中提取单文件 torrent 的内部文件名。
3. 测试必须证明该文件名与 `生成附件torrent元信息` 保持一致。

优先策略：复用 `生成附件torrent元信息` 的命名规则 `content-{content_hash}{稳定扩展名}`，并用测试锁住 storage key 扩展名与 torrent file name 的对应关系。

### 8.4 Node sidecar：`frontend/dev-seeder.mjs`

新增职责：

1. 接收 `torrentBytesBase64`，用 Buffer 作为 `client.add` source。
2. 接收 `localSeed`，在 staging 目录准备硬链接。
3. 对 `canonicalFilePath` 做 root containment 校验。
4. 先用实测 store layout builder 准备目标路径，再执行 `client.add(torrentBytes, { path: stagingRoot, announce, urlList, getAnnounceOpts })`。
5. 短等 `torrent.done` 或 `done` event，返回最新 snapshot。
6. `/seed/reconcile` 停止会话时销毁 WebTorrent session 并清理 staging 目录。
7. 通过 `SWARM_SEEDER_MAX_CONNS` 配置 WebTorrent client 连接预算。

禁止职责：

1. 不用 `create-torrent` 重新生成 metainfo。
2. 不把 hardlink 文件直接 HTTP 暴露给浏览器。
3. 不在路径校验失败时继续链接任意文件。
4. 不用复制大文件作为默认 fallback。

### 8.5 `frontend/package.json`

若 sidecar 需要解析 torrent bytes，优先避免新增依赖，由 Rust 下发 `torrentFileName`。如果实现阶段证明必须解析 `.torrent`，只能新增稳定、直接依赖，并在计划里写明 API 和测试。不得依赖 `webtorrent` 的传递依赖。

---

## 9. 安全边界

### 9.1 路径校验

sidecar 处理 `localSeed` 前必须做：

```text
realRoot = realpath(localSeed.rootPath)
realFile = realpath(localSeed.canonicalFilePath)
require realFile starts with realRoot + path separator
require torrentFileName is basename only, no slash, no backslash, no drive prefix
stagingRoot = realpath-or-create(localSeed.stagingRoot)
require stagingRoot starts with realRoot + path separator
stagingDir = realpath-or-create(stagingRoot/infoHash)
linkTarget = build_link_target_from_characterized_webtorrent_layout(stagingDir, torrentFileName)
require linkTarget remains under stagingDir
```

路径校验失败是控制面错误，应返回非 2xx 或明确 `localSeedMode=unavailable`，不得继续对任意路径执行 hardlink。

### 9.2 日志脱敏

日志允许：

- `infoHash`
- `attachment_id`
- `localSeedMode`
- `fallbackReason`
- storage key 相对路径

日志禁止：

- 完整 `joinTicket`
- 绝对用户隐私目录
- 原始媒体文件名中的用户隐私部分
- 对象存储密钥
- 原始媒体字节

### 9.3 控制面可达性

`/seed/start` 仍应绑定在本机控制面，生产部署不应公网暴露 sidecar 控制端口。即使控制面只在本机，sidecar 也必须做路径 containment，因为路径操作一旦写错会直接触碰文件系统。

---

## 10. 生命周期与清理

### 10.1 创建

```text
start(infoHash)
  -> normalize infoHash
  -> existing session? refresh ticket and source only
  -> prepare local staging if localSeed present
  -> client.add(torrentBytes, { path: characterized staging root, ... })
  -> bind warning/error/done logs
  -> wait readinessWaitMs for torrent.done
  -> return snapshot
```

同 infoHash 只允许一个 session。重复 start 是续租，不是第二条做种真相。

### 10.2 停止

```text
reconcile(activeInfoHashes)
  -> infoHash not active
  -> torrent.destroy()
  -> remove activeSessions entry
  -> remove staging/<infoHash>
```

staging 目录只包含 sidecar 自己创建的硬链接。删除 staging 链接不会删除 canonical 对象；它只减少一个目录项引用。

### 10.3 24 小时窗口

`列出待做种协作分发项` 已按 `web_seed_until > now` 筛选。过期后 reconcile 不再把 infoHash 放进 active list，sidecar 必须停掉 session 并清理 staging。

如果 canonical 冷源清理先删了原始路径，但 sidecar staging hardlink 仍存在，数据最多保留到下一轮 reconcile 清理。这个短窗口属于 sidecar active session 生命周期，不得被前端当成新的冷源直链。

---

## 11. 性能约束

1. 不读取完整媒体文件到 JS 内存。
2. 不复制完整媒体文件作为默认路径。
3. `torrentBytesBase64` 可接受，因为 `.torrent` 体积远小于媒体字节。
4. hardlink 是 O(1) 元数据操作；真正成本是 WebTorrent 对已有文件的 piece verification。
5. piece verification 是本地磁盘顺序读，不能被说成 `done` 已经成立；最终事实仍是 `torrent.done`。
6. sidecar WebTorrent client 必须支持 `SWARM_SEEDER_MAX_CONNS`，避免默认连接数在万人群里成为强种子瓶颈。
7. `readinessWaitMs` 默认 1500ms；超时不阻塞上传 ready，不写强种子 presence，交给 reconcile 继续观察。
8. Rust sidecar HTTP client 仍应复用连接池，避免每个 start/reconcile 新建 client。

### 11.1 推荐初始参数

| 参数 | 默认 | 说明 |
|---|---:|---|
| `SWARM_SEEDER_STAGING_DIR` | `<attachment_storage_dir>/.swarm-seeder-staging` | sidecar staging root，默认同卷 |
| `SWARM_SEEDER_MAX_CONNS` | `512` | WebTorrent client 最大连接数，生产按机器调优 |
| `readinessWaitMs` | `1500` | 本地 hardlink verification 短等预算 |
| reconcile batch limit | `256` | 当前已有值，后续按压力测调优 |

这些是第一版生产参数，不是永恒真理。上线后应通过 `uploaded`、`numPeers`、ready 延迟和 CPU/磁盘读指标调优。

---

## 12. 测试规格

### 12.1 Rust 纯函数测试

必须覆盖：

1. `media-assets/{hash}/canonical.mp4` 推导 `content-{hash}.mp4`。
2. `media-assets/{hash}/canonical.webp` 推导 `content-{hash}.webp`。
3. 非 canonical storage key 不生成 local seed hint。
4. 空扩展名或不合法扩展名不生成 local seed hint。
5. S3 存储驱动不生成 local seed hint。
6. torrent file name 与 `生成附件torrent元信息` 的内部文件名规则一致。

### 12.2 Rust 集成测试

扩展 `tests/协作分发测试/可用性裁决_做种对账.rs`：

1. 本地存储模式下 `/seed/start` payload 包含 `torrentBytesBase64` 和 `localSeed.strategy=hardlink`。
2. local seed hint 包含的 path 只来自 `attachment_storage_dir + canonical storage_key`。
3. sidecar 返回 `done:false, localSeedReady:true` 时不写 `backend_strong_seed`。
4. sidecar 返回 `done:true, localSeedMode:hardlink` 时写 `backend_strong_seed`。
5. S3 模式下 payload 不包含 `localSeed`，但仍包含 `torrentBytesBase64` 或保留 `torrentUrl` fallback。
6. 多个待做种项中一个 localSeed 构造失败，不阻塞其他 ready 项。

### 12.3 Node / Vitest 测试

新增或扩展 sidecar 测试：

1. `torrentBytesBase64` 存在时，`client.add` source 是 Buffer，不是 `torrentUrl`。
2. WebTorrent ^2.8.5 characterization：给定单文件 torrent bytes、预置硬链接文件、`client.add(..., { path })` 后无需 HTTP WebSeed 完整下载即可进入 `done:true`。
3. characterization 测试必须输出并锁定当前 WebTorrent store 实际读取的 staging 路径；实现代码只能复用该 builder。
4. `localSeed.strategy=hardlink` 时，sidecar 在 characterization 锁定的目标路径创建 `torrentFileName` 硬链接。
5. `canonicalFilePath` 不在 `rootPath` 下时拒绝，不执行 hardlink。
6. `torrentFileName` 含路径分隔符时拒绝。
7. `fs.link` 返回 `EXDEV` 时降级到 WebSeed fallback，响应 `localSeedMode=fallback_webseed`。
8. `fs.link` 返回权限或路径安全错误时不静默伪造 ready。
9. 重复 start 同 infoHash 只刷新 ticket，不新建 staging 目录。
10. `/seed/reconcile` 移除 infoHash 时销毁 torrent 并清理 staging。
11. `readinessWaitMs` 内收到 `done` event 时 `/seed/start` 返回 `done:true`。
12. `readinessWaitMs` 超时但未 done 时返回 `done:false`。

### 12.4 启动脚本 / 依赖检查

必须覆盖：

1. `frontend/package.json` 中 `webtorrent` 仍是显式运行依赖。
2. `node-datachannel` 仍在 `pnpm.onlyBuiltDependencies`。
3. `run.ps1` 或 sidecar 启动环境提供 staging dir 默认值；默认值必须落在 `attachment_storage_dir/.swarm-seeder-staging`。
4. 生产默认不启用 mock seeder。

### 12.5 真实烟测

必须使用真实 MP4、真实 room、真实浏览器链路：

1. `run.ps1` 启动完整栈。
2. seeder `/health` 显示 `capability=hybrid`。
3. 上传 MP4 后，sidecar `/seed/start` 或 `/seed/status` 显示 `localSeedMode=hardlink`。
4. 同一 infoHash 在短时间内 `done=true`、`progress=1`。
5. 数据库 `swarm_peer_presence` 出现 `backend_strong_seed`。
6. 第二个浏览器进入同房间能通过 WebTorrent 播放。
7. 不出现前端使用原文件直链、HLS、DASH 或 CDN 的正式播放路径。
8. 过期或 reconcile 移除后，sidecar session 和 staging 目录被清理。

---

## 13. 失败模式与处理

| 失败模式 | 处理 |
|---|---|
| `localSeed` 缺失 | 使用现有 WebSeed fallback；不写 presence 直到 `done` |
| 本地文件不存在 | 返回 degraded；不写 presence；reconcile 重试 |
| 路径不在 root 下 | 安全拒绝；不 hardlink；不写 presence |
| 硬链接跨卷 `EXDEV` | 降级 WebSeed fallback；记录 `cross_device_link` |
| 硬链接权限错误 | 返回 degraded；不写 presence |
| staging 已有旧文件 | 只允许删除 staging 内同名旧链接后重建；不得触碰 canonical |
| WebTorrent 校验失败 | `done=false`；不写 presence；保留错误日志 |
| `torrentBytesBase64` 与 `infoHash` 不匹配 | sidecar 或 Rust 诊断拒绝；不写 presence |
| sidecar crash | Rust 记录 unavailable；reconcile 重试 |
| 24h 到期 | active list 移除；sidecar stop；清理 staging |

任何失败都不能让系统把 `backend_strong_seed` 写成真。

---

## 14. 观测指标

必须能回答：

1. 一个附件是否进入 local hardlink 路径。
2. hardlink 准备耗时。
3. `client.add` 到 `torrent.done` 耗时。
4. fallback 原因是什么。
5. sidecar 当前活跃 session 数。
6. 每个 session 的 `progress`、`done`、`numPeers`、`uploaded`。
7. Rust 写入 `backend_strong_seed` 的延迟。
8. reconcile 清理了多少 staging session。

建议日志字段：

```text
application="协作分发做种"
adapter="sidecar" | "shell"
attachment_id
info_hash
local_seed_mode
local_seed_ready
fallback_reason
progress
done
num_peers
verify_elapsed_ms
```

---

## 15. 与上一版设计的关系

上一版设计已经修正“HTTP 200 被当成强种子事实”的 owner 错误。本设计不推翻它，只优化 sidecar 达到 `torrent.done` 的路径。

```text
上一版：
  事实门控：只有 torrent.done 才写 backend_strong_seed

本版：
  达成路径：让 sidecar 不再通过 HTTP 重下载已有 canonical bytes，而是从本地硬链接 staging 进入 WebTorrent store
```

因此本设计的底线不变：

**hardlink 成功不等于强种子，`localSeedReady` 不等于强种子，只有 WebTorrent runtime 的 `torrent.done` 才等于完整 seed。**

---

## 16. 成功标准

实现完成后，下面句子必须为真：

**本地对象存储模式下，后端上传完成后，sidecar 使用 Rust 权威 torrent bytes 和本地 hardlink staging 加入同一个 WebTorrent swarm；浏览器仍只通过 WebTorrent 获取媒体字节；Rust 仍只在 `torrent.done` 为真时写 `backend_strong_seed`。**

可验收指标：

1. 同一个 MP4 上传后，sidecar 不需要通过 HTTP WebSeed 完整重下载即可进入 `done=true`。
2. `infoHash` 与 Rust 生成的 `torrent_info_hash` 完全一致。
3. 数据库 presence 只在 `done=true` 后出现。
4. 真实双浏览器播放链路不依赖非 WebTorrent 正式字节路径。
5. S3 模式不会下发假的本地路径。
6. 硬链接失败会降级但不说谎。

---

## 17. 自审记录

### 第一遍：需求意图

检查：用户要求公网万人实时多人多群 IM，服务器后端也要作为强而有力的 WebTorrent 群友，且禁止绕过 WebTorrent。

修正点：文档明确 hardlink 不是浏览器媒体路径，只是 sidecar WebTorrent store 的本地接入方式；浏览器仍只走 WebTorrent whole-file swarm。

结论：通过。

### 第二遍：架构边界

检查：是否把本地路径、sidecar runtime、WebTorrent 字段泄漏进 domain/application/contract。

修正点：把所有新增字段限定在 Rust shell -> sidecar 控制面；明确 `localSeed` 不进入 room event、locator、frontend contract；S3 模式不伪造本地路径。

结论：通过。

### 第三遍：验证闭环

检查：是否覆盖 happy path、降级、安全、清理、真实浏览器体验。

修正点：补齐 Rust 纯函数、Rust 集成、Node/Vitest、启动脚本、真实双浏览器烟测；加入路径 containment、EXDEV、staging 清理和 24h 到期测试。

结论：通过。

---

## 18. 100% 信心循环

问题：我对当前设计是否事实 100% 有信心？

第一轮回答：不是。风险是把 hardlink 成功误当成强种子成立。

修复：第 7、13、15 节明确 `localSeedReady` 不能写 presence；唯一门控仍是 `torrent.done`。

第二轮回答：不是。风险是 S3 模式被本地优化污染，出现不存在的 local path 或临时下载第二主链。

修复：第 6.3、8.1、12.2、16 节明确 S3 不下发 `localSeed`，只保留 WebTorrent BEP19 fallback；S3 零下载需要另开 object-store-backed WebTorrent store 设计。

第三轮回答：不是。风险是 sidecar 硬链接被路径穿越滥用，触碰任意文件。

修复：第 9 节加入 `realpath(root)` containment、basename 校验、staging containment，路径失败必须拒绝或降级，禁止继续 hardlink。

第四轮回答：不是。风险是“零延迟”被过度宣传成无需等待 `done`，而 WebTorrent 仍要校验已有文件。

修复：第 11 节明确 hardlink 消除 HTTP 重下载，不消除 piece verification；`readinessWaitMs` 超时仍返回 `done=false`，reconcile 继续观察。

第五轮回答：不是。风险是 WebTorrent `path` 的实际文件布局被猜错，导致硬链接放错位置，sidecar 仍然走 WebSeed 下载。

修复：第 2、7、8、9、10、12 节明确实现前必须先用 `webtorrent ^2.8.5` characterization 测试锁定 store layout；spec 中的 staging 只表示逻辑根，不允许无测试硬编码最终路径。

第六轮回答：不是。风险是 staging 目录默认落到不同卷，NTFS/文件系统硬链接直接 `EXDEV`，零延迟路径在生产默认失败。

修复：第 6、7、9、11、12 节明确 `stagingRoot` 默认由 Rust 设置到 `attachment_storage_dir/.swarm-seeder-staging`，保证同卷；显式覆盖时必须接受跨卷 fallback，不得把 fallback 说成零延迟。

第七轮回答：现在有事实信心。设计没有绕过 WebTorrent，没有自研协议栈，没有第二媒体主链；它只把同机已有 canonical bytes 以硬链接方式交给成熟 WebTorrent runtime 校验和上传，并保持 `torrent.done` 作为唯一强种子事实。
