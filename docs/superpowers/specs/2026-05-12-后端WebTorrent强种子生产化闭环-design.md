# 后端 WebTorrent 强种子生产化闭环设计

日期：2026-05-12
状态：Design / Ready for implementation plan
关联：

- `docs/superpowers/specs/2026-04-23-WebTorrent满血协同分发要求.md`
- `docs/superpowers/plans/2026-05-11-接收者媒体极限秒开修复.md`
- `src/外壳/协作分发做种.rs`
- `frontend/dev-seeder.mjs`

---

## 1. 根因裁决

当前后端强种子链路的根因不是“缺几个 guard / timeout / probe”，而是一个事实 owner 放错了：

**Rust shell 现在把 sidecar `/seed/start` 的 HTTP 成功响应，近似当成 `backend_strong_seed` 成立。**

这在逻辑上不成立。

`/seed/start` 成功只能说明：

1. Rust 成功把命令发到 sidecar。
2. sidecar 接受了启动请求。
3. sidecar 可能已经创建或复用了某个 WebTorrent 会话。

它不能证明：

1. sidecar 当前运行的是浏览器可连接的 `webtorrent-hybrid` 能力。
2. 该 infoHash 的 WebTorrent 会话已经拿到完整 canonical bytes。
3. 该会话已经以带 `join_ticket` 的身份进入受保护 tracker。
4. 浏览器 peer 当前能从这个后端 peer 获得 WebRTC 上传。

因此本次修复的第一原则是：

**`backend_strong_seed` 事实只能由 sidecar 内部 WebTorrent runtime 的实际会话状态产生；Rust 只消费这个事实并落库，不再用 HTTP ack 自己推断强种子成立。**

---

## 2. 总目标

把后端从“启动了一个可能会做种的 sidecar 会话”，进化为“在系统事实层只承认可证明的 WebTorrent 强种子”。

完成后必须满足：

1. 图片/视频附件仍只走唯一 WebTorrent whole-file swarm 主链。
2. 后端 0-24h 的强帮助只发生在 swarm 内，不新增 HTTP 正式字节主链。
3. `backend_strong_seed` presence 只在 sidecar 证明自己是完整 WebRTC seed 后写入。
4. complete、复用、转发、实时广播、周期对账共用同一个强种子确认语义。
5. 性能优化只服务于这个 owner 纠偏，不变成补丁堆。

---

## 3. 分层边界

### 3.1 domain / application

不引入 WebTorrent、HTTP、sidecar、tracker、reqwest、Node.js 概念。

内圈只继续认识稳定事实：

- attachment ready
- content_hash
- swarm_id
- torrent_info_hash
- web_seed_until秒
- peer / backend strong seed presence 类型

### 3.2 contract

不把 sidecar 内部状态暴露给房间事件或前端业务 contract。

`room_event` 可以携带 `distribution_hint` / locator 所需稳定分发线索，但不携带 sidecar runtime 字段，例如：

- `capability`
- `progress`
- `numPeers`
- `uploaded`
- `downloaded`
- sidecar 本地路径

### 3.3 shell / adapter

Rust shell 负责：

1. 从权威库读取待强种的附件。
2. 构造 sidecar 命令。
3. 调用 sidecar。
4. 读取 sidecar 返回的强种子事实。
5. 只有事实成立时写 `backend_strong_seed` presence。
6. 做 retry / reconcile / timeout / 限流 / 日志。

Node sidecar 负责：

1. 复用成熟 WebTorrent runtime。
2. 在生产模式下强制 `webtorrent-hybrid`。
3. 维护每个 infoHash 的真实会话状态。
4. 判断自己是否是完整 WebRTC seed。
5. 返回给 Rust 一个最小事实快照。

---

## 4. 权威状态模型

新增一层 shell 内部控制面语义，不进入 domain contract：

```text
SeedStartAccepted
  = sidecar 接受命令，但不代表强种子成立

BackendStrongSeedReady
  = sidecar 证明：
    capability == hybrid
    infoHash 匹配
    progress == 1
    hasJoinTicket == true
    tracker announce 已至少进入可用状态

BackendStrongSeedDegraded
  = sidecar 存在会话，但不满足强种子条件

BackendStrongSeedUnavailable
  = sidecar 不可达、超时、无会话或 WebTorrent runtime 不可用
```

Rust 只能把 `BackendStrongSeedReady` 写成 `协作分发存活类型后端强种子`。

其他状态只能写日志、指标、下一轮重试依据，不能伪装成 presence。

---

## 5. 数据流

### 5.1 当前错误链路

```text
complete / reuse / forward / realtime / reconcile
  -> Rust 构造 start 命令
  -> POST /seed/start
  -> HTTP 200
  -> Rust 写 backend_strong_seed presence
```

问题：`HTTP 200` 不是强种子事实。

### 5.2 修正后链路

```text
complete / reuse / forward / realtime / reconcile
  -> Rust 构造 start 命令
  -> POST /seed/start
  -> sidecar 创建/复用 WebTorrent 会话
  -> sidecar 返回 SeedSessionSnapshot
  -> Rust 归纳 BackendStrongSeedReady / Degraded / Unavailable
  -> 只有 Ready 写 backend_strong_seed presence
  -> 非 Ready 保留可观测错误并等待同 owner 重试
```

### 5.3 sidecar 会话事实来源

sidecar 的状态来自 WebTorrent torrent 实例，而不是 Rust 推断：

- `torrent.infoHash`
- `torrent.progress`
- `torrent.numPeers`
- `torrent.downloaded`
- `torrent.uploaded`
- `capability`
- `joinTicket`
- `wire` / tracker 连接观测

---

## 6. canonical bytes 与 WebSeed 边界

本项目当前 canonical bytes 由 Rust `attachment_store` 统一管理，可能是：

- `LocalFileSystem`
- `S3对象存储`

sidecar 不应绕开 Rust 对象存储直接读内部路径作为业务真相，因为这会把本地目录形态写死成强种子前提，并破坏 S3 模式。

因此生产级修复不把“直接读本地 canonical 文件”作为唯一方案。

正确边界是：

1. Rust 继续提供受控 `.torrent` 与 `web_seed_url` 控制面/冷启动源。
2. sidecar 通过 WebTorrent `client.add(..., { urlList })` 从同一 torrent/web seed 平面获取 canonical bytes。
3. sidecar 只有在 WebTorrent runtime 显示 `progress == 1` 后，才能报告 `BackendStrongSeedReady`。
4. `web_seed_url` 仍只是 WebTorrent 内部 WebSeed 来源，不被前端正式播放路径直接消费。

后续如果要优化本地部署，可增加“local object store 零拷贝 seed store”作为 sidecar adapter 优化，但必须保持 S3 模式同语义，不允许成为第二强种子真相。

---

## 7. 具体改动面

### 7.1 Rust：`src/外壳/协作分发做种.rs`

将当前 `尝试启动协作分发做种(...) -> io::Result<()>` 调整为返回 sidecar 事实：

```text
尝试启动协作分发做种(...) -> io::Result<后端强种子启动结果>
```

其中 `后端强种子启动结果` 是 shell 私有类型，表达：

- `info_hash`
- `capability`
- `ready`
- `progress`
- `has_join_ticket`
- `num_peers`
- `failure_reason`

Rust 归纳函数只做纯判断：

```text
sidecar snapshot -> 后端强种子裁决
```

裁决为 Ready 时，才调用 `写入协作分发swarm存活`。

### 7.2 Rust：`应用状态`

把 sidecar HTTP client 作为 shell 基础设施复用，而不是每次 `reqwest::Client::new()`。

这是性能修正，但它服务于同一个 owner：sidecar 控制面调用。

### 7.3 Rust：reconcile 执行策略

`执行一次协作分发做种对账` 仍是周期 owner，但内部不再串行放大延迟：

1. 一轮只读取一次 TURN/ICE 配置。
2. sidecar start 使用有限并发。
3. 每个 start 有明确超时。
4. 单个 infoHash 失败不阻塞整轮。
5. reconcile 回收仍以权威待强种集合为输入。

并发只是缩短同一 owner 的执行时间，不改变事实来源。

### 7.4 Node：`frontend/dev-seeder.mjs`

sidecar 要变成“WebTorrent 会话事实 owner”：

1. 生产模式强制 `webtorrent-hybrid`，不能静默降级 `webtorrent` 或 `mock`。
2. `mock` 只允许测试显式打开。
3. `/seed/start` 返回稳定 `SeedSessionSnapshot`。
4. `/seed/status` 返回同一结构，供 Rust readiness 查询。
5. 同 infoHash 的重复 start 只刷新 `joinTicket` 和 source 线索，不创建第二会话。
6. 会话 identity 只认归一化 `infoHash`。

### 7.5 `frontend/package.json`

把 `webtorrent-hybrid` 固化为 sidecar 运行依赖。

`node_modules` 中偶然存在不算生产保证；依赖文件必须表达运行事实。

---

## 8. 入口策略

### 8.1 complete 后

complete 成功落权威 ready / torrent / distribution metadata 后，可以短等待 sidecar 进入强种子 Ready。

约束：

1. 不在写库前启动 sidecar。
2. 不因短暂 sidecar 慢而回滚已成立的 attachment ready 真相。
3. 如果未 Ready，响应仍可返回 ready，但必须记录 `backend_strong_seed_degraded`，并由 reconcile 同一 owner 继续补齐。

理由：attachment ready 是媒体业务事实；backend strong seed 是分发能力事实，二者不能互相冒充。

### 8.2 realtime 广播前后

实时广播不能只因为 `/seed/start` ack 成功就认为强种子存在。

策略：

1. 广播前尽量读取当前 `backend_strong_seed` presence 或 sidecar status。
2. 如果已有 Ready，直接广播。
3. 如果未 Ready，触发同一强种子 owner 的确认流程，并在日志中显式记录竞态窗口。
4. 不在实时 handler 中复制第二套强种子判断逻辑。

是否把“未 Ready”升级为拒绝发布媒体消息，留给实施计划里的产品取舍门禁；本 spec 的底线是：**未 Ready 不得被写成 Ready。**

### 8.3 reconcile

reconcile 是最终收口 owner：

1. 拉取权威待强种附件。
2. 启动或刷新 sidecar 会话。
3. 只按 Ready 裁决写 presence。
4. 下发 activeInfoHashes 回收非权威会话。

---

## 9. 错误与恢复语义

### 9.1 不可用

sidecar 不可达、超时、返回非法 JSON、返回非 2xx：

- 不写 presence。
- 记录 `BackendStrongSeedUnavailable`。
- 下一轮 reconcile 重试。

### 9.2 降级

sidecar 返回：

- `capability != hybrid`
- `progress < 1`
- `hasJoinTicket == false`
- `infoHash` 不匹配

处理：

- 不写 presence。
- 记录 `BackendStrongSeedDegraded`。
- 对同 infoHash 继续复用会话和刷新 ticket。
- 不创建第二条做种路径。

### 9.3 票据轮换

ticket TTL 短于强 seed 窗口。

同 infoHash start 必须原地更新 ticket 引用，不能销毁重建会话，也不能继续 announce 旧 ticket。

### 9.4 退出

权威待强种集合不再包含某 infoHash 时：

- reconcile 下发 activeInfoHashes。
- sidecar 销毁不在集合内的会话。
- Rust 不再续写 backend strong seed presence。

---

## 10. TDD 验证规格

### 10.1 Rust 单测

新增纯函数测试：

1. `hybrid + progress=1 + hasJoinTicket=true + infoHash匹配` 才裁决 Ready。
2. `webtorrent` 能力不得裁决 Ready。
3. `mock` 能力不得裁决 Ready。
4. `progress < 1` 不得裁决 Ready。
5. `infoHash` 不匹配不写 presence。

### 10.2 Rust 集成测试

扩展 `tests/协作分发测试/可用性裁决_做种对账.rs`：

1. fake seeder 返回 Ready 时写入 backend strong seed presence。
2. fake seeder 返回 accepted but not ready 时不写 presence。
3. fake seeder hang 时本轮对账按超时退出，不永久卡住。
4. 多条待做种项中单条失败不阻塞其他 Ready 项写入。
5. reconcile 清单仍包含权威 active infoHash。

扩展 `tests/媒体上传测试/单文件主链.rs`：

1. complete 后 start payload 仍来自同一 runtime_distribution。
2. sidecar not ready 不影响 attachment ready 响应。
3. sidecar ready 时可观测到强种子确认成功。

### 10.3 Node / Vitest

新增或扩展 sidecar 测试：

1. 生产模式下无法加载 `webtorrent-hybrid` 时进程失败，不静默 mock。
2. 显式 `SWARM_SEEDER_FORCE_MOCK=1` 时只用于测试。
3. `/seed/start` 返回 `SeedSessionSnapshot`。
4. `/seed/status` 对存在和不存在 infoHash 返回稳定结构。
5. 同 infoHash 重复 start 刷新 ticket，不新建第二会话。

### 10.4 脚本检查

扩展 `tests/启动器脚本检查.ps1`：

1. `package.json` 显式声明 `webtorrent-hybrid`。
2. 启动脚本不允许生产默认 mock seeder。
3. health 输出必须能暴露 capability 和 active sessions。

### 10.5 真实烟测

同链路烟测必须证明：

1. 启动后 seeder health 显示 `capability=hybrid`。
2. 上传视频 complete 后，对应 infoHash 的 sidecar status 最终 Ready。
3. 两个浏览器同房间时，接收端从 WebTorrent swarm 进入播放链。
4. 24h 窗口内 backend strong seed presence 存在；窗口过期后 reconcile 不续写。

---

## 11. 性能约束

1. sidecar HTTP client 复用连接池。
2. 每个 sidecar HTTP 调用有硬超时。
3. reconcile 批量 start 使用有限并发，默认并发上限先取 `16`。
4. 一轮 reconcile 不重复读取 TURN/ICE 配置。
5. 不在 async 热路径做阻塞文件 IO。
6. 不为了并发引入全局大锁。

---

## 12. 可观测性

日志必须能回答：

1. 哪个 attachment / infoHash 被要求强种。
2. sidecar 返回的 capability / progress / ready 是什么。
3. 为什么没有写 backend strong seed presence。
4. 是 complete、reuse、forward、realtime 还是 reconcile 触发的确认。
5. reconcile 本轮成功、降级、失败、回收了多少。

日志不得输出：

- 完整 join_ticket
- 用户隐私内容
- 原始媒体字节
- 对象存储密钥

---

## 13. 非目标

1. 不手搓 WebTorrent、WebRTC、BitTorrent tracker。
2. 不新增 HLS / DASH / CDN / range / 原文件直链作为正式媒体字节主链。
3. 不把 sidecar runtime 字段放进前端共享 contract。
4. 不把 tracker join_ticket 校验搬进 sidecar。
5. 不为了本地目录优化破坏 S3 对象存储语义。
6. 不新增第二个强种子服务或第二套 seeder owner。
7. 不用 sleep、扩大重试次数、盲目延长等待来掩盖 owner 错位。

---

## 14. 实施顺序

1. 先写 Rust 裁决纯函数测试，锁定“什么才叫强种子”。
2. 实现 shell 私有裁决类型，不碰 domain / contract。
3. 扩展 fake seeder 测试，让 accepted-but-not-ready 先失败。
4. 修改 `尝试启动协作分发做种` 返回事实快照。
5. 修改 reconcile 只按 Ready 写 presence。
6. 再做 reqwest client 复用、timeout、ICE 复用、有限并发。
7. 最后调整 Node sidecar 的 hybrid 强制和 status 输出。
8. 跑 Rust + Node + 启动脚本 + 真实浏览器烟测闭环。

这个顺序保证先修事实 owner，再做性能和体验，不允许先堆表层补丁。

---

## 15. 成功标准

完成后，下面句子必须在代码和测试里为真：

**后端只有在 sidecar 的 WebTorrent runtime 证明自己是完整、持票、WebRTC-capable 的同 infoHash seed 后，才会把自己写成 backend strong seed。**

如果 sidecar 只是接受命令、正在下载、运行 mock、运行非 hybrid、缺票、infoHash 不匹配或状态不可知，系统必须说真话：

- 不写强种子 presence。
- 保持 attachment ready 与分发能力两个事实分离。
- 由同一个强种子 owner 重试和收口。

---

## 16. 自审记录

### 第一遍：需求意图

修正点：把原先“七项优化清单”改成“强种子事实 owner 纠偏”。

结论：通过。文档直接回应“禁止掩耳盗铃/亡羊补牢”，不再用 guard/timeout 替代根因。

### 第二遍：架构边界

修正点：明确 domain/application/contract 不接触 sidecar runtime 字段，sidecar 只报告协议事实，Rust shell 只消费事实并落库。

结论：通过。没有把外层协议状态泄漏进内圈。

### 第三遍：验证闭环

修正点：补齐 Rust 纯函数、Rust 集成、Node/Vitest、PowerShell 脚本、真实双浏览器烟测五层验证。

结论：通过。每个改变强种子事实语义的路径都有失败先行测试入口。

---

## 17. 100% 信心循环

问题：我对这份设计是否事实 100% 有信心？

第一轮回答：不是。风险是把“直接读本地 canonical 文件 seed”误当成唯一正确方案，会破坏 S3 对象存储模式。

修复：第 6 节明确 sidecar 不绕开 Rust 对象存储；WebSeed 仍作为 WebTorrent 内部 bootstrap，Ready 必须由 WebTorrent runtime `progress == 1` 产生。本地零拷贝只能作为后续 adapter 优化。

第二轮回答：不是。风险是把广播前未 Ready 直接拒绝消息发布，可能混淆 attachment ready 与 strong seed availability。

修复：第 8 节明确二者分离。本 spec 的硬底线是“未 Ready 不得写成 Ready”；是否拒绝媒体消息发布放到实施计划作为产品门禁，不在底层 owner 修复里偷换。

第三轮回答：现在有事实信心。设计锁定唯一根因：`backend_strong_seed` 的事实 owner 从 Rust ack 推断纠回 sidecar WebTorrent runtime；所有性能与时序优化只服务这一点，没有新增第二真相或绕过 WebTorrent。
