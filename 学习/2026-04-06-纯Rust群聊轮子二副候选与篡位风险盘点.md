# 2026-04-06 纯 Rust 群聊轮子二副候选与篡位风险盘点

适用范围：`koko` 在坚持 DDD 领域主权前提下，为后端招聘“二副级成熟轮子”时的选型判断。  
目标：明确区分三种东西：

1. 真正适合招聘为二副的成熟轮子
2. 值得借鉴但不该直接接入核心的整舰产品
3. 生态里目前根本不存在、不要再幻想的“无船长现成舰船”

## 1. 先给总判断

### 1.1 结论一句话

目前我没有查到一艘“成熟、纯 Rust、可嵌入、没有自带船长的群聊舰船”。  
也就是：

1. 没找到一个成熟、头less、通用、可嵌入的纯 Rust 群聊业务核心轮子
2. 找到的成熟方案要么是专业二副，要么是整艘现成舰船

### 1.2 对 `koko` 的真正含义

对 `koko` 最现实的路线不是“找到现成无主舰船”，而是：

1. 领域继续当船长
2. 招聘成熟二副
3. 值得借鉴的整舰产品拿来学习，不拿来直接替换核心

## 2. 先立判题标准：什么叫“二副级轮子”

一项技术只有同时满足以下条件，才算适合给 `koko` 当二副：

1. 提供的是专业能力，而不是完整业务世界观
2. 不强迫 `koko` 接受它自己的房间、成员、权限、消息成立模型
3. 可以通过 port / contract 接入
4. 替换它时，影响主要停留在 adapter 边界
5. 它增强的是能力，不是重写业务真相

反过来，如果一个项目：

1. 自带完整协议语义
2. 自带完整数据模型
3. 自带完整同步逻辑
4. 自带完整权限/治理/扩展体系
5. 你一旦接入就要围绕它重塑自己的契约

那它不是二副，而是一艘整舰，且通常自带隐形船长。

## 3. 真正适合招聘为二副的纯 Rust 轮子

### 3.1 `socketioxide`

定位：

1. Rust 的 Socket.IO server 实现
2. 能力覆盖 `rooms / state / acknowledgements / adapters / polling / websocket`

它适合当二副的原因：

1. 它提供实时基础设施核心能力
2. 它不强迫你接受完整聊天业务模型
3. 它能当实时主通道 adapter，而不是业务船长

它不做什么：

1. 不裁决成员资格
2. 不裁决消息成立
3. 不替你定义群聊领域模型

结论：

- 这是 `koko` 最应该招聘的“实时二副”

来源：

- [socketioxide docs.rs](https://docs.rs/socketioxide/latest/socketioxide/)

### 3.2 `vodozemac`

官方定位：

- 纯 Rust 的 Olm / Megolm 实现
- 目标是为 Matrix 客户端和安全通信提供高层加密能力

它适合当二副的原因：

1. 它只提供加密与安全通信能力
2. 不接管你的房间、消息、权限、同步语义
3. 是一个很典型的“专业设备型二副”

结论：

- 如果以后 `koko` 需要 E2EE，它是非常值得优先考虑的二副

来源：

- [matrix-org/vodozemac](https://github.com/matrix-org/vodozemac)

### 3.3 `sqlx` / `axum`

虽然这轮不是重点查它们，但放到这个框架里很清楚：

1. `sqlx` 是持久化二副
2. `axum` 是 HTTP 入口二副
3. 它们都不自带群聊业务船长

结论：

- 这类轮子继续保留，没有 DDD 冲突

## 4. 条件适合当二副，但要非常克制使用的轮子

### 4.1 `Ruma`

官方定位：

- `A set of Rust crates for interacting with the Matrix chat network.`

它的价值：

1. 提供 Matrix 协议相关 Rust crates
2. 适合做 Matrix 协议交互、类型、安全的协议处理

它的风险：

1. 它的语言和模型是 Matrix 的语言和模型
2. 一旦你深度采用，就容易把 `koko` 的领域语义向 Matrix 术语靠拢

结论：

1. 如果未来 `koko` 明确要兼容 Matrix 或借用其协议结构，`Ruma` 可以当“协议二副”
2. 如果 `koko` 不打算采用 Matrix 世界观，就不要把 `Ruma` 拉进核心模型层

来源：

- [ruma.dev](https://ruma.dev/)
- [ruma/ruma](https://github.com/ruma/ruma)

### 4.2 `matrix-rust-sdk`

官方定位：

- Matrix Client-Server SDK for Rust
- 仓库写明 production ready，并服务多个客户端实现

它的价值：

1. 生产成熟
2. 能说明 Matrix Rust 生态的工程成熟度很高

它的风险：

1. 它是客户端 SDK，不是给你当自定义群聊后端核心的
2. 语言、协议和行为仍然围绕 Matrix

结论：

- 更适合作为“学习 Matrix 生态成熟设计”的参考，不适合当 `koko` 群聊核心二副

来源：

- [matrix-org/matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk)

## 5. 看起来很强，但本质上是整舰，不适合直接当二副的项目

### 5.1 `Tuwunel`

官方定位非常明确：

- `High Performance Matrix Homeserver in Rust`
- `featureful Matrix homeserver`
- `enterprise-ready`
- 可直接替代 Synapse

这说明它是什么：

1. 它是整套 Matrix homeserver
2. 不是一个“可嵌入群聊业务核心库”

它为什么不适合直接当 `koko` 的二副：

1. 它自带 Matrix 协议世界观
2. 自带 homeserver 数据模型与同步语义
3. 你一旦接入，很容易变成“`koko` 围绕 Tuwunel 适配”
4. 这会明显侵入领域主权

它值得借鉴什么：

1. 纯 Rust 高性能聊天服务如何组织大型工程
2. homeserver 在性能、部署、维护上的成熟做法
3. 规模化测试与发布方式

结论：

- 适合学习，不适合直接接成二副

来源：

- [matrix-construct/tuwunel](https://github.com/matrix-construct/tuwunel)

### 5.2 `continuwuity`

官方定位：

- `A community-driven Matrix homeserver in Rust`
- `official community continuation of conduwuit`

这同样说明：

1. 它是完整 Matrix homeserver
2. 不是一个没有船长的组件库

它不适合直接当二副的原因和 `Tuwunel` 一样：

1. 自带完整协议语义
2. 自带完整产品边界
3. 采用它基本等于采用 Matrix homeserver 方向

它值得借鉴什么：

1. 轻量、高效、长期维护的 Rust 聊天基础设施怎么做
2. Rust homeserver 项目如何在稳定性和特性之间平衡

结论：

- 适合学习，不适合直接接成 `koko` 的群聊二副

来源：

- [continuwuity/continuwuity](https://github.com/continuwuity/continuwuity)
- [continuwuity 官网](https://continuwuity.org/)

### 5.3 `VoceChat`

官方定位非常直白：

- `VoceChat is a superlight rust written social server. Easy integration to your site/app.`

这里最容易让人误判，因为它写了“easy integration”。  
但要看清：

1. 它是 social server
2. 不是“群聊业务核心库”
3. 它是完整产品后端，不是无主舰船

它为什么有诱惑力：

1. 纯 Rust
2. 自托管
3. 聊天能力现成

它为什么仍然不适合直接当 `koko` 的二副：

1. 它自带自己的产品边界
2. 自带自己的服务形态
3. 真接进去，你大概率是在对接另一个系统，而不是在招聘一个组件

它值得借鉴什么：

1. “易集成聊天产品”如何设计最小接入面
2. 纯 Rust 聊天服务如何面向实际产品落地

结论：

- 比 Matrix homeserver 更接近“可集成产品”，但仍不是 `koko` 想要的“无船长舰船”

来源：

- [Privoce/vocechat-server-rust](https://github.com/Privoce/vocechat-server-rust)
- [VoceChat 文档](https://doc.voce.chat/)

## 6. 这轮搜索的负面结论：生态里没有什么

### 6.1 crates 生态没有显眼的成熟“headless chat core”

我直接做了 `cargo search`：

1. `cargo search chat`
2. `cargo search matrix`
3. `cargo search xmpp`

结果说明：

1. `chat` 关键词里没有出现明显成熟、专注群聊领域核心的 crate
2. `matrix` 关键词多数是协议或客户端/桥接相关
3. `xmpp` 关键词更多是协议实现和库，但不是现代 headless 群聊业务核心

也就是说：

1. Rust 生态里并不是没有聊天相关能力
2. 但确实缺少一个成熟、头less、通用、可嵌入的“群聊业务核心 crate”

### 6.2 这不是搜索失误，而是生态形态如此

当前 Rust 生态在这个问题上的形态更像：

1. 协议栈和基础设施能力不错
2. 整体聊天后端产品也开始成熟
3. 但中间那层“通用业务核心库”是空档

对 `koko` 的含义：

1. 不要再浪费时间寻找“完全现成的无主舰船”
2. 应该转向“招成熟二副 + 自己掌握船长”

## 7. 最终建议：哪些该招，哪些该学，哪些别幻想

### 7.1 直接招聘

1. `socketioxide`：实时二副
2. `sqlx`：持久化二副
3. `axum`：入口二副
4. `vodozemac`：未来安全二副

### 7.2 条件招聘

1. `Ruma`：只有当 `koko` 明确要吸收 Matrix 协议层能力时
2. `matrix-rust-sdk`：更适合研究其工程能力，不适合直接当后端核心

### 7.3 重点借鉴但不直接接入

1. `Tuwunel`
2. `continuwuity`
3. `VoceChat`

### 7.4 不要再幻想

1. 不要再找“成熟、纯 Rust、无主、可嵌入的群聊整舰”
2. 目前我没有查到它存在

## 8. 结论

真正符合 `koko` 的架构现实，不是：

- 找到一艘没有船长的现成航母

而是：

1. 领域继续当船长
2. 招聘成熟专业二副
3. 借鉴成熟整舰的工程经验
4. 不把别人的整舰误当成自己的组件

说得更直白一点：

**纯 Rust 生态里，成熟二副有，成熟整舰也有，但“没有船长的现成舰船”我目前没查到。**

## 9. 主要来源

- [socketioxide docs.rs](https://docs.rs/socketioxide/latest/socketioxide/)
- [matrix-construct/tuwunel](https://github.com/matrix-construct/tuwunel)
- [continuwuity/continuwuity](https://github.com/continuwuity/continuwuity)
- [continuwuity 官网](https://continuwuity.org/)
- [Privoce/vocechat-server-rust](https://github.com/Privoce/vocechat-server-rust)
- [VoceChat 文档](https://doc.voce.chat/)
- [ruma.dev](https://ruma.dev/)
- [ruma/ruma](https://github.com/ruma/ruma)
- [matrix-org/matrix-rust-sdk](https://github.com/matrix-org/matrix-rust-sdk)
- [matrix-org/vodozemac](https://github.com/matrix-org/vodozemac)
- `cargo search chat --limit 20`
- `cargo search matrix --limit 20`
- `cargo search xmpp --limit 20`
