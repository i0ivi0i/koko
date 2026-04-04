# 官方 IM 架构资料索引

抓取日期：2026-04-04

这批资料只收官方源，目的是给 `koko` 后续的群聊 IM 设计、实时链路治理、断线恢复和多壳同步提供长期依据。

## Socket.IO

- `socket.io/delivery-guarantees.html`
  原始地址：`https://socket.io/docs/v4/delivery-guarantees/`
  价值：官方明确区分默认 `at most once`、顺序保证、应用自己负责 event id / offset / persistence。

- `socket.io/connection-state-recovery.html`
  原始地址：`https://socket.io/docs/v4/connection-state-recovery/`
  价值：官方说明短断线恢复能力的边界，提醒恢复不等于业务同步闭环。

- `socket.io/rooms.html`
  原始地址：`https://socket.io/docs/v4/rooms/`
  价值：官方明确 room 是 server-only concept，不能把 room 当业务成员真相。

- `socket.io/emitting-events.html`
  原始地址：`https://socket.io/docs/v4/emitting-events/`
  价值：官方 ack / emit 语义，用来防止把 ack 错看成消息成立。

- `socket.io/testing.html`
  原始地址：`https://socket.io/docs/v4/testing/`
  价值：官方推荐的端到端测试姿势，提醒实时链路不能只靠手写探针自证。

## socketioxide

- `socketioxide/crate-latest.html`
  原始地址：`https://docs.rs/crate/socketioxide/latest`
  价值：当前 latest crate 表面。

- `socketioxide/api-latest.html`
  原始地址：`https://docs.rs/socketioxide/latest/socketioxide/`
  价值：当前 latest API 文档总入口。

- `socketioxide/socket-struct.html`
  原始地址：`https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html`
  价值：回看 socket 能力、房间、emit、ack 相关 API 时直接用。

## Telegram

- `telegram/working-with-updates.html`
  原始地址：`https://core.telegram.org/api/updates`
  价值：Telegram 官方的 `seq / pts / qts / getDifference` 机制，是“事件位置 + 缺口恢复”最值得学的资料。

- `telegram/update-new-channel-message.html`
  原始地址：`https://core.telegram.org/constructor/updateNewChannelMessage`
  价值：直接看频道消息更新里 `pts / pts_count` 如何承载同步语义。

## WhatsApp / Meta

- `whatsapp-meta/whatsapp-multi-device.html`
  原始地址：`https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/`
  价值：WhatsApp 多设备官方工程文章，重点看“不要把单设备当唯一真相源”。

- `whatsapp-meta/meta-security-principles-private-messaging-2022.pdf`
  原始地址：`https://engineering.fb.com/wp-content/uploads/2022/07/Meta-Security-Principles-for-Private-Messaging-White-Paper-July-2022-2.pdf`
  价值：Meta 对私密消息系统的长期安全原则，重点看 `Security by Design` 和 `Reduce the Attack Surface`。

- `whatsapp-meta/labyrinth-encrypted-message-storage-protocol-2023.pdf`
  原始地址：`https://engineering.fb.com/wp-content/uploads/2023/12/TheLabyrinthEncryptedMessageStorageProtocol_12-6-2023.pdf`
  价值：看大厂如何处理大规模私密消息存储与可靠性边界。

- `whatsapp-meta/whatsapp-dit-de-identified-data-collection.html`
  原始地址：`https://engineering.fb.com/2021/04/16/security/dit/`
  价值：补充理解 WhatsApp / Meta 如何在隐私与系统演进之间做边界设计。

## 推荐阅读顺序

1. `socket.io/delivery-guarantees.html`
2. `socket.io/connection-state-recovery.html`
3. `telegram/working-with-updates.html`
4. `whatsapp-meta/whatsapp-multi-device.html`
5. `whatsapp-meta/meta-security-principles-private-messaging-2022.pdf`

## 对项目最直接的提醒

1. ack 不是消息成立。
2. room 不是成员真相。
3. 断线恢复不能只靠重连，必须靠事件位置补洞。
4. 前端不能再替后端宣布消息已成立。
