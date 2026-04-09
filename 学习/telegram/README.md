# Telegram 分馆

这里收 Telegram 官方更新机制资料，重点看事件位置、缺口恢复和同步闭环。

## 资料清单

- [working-with-updates.md](./working-with-updates.md)
  核心看 `seq / pts / qts / getDifference` 这套“事件位置 + 缺口恢复”机制。
- [update-new-channel-message.md](./update-new-channel-message.md)
  直接看频道消息更新里 `pts / pts_count` 怎么承载同步语义。

## 建议阅读顺序

1. [working-with-updates.md](./working-with-updates.md)
2. [update-new-channel-message.md](./update-new-channel-message.md)

## 这个分馆最值钱的点

- 不要只看“收到消息”，要看“事件位置有没有连续”。
- 断线恢复不能只靠重连，还要能补缺口。
