# 2026-04-06 设备级花名匿名身份 MVP 官方资料与设计启发

目的：

这份笔记只服务 `koko` 接下来要做的“最小群聊功能 MVP”。
目标不是“真正匿名”，而是：

1. 启动项目
2. 打开 Web 页面
3. 输入合规房间码
4. 立即进入房间页 / 聊天区
5. 同一设备自动绑定一个稳定花名匿名身份
6. 先不做注册系统
7. 未来接注册时，不推翻现在的核心真相

一句话先定性：

这不是“无身份聊天室”，而是**设备级稳定伪匿名群聊 MVP**。

---

## 1. 这次最该先信谁

第一优先：

- MDN Web 平台官方文档
- `socket.io` / `socketioxide` 官方文档

第二优先：

- Firebase 官方匿名账户升级文档
- Supabase 官方匿名登录升级文档
- Slack / Discord 官方工程文章

这轮真正要解决的不是“怎么注册”，而是：

1. 浏览器里怎样稳定保存“设备级匿名身份”
2. 这种匿名身份将来怎么升级成注册账户
3. MVP 页面和数据加载怎样保持又快又薄

---

## 2. 设备级花名匿名身份，官方资料给出的最稳方向

### 2.1 不要做浏览器指纹识别，要做“本地持久化的随机设备身份”

MDN 的隐私文档明确提醒：

- 浏览器厂商在持续压制 fingerprinting
- 最好的隐私策略是最小化你收集的数据

这对 `koko` 的直接结论：

1. 禁止为了“识别同一设备”去手搓浏览器指纹
2. 禁止收集一堆硬件、时区、UA 细节拼设备画像
3. MVP 最稳做法是：
   - 首次进入时生成一个随机设备匿名标识
   - 存在浏览器本地
   - 后续用它恢复同一设备的花名身份

来源：

- [Privacy on the web | MDN](https://developer.mozilla.org/en-US/docs/Web/Privacy)
- [User-Agent reduction | MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/User-agent_reduction)

### 2.2 生成随机设备标识，优先用 `crypto.randomUUID()`

MDN 官方说明：

- `crypto.randomUUID()` 是安全随机生成 v4 UUID 的标准 API
- 已广泛可用

这意味着：

- 不要自己拼“时间戳 + Math.random()”当设备标识
- MVP 的设备匿名标识优先直接用浏览器官方 API 生成

来源：

- [Crypto.randomUUID() | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)

### 2.3 设备级匿名标识优先存 `localStorage`，但要清楚它的边界

MDN 官方说明：

- `localStorage` 没有过期时间
- 浏览器私密模式里，数据会在最后一个私密标签关闭时被清掉
- `file:` 场景下行为不稳定

对 `koko` 的实际结论：

1. 这个 MVP 适合把“设备匿名标识 + 花名身份”存 `localStorage`
2. 但这只保证“同浏览器、同站点、未清缓存”下稳定
3. 清浏览器数据、隐私模式、换浏览器、换设备，都应视为新匿名身份
4. 所以它是**设备级伪匿名**，不是设备不可丢失身份

来源：

- [Window.localStorage | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [Web Storage API | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)

### 2.4 同标签外的身份变更同步，可以利用 `storage` 事件

MDN 官方说明：

- 当其他同源文档修改 `localStorage` 时，会触发 `storage` 事件

这对 `koko` 的意义：

- 如果未来一个设备开多个标签页，花名身份或房间态变化时，可以用它做轻同步
- 但这只是前端体验增强，不是业务真相

来源：

- [Window: storage event | MDN](https://developer.mozilla.org/en-US/docs/Web/Events/storage)

---

## 3. 未来接注册系统，官方资料给出的最稳方向

### 3.1 正确思路不是“匿名和注册两套用户体系”，而是“匿名身份可升级”

Firebase 官方匿名认证文档明确支持：

- 先创建匿名账户
- 之后把匿名账户 `link` 到正式身份
- 链接成功后，新账户可继承匿名账户的数据

Supabase 官方匿名登录文档也强调：

- 匿名登录适合先让用户使用产品
- 之后可以把匿名身份链接到永久身份

这给 `koko` 的设计启发非常清楚：

1. 现在的设备级花名身份，不应该是未来的死胡同
2. 未来注册时，应该是“把这个匿名身份升级/绑定到注册身份”
3. 不应该出现：
   - 现在一套匿名用户表
   - 未来又一套正式用户表
   - 最后还要痛苦迁移聊天记录

来源：

- [Authenticate with Firebase Anonymously](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Anonymous Sign-Ins | Supabase Docs](https://supabase.com/docs/guides/auth/auth-anonymous)

### 3.2 对 `koko` 最稳的内部真相模型

结合上面的官方启发，`koko` 最稳的身份设计不是：

- “现在只有花名，未来再想”

而是从第一天就分开：

1. **内部稳定身份**
   - 例如 `anonymous_identity_id` / `profile_id`
   - 后端权威持有

2. **设备绑定入口**
   - 浏览器本地保存 `device_anonymous_token`

3. **展示身份**
   - 花名匿名名
   - 可带默认人格头像 / 标签

4. **未来注册身份**
   - 邮箱 / 手机 / OAuth / 用户名密码
   - 作为“链接到同一内部身份”的新入口

一句话：

**未来加注册，不是换一套人，而是给同一个人增加新身份证。**

---

## 4. 高性能群聊榜样，对这个 MVP 最值钱的启发

### 4.1 Slack：不要一进来就把所有房间和历史全拉了

Slack 官方工程文章《Making Slack Faster By Being Lazy》讲得非常实在：

- 不要在客户端启动时为每个频道都拉最近消息
- 当前在看的频道优先，其他的按需、按可能性加载
- 做少一点、晚一点、懒一点，反而更快

这对 `koko` 的 MVP 是一条非常硬的建议：

1. 首页只做“输入房间码并进房”
2. 进房后只拉当前房间快照和当前房间增量
3. 不要在 MVP 阶段预加载房间列表、其他房间消息、历史大缓存

来源：

- [Making Slack Faster By Being Lazy](https://slack.engineering/making-slack-faster-by-being-lazy/)

### 4.2 Slack Part 2：别迷信 `localStorage` 什么都能缓存

Slack 官方在第二篇里明确提到：

- 他们的 `LocalStorage` 缓存最终变得又慢又脆
- 随着数据增长，反而给 UI 带来卡顿

对 `koko` 的直接结论：

1. `localStorage` 适合存“设备匿名标识、花名身份、极少量本地偏好”
2. 不适合存越来越长的聊天历史、复杂房间缓存、重度消息索引
3. 聊天历史真相仍然该在后端 + 冷路径快照 / 增量

来源：

- [Making Slack Faster By Being Lazy: Part 2](https://slack.engineering/making-slack-faster-by-being-lazy-part-2/)

### 4.3 Discord：实时事件 payload 要克制，不要把展示冗余全塞进去

Discord 官方工程文章《How Discord Reduced Websocket Traffic by 40%》给出的核心方向是：

- 减少无效 websocket 载荷
- 压缩重复信息
- 降低广播体积

对 `koko` 的 MVP 启发：

1. `room_event` 里只放聊天成立所需的最小权威字段
2. 花名展示如果能从稳定身份映射得到，就不要在每条消息里重复塞一大坨冗余展示数据
3. MVP 阶段房间页先把“能聊通”放第一，别让 payload 先膨胀

来源：

- [How Discord Reduced Websocket Traffic by 40%](https://discord.com/blog/how-discord-reduced-websocket-traffic-by-40-percent)

---

## 5. 对 `koko` 这个 MVP 的直接设计结论

### 5.1 你真正要的最小 MVP 形态

启动后进入 Web 页，页面只做一件主事：

1. 浏览器检查本地是否已有 `device_anonymous_token`
2. 如果没有，就生成一个随机设备匿名标识
3. 用这个标识向后端换取或恢复一个稳定花名身份
4. 用户输入合规房间码
5. 成功后直接进入房间页 / 聊天区
6. 房间里展示的是这个设备绑定的花名身份，不是真实注册身份

### 5.2 这个 MVP 的最稳身份模型

MVP 推荐分成三层：

1. 前端本地：
   - `device_anonymous_token`

2. 后端权威：
   - `anonymous_identity_id`
   - `display_alias`
   - 将来可链接 `registered_account_id`

3. 房间消息展示：
   - 用花名匿名身份发言

### 5.3 花名身份的生成原则

最稳方向不是让前端自己乱生成，而是：

1. 前端只负责持有设备匿名 token
2. 后端负责生成和持久化花名身份
3. 同一个 `device_anonymous_token` 默认映射到同一个花名身份

这样做的好处：

1. 前后端不会各有一套花名真相
2. 未来注册升级时，后端能无缝把匿名身份链接过去
3. 花名词库、敏感词过滤、重名处理都在后端收口

### 5.4 现在绝不要做的事

1. 不要做浏览器指纹识别
2. 不要先做注册系统
3. 不要把聊天历史重缓存进 `localStorage`
4. 不要让前端自己永久裁决花名身份真相
5. 不要把“设备匿名 token”直接当最终用户体系

---

## 6. 未来注册时的准备动作

如果按这条路做，未来注册系统只需要做“身份链接”，而不是推翻重来：

1. 当前匿名内部身份继续保留
2. 注册后新增正式认证入口
3. 把正式账户绑定到原匿名内部身份
4. 房间消息、成员关系、历史记录仍归同一个内部身份

这就是最值得提前准备好的地方。

---

## 7. 动手前最后的禁令

1. 禁止把“设备级稳定花名身份”做成浏览器指纹系统
2. 禁止让前端自己成为花名身份真相来源
3. 禁止把匿名身份和未来注册身份设计成两套互不相认的人
4. 禁止一进来就预拉全部历史、全部房间或厚缓存
5. 禁止把 `localStorage` 当聊天数据库

---

## 8. 本轮来源

- [Privacy on the web | MDN](https://developer.mozilla.org/en-US/docs/Web/Privacy)
- [Window.localStorage | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [Web Storage API | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [Window: storage event | MDN](https://developer.mozilla.org/en-US/docs/Web/Events/storage)
- [Crypto.randomUUID() | MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
- [Authenticate with Firebase Anonymously](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Anonymous Sign-Ins | Supabase Docs](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Making Slack Faster By Being Lazy](https://slack.engineering/making-slack-faster-by-being-lazy/)
- [Making Slack Faster By Being Lazy: Part 2](https://slack.engineering/making-slack-faster-by-being-lazy-part-2/)
- [How Discord Reduced Websocket Traffic by 40%](https://discord.com/blog/how-discord-reduced-websocket-traffic-by-40-percent)
