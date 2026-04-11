# Telegram 分馆

这里收 Telegram 官方更新机制资料，重点看事件位置、缺口恢复和同步闭环。

## 资料清单

- [working-with-updates.md](./working-with-updates.md)
  核心看 `seq / pts / qts / getDifference` 这套“事件位置 + 缺口恢复”机制。
- [update-new-channel-message.md](./update-new-channel-message.md)
  直接看频道消息更新里 `pts / pts_count` 怎么承载同步语义。
- [media-viewer-interaction-and-library-selection.md](./media-viewer-interaction-and-library-selection.md)
  记录 Telegram 图片/视频查看交互方向，并给出媒体查看器轮子初步选型。
- [webtorrent-media-viewer-source-contract.md](./webtorrent-media-viewer-source-contract.md)
  记录 WebTorrent、viewer 壳和视频播放器内核的 source contract，防止接 viewer 时破坏边下边播。

## 建议阅读顺序

1. [working-with-updates.md](./working-with-updates.md)
2. [update-new-channel-message.md](./update-new-channel-message.md)
3. [media-viewer-interaction-and-library-selection.md](./media-viewer-interaction-and-library-selection.md)
4. [webtorrent-media-viewer-source-contract.md](./webtorrent-media-viewer-source-contract.md)

## 这个分馆最值钱的点

- 不要只看“收到消息”，要看“事件位置有没有连续”。
- 断线恢复不能只靠重连，还要能补缺口。
- 图片/视频在聊天流里只是入口，真正观看应该进入独立 media viewer；优先复用成熟轮子，不继续手搓。
- 媒体查看器只能消费媒体播放层解析出的 source，不能绕过 WebTorrent streamURL 直接拼原始下载地址。
