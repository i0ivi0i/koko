# WhatsApp / Meta 分馆

这里收 WhatsApp / Meta 官方工程资料，重点看多设备、安全边界和消息存储。

## 资料清单

- [whatsapp-multi-device.md](./whatsapp-multi-device.md)
  重点看多设备架构，理解为什么不能把单设备当唯一真相源。
- [meta-security-principles-private-messaging-2022.md](./meta-security-principles-private-messaging-2022.md)
  总结 Meta 在私密消息上的长期安全原则，尤其是 `Security by Design` 和缩小攻击面。
- [labyrinth-encrypted-message-storage-protocol-2023.md](./labyrinth-encrypted-message-storage-protocol-2023.md)
  看大厂怎么处理加密消息存储与可靠性边界。
- [whatsapp-dit-de-identified-data-collection.md](./whatsapp-dit-de-identified-data-collection.md)
  补充理解隐私边界下的数据采集和系统演进。

## 建议阅读顺序

1. [whatsapp-multi-device.md](./whatsapp-multi-device.md)
2. [meta-security-principles-private-messaging-2022.md](./meta-security-principles-private-messaging-2022.md)
3. [labyrinth-encrypted-message-storage-protocol-2023.md](./labyrinth-encrypted-message-storage-protocol-2023.md)
4. [whatsapp-dit-de-identified-data-collection.md](./whatsapp-dit-de-identified-data-collection.md)

## 这个分馆最该记住的几句话

- 多设备不是单设备的附庸，真相不能绑死在一个端上。
- Security by Design 不是文案，是边界设计原则。
