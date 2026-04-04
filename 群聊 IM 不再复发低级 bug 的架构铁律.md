# 群聊 IM 不再复发低级 bug 的架构铁律

日期：2026-04-04

## 定位

这份设计不讨论某个具体 bug 的修补细节，而是给 `koko` 的群聊 IM 主链路立长期铁律。  
目标只有一个：以后再遇到“点发送没反应”“明明进房却显示未连接”“消息已入库却没成立”这类低级错时，系统能更早拦住、更快定位，而不是跨层漂移。

## 外部依据

1. Socket.IO 官方明确区分了事件顺序、交付保证、ack、断线恢复与 room 概念。
2. socketioxide 官方提供了与 Socket.IO 兼容的 rooms、acks、adapter、per-socket state 等能力，说明实时库应做薄适配，不应再手搓第二层协议真相。
3. Telegram 官方更新机制以 `seq / pts / qts` 和 `getDifference` 为核心，说明成熟 IM 依赖“事件位置 + 缺口恢复”而不是“连接永不出错”。
4. WhatsApp / Meta 公开资料持续强调多设备同步、security by design、reduce attack surface，说明稳定系统来自真相收口与复杂度收缩，而不是壳层越来越聪明。

## 最新官方来源

- Socket.IO How it works
  https://socket.io/docs/v4/how-it-works/
  关键点：官方明确双向连接可能建立在 `WebTransport`、`WebSocket`，最差情况是 `HTTP long-polling`；Engine.IO 默认会先保可靠性和升级机制，再追求纯 WebSocket 性能。页面显示的“实时”不等于系统应该抛弃 HTTP。

- Socket.IO Delivery guarantees
  https://socket.io/docs/v4/delivery-guarantees/
  关键点：默认只有顺序保证与 `at most once`；若要更强交付保证，应用自己负责事件唯一 ID、持久化、offset 与重连补发。

- Socket.IO Connection state recovery
  https://socket.io/docs/v4/connection-state-recovery/
  关键点：临时断线恢复不是万能同步机制，恢复失败时仍需要应用回到自己的快照 / 补洞路径。

- Socket.IO Rooms
  https://socket.io/docs/v4/rooms/
  关键点：room 是 server-only concept，广播分组不等于业务成员真相。

- Socket.IO Testing
  https://socket.io/docs/v4/testing/
  关键点：实时链路必须有真实 client/server 测试，不该只靠本地推测和手写探针自证。

- socketioxide latest API
  https://docs.rs/socketioxide/latest/socketioxide/
  关键点：`SocketIo`、adapter、ack、state、rooms 都属于基础设施表面；适合做薄 adapter，不适合承载业务真相。

- Telegram Working with Updates
  https://core.telegram.org/api/updates
  关键点：一旦 `seq / pts / qts` 发现 gap，就必须 `getDifference`；成熟 IM 的稳定性核心是位置序列与补洞，而不是“长连接永不掉”。

- WhatsApp Multi-Device
  https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/
  关键点：多设备后每个设备拥有自己的身份，服务器维护“账号 -> 设备集合”的映射；真正要设计的是同步与真相归属，不是某个单壳页面状态机。

- Meta Security Principles for Private Messaging
  https://engineering.fb.com/wp-content/uploads/2022/07/Meta-Security-Principles-for-Private-Messaging-White-Paper-July-2022-2.pdf
  关键点：`Security by Design and Defense in Depth`、`Reduce the Attack Surface`。减少复杂度本身就是减少 bug 和脆弱性的手段。

## 系统塑形原则

### 1. 先收口稳定原语，再扩展组合

- 群聊主链路不要先追求“功能都能做”，要先守住少数稳定原语，再让能力从组合里长出来。
- 对 `koko` 来说，应优先收口到 `command / query / snapshot / event / error code / event_position`，而不是页面流程、socket 回调或壳层临时状态。

### 2. 接口先说真话，再允许壳层变聪明

- 共享契约先表达权威事实，不夹带展示意图、页面流程和壳层体验态。
- `contract` 负责讲清业务上到底发生了什么，`shell` 只负责把这些事实翻译成用户可感知的交互。

### 3. 先删冗余，再加功能

- 真正危险的不是功能不够，而是第二套真相、重复桥接、壳层假状态和低价值包装越长越多。
- 任何新增能力都要先问：是在增强稳定契约，还是只是在旧链路旁边再焊一条方便通道。

### 4. 先做闭环，再谈丝滑

- 新链路先证明“快照锚点、实时续接、缺口补洞、幂等合并、失败暴露”成立，再谈交互是否丝滑。
- 先把真相闭环钉死，页面体验才不会建立在假状态上。

### 5. 小件清楚，关系更清楚

- 单个模块职责必须窄，但更重要的是模块之间怎么接，谁翻译，谁裁决，谁存真相，要一眼看明白。
- 能组合出来的能力，不要提前焊成一个跨层巨函数；能用稳定契约串起来的链路，不要塞进隐式共享状态。

## 代码习惯塑形

- 写 handler / socket 回调 / presenter 时，默认先问一句：这是不是业务判断；如果是，就退回 `application / domain`。
- 写共享结构时，默认先问一句：这是不是事实契约；如果掺了展示字段、页面流程或壳层状态，就不该进 `contract`。
- 写 adapter 时，默认只做协议翻译、鉴权接入、IO 编排和错误转码，不顺手塞业务真相。
- 写前端状态时，默认只保留草稿、pending、连接提示、滚动位置这类本地体验态，不把它们升级成业务结论。
- 新增字段、接口或事件前，默认先搜现有契约和数据流；能复用就复用，不能因为眼前方便再开第二入口。
- 遇到重复分支、重复映射、重复同步胶水时，优先收口成一处稳定实现，不靠复制粘贴维持一致。
- 命名直接说事实，不说猜测；函数名、事件名、错误名都要让维护者看出它在表达哪一层的真相。
- 改完链路先跑能直接证明它的验证，不靠“我觉得这次应该对了”收工。

## 热路径与冷路径职责

### 1. HTTP 不是落后，乱用才落后

- `HTTP / RPC` 适合做冷路径：登录、bootstrap、join room、load snapshot、send command、get difference、后台管理。
- `WebSocket / WebTransport / socketioxide` 适合做热路径：订阅房间事件流、在线状态、实时广播、短延迟增量同步。
- 真正不优雅的不是“用了 HTTP”，而是把冷路径和热路径混成一锅。

### 2. 千万人在线的群聊 IM，不该把所有事都塞进 WebSocket

- 只靠 HTTP，会让实时增量变钝。
- 只靠 WebSocket，也会把快照、补洞、幂等、重试、权限裁决全塞进长连接层，最后更乱。
- 成熟 IM 更常见的做法是：命令和快照走可恢复的请求路径，增量变化走实时事件流。

### 3. `koko` 的正确职责划分

- `HTTP`：bootstrap session、join room、load snapshot、send command、recover gap。
- `socketioxide`：subscribe room stream、receive authoritative events、fanout、connection hint。
- `application / domain`：消息是否合法、谁能发、谁能看、消息什么时候成立、事件位置如何推进。
- `shell`：草稿、pending、连接提示、错误提示，不宣布业务真相。

## 核心铁律

### 1. ack 不是消息成立

- transport ack 只表示包被接住或对端回了一个响应。
- command result 只表示命令被受理或被拒绝。
- 只有权威 `message_created` 事件，或包含同一事件位置的权威快照，才表示消息成立。

### 2. 壳层不能裁决业务真相

- 前端只允许管理草稿、pending、滚动位置、连接提示等体验态。
- 房间成员资格、消息可见性、消息成立、历史完整性，只能回到 `application / domain`。
- “页面看起来已经连上”不能反向定义成“业务上已加入房间”。

### 3. 快照与实时必须由同一锚点接上

- 房间快照必须返回稳定事件位置。
- 订阅成功后，增量流必须从不早于该位置继续。
- 缺失位置锚点的快照或事件流，默认都不算同步闭环。

### 4. 进入房间、发送消息、断线恢复是三条不同链

- 进入房间：建立历史基线。
- 发送消息：表达意图并等待权威成立事实。
- 断线恢复：按事件位置补洞，补失败就重拉快照。

它们可以共享契约，但不能混成一个“连上了所以一切都对”的假状态机。

### 5. room 是 adapter 概念，不是业务成员真相

- Socket.IO / socketioxide 的 room 只用于广播与路由。
- 它不能代替房间成员资格、权限或消息可见性的业务裁决。

### 6. 所有权威消息都必须可幂等合并

- 必须有稳定 `message_id`
- 必须有稳定 `client_message_id`
- 必须有稳定 `event_position`

这样快照回放、实时重发、断线补差、多壳同步，才不会重复插入或错把旧事件当新事实。

### 7. 任何“成功”声明都必须建立在新鲜证据上

- 改发送链路，要有 application / HTTP / realtime / 页面点击四层证据。
- 改启动链路，要有 run 脚本、bundle、migration、服务启动四层证据。
- 不能只看单测绿了就宣布用户链路也绿了。

## 工程门禁

### 1. 发送链路必须长期保留四层测试

1. `application`：消息已入库时不得因为非业务差异误判失败。
2. `HTTP command`：`POST /messages` 必须返回权威 `message_created`。
3. `realtime integration`：同房发送后，sender / receiver 都要收到正确权威事件。
4. `browser E2E`：真实页面必须能从输入到看到 `已送达`。

### 2. 开发启动必须自动补 migration

- 新代码依赖的新 schema 不能指望人手记忆。
- `run.ps1 / xtask dev` 必须自动确保数据库结构已追平。

### 3. 后台错误不能再被壳层静默覆盖

- “房间打开失败”“快照失败”“发送失败”要分别暴露。
- joined rooms / search 这类背景成功，不得顺手把主链错误抹掉。

### 4. 新功能立项前必须先回答四个问题

1. 这条能力的权威真相在哪一层？
2. 它的稳定契约是什么？
3. 它的事件位置或同步锚点是什么？
4. 如果断线、重试、重进，会如何补洞与去重？

答不出来，就不能算设计完成。

## 对 `koko` 的直接要求

1. `socketioxide` 保留为实时主通道 adapter，不再手搓第二套实时协议真相。
2. `contract` 持续作为多壳共享表面，先收口 command / query / snapshot / event / error code。
3. Web 壳继续瘦身，少做业务裁决，多做显式错误与显式状态。
4. 后续若扩展 CLI / iOS / Android，只允许复用同一套权威事件与快照，不允许复制 Web 页面状态机。
5. 持续修枝：优先清理手搓桥接、重复协议胶水、壳层假状态和单壳专属数据形状，不让它们在主链路里再次长成第二套真相。

## 结论

以后要防的不是“某个按钮偶尔点不动”，而是系统重新滑回“多层都能宣布真相”的旧路。  
真正的稳，不是多写几层包装，而是把权威事实、稳定接口、事件位置、补洞路径、测试门禁和持续修枝这几件事长期钉死。
