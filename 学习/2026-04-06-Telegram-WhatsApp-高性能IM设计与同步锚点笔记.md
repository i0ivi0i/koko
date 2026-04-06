# 2026-04-06 Telegram / WhatsApp 高性能 IM 设计与同步锚点笔记

适用范围：`koko` 的聊天体验、恢复逻辑、身份展示、同步锚点与补洞策略。  
原则：只整理官方公开资料和高质量工程资料，不推实现代码。

## 1. 事实结论

### 1.1 会话恢复不是“页面记忆”，而是“带锚点的状态续接”

- Telegram 的更新处理明确要求客户端基于本地状态检查 `pts / qts / seq` 是否有 gap，有缺口就要补洞。
- Telegram 的 imported messages 机制也明确保留原始时间戳，并要求在导入后按既有历史与新消息一起对齐。
- WhatsApp Multi-device 走的是“每设备独立连接 + 同步消息历史和应用状态”的思路，不再把手机当唯一 source of truth。

### 1.2 消息列表 UI 不该暴露内部事件序号

- Telegram 的公开文档强调的是消息时间戳、回复关系、@ 提及、跳转回原消息，而不是把 `pts/seq` 这种内部同步序列直接展示给普通用户。
- Telegram 的导入消息规则保留原始时间戳，但没有把序列号外露成主视觉。
- WhatsApp 的公开资料同样把重点放在聊天历史、联系人名称、星标、归档等同步状态上，而不是对外暴露内部序号。

### 1.3 身份标识应对用户可读，但不要把内部锚点端上来

- Telegram 公开说明：screen name、头像、username 对外可见，且不要求是真名；联系人看到的是自己保存的名字。
- Telegram 还明确 phone number 是账号识别的基础标识，但并不等于前台展示字段。
- WhatsApp Multi-device 明确提到：每个设备有自己的 identity key，服务器维护账号与设备身份的映射，同时同步联系人名称、聊天归档、星标等状态。

### 1.4 同步锚点与补洞是成熟 IM 的硬骨头

- Telegram 的更新模型是明确的“本地 state + 远端 state + gap repair”。
- Matrix 的客户端/服务器 API 也把 `next_batch`、`txnId` 这类 token 作为幂等与增量同步的基础，不把消息成立和重试成功混成一个概念。
- WhatsApp 的工程资料强调：多设备体验要保证同步，但同步的是消息历史和应用状态，不是把某个设备当永远可信的单点。

### 1.5 左右分边是成熟聊天 UI 的默认阅读辅助

- Telegram 官方 bug tracker 里，“自己发出的群消息应显示为 outgoing，而不是左侧 incoming”被直接视为正确预期。
- 这说明群聊视图里，区分“我发的”和“别人发的”是成熟产品的基本阅读辅助，不是可有可无的装饰。

## 2. 直接来源链接

- [Telegram Working with Updates](https://core.telegram.org/api/updates)
- [Telegram FAQ](https://telegram.org/faq)
- [Telegram Privacy Policy](https://telegram.org/privacy)
- [Telegram Group Chats](https://telegram.org/tour/groups)
- [Telegram Imported messages](https://core.telegram.org/api/import)
- [Telegram messages.checkHistoryImport](https://core.telegram.org/method/messages.checkHistoryImport)
- [Telegram messages.initHistoryImport](https://core.telegram.org/method/messages.initHistoryImport)
- [Telegram messages.startHistoryImport](https://core.telegram.org/method/messages.startHistoryImport)
- [Telegram Bugs: Sorting by original date for Imported Messages](https://bugs.telegram.org/c/1238/2)
- [Telegram Bugs: The messages you send are unreadable](https://bugs.telegram.org/c/11989/3)
- [WhatsApp Multi-device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)
- [WhatsApp privacy checkup / silence unknown callers](https://blog.whatsapp.com/new-privacy-features-silence-unknown-callers-and-privacy-checkup?lang=th)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)

## 3. 对 koko 的启发

1. 刷新后回到原房间，不应依赖页面状态猜测，而应保存壳层本地的 `current_room_id`，再用后端权威快照和增量重新闭环。
2. `session_id`、`event_position`、`pts/seq` 这类内部锚点不应暴露给普通用户视图，只保留在同步和调试层。
3. 聊天气泡要明确区分“我发的”和“别人发的”，否则群聊阅读成本太高。
4. 冷路径补洞必须带成员资格校验，不能让“能拉到事件”替代“有资格看见事件”。
5. 身份展示要对用户友好，优先展示花名/可读名，不直接露内部运行标识。
6. 同步语义建议保持“增量锚点 + gap repair + 快照兜底”的三段式，不把 ACK、连接存活、页面受理当成业务成立。

## 4. 一句话结论

成熟 IM 的共同点不是“把更多状态展示给用户”，而是“把内部锚点藏好，把用户能理解的状态做清楚”。
