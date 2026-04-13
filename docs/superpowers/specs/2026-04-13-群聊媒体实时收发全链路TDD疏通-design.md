# 群聊媒体实时收发全链路 TDD 疏通设计

日期：2026-04-13  
状态：Draft  
适用范围：`koko` 仓库 `Web 前端 + Rust 后端` 当前阶段的群聊图片/视频实时收发链路，包括上传完成、房间事件、媒体定位、列表预览、查看器、补齐、缓存、释放与 `24 小时` 冷源退场。  
关联文档：

- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/specs/2026-04-12-浏览器端应用平台化-design.md`
- `docs/superpowers/plans/2026-04-13-web媒体资产协议彻底收口实现计划.md`

## 1. 这份 spec 为什么存在

群聊里用户发送的视频或者观看过的视频会变成黑色、一直转圈、只能看到缩略图、点开也播不起来，这不是一个局部播放器 bug。  
这说明媒体链路从上传完成到实际查看之间，至少有一段业务血管发生了堵塞。

当前真正的问题不是“前端完全没缓存”这么简单，而是下面这些事情没有被一起收口：

1. 上传完成后的权威媒体真相，未必被稳定投影到房间消息；
2. `locator` 明明给了新主链，列表预览和查看器却可能还在消费旧链或错误链；
3. `viewer / session / cache / swarm runtime` 之间的 owner 边界不够硬；
4. 失败路径测试不足，导致黑屏、无限转圈、关闭不 release、冷源退场不彻底这些角落靠运气活着。

所以这份 spec 的任务，不是“再修一个黑屏 case”，而是把下面这条链一次真正疏通：

```text
prepare
  -> complete
  -> room event
  -> locator
  -> list preview
  -> viewer
  -> backfill
  -> complete / release
  -> 24h origin cleanup
```

它必须像清血栓一样，一段一段钉住失败测试、最小修复、旧路径退场点，直到整条链恢复成单一真相、单一主链、单一 owner。

## 2. 范围锁定

这份 spec 只覆盖 `Web 前端 + Rust 后端当前阶段`。

不纳入本轮范围：

- `iOS / Android / Desktop / CLI`
- 音频链路
- 大规模压测平台、跨端容量治理、统一观测平台

这样锁范围不是保守，而是为了先把当前真实用户正在踩的群聊图片/视频收发问题修透，再把跨端能力建立在稳定协议和稳定测试矩阵之上。

## 3. 当前阶段完成定义

本 spec 施工完成后，必须满足下面这些条件，才算“群聊媒体实时收发已真正疏通”：

1. 用户发送图片/视频后，发送者和其他成员都能在消息时间线里稳定看到正确预览，不出现黑块和无限转圈；
2. 用户点开查看器后，图片正式走 `blob_asset`，视频正式走 `streaming_asset.manifest`，不允许错误旧链继续渗透；
3. `prepare -> complete -> 房间事件 -> locator -> preview -> viewer -> backfill -> complete/release -> 24h 清理` 每一段都有失败测试；
4. 壳层只负责表达输入与展示快照，不再自己决定媒体业务真相；
5. 旧附件直链、错误预览链、双重判定逻辑必须明确退场，不能“新逻辑叠上去，旧逻辑先留着”。

## 4. DDD 边界：这条血管到底由谁负责

这条媒体实时收发链只允许 5 类 owner，各自只回答一类问题。

### 4.1 `MediaUploadDomain`

负责：

- `prepare / complete` 契约；
- 媒体资产生成与落库；
- 图片 `preview / full / original`；
- 视频 `manifest / segments / distribution`；
- 原始冷源何时过期、何时删除。

不负责：

- 当前聊天页面该怎么播；
- 当前浏览器该怎么恢复；
- swarm 现在是不是活着。

### 4.2 `RoomTimelineProjection`

负责：

- 把 ready 媒体附件投影成房间消息里的稳定事实；
- 决定一条消息有哪些附件、有哪些最小展示信息。

不负责：

- 给壳层拼 `src`；
- 替播放器决定 `HLS / blob / swarm`。

### 4.3 `MediaLocatorOwner`

负责：

- 把附件真相翻译成统一媒体定位结果；
- 回答 `blob_asset / streaming_asset / distribution / origin` 分别是什么；
- 回答当前冷源是否 still available / expired。

不负责：

- 哪个 UI 组件应该选哪个入口；
- 浏览器事件如何转成恢复状态。

### 4.4 `MediaSessionOwner`

负责：

- 当前附件在本客户端中的运行态真相；
- `bootstrapping / preview_ready / playing / backfilling / recovering / waiting / locally_complete / degraded`；
- 收到 `PLAYER_ERROR / WAITING / STALLED / ASSET_BACKFILLING / ASSET_COMPLETE / SWARM_NO_PEERS / RELEASED` 后如何推进。

不负责：

- 实际怎么下载分片；
- 实际如何缓存字节；
- 实际怎么渲染 DOM。

### 4.5 `SwarmRuntime` 与 `MediaCacheOwner`

`SwarmRuntime` 只负责：

- 进入 swarm；
- backfill；
- seeding；
- presence；
- release 与 runtime reset。

`MediaCacheOwner` 只负责：

- 本地完整度；
- 本地长期保留元数据；
- `kind / contentHash / retainedAt / lastAccessAt / complete` 这类真相。

它们都不允许反客为主，去决定 UI 文案、业务成功语义或查看器流程。

## 5. Unix 切片：每段链路只回答一个问题

为了让这条链轻、准、可测，必须把群聊媒体实时收发切成以下小段：

1. `prepare`
   - 只回答上传授权与运输契约是否成立；
2. `complete`
   - 只回答媒体资产真相是否已经生成；
3. `room event`
   - 只回答这条消息现在拥有什么 ready 附件；
4. `locator`
   - 只回答这个附件现在有哪些正式入口和分发线索；
5. `list preview`
   - 只回答时间线卡片该用什么预览源；
6. `viewer`
   - 只回答点开后真正查看哪个资产入口；
7. `session`
   - 只回答当前恢复与补齐状态；
8. `runtime / cache`
   - 只回答如何 backfill、如何保留、如何 release；
9. `24h cleanup`
   - 只回答 origin 何时退场、删除后谁还应该存活。

任何一段偷偷多回答一个问题，都会重新长出 bug 温床。

## 6. 已知病灶

这份 spec 先把当前已经暴露出的真实病灶写清楚，后续实现必须逐个清掉：

1. 视频 `manifest` 主链已经成立，但消息卡片预览仍可能把 `m3u8` 直接塞进原生 `<video>`；
2. 视频时间线没有稳定 `poster` 真相时，会退化成黑块和转圈；
3. 列表预览、查看器、播放会话没有清楚区分“预览入口”和“正式查看入口”；
4. 图片虽然已经有 `blob_asset`，但部分链路仍保留旧附件内容地址思维；
5. `ASSET_BACKFILLING / ASSET_COMPLETE / SWARM_NO_PEERS / release` 已有局部信号，但还没形成完整回归矩阵；
6. `24 小时` 冷源窗口虽然已有协议语义，但必须确保没有调用方继续把旧冷源当主链。

## 7. 核心设计决策

### 7.1 列表预览和查看器必须拆开

列表卡片只为“可见预览”负责，不为正式查看负责。  
查看器才是真正消费 `blob_asset` 和 `streaming_asset` 主链的地方。

### 7.2 视频正式查看主链只有 `streaming_asset.manifest`

时间线卡片如果不能稳定播放 `manifest`，就退回 `poster` 或安全占位。  
不允许再把 `m3u8` 当普通视频文件塞给原生 `<video>`。

### 7.3 图片正式查看主链只有 `blob_asset.full / original`

时间线优先 `preview`，查看器优先 `full`，`original` 负责长期资产真相与导出语义。  
不允许继续靠顶层旧 `original_url` 混着用。

### 7.4 `MediaSessionOwner` 是浏览器媒体运行态唯一裁决者

所有浏览器媒体事件、查看器事件、swarm runtime 事件都必须先变成信号，再由 `MediaSessionOwner` 裁决。  
浏览器事件只是信号，不是业务事实。

### 7.5 `MediaCacheOwner` 只保留本地资产真相

它不保存 UI 意图，不保存查看器开关，不保存壳层流程。  
它只回答“本地是否已经拥有完整资产以及何时保留过它”。

### 7.6 `SwarmRuntime` 只做补齐与分发

它不负责宣布业务成功，不负责 degraded 文案，也不负责查看器策略。  
它的职责边界就是进入、补齐、做种、presence、release。

### 7.7 旧主链必须有明确退场点

只要某个壳层还能绕过 `blob_asset / streaming_asset` 直接吃旧附件 `original_url`，就算没完成。

### 7.8 每修一段就补一段失败测试

不允许只改生产代码，然后用“我手测感觉好了”当证明。  
每个修复必须有失败测试先红、实现后转绿，再清理旧路径。

## 8. TDD 总策略

这份 spec 的施工原则不是先大重构，而是先把每段堵点钉成失败测试，再做最小修复。

推荐测试层次：

1. `Rust 契约测试`
   - 守 `prepare / complete / locator / 24h cleanup`；
2. `前端播放器 / 查看器 / 会话单测`
   - 守主链选择、事件翻译、状态推进、release；
3. `聊天应用编排测试`
   - 守 `room event -> locator -> preview/viewer -> session signal`；
4. `高价值端到端冒烟`
   - 守真实用户体验，不再只看局部函数。

## 9. 必须补齐的测试矩阵

### 9.1 `prepare -> complete`

必须覆盖：

- 视频 complete 后必须落真实 `manifest` 资产；
- 图片 complete 后必须落 `preview / full / original` 三层资产；
- 缺工具或转码失败时 complete 必须明确失败，不允许假 ready。

### 9.2 `complete -> room event`

必须覆盖：

- ready 媒体附件进入消息快照时，必须带最小稳定展示事实；
- `room projection` 不能脑补 runtime 字段；
- 发送者和其他成员拿到的是同一套契约事实。

### 9.3 `room event -> locator`

必须覆盖：

- 视频 locator 必须带 `streaming_asset.manifest`；
- 图片 locator 必须带 `blob_asset`；
- `24h` 后 origin 顶层冷源必须失效，但长期资产主链仍可用。

### 9.4 `locator -> list preview`

必须覆盖：

- 视频 `manifest` 模式下，消息卡片不能把 `m3u8` 喂给原生 `<video>`；
- 没有 `poster` 时必须走安全占位，不允许黑块赌博；
- 图片列表必须优先 `preview`。

### 9.5 `list preview -> viewer`

必须覆盖：

- 点击视频后查看器必须拿到 manifest 主链；
- 点击图片后查看器必须拿到 `full / original` 主链；
- 打开失败不能卡死视口占用。

### 9.6 `viewer -> session`

必须覆盖：

- `playing / waiting / stalled / error / loadComplete` 都必须翻译成标准信号；
- 图片 `loadComplete` 必须推进 `ASSET_COMPLETE`；
- 视频 `noPeers` 不能直接宣布失败。

### 9.7 `session -> runtime / cache`

必须覆盖：

- backfilling 会激活 swarm；
- complete 会写入 `MediaCacheOwner`；
- close / dispose 会 release；
- 重开后能恢复 `locally_complete`。

### 9.8 `24h cleanup`

必须覆盖：

- 原始冷源会真实删除；
- 删除后 locator 顶层 origin 失效；
- 图片长期资产和视频 manifest 资产不会被误删。

## 10. 失败判定

只要出现下面任一情况，就说明这份 spec 没有真正把血管疏通：

1. 消息卡片还能继续直接消费错误旧链；
2. 查看器和列表对同一附件使用两套不受控主链；
3. 壳层继续裁决“该不该恢复 / 等待 / complete”；
4. `MediaSessionOwner` 只测成功路径，不测等待与失败路径；
5. 修了黑屏，但没有补失败测试；
6. 为了修一个点，又长出新的私有 `manager / wrapper / runtime`；
7. `blob_asset / streaming_asset` 已存在，但旧附件直链仍长期双活；
8. release、`24h` 清理、cache 恢复这些冷角落没进测试矩阵。

## 11. 分阶段实施顺序

### 阶段 A：锁住真实症状

先把黑块、转圈、只有缩略图、关闭不 release、24h 后仍能走旧冷源这些已知问题全部写成 characterization tests。

### 阶段 B：疏通视频预览链

先修列表卡片错误把 `manifest` 喂给原生 `<video>` 的问题，确保消息时间线不再因为错链而黑屏。

### 阶段 C：疏通查看器正式主链

确保视频一定走 `manifest`，图片一定走 `blob_asset.full / original`，并补上失败与降级语义。

### 阶段 D：疏通会话与运行态

把 viewer 与 runtime 信号统一回流到 `MediaSessionOwner`，不再在壳层和查看器内部偷偷裁决状态。

### 阶段 E：疏通 cache / release / 24h

把 complete、retain、release、origin 删除这几个冷角落全部补齐。

### 阶段 F：退场旧旁路

删掉旧附件直链、重复判定和旁路兼容分支，避免“看起来修好了，实际上新旧双活”。

## 12. 后续 implementation plan 必须写清什么

基于这份 spec 继续写 plan 时，每个阶段都必须明确：

1. 本阶段收口哪个 owner；
2. 本阶段让哪个旧入口退场；
3. 本阶段新增哪些失败测试；
4. 本阶段删掉或收缩哪段旧复杂度；
5. 本阶段复用哪个成熟轮子，为什么它只是通用能力而不是新的私有核心；
6. 本阶段暂时不做什么，以避免范围膨胀；
7. 本阶段如何验证没有引入双真相。

如果 plan 里只写“接入 X”“增加 runtime”“补个判断”，但没写旧路径退场点和失败测试，就不能进入编码。

## 13. 一句话结论

这份 spec 的目标不是“再修几个媒体 bug”，而是：

**把群聊图片/视频从上传完成到查看结束这整条实时收发血管，按 DDD owner 和 Unix 小段职责彻底疏通，并用 TDD 把每个回归口焊死。**
