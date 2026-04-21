# 学习资料总地图

这座图书馆按资料来源分馆，顶层只保留总地图，其他资料全部进入各自分馆。

## 专题入口

- [浏览器中的应用-前端应用化方案.md](./浏览器中的应用-前端应用化方案.md)
- [浏览器内应用与前端应用化官方实践笔记.md](./整理笔记/浏览器内应用与前端应用化官方实践笔记.md)
- [浏览器应用化官方实践补充-Safari-Chrome-P2P-2026.md](./整理笔记/浏览器应用化官方实践补充-Safari-Chrome-P2P-2026.md)
- [WebTorrent最新版官方建议与高性能设计补充-2026-04.md](./整理笔记/WebTorrent最新版官方建议与高性能设计补充-2026-04.md)
- [WebTorrent-秒开秒播秒切与图片秒开-官方与BEP性能清单-2026-04-19.md](./整理笔记/WebTorrent-秒开秒播秒切与图片秒开-官方与BEP性能清单-2026-04-19.md)
- [Web主链落地前最新资料补充与依赖升级裁决-2026-04.md](./整理笔记/Web主链落地前最新资料补充与依赖升级裁决-2026-04.md)
- [客户端预制媒体与WebTorrent单文件主链-官方实践清单-2026-04-20.md](./整理笔记/客户端预制媒体与WebTorrent单文件主链-官方实践清单-2026-04-20.md)
- [客户端派生预览与零长期轻封面-官方实践清单-2026-04-21.md](./整理笔记/客户端派生预览与零长期轻封面-官方实践清单-2026-04-21.md)
- [高清视频自动播放与激进协作分发实现前官方API清单-2026-04-21.md](./整理笔记/高清视频自动播放与激进协作分发实现前官方API清单-2026-04-21.md)

## 分馆一览

- [graphify 分馆](./graphify/README.md)
- [socket.io 分馆](./socket-io/README.md)
- [socketioxide 分馆](./socketioxide/README.md)
- [Telegram 分馆](./telegram/README.md)
- [WhatsApp / Meta 分馆](./whatsapp-meta/README.md)
- [整理笔记分馆](./整理笔记/README.md)

## 推荐阅读路径

1. 先看 [socket.io 分馆](./socket-io/README.md) 的可靠性、恢复和房间边界。
2. 再看 [Telegram 分馆](./telegram/README.md) 的事件位置和缺口恢复。
3. 接着看 [WhatsApp / Meta 分馆](./whatsapp-meta/README.md) 的多设备与安全设计。
4. 再回到 [socketioxide 分馆](./socketioxide/README.md) 对照你手里正在用的 Rust 轮子。
5. 想把知识图谱真正用顺手，再看 [graphify 分馆](./graphify/README.md)。
6. 最后看 [整理笔记分馆](./整理笔记/README.md)，把判断带回项目。

## 项目最直接的提醒

- ack 不是消息成立。
- room 不是成员真相。
- 断线恢复不能只靠重连，必须靠事件位置补洞。
- 前端不能再替后端宣布消息已成立。

## graphify 怎么配合这座图书馆

物理目录靠 README，跨来源关联靠 graphify；不要按 graphify 社区编号改物理目录。
