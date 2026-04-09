# socket.io 分馆

这里收 `socket.io` 官方资料，重点看可靠性、恢复、房间语义和测试方式。

## 资料清单

- [delivery-guarantees.md](./delivery-guarantees.md)
  官方把默认 `at most once`、顺序保证和应用自己补 event id / offset / persistence 的边界说得最清楚。
- [connection-state-recovery.md](./connection-state-recovery.md)
  讲短断线恢复能做什么、不能做什么，提醒恢复不等于业务同步闭环。
- [rooms.md](./rooms.md)
  明确 room 是 server-only concept，不能把 room 当成员真相。
- [emitting-events.md](./emitting-events.md)
  补足 ack / emit 语义，防止把 ack 错看成消息已经成立。
- [testing.md](./testing.md)
  给实时链路的官方测试姿势，提醒不要只靠手搓探针自证。

## 建议阅读顺序

1. [delivery-guarantees.md](./delivery-guarantees.md)
2. [connection-state-recovery.md](./connection-state-recovery.md)
3. [rooms.md](./rooms.md)
4. [emitting-events.md](./emitting-events.md)
5. [testing.md](./testing.md)

## 这个分馆最该记住的几句话

- ack 不是消息成立。
- room 不是成员真相。
- 恢复只是补链路，不是替你补业务事实。
