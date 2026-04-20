# 整理笔记分馆

这里放的是消化后的理解与判断，不替代原始资料。

## 资料清单

- 架构判断
  - [ddd-领域主权与乐高系统笔记.md](./ddd-领域主权与乐高系统笔记.md)
    从 DDD、可插拔边界和主权归属角度校准系统骨架。
  - [浏览器内应用与前端应用化官方实践笔记.md](./浏览器内应用与前端应用化官方实践笔记.md)
    把 PWA、生命周期、Service Worker、WebSocket、Actor model 和前端应用化的官方依据收成一张判断表。
  - [浏览器应用化官方实践补充-Safari-Chrome-P2P-2026.md](./浏览器应用化官方实践补充-Safari-Chrome-P2P-2026.md)
    继续补强 Safari / Chrome / WebTorrent / WebRTC / p2p-media-loader / Video.js 的官方边界，专门回答“浏览器中的应用”在多人群聊里该怎么落。
  - [Rust-集成测试与TDD组织实践笔记.md](./Rust-集成测试与TDD组织实践笔记.md)
    回答 Rust 官方和一线项目到底怎么组织集成测试，以及 `koko` 该怎么拆当前 5k 行测试热点。
  - [群聊-im实践对齐清单.md](./群聊-im实践对齐清单.md)
    把官方建议和高手实践收成一张对齐清单。
  - [唯一壳级操作台与不手搓轮子依据.md](./唯一壳级操作台与不手搓轮子依据.md)
    说明为什么壳层要收口，为什么通用轮子别再手搓。
  - [统一附件入口与媒体选择官方实践清单.md](./统一附件入口与媒体选择官方实践清单.md)
    只聚焦这次“统一附件按钮 + 统一媒体 chooser + 媒体事实后置判断”的官方依据和实现边界。
  - [统一附件入口多选与文件选择器策略补充.md](./统一附件入口多选与文件选择器策略补充.md)
    只补这次实机回归暴露出的关键边界：`multiple` 不能被我们主动砍掉，隐藏 file input 继续以 `click()` 为主路径。
- 主通道与实时链路
  - [单节点多房间主通道实践清单.md](./单节点多房间主通道实践清单.md)
    盘点单节点多房间主通道最该抄的成熟做法。
  - [群聊主通道后续资料补充.md](./群聊主通道后续资料补充.md)
    继续补强主通道下一步最该看的资料。
  - [单机多房间实时主链笔记.md](./单机多房间实时主链笔记.md)
    重新梳理单机多房间实时主链该怎么收口。
  - [实时主链资料补强笔记.md](./实时主链资料补强笔记.md)
    补上 `socketioxide`、`socket.io`、Telegram、WhatsApp 的交叉启发。
- 恢复、门禁与同步
  - [恢复门禁与单节点性能补充.md](./恢复门禁与单节点性能补充.md)
    看恢复门禁、观测和单节点性能边界。
  - [telegram-whatsapp-同步锚点笔记.md](./telegram-whatsapp-同步锚点笔记.md)
    重点是同步锚点、事件位置和缺口补偿。
- 轮子与基础设施选择
  - [纯-rust群聊轮子候选风险盘点.md](./纯-rust群聊轮子候选风险盘点.md)
    盘点纯 Rust 轮子候选，以及哪些有篡位风险。
  - [群聊媒体-WebTorrent协作分发官方实践清单.md](./群聊媒体-WebTorrent协作分发官方实践清单.md)
    把 WebTorrent、tracker、Web Seed 和浏览器真实边界收成实现可直接复用的一张清单。
  - [WebTorrent最新版官方建议与高性能设计补充-2026-04.md](./WebTorrent最新版官方建议与高性能设计补充-2026-04.md)
    专门回答最新版 `WebTorrent` 到底能不能让群聊视频/图片秒开，以及官方和 WebTorrent/BitTorrent 实作者给出的高性能路线是什么。
  - [WebTorrent-秒开秒播秒切与图片秒开-官方与BEP性能清单-2026-04-19.md](./WebTorrent-秒开秒播秒切与图片秒开-官方与BEP性能清单-2026-04-19.md)
    按 2026-04-19 重新核对最新版 `WebTorrent`、BEP 规范与主流高性能实现，收敛成可直接执行的秒开/秒切/秒开图落地清单。
  - [客户端预制媒体与WebTorrent单文件主链-官方实践清单-2026-04-20.md](./客户端预制媒体与WebTorrent单文件主链-官方实践清单-2026-04-20.md)
    专门为“客户端预制 + 后端单文件存储 + WebTorrent 单文件主链”整理的官方约束与高性能落地裁决。
  - [Web主链落地前最新资料补充与依赖升级裁决-2026-04.md](./Web主链落地前最新资料补充与依赖升级裁决-2026-04.md)
    只补当前施工前最后还缺的官方资料、依赖升降裁决，以及为什么先补门禁/调参/持久化语义而不是继续乱追版本。
  - [Web大视频秒开播放与P2P协同主链官方实践清单-2026.md](./Web大视频秒开播放与P2P协同主链官方实践清单-2026.md)
    只看当前 Web 阶段，把 WebTorrent、WebRTC、HLS、DASH、CMAF、hls.js、p2p-media-loader、Video.js v10 的官方边界和 `koko` 的直接工程裁决一次压清。
  - [群聊媒体上传-Uppy-Tus-Rustus官方实践清单.md](./群聊媒体上传-Uppy-Tus-Rustus官方实践清单.md)
    把群聊媒体上传当前配置、官方建议和生产前缺口收成一张清单。
  - [Video.js-v10-beta-播放器候选笔记.md](./Video.js-v10-beta-播放器候选笔记.md)
    跟进 Video.js v10 beta 的可组合播放器、SPF、React/HTML 表面与当前项目暂不迁移判断。
  - [socketioxide-多节点部署与门禁笔记.md](./socketioxide-多节点部署与门禁笔记.md)
    看 `socketioxide` 从单节点走向多节点时的部署与门禁问题。
  - [socketioxide-多房间群聊落地笔记.md](./socketioxide-多房间群聊落地笔记.md)
    贴近项目落地，梳理 `socketioxide` 做多房间群聊的关键点。
  - [socketioxide-im实践补充.md](./socketioxide-im实践补充.md)
    补足 `socketioxide` 和 IM 实践之间还缺的桥。
- 业务语义与资料调研
  - [设备级花名匿名身份-mvp启发.md](./设备级花名匿名身份-mvp启发.md)
    给设备级花名、匿名身份和 MVP 设计找边界感。
  - [pretext-调研记录.md](./pretext-调研记录.md)
    记录 `pretext` 相关资料调研和取舍判断。

## 建议阅读顺序

1. 先看 [socket-io 分馆](../socket-io/README.md) 和 [Telegram 分馆](../telegram/README.md)，补齐可靠性与同步闭环。
2. 再看 [socketioxide 分馆](../socketioxide/README.md) 和 [WhatsApp / Meta 分馆](../whatsapp-meta/README.md)，补齐落地轮子与多设备边界。
3. 最后按上面的主题顺序回来看整理笔记，把判断收回项目。
