# 实时视频自动播 WebTorrent 接力修复设计

日期：2026-05-17
状态：Design / Ready for implementation plan after owner review
方案：前台播放接力协议

关联文件：

- `frontend/媒体/播放会话/应用.ts`
- `frontend/媒体/媒体播放.ts`
- `frontend/媒体/媒体定位.ts`
- `frontend/媒体/协作分发/应用.ts`
- `frontend/媒体/资产协作分发运行时.ts`
- `frontend/媒体/壳层/自动播协作.ts`
- `frontend/媒体/运行时.ts`
- `frontend/媒体/自动播运行时裁决.ts`
- `frontend/媒体/信息流视频预算.ts`
- `frontend/房间消息窗/时间线媒体基类.ts`
- `frontend/房间消息窗/视频附件渲染.ts`
- `frontend/房间消息窗/视频附件表面渲染.ts`
- `frontend/tests/媒体播放定位刷新测试.spec.ts`
- `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts`
- `frontend/tests/媒体运行时自动播稳定表面测试.spec.ts`
- `frontend/tests/房间消息窗/自动播露出门禁测试.spec.ts`
- `frontend/tests/房间消息窗/时间线播放器宿主owner测试.spec.ts`
- `docs/superpowers/specs/2026-05-13-WebTorrent-P2P做种即时可靠性修复-design.md`
- `docs/superpowers/specs/2026-05-16-全屏退出视频卡片黑闪根因与修复-design.md`
- `学习/浏览器中的应用-前端应用化方案.md`
- `UIUX禁令.md`

---

## 1. 一句话结论

实时新视频自动播黑灰占位的根因不是“WebTorrent 不行”，而是**实时预热路径和前台播放路径没有形成可证明的接力协议**。

正确修复不是新增直链、HLS、CDN 或第二播放器，而是把现有链路收成一条唯一主链：

```text
room_event distribution_hint(web_seed_url=null)
  -> prefetch 加入 WebTorrent swarm，不下载正式字节
  -> inline_autoplay/viewer 成为前台消费者
  -> forceRefresh locator 取得当前 session 的 web_seed_url
  -> 复用同一 torrent 并 addWebSeed(web_seed_url)
  -> 探测 file.streamURL 首个 body chunk
  -> 只在正式字节可读后提交 swarm playback
  -> 唯一时间线播放器挂源、play promise 成功或首帧提交后揭帘
```

这条链路必须像产品里的“传接球”：每一步有唯一 owner、明确输入输出、失败语义和验证证据。用户不应该知道 WebTorrent、WebRTC、web seed、Service Worker 或 locator 刷新存在。

---

## 2. 用户现象

在万人实时群聊中：

1. 用户 A 发送视频到群里。
2. B/C/D 在线接收者立刻看到视频卡片。
3. 卡片没有自动播放，显示黑色或灰色占位。
4. 页面刷新后，视频能自动播放。
5. 不刷新时，手动点击卡片进入查看器，也能恢复播放。

产品上这非常糟糕。用户期待的是：

```text
我刚发出去的视频，群友看见它时，它就像一条活消息一样自然动起来。
```

而不是：

```text
群友看到一个技术系统还没准备好的残影，然后被迫刷新或点击。
```

`UIUX禁令.md` 的判断标准是“用户进入现场，不是在浏览页面”。所以这个 bug 的产品本质不是一个播放器 bug，而是**现场连续性断裂**。

---

## 3. 官方资料和成熟实践依据

### 3.1 WebTorrent 官方依据

已查 WebTorrent 官方文档和 FAQ，关键点如下：

1. 浏览器 WebTorrent 正式播放路径应使用 `client.createServer({ controller })`，由 Service Worker 服务 `file.streamURL` 或 `file.streamTo(elem)`。
2. `file.streamURL` 是官方浏览器 DOM 播放入口，支持 Range、seek 和浏览器原生 codec/container 能力。
3. `torrent.addWebSeed(urlOrConn)` 是官方 BEP19 Web Seed API；浏览器中 web seed 必须满足 CORS。
4. `torrent.select(start, end)`、`torrent.deselect(start, end)`、`torrent.critical(start, end)` 是官方 piece priority 控制。
5. `file.stream()` / `file.createReadStream()` 会优先拉流读取所需 piece。
6. 浏览器 WebTorrent 只能连 WebRTC-capable peers，不能指望传统 BitTorrent peer 直接连到浏览器。
7. `.mp4/.m4v/.m4a` 支持最好，MP4 faststart / moov atom 前置能更快首帧。

对本项目的含义：

- **`web_seed_url` 是 WebTorrent 主链的一部分**：它是同一个 torrent swarm 的 BEP19 web seed，不是绕过 WebTorrent。
- **正式字节仍来自 WebTorrent 官方 `file.streamURL`**：不能把原文件 URL 直接塞给 `<video>`。
- **预热不是播放**：预热只能提前加入 swarm，不能证明视频已经可播。

### 3.2 MDN / Chrome autoplay 依据

已查 MDN autoplay guide 和 Chrome autoplay policy：

1. muted autoplay 通常允许。
2. autoplay with sound 通常需要用户激活、MEI 或安装/PWA 等条件。
3. 永远不能假设 `play()` 会成功。
4. 必须检查 `HTMLMediaElement.play()` 返回的 Promise。
5. 内联 feed 视频应使用 `muted + playsinline + autoplay`。
6. UI 不应显示“正在播放/可暂停”，除非 `play()` 真的开始或首帧真的提交。

对本项目的含义：

- 自动播卡片必须默认静音。
- 播放器壳要处理 `play()` rejection。
- 黑灰占位不能靠“再调一次 play”盲修；必须先证明 source 字节可读、再让播放器接管。

### 3.3 Video.js v10 依据

已查 Video.js v10 文档：

1. Video.js 支持 `autoplay: true/muted/play/any`。
2. 推荐用 `player.play()` Promise 判断自动播是否被阻止。
3. source 必须先成立，再触发播放。
4. 复用或销毁 player 实例应由明确 owner 控制。

对本项目的含义：

- Video.js 只做播放器壳，不拥有 source 真相。
- WebTorrent source owner 仍在媒体播放/协作分发链路。
- 时间线唯一播放器只能消费已裁决的 `swarm` 播放结果。

### 3.4 Fetch / ReadableStream 依据

已查 MDN Fetch 和 Streams：

1. `Response.body` 是 `ReadableStream`。
2. 流式读取可以按 chunk 消费，避免整文件读入。
3. 读取 stream 会锁定 reader，结束或取消时应释放/取消。
4. 仅 `response.ok` 或 `206` 不代表媒体字节已到达。

对本项目的含义：

- `file.streamURL` 探测不能只看 `fetch()` header 成功。
- 必须在 timeout 内读到首个 body chunk，才可把它当成“可交给播放器”的 source。
- 探测不能整文件读入，不能制造 OOM。

### 3.5 Cloudflare / 生产实时依据

已查 Cloudflare WebSocket 文档：

1. Cloudflare 边缘更新可能终止 WebSocket。
2. 生产必须实现 keepalive/reconnect。
3. WSS 连接成功不等于媒体字节可播放。

对本项目的含义：

- `room_event` 到达、socket 在线、tracker 有回应，都只能是信号。
- 播放成功真相必须来自 WebTorrent stream 字节与播放器首帧。

---

## 4. 当前项目事实

### 4.1 广播 hint 的真实语义

`附件分发线索.web_seed_url` 在广播路径设计上可以是 `null`。原因是 `web_seed_url` 带 per-session 鉴权，不能在 room_event 里广播给所有用户共用。

所以实时消息到达时，接收者拿到的 `distribution_hint` 主要用于：

```text
content_hash / swarm_id / torrent_info_hash / announce_urls / join_ticket
```

这些足够让前端提前加入 swarm，但不保证立即有可读字节。

### 4.2 预热路径已经存在

`frontend/媒体/播放会话/应用.ts` 里 `预热权威消息媒体分发` 会：

1. 收到 room_event。
2. 从 attachment 的 `distribution_hint` 构造最小 locator。
3. 写入媒体定位缓存。
4. 如果有 `join_ticket + announce_urls`，立即以 `prefetch:${attachmentId}` 加入 swarm。

这个路径的正确语义是：

```text
早到 50-200ms 的 WebRTC 连接预热，只建立连接，不下载正式 piece。
```

它不应该提交播放源，也不应该让 UI 认为视频已经可播。

### 4.3 前台播放强刷 locator 已有修复痕迹

`frontend/媒体/媒体播放.ts` 中已有针对灰卡片的关键逻辑：

```text
连接态轮询时 await deps.locate(attachmentId, { forceRefresh: true })
再用 refreshed locator 重试 resolveSwarmSource
```

源码注释也明确指出：

```text
之前是 fire-and-forget 导致刷新结果来不及被下一轮使用 → 灰卡片根因
```

这说明历史根因之一已经被识别：

```text
刷新 locator 没有成为播放解析的同步前置条件。
```

### 4.4 prefetch -> foreground web seed 注入已有测试

`frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts` 已覆盖：

1. prefetch locator 的 `web_seed_url = null`。
2. 前台 `inline_autoplay` 使用带 `web_seed_url` 的 refreshed locator。
3. 同一个 torrent 复用。
4. 调用 `addWebSeed(web_seed_url)`。

这说明协作分发 runtime 已有正确方向：**不要新建第二套 torrent，要升级同一个 session**。

### 4.5 自动播 owner 与可见表面还有第二层门禁

`frontend/媒体/自动播运行时裁决.ts` 中，自动播不是“候选出现就 owner 成立”。它有 pending、playback、stable surface、viewer 占用等门禁。

`frontend/媒体/信息流视频预算.ts` 中，只有 inline autoplay owner 且拥有 WebTorrent 正式字节时，才允许 canonical video source 进入 heavy playback。

`frontend/房间消息窗/时间线媒体基类.ts` 中，唯一播放器还要经历 hidden-stage、可见接管、首帧标记、播放位置恢复。

所以即便 `解析播放结果` 返回 `swarm`，UI 仍可能因为“可见 canonical surface 未提交”而继续显示黑灰底板。

---

## 5. 根因模型

根因不是单点，而是两个接力断点可能同时存在。

### 5.1 断点一：预热 locator 被误当成播放 locator

错误链路：

```text
room_event hint(web_seed_url=null)
  -> 构造最小 locator
  -> prefetch session 建立
  -> inline_autoplay 直接复用旧 locator
  -> torrent 没有 web seed
  -> 没有 WebRTC peer 字节或首字节太慢
  -> streamURL 不可读
  -> 黑灰占位
```

正确链路：

```text
inline_autoplay 成为前台消费者
  -> forceRefresh locator
  -> refreshed locator 含 web_seed_url
  -> existing torrent addWebSeed(web_seed_url)
  -> streamURL 首字节可读
  -> 提交 swarm playback
```

### 5.2 断点二：播放结果被提交前没有证明首字节与首帧

错误链路：

```text
resolveSwarmSource 返回 file.streamURL
  -> playback 被写入 runtime
  -> 时间线 canonical host 暴露
  -> 浏览器还没拿到 body chunk / readyState 仍为 0
  -> 用户看到黑壳
```

正确链路：

```text
fetch(file.streamURL)
  -> status ok/206
  -> body.getReader().read() 在 timeout 内返回非空 chunk
  -> 才允许 playback = swarm
  -> canonical player 隐藏挂源
  -> loadeddata / requestVideoFrameCallback / 现有首帧事件成立
  -> 才揭帘
```

### 5.3 为什么刷新页面能恢复

刷新后走历史/locator 查询路径，此时：

1. 后端 metadata 已稳定。
2. locator 能拿到完整 `web_seed_url`。
3. WebTorrent session 从一开始就有 web seed。
4. 自动播看到的是完整播放前提。

所以页面刷新能恢复。

### 5.4 为什么手动点击卡片能恢复

点击卡片走 viewer 路径。viewer 是强前台消费者，通常会触发：

1. 正式播放解析。
2. locator 刷新。
3. WebTorrent source 解析。
4. 查看器播放器接管。

所以点击相当于把自动播没完成的升级链补了一遍。

---

## 6. 修复目标

### 6.1 产品目标

用户 A 发送视频后，在线群友 B/C/D 看到新视频消息时：

1. 卡片应自然进入静音内联自动播。
2. 不需要刷新页面。
3. 不需要点击卡片才能恢复。
4. 黑灰占位不能作为正常等待态暴露。
5. WebTorrent/WebRTC/web seed/locator 对用户完全不可见。

### 6.2 工程目标

1. 保持纯 WebTorrent 主链。
2. 不引入 HLS/DASH/CDN/direct file URL 第二真相。
3. 不新增第二播放器 owner。
4. prefetch 和 foreground 复用同一个 torrent session。
5. 播放提交前必须证明 `streamURL` 首字节可读。
6. 可见 canonical host 揭帘前必须证明首帧或稳定表面已成立。
7. 所有行为通过 TDD 保护。

### 6.3 性能目标

1. 不整文件读入。
2. 不创建无界队列。
3. 不为每个候选无限 force refresh。
4. 不对所有屏外视频下载 piece。
5. `prefetch` 只建连接，不下载正式字节。
6. 前台消费者才升级为 heavy playback / whole-file backfill。
7. 探测必须有 timeout、abort、reader cancel。

---

## 7. 非目标

本次不做：

1. 不换掉 WebTorrent。
2. 不引入 HLS/DASH。
3. 不把原文件 HTTP URL 直接交给 `<video>`。
4. 不重写 Video.js 或时间线播放器架构。
5. 不新增“自动播专用播放器”。
6. 不让 shell 直接决定媒体业务真相。
7. 不把 `distribution_hint.web_seed_url=null` 改成后端广播完整 web seed。
8. 不为这个 bug 新增大而全的媒体状态机框架。
9. 不用单纯 loading 动画掩盖根因。
10. 不靠增加 sleep/backoff 作为主要修复。

---

## 8. 推荐方案：前台播放接力协议

方案 B 被确认采用：**前台播放接力协议**。

它不是新增抽象层，而是把现有隐式链路命名并用测试锁住：

```text
prefetch_ready
  -> foreground_locator_refreshing
  -> web_seed_attached
  -> stream_first_chunk_ready
  -> playback_resolved
  -> canonical_frame_committed
```

### 8.1 状态语义

| 阶段 | owner | 输入 | 输出 | 不能做什么 |
|---|---|---|---|---|
| `prefetch_ready` | 播放会话应用 + 协作分发 runtime | room_event hint | `prefetch:${aid}` session | 不能提交 playback |
| `foreground_locator_refreshing` | 媒体播放器 + 媒体定位器 | inline_autoplay/viewer request | refreshed locator | 不能复用旧的 `web_seed_url=null` locator 当正式播放 locator |
| `web_seed_attached` | 资产协作分发运行时 | refreshed locator distribution | existing torrent `addWebSeed` | 不能新建第二 torrent |
| `stream_first_chunk_ready` | 资产协作分发运行时 | `file.streamURL` | 首个 body chunk 可读 | 不能只看 `ok/206` |
| `playback_resolved` | 媒体播放器 + 媒体运行时 | `协作分发媒体源` | `媒体播放结果.mode='swarm'` | 不能缓存 anchor/direct URL |
| `canonical_frame_committed` | 时间线唯一播放器 owner | `swarm` src | 可见首帧/稳定表面 | 不能暴露黑壳 |

### 8.2 权威真相分配

1. **媒体定位真相**：`媒体定位器`
   - 管 cache、forceRefresh、inflight。
   - 不管 WebTorrent session 生命周期。

2. **WebTorrent session 真相**：`资产协作分发运行时`
   - 管 torrent、web seed 注入、consumer binding、piece selection、session lifecycle。
   - 不管 UI 是否揭帘。

3. **播放结果真相**：`媒体播放器`
   - 负责把 locator + swarm source 转成 `媒体播放结果`。
   - 对 video 正式播放坚持 WebTorrent 主链。

4. **自动播 owner 真相**：`媒体运行时` / `自动播运行时裁决`
   - 管 pending/owner/viewer 占用/稳定表面。
   - 不直接 fetch 字节。

5. **可见表面真相**：`时间线播放器宿主Owner` / 视频附件渲染
   - 管 hidden-stage、canonical host、首帧、冻结帧。
   - 不决定 source 是否正式。

### 8.3 稳定交换契约

本次不改后端 contract。

前端内部继续使用现有契约：

```text
媒体定位结果
协作分发定位片段
协作分发媒体源
媒体播放结果
媒体运行时事件
信息流视频预算投影
```

如果实现时发现必须新增字段，只允许新增**内部 adapter/shell 诊断字段**，不能污染 `聊天共享/契约.ts` 的稳定共享表面。

---

## 9. 具体设计

### 9.1 前台播放必须主动刷新 locator

规则：

```text
video + surface in { inline_autoplay, viewer } + locator 来自广播 hint 或缺 web_seed_url
=> 必须 forceRefresh locator 后再尝试正式播放
```

当前 `媒体播放.ts` 已在连接态轮询中 force refresh。实现阶段要确认两个点：

1. 首次进入 foreground 时，如果发现 `web_seed_url` 缺失，是否应该主动 refresh，而不等连接态轮询。
2. retry 里 refresh 的结果是否真实写入后续 `resolveSwarmSource`，不能 fire-and-forget。

验收标准：

```text
inline_autoplay 冷视频
  -> 第一次正式解析前或第一次连接态重试中
  -> deps.locate(aid, { forceRefresh: true }) 被 await
  -> resolveSwarmSource 收到含 web_seed_url 的 locator
```

### 9.2 prefetch session 升级必须复用同一 torrent

规则：

```text
prefetch session 已存在 + foreground consumer 进入
=> 同 swarm_id 复用现有 session
=> 更新 join ticket / web seed / consumer binding
=> 不再次 client.add()
```

当前 `资产协作分发运行时.ts` 已有：

```text
runtime.底层会话表.get(input.distribution.swarm_id)
```

以及：

```text
接入当前定位WebSeed(session, distribution)
```

实现阶段要确认 existing-session 分支一定调用 web seed 注入；如果只在新建 session 的 sourcePromise 里处理 web seed，就会复现 bug。

验收标准：

```text
prefetch locator.web_seed_url = null
foreground locator.web_seed_url = http://...
同一 torrent
addWebSeed(http://...) 被调用一次
client.add 仍只调用一次
```

### 9.3 `streamURL` 探测必须读首个 body chunk

规则：

```text
fetch(file.streamURL) 返回 headers 成功 ≠ 可播放
只有 body 首 chunk 到达，才算 source 可交付
```

实现要求：

1. 用 `fetch(streamURL, { signal })`。
2. 检查 `response.ok` 或 `206/200`。
3. 检查 `response.body` 存在。
4. `const reader = response.body.getReader()`。
5. `Promise.race([reader.read(), timeout])`。
6. 首次 `read()` 必须返回 `done=false` 且 `value.byteLength > 0`。
7. 成功或失败后都要 `reader.cancel()` 或通过 abort 释放。
8. timeout 是有界探测，不是任意 sleep。
9. 不得 `arrayBuffer()` 读取整文件。

验收标准：

```text
headers ok + body 永不吐 chunk
=> resolveSwarmSource 不返回 source
=> inlineAutoplayPlayback 不提交
=> 自动播继续保持稳定底板/等待重试
```

### 9.4 播放结果只缓存 swarm

当前 `可投影为自动播播放结果` 已规定：

```text
playback.mode === 'swarm'
```

这条必须保留。

规则：

```text
inline_autoplay runtime 只能记住 WebTorrent swarm 正式字节
不能把 anchor/direct/http fallback 当成自动播真相
```

原因：

- 项目媒体正式字节唯一主链是 WebTorrent whole-file swarm。
- 自动播缓存一旦接受 anchor，就会让 shell 形成第二真相。

### 9.5 可见 canonical host 必须先隐藏接管，后揭帘

规则：

```text
playback_resolved 不等于 surface_visible
```

时间线视频应分两步：

1. hidden-stage canonical player 挂 `swarm` src，恢复位置，尝试 play。
2. `loadeddata` / `requestVideoFrameCallback` / 现有首帧事件确认后，标记 `canonical_frame_committed`，再揭帘。

如果 source 已 resolved 但 frame 未 committed：

- 保留 poster / preview / frozen frame / stable surface。
- 不暴露空 canonical host。
- 不把用户眼前画面切成黑底。

### 9.6 自动播失败语义

失败不能被吞成“看起来成功”。

| 失败点 | 语义 | UI 行为 | 后续 |
|---|---|---|---|
| forceRefresh 失败 | locator 暂不可用 | 保持稳定底板 | 按已有重试节奏 |
| web seed 注入失败 | WebTorrent session 未升级 | 不提交 playback | 触发下一轮 locator/session 重试 |
| streamURL 首 chunk timeout | 字节未就绪 | 不揭帘 | 继续连接态/重试 |
| play promise NotAllowedError | 浏览器策略阻止 | 保持可点击卡片 | 用户点击 viewer 可接管 |
| 首帧未提交 | 播放器未形成可见画面 | 保持 stable surface | 等 loadeddata/RVFC 或重试 |

---

## 10. TDD 计划入口

后续 implementation plan 必须按 RED → GREEN → REFACTOR。

### 10.1 测试一：实时 hint 预热后，自动播必须升级已有 torrent

目标文件：

- `frontend/tests/资产协作分发运行时/prefetch消费者模式测试.spec.ts`
- 或新增同目录测试，保持 runtime 层边界。

RED 场景：

```text
1. 用 web_seed_url=null 的 locator 先调用 解析协作分发源 consumerId=prefetch:aid。
2. 再用 web_seed_url=有效值 的 locator 调用 解析协作分发源 consumerId=inline_autoplay:aid。
3. 断言 client.add 只调用一次。
4. 断言同一个 torrent.addWebSeed 被调用。
5. 断言返回 source.formalByteSource = webtorrent_official_stream。
```

如果现有测试已经覆盖，要补缺口而不是重复造测试。

### 10.2 测试二：自动播连接态重试必须 await forceRefresh 并使用刷新结果

目标文件：

- `frontend/tests/媒体播放定位刷新测试.spec.ts`

RED 场景：

```text
1. 第一次 locate 返回 ready 但 distribution.web_seed_url=null，media_state=MEDIA_CONNECTING_TO_PEERS。
2. 第一次 resolveSwarmSource 返回 null。
3. forceRefresh locate 返回 web_seed_url。
4. 第二次 resolveSwarmSource 必须收到 refreshed locator。
5. 最终 playback.mode = swarm。
```

关键断言：

```text
locate 第二次调用参数含 { forceRefresh: true }
resolveSwarmSource 第二次调用的 locator.distribution.web_seed_url 非空
```

### 10.3 测试三：streamURL headers 成功但 body 卡住时不得提交 playback

目标文件：

- `frontend/tests/资产协作分发运行时/流探测测试.spec.ts`
- 如果已有相邻测试，则扩展相邻文件。

RED 场景：

```text
1. fetch(streamURL) 返回 ok=true/status=206/body=ReadableStream 但永不 enqueue。
2. 探测 timeout。
3. 解析协作分发源 返回 null 或抛出可恢复错误。
4. 不设置 播放源已交付过。
5. 不向上层返回 swarm source。
```

性能约束：

- 测试不能依赖真实等待几秒。
- 使用 fake timers 或可注入 timeout。
- 不能 `arrayBuffer()`。

### 10.4 测试四：playback resolved 后，未首帧不得揭露 canonical host

目标文件：

- `frontend/tests/房间消息窗/自动播露出门禁测试.spec.ts`
- `frontend/tests/房间消息窗/时间线播放器宿主owner测试.spec.ts`

RED 场景：

```text
1. inlineAutoplayPlaybackByAttachmentId[aid] 有 swarm src。
2. inlineAutoplayOwnerAttachmentId = aid。
3. canonical player 尚未触发 loadeddata/RVFC/标记可见宿主已出帧。
4. 可见 DOM 不应暴露黑色 canonical host。
5. stable poster/preview/frozen surface 应保留。
```

GREEN 后再补：

```text
触发首帧事件
=> canonical host 才 reveal
```

### 10.5 测试五：真实浏览器 HTTPS 双客户端冒烟

目标：证明用户链路，而不是只证明单元。

工具要求：

- 使用 HTTPS。
- 使用 `playwright-cli`。
- 使用 `chrome-devtools-cli`。
- 使用 `browser-trace`。

场景：

```text
1. A/B 两个浏览器进同一房间。
2. A 上传并发送 mp4 视频。
3. B 不刷新、不点击。
4. B 收到新消息后自动静音播放。
5. Console/performance mark 出现：
   - media_hint_ingested:aid
   - swarm_immediate_join:aid
   - locator forceRefresh
   - web_seed_attached
   - stream_first_chunk_ready
   - inline_autoplay_playback_resolved
   - canonical_frame_committed
6. DOM 中可见 video readyState >= HAVE_CURRENT_DATA。
7. 截图/trace 不出现长期黑灰占位。
```

---

## 11. 受影响文件和层级

| 文件 | 层级 | 可能改动 |
|---|---|---|
| `frontend/媒体/媒体播放.ts` | application/adapter 边界 | locator refresh 与 swarm retry 接力，确保刷新结果进入下一次 source 解析 |
| `frontend/媒体/资产协作分发运行时.ts` | adapter | existing session 分支注入 web seed；streamURL 首 chunk 探测；consumer 升权 |
| `frontend/媒体/协作分发/应用.ts` | application adapter | 通常不改；保持 locator owner 与 runtime owner 的薄连接 |
| `frontend/媒体/媒体定位.ts` | application adapter | 通常不改；如需只调整 forceRefresh/inflight 语义，必须单独做影响分析 |
| `frontend/媒体/壳层/自动播协作.ts` | shell/application seam | 确保播放解析结果只在 swarm 成功时提交；失败保持可恢复 |
| `frontend/媒体/运行时.ts` | application/shell seam | 如 stable surface 与 playback 提交流程有缺口才改 |
| `frontend/媒体/自动播运行时裁决.ts` | application pure logic | 通常不改；如改必须先写纯函数 RED 测试 |
| `frontend/媒体/信息流视频预算.ts` | application projection | 保持“正式字节才 heavy playback”的投影规则 |
| `frontend/房间消息窗/时间线媒体基类.ts` | shell | canonical player 挂源、play promise、首帧提交、揭帘 |
| `frontend/房间消息窗/视频附件渲染.ts` | shell | 可见表面门禁，如未首帧保持稳定底板 |
| `frontend/房间消息窗/视频附件表面渲染.ts` | shell | DOM 模板层揭帘属性，避免空 host 暴露 |

---

## 12. 洋葱边界审计

### 12.1 domain

不涉及。

媒体自动播、WebTorrent、Service Worker、Video.js 都是浏览器运行态和适配层问题，不进入领域核心。

### 12.2 application

涉及：

- 播放结果裁决。
- 自动播 owner 裁决。
- 媒体预算投影。

application 层只表达：

```text
什么条件下算作有正式播放源
什么条件下 inline_autoplay owner 可以持有播放结果
什么条件下可投影 heavy playback
```

不能出现浏览器 DOM、Video.js 实例、Service Worker 具体对象。

### 12.3 contract

不改共享 contract。

`distribution_hint.web_seed_url` 保持可空，因为广播路径 per-session 鉴权不可共享。

### 12.4 adapter

涉及：

- WebTorrent session。
- `addWebSeed`。
- `file.streamURL`。
- Fetch/ReadableStream 首 chunk 探测。
- Service Worker 运行时。

adapter 只做协议、IO、错误转码和资源生命周期。

### 12.5 shell

涉及：

- 时间线唯一播放器。
- Video.js 播放器壳。
- DOM 可见表面。
- 首帧揭帘。

shell 不拥有 source 真相，只消费 `媒体播放结果` 和 projection。

---

## 13. 可观测性要求

实现阶段允许加入轻量 `performance.mark` / `console.debug`，但不能把日志当修复。

建议事件名：

```text
media_hint_ingested:{aid}
swarm_immediate_join:{aid}
foreground_locator_force_refresh:{aid}
web_seed_attached:{aid}
stream_first_chunk_ready:{aid}
inline_autoplay_playback_resolved:{aid}
canonical_frame_committed:{aid}
```

要求：

1. 日志只出现在前端 adapter/shell 调试面，不进入共享 contract。
2. 不记录敏感 token、ticket、完整 URL query。
3. `web_seed_url` 如果日志需要展示，只能展示 origin/path 或 hash 后摘要。
4. 冒烟测试用 marks/console 作为定位辅助，最终证明仍是 DOM readyState、首帧和用户可见画面。

---

## 14. 风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| forceRefresh 风暴 | 多个候选同时出现可能触发重复 locator refresh | 只对 foreground owner/pending owner 做正式刷新；复用 `媒体定位器` inflight/cache 语义 |
| WebTorrent 资源过载 | prefetch 太多会占 WebRTC 资源 | 保持 `prefetch` 为 `deselect=true`；只由当前房间 room_event 触发；生命周期策略负责释放 |
| 首 chunk 探测误伤慢网 | 弱网下 body chunk 慢到达 | timeout 只阻止“提交播放源”，不终止后续重试；UI 保持稳定底板 |
| play promise 被浏览器拒绝 | 移动端或策略变化可能拒绝自动播 | 默认 muted/playsinline；失败时保留点击查看器恢复路径 |
| 可见门禁过严 | 已可播放但迟迟不揭帘 | 首帧事件、loadeddata、现有画面缓存 owner 都可作为揭帘证据；测试覆盖 |
| 只修单元不修真实体验 | 单测绿但浏览器仍黑 | 必须做 HTTPS 双客户端真实冒烟，trace + DOM + screenshot 闭环 |

---

## 15. 执行防漂移规则

后续实现必须遵守：

1. **先 GitNexus impact**：改任何函数/方法前，先看上游影响面。
2. **先 RED**：每个行为改动先有失败测试或 characterization。
3. **不新增第二主链**：禁止 HTTP direct、HLS、DASH、CDN、range 旁路作为正式播放源。
4. **不新增第二播放器 owner**：Video.js 仍只是唯一播放器壳。
5. **不把日志当证明**：日志只是辅助定位，验证必须看状态、DOM、首帧、真实浏览器。
6. **不读整文件**：首字节探测只能读第一个 chunk，有 abort/cancel。
7. **不扩大 contract**：没有明确必要，不改 `聊天共享/契约.ts`。
8. **不做顺手重构**：只清理同链路、同 owner、可证明冗余的代码。
9. **第二轮编辑前重读文件**：触碰过的文件再次修改前，必须重新读当前内容。
10. **真实冒烟用 HTTPS**：浏览器媒体/Service Worker/WebTorrent 链路不接受 HTTP 假闭环。

---

## 16. 验收标准

### 16.1 单元/集成测试

至少覆盖：

1. prefetch -> inline_autoplay 复用同一 torrent 并 `addWebSeed`。
2. inline_autoplay forceRefresh locator 后使用刷新 locator。
3. `streamURL` headers 成功但 body 首 chunk 不到时不提交 playback。
4. 自动播 runtime 只缓存 `mode='swarm'`。
5. canonical host 未首帧时不揭露黑壳。

### 16.2 架构 fitness

必须通过：

```text
pnpm --dir frontend test -- --runInBand
pnpm --dir frontend typecheck
pnpm --dir frontend check:browser-app-constitution
pnpm --dir frontend check:architecture-fitness
pnpm --dir frontend check:test-architecture
```

如果实际命令参数与 Vitest 版本不兼容，implementation plan 中必须用项目 `package.json` 的可执行脚本重写为可运行命令。

### 16.3 真实浏览器冒烟

通过标准：

```text
A 发视频
B 不刷新、不点击
B 在新消息卡片上看到静音自动播放
无长期黑灰占位
无 direct/http/hls/dash source
WebTorrent streamURL 是唯一正式视频 src
```

### 16.4 代码影响检查

提交前必须：

1. `gitnexus_detect_changes(scope='all')`。
2. `git status --short`。
3. 只提交本次 spec/实现相关文件。
4. 中文 commit message 写清楚做了什么、为什么做、验证了什么、影响了什么边界。

---

## 17. 执行顺序建议

后续 implementation plan 应拆成 4 个小阶段：

1. **Characterization**
   - 跑现有相关测试。
   - 补 RED 测试证明当前缺口。

2. **WebTorrent 接力闭环**
   - locator refresh。
   - existing session `addWebSeed`。
   - stream first chunk probe。

3. **自动播和可见表面闭环**
   - runtime 只提交 swarm。
   - canonical host 首帧揭帘。
   - play promise 失败不假装成功。

4. **真实 HTTPS 冒烟和收口**
   - 双客户端真实发送视频。
   - trace/performance mark。
   - 截图和 DOM readyState 证明。
   - GitNexus detect changes。
   - commit。

---

## 18. 100% 信心循环

### 第 1 轮：我对当前设计是否 100% 有信心？

不是。原因：

1. 当前源码已有一部分修复痕迹，线上复现可能是部署版本问题，也可能是第二层可见表面问题。
2. GitNexus MCP transport 曾断开，虽然 CLI 和源码读证据足够，但 implementation 前仍要重新做 impact。
3. `streamURL` 首 chunk 探测具体实现需要重读当前 `资产协作分发运行时.ts` 全量上下文，避免重复探测或并发打爆 streamURL。

修正：

- 本 spec 不直接断言唯一代码改点，而是把修复拆成 TDD 验证项。
- 实现前必须跑 GitNexus impact 和现有测试确认真实缺口。
- 首 chunk 探测被明确限制为有界、可取消、不可整文件读取。

### 第 2 轮：修正后是否 100% 有信心？

仍不是。原因：

1. 自动播可见表面涉及 Lit、唯一播放器、画面缓存 owner，可能已有测试覆盖但命名分散。
2. 如果贸然新增状态字段，可能污染 shell/application 边界。

修正：

- 明确要求优先扩展现有 `自动播露出门禁测试` 和 `时间线播放器宿主owner测试`。
- 明确禁止改共享 contract，新增字段只能是内部诊断或现有 owner 状态的投影。
- 明确 `playback_resolved` 和 `surface_visible` 是两个不同事实，不能合并。

### 第 3 轮：再次修正后是否 100% 有信心？

达到 spec 层面的 100% 信心：这份设计没有承诺未验证的代码事实，也没有把症状补丁当根因修复；它把所有不确定点都转成了必须 RED 的测试和必须真实冒烟的验收标准。

实现层面的 100% 信心必须等 implementation plan 和 TDD 执行后再获得。

---

## 19. 三遍自审结论

### 第 1 遍：需求意图

已覆盖用户要求的前因后果、为什么这么做、官方资料依据、乔布斯式体验目标和防漂移约束。

修正点：把“用户看到灰卡”从播放器现象提升为“现场连续性断裂”，避免后续只补播放器局部。

### 第 2 遍：架构边界

已按 domain/application/contract/adapter/shell 分层审计。明确 contract 不改、正式字节只走 WebTorrent、Video.js 只做壳、shell 不拥有 source 真相。

修正点：新增“稳定交换契约”和“执行防漂移规则”，防止实现阶段引入第二主链或污染共享 contract。

### 第 3 遍：执行路径和验证闭环

已给出 5 个 TDD 入口、单元/集成/真实 HTTPS 冒烟、GitNexus detect changes 和 commit 收口要求。

修正点：把 `streamURL` 探测从“fetch ok”细化为“首个 body chunk 可读”，并显式禁止整文件读入和无界等待。
