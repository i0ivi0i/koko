# Pending-first 群聊媒体发送设计

日期：2026-05-15
状态：Design / 待实现计划

关联：

- `docs/superpowers/specs/群聊媒体秒达优化-plan.md`
- `docs/superpowers/specs/2026-05-13-WebTorrent-P2P做种即时可靠性修复-design.md`
- `docs/superpowers/specs/2026-05-12-后端WebTorrent零延迟强种子群友-design.md`
- `docs/superpowers/specs/2026-05-14-群聊视频发送者慢于接收者的问题分析-design.md`
- `frontend/媒体/媒体草稿.ts`
- `frontend/实时/应用.ts`
- `src/消息/应用.rs`
- `src/媒体/上传/外壳/完成上传.rs`

---

## 1. 大白话结论

现在群聊发媒体像“照片必须办完所有手续，才允许告诉群里有人发了照片”。

目标体验应该是：

```text
用户选图/视频
  -> 点发送
  -> 群里立刻出现这条消息和本地预览
  -> 附件显示上传中/处理中
  -> 后台上传、校验、写 canonical、生成 torrent、服务器做强种子
  -> 完成后同一条消息升级为 ready
  -> 失败时同一条消息显示可重试
```

一句话：**消息先落地，媒体后台完成；Socket.IO 传小事件，WebTorrent 传大字节，服务器负责真相、安全和高速兜底。**

---

## 2. 当前真实问题

Serena 和 GitNexus 已查到当前代码有两道 ready 门禁：

1. 前端 `frontend/媒体/媒体草稿.ts` 的 `提取可发送媒体附件标识` 和 `提取可发送媒体附件元数据` 只接受 `ready + attachmentId`。草稿是 `transporting` 或 `processing` 时返回 `null`，发送链路停止。
2. 后端 `src/消息/应用.rs` 的 `从附件快照构造待发送附件` 明确写着“ready 才允许进入消息主链”，非 ready 返回 `附件未就绪`。

`src/媒体/上传/外壳/完成上传.rs` 的 complete 阶段还会同步做这些重活：

- 等 tus sidecar finished 回执。
- 读取和校验临时文件。
- 写 canonical 对象。
- 构造协作分发元数据。
- 生成 torrent 元信息。
- 写附件 ready、canonical 资产、分发元数据、torrent 元数据。
- 触发后端 WebTorrent 强种子。

所以小图小视频也慢，不是先假设底层网络坏，而是用户发送动作被完整媒体 ready 流程挡住。

---

## 3. 设计目标

1. 发送者点击发送后，消息在本地时间线立即出现。
2. 后端允许“消息已创建但附件未 ready”的权威状态。
3. 附件后台完成后，后端广播权威升级事件。
4. 失败时保留消息和附件槽位，允许重试或删除。
5. Socket.IO/socketioxide 只广播小型状态事件，不承载媒体字节。
6. 正式媒体字节仍只走 WebTorrent whole-file swarm；服务器作为大带宽强种子和短期 web seed 兜底。
7. 不把 UI pending 状态当业务成功；消息成立和附件 ready 是两个不同事实。
8. 不手搓 WebTorrent、WebRTC、BitTorrent 或 tus 替代协议。

---

## 4. 非目标

1. 不把 HLS、DASH、原文件直链、CDN、range 静态预览变成第二媒体主链。
2. 不绕过服务端权限、成员资格、附件归属、安全校验。
3. 不让前端自行宣布附件 ready。
4. 不把 sidecar runtime、本地文件路径、WebTorrent 连接细节塞进 domain。
5. 不要求第一版改完所有上传性能问题；Tus 连接复用和 `to_vec()` 优化可以作为后续同链路性能任务。
6. 不用“本地乐观消息”替代后端权威消息。乐观态只能是体验投影，不能成为业务真相。

---

## 5. DDD 上下文与统一语言

### 5.1 Bounded Context

本设计涉及四个上下文：

- **消息上下文**：裁决一条消息是否属于房间、谁发送、消息生命周期是什么。
- **媒体上下文**：裁决附件上传、校验、ready/failed、canonical 内容身份。
- **实时上下文**：传递消息和附件状态变化事件，不拥有业务事实。
- **协作分发上下文**：管理 WebTorrent swarm、tracker、web seed、强种子 presence。

### 5.2 核心语言

- **消息已创建**：消息已经属于房间，可被群成员看到。
- **附件槽位**：消息里预留的媒体位置，可能是 pending、ready 或 failed。
- **附件待完成**：附件已绑定到消息，但媒体内容还没完成 ready 裁决。
- **附件已就绪**：媒体上下文完成校验、存储、分发元数据和 ready 快照。
- **附件完成失败**：媒体后台完成失败，但消息不自动消失。
- **附件状态已变更**：附件槽位从 pending/processing/failed 变为另一种权威状态。

### 5.3 聚合和 owner

**消息聚合**拥有：

- `message_id`
- `client_message_id`
- `room_id`
- `sender`
- `text`
- `attachment_slots`
- 消息是否成立

**媒体附件聚合**拥有：

- `attachment_id`
- 上传会话
- 所属发送者
- 归属消息槽位
- 媒体状态
- canonical 内容身份
- 分发元数据

消息聚合不判断媒体文件是否已经可播放；媒体聚合不判断消息是否应该进入某个房间。两者通过稳定 ID 和应用层用例协作。

---

## 6. 六边形边界

### 6.1 Domain

Domain 只表达业务事实：

- 消息可创建，且可携带 pending 附件槽位。
- 附件槽位状态只能按合法状态迁移。
- ready 不是消息成立的前提，而是附件槽位的后续状态。

Domain 禁止依赖：

- Axum、socketioxide、SQLx、reqwest。
- WebTorrent、tusd、DOM、Video.js。
- 本地文件路径、sidecar 控制面字段。

### 6.2 Application

Application 负责用例编排：

- `创建消息_异步` 接收文本和附件草稿/上传会话引用，创建消息和附件槽位。
- `完成媒体附件上传` 继续由媒体应用 owner 裁决 ready。
- 新增或扩展“附件状态升级”用例，将媒体完成结果投影到消息附件槽位。

Application 可以发布领域事件，但不能把外部广播细节写进领域。

### 6.3 Contract

Contract 放稳定跨壳表面：

- `消息已创建` 事件可包含 `附件槽位快照`。
- `附件槽位快照` 包含 `status: pending | processing | ready | failed`。
- ready 时才包含完整播放/分发线索。
- failed 时包含稳定错误码。

Contract 禁止包含：

- UI 文案。
- DOM 状态。
- WebTorrent runtime 对象。
- sidecar 本地路径。

### 6.4 Adapter / Shell

Adapter 负责：

- HTTP/tus/socket 请求转译。
- SQL 读写。
- 鉴权材料读取。
- 错误码映射。
- sidecar 控制面调用。

Shell 负责：

- 本地预览。
- 上传进度。
- 发送按钮状态。
- retry/delete 交互。
- Socket.IO 事件接线。

---

## 7. 状态机

### 7.1 附件槽位状态

```text
pending
  -> uploading
  -> processing
  -> ready

pending/uploading/processing
  -> failed

failed
  -> uploading   (用户重试)
  -> removed     (用户删除附件槽位或撤回消息)
```

### 7.2 消息状态

第一版不需要把消息本身做复杂状态机。消息只需要区分：

- `created`：消息已创建。
- `deleted`：后续如果支持撤回/删除再处理。

附件失败不等于消息失败。消息里可以有 failed 附件槽位。

### 7.3 非法状态

1. 前端不能把本地预览宣布为 `ready`。
2. 后端不能在媒体校验失败时广播 ready。
3. complete 失败不能让消息消失。
4. 同一个 `client_message_id` 重试不能创建多条消息。
5. 同一个附件槽位不能同时存在两个 ready 内容身份。

---

## 8. 新数据流

### 8.1 发送端

```text
选择文件
  -> shell 创建本地预览和草稿
  -> media upload prepare 创建 attachment/session
  -> 用户点发送
  -> realtime emit create_message {
       text,
       pending_attachment_slots: [{ attachment_id, local_id, kind, width, height }]
     }
  -> 前端立刻插入本地乐观消息
```

如果上传还没拿到服务端 `attachment_id`，第一版不应硬发裸本地文件 ID 到后端。更稳路径是：

1. 文件选择后先快速 prepare，拿到 `attachment_id`。
2. prepare 成功即可允许消息创建为 pending。
3. 字节上传和 complete 继续后台进行。

### 8.2 后端创建消息

```text
create_message
  -> 校验 session、房间、成员资格
  -> 校验 attachment_id 属于发送者
  -> 不要求 attachment ready
  -> 创建消息 + 附件槽位 pending/processing
  -> 提交消息事件
  -> room_event: message_created
```

这一步必须仍然拒绝：

- 附件不属于当前发送者。
- 附件不存在。
- 附件已被删除或过期。
- 附件类型不支持。
- 单条消息附件数量超限。

### 8.3 媒体后台完成

```text
tus upload finished
  -> complete_media_upload
  -> 校验内容
  -> 写 canonical
  -> 生成 torrent
  -> 写媒体 ready 快照
  -> 写协作分发元数据
  -> 启动服务器强种子
  -> 发布 attachment_status_changed(ready)
```

### 8.4 群友接收

```text
room_event: message_created
  -> 立刻显示消息
  -> pending 附件显示占位/上传中

room_event: attachment_status_changed ready
  -> 同一条消息同一个附件槽位升级
  -> 写 locator/distribution hint
  -> WebTorrent prefetch / autoplay 复用已有协作分发链
```

---

## 9. 实时事件设计

### 9.1 `message_created`

新增或扩展附件快照：

```json
{
  "type": "message_created",
  "message_id": "m-1",
  "client_message_id": "c-1",
  "text": "hello",
  "attachments": [
    {
      "kind": "video",
      "attachment_id": "att-1",
      "status": "processing",
      "width": 1280,
      "height": 720
    }
  ]
}
```

### 9.2 `attachment_status_changed`

ready：

```json
{
  "type": "attachment_status_changed",
  "message_id": "m-1",
  "attachment_id": "att-1",
  "status": "ready",
  "width": 1280,
  "height": 720,
  "distribution_hint": {
    "swarm_id": "swarm",
    "torrent_info_hash": "infohash",
    "join_ticket": "runtime-signed",
    "announce_urls": ["wss://tracker"]
  }
}
```

failed：

```json
{
  "type": "attachment_status_changed",
  "message_id": "m-1",
  "attachment_id": "att-1",
  "status": "failed",
  "error_code": "attachment_upload_failed"
}
```

事件必须是后端权威事实。前端本地进度可以更细，但不进入共享 contract。

---

## 10. WebTorrent 与服务器强种子

本设计继承既有 WebTorrent 主链：

1. 正式媒体字节只走 WebTorrent whole-file swarm。
2. 浏览器发起者可以在本地持有文件时尽快成为初始 peer。
3. 服务器 complete 后作为大带宽强种子加入同一 swarm。
4. `webSeeds` 是 WebTorrent BEP19 内部兜底，不是播放器直链。
5. `seedOutgoingConnections`、`maxConns`、tracker、join ticket 继续走成熟 WebTorrent/Socket.IO 生态能力。

服务器不是退出链路，而是做：

- 真相裁判。
- 安全门卫。
- 大带宽强种子。
- 24 小时冷源兜底。
- 分发线索签发者。

---

## 11. 失败与重试

### 11.1 上传失败

前端显示：

- 消息仍在。
- 附件槽位显示失败。
- 用户可重试或移除附件。

后端规则：

- retry 使用同一个消息槽位或明确的新附件槽位版本。
- 不能创建重复消息。
- 不能把旧失败附件和新 ready 附件同时投影成同一个槽位的真相。

### 11.2 complete 失败

complete 失败要广播 failed 状态，带稳定错误码。

第一版可先支持：

- `attachment_type_not_allowed`
- `attachment_upload_failed`
- `attachment_processing_failed`
- `system_error`

### 11.3 断线重连

客户端重连后从历史/恢复接口拿到当前权威快照：

- 消息存在。
- 每个附件槽位有当前状态。
- ready 附件带分发线索或可重新定位。
- failed 附件带错误码。

---

## 12. 幂等与顺序

1. `client_message_id` 继续作为消息创建幂等锚点。
2. `attachment_id` 作为附件槽位关联锚点。
3. 状态升级事件必须带 `event_position` 或可被时间线 owner 有序合流。
4. 重复收到同一状态事件必须幂等。
5. 旧状态不能覆盖新状态：`processing` 不能覆盖 `ready`，`uploading` 不能覆盖 `failed/ready`。

---

## 13. 安全边界

1. 创建 pending 附件消息前仍要校验附件归属。
2. 前端传来的宽高、文件名、MIME 只能作为体验提示；ready 事实必须来自服务端校验。
3. 服务器签发 WebTorrent join ticket 时必须按房间成员资格和附件可读性裁决。
4. failed/ready 状态广播不得泄漏本地文件路径、Tus 临时路径、对象存储密钥。
5. 附件未 ready 时不能提供正式播放地址。

---

## 14. 分阶段落地建议

### Phase 1：领域和 contract 先开口子

目标：后端消息主链允许 pending 附件槽位，但仍严格校验归属。

关键文件：

- `src/共享/契约基础.rs`
- `src/领域/消息.rs`
- `src/消息/应用.rs`
- `src/消息/适配.rs`
- `tests/消息主链测试.rs`
- `tests/用例测试.rs`

### Phase 2：前端发送体验改成 pending-first

目标：prepare 后即可发送消息，草稿不再等 ready 才允许点击发送。

关键文件：

- `frontend/媒体/媒体草稿.ts`
- `frontend/输入框/应用.ts`
- `frontend/实时/应用.ts`
- `frontend/时间线/领域.ts`
- `frontend/应用根/聊天壳操作台视图.ts`
- `frontend/tests/聊天壳/附件草稿与发送门禁测试.spec.ts`
- `frontend/tests/媒体草稿测试.spec.ts`

### Phase 3：附件状态升级事件

目标：complete 成功/失败后广播 `attachment_status_changed`，时间线同槽位升级。

关键文件：

- `src/媒体/上传/外壳/完成上传.rs`
- `src/实时/外壳.rs`
- `src/外壳/协议响应.rs`
- `frontend/聊天共享/契约.ts`
- `frontend/时间线/领域.ts`

### Phase 4：性能低垂果实

目标：在语义正确后优化耗时热点。

候选：

- `src/媒体/上传/外壳/tus代理.rs` 复用 `reqwest::Client`。
- 视频 canonical 写入避免 `mmap.as_ref().to_vec()` 的整文件复制。
- complete 重活拆后台任务队列，但必须保留 ready 权威升级事件。

---

## 15. TDD 验证规格

### 15.1 后端 RED

新增失败测试：

1. `processing` 附件属于发送者时，`创建消息_异步` 应创建消息并返回 pending 附件槽位。
2. 附件属于别人时仍拒绝。
3. 附件不存在时仍拒绝。
4. pending 附件消息不会带 ready 分发线索。
5. complete 成功后产生附件 ready 升级事件。
6. complete 失败后产生附件 failed 升级事件。

### 15.2 前端 RED

新增或改写失败测试：

1. `processing` 草稿存在且有 `attachmentId` 时，发送按钮不再禁用。
2. 点击发送后立刻出现本地消息和本地预览。
3. `transporting` 但尚无 `attachmentId` 时仍阻止发送，避免裸本地 ID 进入后端。
4. 收到 ready 升级事件后，同一附件槽位更新为 ready。
5. 收到 failed 升级事件后，同一附件槽位显示失败和重试入口。

### 15.3 真实烟测

必须用真实浏览器和真实上传链路：

1. 启动完整栈。
2. 进入房间。
3. 选择小图片，prepare 后立刻发送。
4. 验证消息在 100ms 级别出现在发送者时间线。
5. 验证附件先显示 pending/processing，再升级 ready。
6. 另一个浏览器能收到同一条消息和后续升级。
7. 视频路径验证服务器强种子最终加入同一 WebTorrent swarm。

---

## 16. 观测指标

必须打点能回答：

1. 用户点击发送到本地消息出现耗时。
2. create_message 到 room_event 广播耗时。
3. 附件 pending 到 ready 耗时。
4. complete 各阶段耗时。
5. ready 到服务器强种子 `torrent.done` 耗时。
6. failed 原因分布。
7. retry 成功率。

建议日志字段：

```text
application="创建消息" | "完成媒体上传" | "附件状态升级"
room_id
message_id
client_message_id
attachment_id
attachment_status
event_position
duration_ms
error_code
```

---

## 17. 方案裁决

### 17.1 拒绝：只改前端按钮

原因：后端仍会拒绝非 ready 附件，会制造假成功。

### 17.2 拒绝：把媒体字节塞进 Socket.IO

原因：Socket.IO 适合小事件，不适合承载图片视频字节；会破坏 WebTorrent 主链和背压边界。

### 17.3 拒绝：自研 WebTorrent/RTC 传输

原因：官方 WebTorrent 已提供 browser/Node、tracker、webSeeds、连接预算等成熟能力。自研会重复造轮子。

### 17.4 选中：pending-first 消息 + 后台附件升级

原因：

- 最贴近正常聊天体验。
- 消息真相和附件真相分离，不造假。
- 继续复用 Socket.IO 和 WebTorrent 成熟生态。
- 符合 DDD/六边形边界。

---

## 18. 自审记录

### 第一遍：需求意图

检查：用户要的是普通人感觉“选中、发送、立刻看见”，不是继续解释网络复杂。

修正点：把文档第一节写成大白话结论，并把目标定义为 pending-first，而不是 complete 加速。

结论：通过。

### 第二遍：架构边界

检查：是否让前端 pending 状态冒充业务成功，是否把 WebTorrent/sidecar/tus 泄漏进 domain。

修正点：明确消息聚合和媒体附件聚合分离；ready 只归媒体 owner；Socket.IO/WebTorrent/tusd 只在 adapter/shell。

结论：通过。

### 第三遍：验证闭环

检查：是否有 RED/GREEN 路径、失败路径、真实烟测和观测指标。

修正点：补齐后端、前端、真实浏览器三层测试；明确 `transporting` 无 `attachmentId` 仍不能发送，避免裸本地 ID。

结论：通过。

---

## 19. 100% 信心循环

问题：我对当前设计是否事实 100% 有信心？

第一轮回答：不是。风险是 pending 消息被误解成附件已经成功。

修复：第 5、7、9、13 节明确消息成立和附件 ready 是两个事实；前端不能宣布 ready。

第二轮回答：不是。风险是为了“立刻发送”绕过附件归属和安全校验。

修复：第 8、13、15 节明确 create_message 仍必须校验附件存在、归属、成员资格和类型约束。

第三轮回答：不是。风险是附件还没拿到服务端 `attachment_id` 就发送，导致后端只能相信本地 ID。

修复：第 8.1 和 15.2 明确第一版必须 prepare 成功拿到 `attachment_id` 后才能发送 pending 消息。

第四轮回答：不是。风险是 Socket.IO 被拿去传大文件，破坏实时热路径。

修复：第 3、9、10、17 节明确 Socket.IO 只传小事件，媒体字节仍只走 WebTorrent whole-file swarm。

第五轮回答：不是。风险是 complete 重活后台化后，失败没有权威回传，用户只看到永远处理中。

修复：第 9、11、15、16 节加入 `attachment_status_changed failed`、错误码、retry 和观测指标。

第六轮回答：不是。风险是本设计和既有“后端强种子零延迟”文档冲突。

修复：第 10、14 节明确本设计继承既有 WebTorrent 主链；强种子优化仍以 `torrent.done` 为事实，不被 pending-first 改写。

第七轮回答：现在有事实信心。设计把“用户发送体验”从“附件 ready 门禁”中解耦，同时没有牺牲后端真相、安全裁决、WebTorrent 主链和 DDD/六边形边界。下一步可以基于本 spec 写实现计划，并严格按 TDD 分阶段落地。
