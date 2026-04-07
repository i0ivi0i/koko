# 前端现状 DDD 分层评估

日期：2026-04-07  
状态：评估已确认，可作为后续重构与评审依据  
范围：`frontend/传输.ts`、`后台壳.ts`、`聊天壳.ts`、`契约.ts`、`入口.ts`、`视图.ts`、`状态.ts`

## 0. 一句话结论

这 7 个文件不是“完全没用 DDD”，而是：

**共享契约、传输适配、展示派生这三块已经有正确边界；前端应用层还没真正独立出来，导致 `聊天壳.ts` 过胖，`状态.ts` 过杂。**

换句话说：

1. 方向是对的。
2. 边界意识已经有了。
3. 但前端还停在“壳层硬撑 application 逻辑”的阶段，离优雅还差最后一次收口。

---

## 1. 评估标准

本次评估只按 DDD 前端边界来判断：

1. `contract`：共享稳定语义，只描述前后端共同理解的事实
2. `adapter`：协议/IO 翻译，不裁决业务真相
3. `presenter`：基于稳定事实派生展示模型
4. `shell`：渲染、收集意图、交互编排
5. `application (frontend orchestration)`：前端自己的同步编排逻辑

注意：

**这里的前端 `application` 不是领域层。**
它只负责编排 bootstrap、恢复、订阅、补洞、软离房、滚动意图，不裁决任何后端领域真相。

---

## 2. 逐文件裁决

### 2.1 [frontend/契约.ts](/E:/koko/frontend/契约.ts)

**裁决：利用得最好，应该保留为共享契约层。**

做对的地方：

1. 明确区分匿名内部身份、展示花名、会话锚点。
2. 明确 `last_read_event_position` 是阅读真相，不是滚动条像素。
3. 明确 `first_unread_event_position` 和 `snapshot_messages` 由后端裁决，不让前端自己猜。

为什么它像 DDD：

1. 它描述的是跨端共享语义，不是某个页面的展示细节。
2. 它没有塞 UI 文案、布局字段或壳层流程语义。

后续建议：

1. 继续保持为共享表面。
2. 不要把某个壳专属字段倒灌进来。

---

### 2.2 [frontend/传输.ts](/E:/koko/frontend/传输.ts)

**裁决：已经像 adapter，值得保留。**

做对的地方：

1. 通过 [frontend/传输.ts:34](/E:/koko/frontend/传输.ts#L34) 定义了 `前端传输端口`。
2. [frontend/传输.ts:57](/E:/koko/frontend/传输.ts#L57) 的 `HttpRealtime传输` 只做 HTTP/socket.io 接线。
3. [frontend/传输.ts:19](/E:/koko/frontend/传输.ts#L19) 的 `Http接口错误` 把协议错误翻成壳层能消费的稳定形状。

为什么它像 DDD：

1. 它没有自己决定“谁能发言”“这条消息是否成立”。
2. 它做的是协议适配，不是真相裁决。

不够优雅的点：

1. `createSocket()` 目前还只是最小接线，[frontend/传输.ts:126](/E:/koko/frontend/传输.ts#L126) 没有把 ack / retries / reconnect 这些官方客户端能力收成更稳定的前端基础设施策略。

后续建议：

1. 保留文件，不推翻。
2. 让未来的房间编排内核依赖它，而不是让壳层直接拿它拼业务流程。

---

### 2.3 [frontend/视图.ts](/E:/koko/frontend/视图.ts)

**裁决：像 presenter，方向正确。**

做对的地方：

1. [frontend/视图.ts:23](/E:/koko/frontend/视图.ts#L23) 明确把未读分隔条定义成展示项，不是假装成领域事件。
2. [frontend/视图.ts:61](/E:/koko/frontend/视图.ts#L61) 只基于稳定事实派生左右分边和花名显示。

为什么它像 DDD：

1. 它做的是“事实 -> 展示模型”的翻译。
2. 它不把 UI 展示反向当成真相。

后续建议：

1. 保留为 presenter/view-model 层。
2. 以后可以继续让房间标题、副标题、提示文案也都走这条层，而不是让壳组件自己拼字符串。

---

### 2.4 [frontend/入口.ts](/E:/koko/frontend/入口.ts)

**裁决：克制，基本正确。**

做对的地方：

1. [frontend/入口.ts:1](/E:/koko/frontend/入口.ts#L1) 只做前端入口装配。
2. 后台壳按需懒加载，没有在入口层混业务流程。

为什么它像 DDD：

1. 装配层就该薄。
2. 它没有越界去承载会话逻辑。

后续建议：

1. 继续保持薄。
2. 未来只在这里接入新的房间编排内核装配，不要把状态机本体写回来。

---

### 2.5 [frontend/状态.ts](/E:/koko/frontend/状态.ts)

**裁决：有边界意识，但目前是混合态，不够优雅。**

当前混在一起的东西有三类：

1. 稳定同步上下文  
   例如 [frontend/状态.ts:10](/E:/koko/frontend/状态.ts#L10) 的 `sessionId`、[frontend/状态.ts:18](/E:/koko/frontend/状态.ts#L18) 的 `latestEventPosition`
2. 壳层输入态  
   例如 [frontend/状态.ts:16](/E:/koko/frontend/状态.ts#L16) 的 `roomCodeInput`、[frontend/状态.ts:17](/E:/koko/frontend/状态.ts#L17) 的 `messageInput`
3. 瞬时副作用编排态  
   例如 [frontend/状态.ts:25](/E:/koko/frontend/状态.ts#L25) 的 `initialUnreadSettled`、[frontend/状态.ts:33](/E:/koko/frontend/状态.ts#L33) 的 `scrollPhase`、[frontend/状态.ts:36](/E:/koko/frontend/状态.ts#L36) 的 `pendingReadAnchorPosition`

为什么说它还不优雅：

1. 它不是纯粹的 view state。
2. 也不是独立的前端 application 状态机上下文。
3. 结果就是：一改 UI，容易顺手改到同步编排字段。

后续建议：

1. 保留这个文件，但收口职责。
2. 让真正的同步流程状态迁移搬去独立的房间编排内核。
3. 这里保留壳层外观态和轻量共享类型。

---

### 2.6 [frontend/后台壳.ts](/E:/koko/frontend/后台壳.ts)

**裁决：能用，但只是最小壳，不算优雅 DDD。**

当前特征：

1. 组件直接拿 transport 调后台接口，[frontend/后台壳.ts:13](/E:/koko/frontend/后台壳.ts#L13)
2. 组件自己持有登录态、房间过滤、详情文本等状态

为什么它不算错：

1. 后台页目前逻辑简单，业务复杂度远低于聊天室房间页。

为什么它不算优雅：

1. 它还是“组件直接调 adapter + 自己管状态”的最小实现。
2. 如果后台后续复杂起来，也会走向和 `聊天壳.ts` 类似的过胖问题。

后续建议：

1. 现阶段可暂时不动。
2. 不把它当作聊天室前端分层的参考模板。

---

### 2.7 [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)

**裁决：这是当前最大的问题点。**

它不是“前端做了后端的活”，而是：

**前端自己的 application / shell / side effects 全揉在一个超级组件里。**

证据很直接：

1. bootstrap 与恢复编排在这里  
   [frontend/聊天壳.ts:479](/E:/koko/frontend/聊天壳.ts#L479)
2. 房间快照入房在这里  
   [frontend/聊天壳.ts:965](/E:/koko/frontend/聊天壳.ts#L965)
3. realtime 连接与订阅在这里  
   [frontend/聊天壳.ts:1091](/E:/koko/frontend/聊天壳.ts#L1091)
4. 已读采样与节流在这里  
   [frontend/聊天壳.ts:1148](/E:/koko/frontend/聊天壳.ts#L1148)
5. 消息合流与乐观态收敛在这里  
   [frontend/聊天壳.ts:1293](/E:/koko/frontend/聊天壳.ts#L1293)
6. 最终渲染也在这里  
   [frontend/聊天壳.ts:1440](/E:/koko/frontend/聊天壳.ts#L1440)

为什么这不优雅：

1. 同步编排、滚动副作用、渲染模板在同一个文件里，任何 UI 迭代都可能踩到恢复链。
2. 这个文件过胖，不利于独立测试和长期维护。
3. 它让前端“有边界意识”却无法真正形成稳定应用层。

为什么它又不是完全错误：

1. 它现在大体上仍然消费后端权威快照与事件。
2. 它没有自己越权裁决成员资格与消息成立。

所以它的问题不是“前端越权做领域”，而是：

**壳层承载了过多前端 application orchestration。**

后续建议：

1. 保留这个文件作为最终壳。
2. 但必须把会话编排、滚动副作用、本地持久化从这里抽走。

---

## 3. 总结裁决

### 3.1 已经值得保留的

1. [frontend/契约.ts](/E:/koko/frontend/契约.ts)
2. [frontend/传输.ts](/E:/koko/frontend/传输.ts)
3. [frontend/视图.ts](/E:/koko/frontend/视图.ts)
4. [frontend/入口.ts](/E:/koko/frontend/入口.ts)

### 3.2 应该收口但不是推翻的

1. [frontend/状态.ts](/E:/koko/frontend/状态.ts)
2. [frontend/后台壳.ts](/E:/koko/frontend/后台壳.ts)

### 3.3 必须瘦身的核心热点

1. [frontend/聊天壳.ts](/E:/koko/frontend/聊天壳.ts)

---

## 4. 最终结论

原先这套文件并不是“假分层”。

更准确的判断是：

**前端已经把 `contract / adapter / presenter` 三层摸出来了，但还没把 `frontend application orchestration` 从 `shell` 里独立出来。**

这正是后续房间前端重构的真正切入点。

一句话收口：

**该利用的继续利用；真正需要动刀的，不是契约和传输，而是那只过胖的聊天壳。**
