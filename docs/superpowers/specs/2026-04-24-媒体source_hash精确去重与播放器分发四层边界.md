# 媒体 source_hash 精确去重与播放器分发四层边界

日期：2026-04-24  
状态：Design  
适用范围：`koko` 的新上传图片/视频附件、前端图片/视频 canonical 预处理、后端协作分发元数据、WebTorrent swarm、`.torrent` 元信息、未来播放器壳升级。  
前置文档：

- `docs/superpowers/specs/2026-04-23-WebTorrent群聊越活跃越强的极限协同分发.md`
- `docs/superpowers/specs/2026-04-22-WebTorrent高速分发防止群友偷懒.md`
- `学习/整理笔记/Web大视频秒开播放与P2P协同主链官方实践清单-2026.md`

官方依据：

- WebTorrent Docs：<https://webtorrent.io/docs>
- WebTorrent FAQ：<https://webtorrent.io/faq>
- BitTorrent BEP 19 WebSeed：<https://www.bittorrent.org/beps/bep_0019.html>
- Video.js v10 Roadmap：<https://videojs.org/docs/framework/react/concepts/v10-roadmap>
- Video.js v10 Beta：<https://videojs.org/blog/videojs-v10-beta-hello-world-again>
- Chrome Autoplay Policy：<https://developer.chrome.com/blog/autoplay/>
- Chrome WebCodecs Best Practices：<https://developer.chrome.com/docs/web-platform/best-practices/webcodecs>
- WebKit iOS Video Policies：<https://webkit.org/blog/6784/new-video-policies-for-ios/>
- WebKit macOS Auto-Play Policy：<https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/>
- WHATWG HTML Media：<https://html.spec.whatwg.org/dev/media.html>

---

## 0. 为什么补这一份设计

当前协作分发主链已经有一个正确事实：

1. 后端用正式共享字节生成 `content_hash`。
2. `swarm_id = swarm_{content_hash}`。
3. `.torrent` 内部文件名绑定 `content_hash + canonical 扩展名`。
4. 已有测试证明“相同内容的不同附件可以共享同一 `swarm_id`”。

这解决的是：

**同一份 canonical 字节，必须共享同一分发平面。**

但它还没有解决另一个更靠前的问题：

**用户上传同一个原始文件两次时，系统能否在预处理和上传前就识别为完全相同，从而直接复用已有 canonical / torrent / swarm。**

这不是“识别肉眼一样”的问题。  
这是更克制、更可靠的一件事：

**同一个原始文件的原始字节完全一样，就应该被 `source_hash` 精确命中。**

---

## 1. 当前代码事实

### 1.1 后端已经有 canonical 字节级分发身份

后端 `src/媒体协作分发.rs` 当前已经做了几件正确的事：

1. `生成内容哈希` 对共享字节做 `SHA-256`。
2. `构造协作分发元数据写入请求` 把 `content_hash` 写入分发元数据。
3. `swarm_id` 由 `content_hash` 派生。
4. `生成附件torrent元信息` 把 torrent 内文件名固定为 `content-{content_hash}{扩展名}`。

这意味着：

**只要两次上传最终 canonical 字节完全一样，它们天然应该共享 WebTorrent 分发平面。**

### 1.2 前端 canonical 不是原文件身份

前端图片当前走：

1. HEIC / HEIF 先经 `heic2any` 转成 JPEG 中间态。
2. 再经浏览器 `createImageBitmap + canvas / OffscreenCanvas` 转成 `canonical.webp`。
3. WebP 编码质量为 `0.95`。

前端视频当前走：

1. 可直通 MP4 直接保留。
2. 不可直通时用 Mediabunny 整理为 `canonical.mp4`。
3. 必要时用 WebCodecs 转码到 `avc + aac`。
4. MP4 输出使用 `fastStart: "in-memory"`。

因此必须承认：

**canonical 字节是播放和分发用的稳定产物，不是原始文件身份。**

同一个原文件在同一浏览器同一路径下大概率会得到同样 canonical；但跨浏览器、跨硬件、跨编码器、跨库版本时，前端转码产物不能被当成绝对稳定身份。

---

## 2. 四层边界

这次把媒体系统分成四层，防止后续把播放器、分发和去重混在一起。

| 层级 | 拥有的真相 | 不拥有的真相 |
| --- | --- | --- |
| 内容身份层 | `source_hash`、`content_hash`、`torrent_info_hash`、`swarm_id` | 播放 UI、自动播放策略、连接调度 |
| 分发层 | WebTorrent、WebSeed、Range、对象存储、tracker/signaling | 附件是否成立、内容是否删除、UI 状态 |
| 播放层 | `video` 元素、Video.js 壳、HLS/MSE 播放适配 | 去重真相、成员权限、swarm ready 真相 |
| 协调层 | presence、RoomRuntime、连接生命周期、背压、恢复提示 | 媒体字节、播放器内部状态、原文件身份 |

硬裁决：

**去重真相只能属于内容身份层；播放器不能决定两个文件是不是同一个内容，WebTorrent 也不能反向决定业务附件是不是同一个附件。**

---

## 3. `source_hash` 的定义

`source_hash` 只表示一件事：

**上传前用户选择的原始 `File` 字节的 SHA-256。**

它不表示：

1. 肉眼看起来一样；
2. 同一个视频被重新压缩后仍然一样；
3. 同一张图被截图、转存、裁剪、去 EXIF 后仍然一样；
4. 不同封装但内容相似；
5. 不同码率、不同分辨率、不同音轨但视觉接近。

因此本设计只做：

**精确原文件去重。**

不做：

**感知哈希、AI 相似度、帧级比对、音视频指纹、跨平台模糊查重。**

这不是能力不足，而是产品边界选择。  
模糊查重会带来误判、隐私探测、计算成本、解释成本和删除语义复杂化；当前阶段不应引入。

---

## 4. 推荐上传路径

### 4.1 新上传前置查询

前端选择文件后，预处理前先做：

1. 读取原始 `File` 字节流。
2. 计算 `source_hash = sha256(raw file bytes)`。
3. 向后端发起受权限约束的去重预检。

预检只允许回答当前用户当前上下文内可见的事实：

1. 当前房间或当前可访问范围内是否已有相同 `source_hash` 的 ready 媒体；
2. 是否可复用已有 canonical 资产；
3. 是否可复用已有 `content_hash / swarm_id / torrent_info_hash`；
4. 是否仍需要继续走正常上传。

### 4.2 命中路径

如果命中同一 `source_hash` 且权威资产仍可用：

1. 不再重新图片转码或视频转码。
2. 不再重新上传媒体字节。
3. 后端创建新的业务附件或消息引用。
4. 新附件绑定已有 canonical 资产和分发元数据。
5. 新消息仍是新消息，发送人、房间、时间、消息位置都按当前发送成立。

也就是说：

**复用的是媒体资产，不是复用上一条消息。**

### 4.3 未命中路径

如果未命中：

1. 继续当前图片 / 视频 canonical 预处理。
2. 上传 canonical 字节。
3. 后端生成 `content_hash`、`swarm_id`、`.torrent`。
4. 完成后同时记录 `source_hash -> canonical 资产` 的受权限索引。

### 4.4 canonical 相同但 source 不同

如果两个不同原文件最终 canonical 字节相同：

1. `source_hash` 不会提前命中。
2. 上传完成后，后端 `content_hash` 仍会让它们共享同一分发平面。
3. 这是正确的第二层收口，不需要把 `source_hash` 伪装成万能去重。

---

## 5. 权限、删除与隐私边界

`source_hash` 不能变成“探测别人是否上传过某文件”的侧信道。

必须禁止：

1. 跨未授权房间返回命中。
2. 跨用户全局返回“已有这个文件”。
3. 返回原上传者、原房间、原消息等非必要信息。
4. 附件已删除后继续通过 `source_hash` 复活 canonical。
5. 用 `source_hash` 命中绕过当前发送权限、附件权限和房间权限。

正确做法：

1. 命中查询必须先过当前会话、房间、成员和可见性裁决。
2. 命中响应只返回复用所需的最小资产引用或一次性复用票据。
3. 删除权威事实优先级高于本地缓存、source hash 和 content hash。
4. 复用成功仍要写入当前消息成立事实，而不是偷拿旧消息事实。

---

## 6. WebTorrent / WebSeed / 播放器的边界

### 6.1 WebTorrent

WebTorrent 官方定位是浏览器和桌面里的 streaming torrent client。  
浏览器侧 WebTorrent 使用 WebRTC peer，连接后走 BitTorrent wire protocol，并支持 web peer 之间分发。

本项目里的裁决：

1. WebTorrent 负责分发 canonical 字节。
2. `infohash` 和 `swarm_id` 必须由内容身份层稳定派生。
3. WebTorrent 不负责判断两个上传是不是同一个原文件。
4. 同一 canonical 内容必须进入同一 swarm，不能因为业务附件不同而制造重复 torrent。

### 6.2 WebSeed

BEP 19 的 WebSeed 允许 HTTP/FTP 服务器作为种子来源参与下载。  
本项目已经裁定：

1. 前 `24 小时` WebSeed 是强帮助者。
2. 它属于 swarm 分发平面。
3. 它不能变回第二正式播放主链。
4. `source_hash` 去重不能改变 `24 小时` 服务器退字节裁决。

### 6.3 Video.js v10

截至 2026-04-24，Video.js 官方 v10 Roadmap 显示 v10 仍处于 beta / GA 前后迁移窗口。  
v10 的价值在于它强化了更现代的播放器内核、状态和 UI 分离方向，但本项目不能把它当成已经完成生态迁移的稳定唯一真相。

本项目里的裁决：

1. Video.js 只能做播放器壳。
2. 播放器壳不拥有媒体身份、附件权限、删除真相和 swarm ready 真相。
3. 若未来升级到 Video.js v10，必须通过播放器 adapter 接入。
4. 不允许为了换播放器重写 WebTorrent 主链、附件契约或媒体身份层。

### 6.4 Chrome / Safari 自动播放

Chrome、Safari、WHATWG HTML 都把自动播放、静音、内联播放、用户手势、用户偏好视为浏览器媒体策略的一部分。  
这些策略只影响 `video` 元素何时能播放、是否需要静音、是否能内联。

本项目里的裁决：

1. 自动播放失败不等于媒体不可分发。
2. 滑出视口不等于帮助任务结束。
3. 播放器事件只能作为 UI / 壳层信号。
4. 帮助任务、后台补齐和 swarm presence 仍由协作分发 owner 裁决。

### 6.5 WebCodecs

Chrome 官方对 WebCodecs 的定位是暴露底层视频帧和编码块处理能力。  
它适合做前端视频预处理、转码和高级媒体管线，但不是业务身份系统。

本项目里的裁决：

1. WebCodecs 可以参与生成 canonical。
2. WebCodecs 生成的 canonical 不等于原始文件身份。
3. 原始文件身份必须在 WebCodecs 前用 `source_hash` 锚定。

---

## 7. 不参考闭源产品细节做实现依据

Telegram、微信这类大型 IM 很可能会做内容寻址、秒传、服务端资产复用、CDN 缓存、转码资产复用等能力。  
但它们的具体实现不是公开可验证协议，本项目不能把猜测写成事实。

本项目能确定并应采用的是通用工程规律：

1. 原文件字节一致：可用强哈希精确去重。
2. canonical 字节一致：可用 `content_hash` 共享分发资产。
3. 业务消息不同：仍然保持不同消息事实。
4. 权限不同：不能泄漏跨权限资产存在性。
5. 肉眼相似：当前不做，不伪装。

---

## 8. 实现红线

1. 禁止把 `source_hash` 做成感知哈希或 AI 相似度。
2. 禁止跨权限返回 source 命中事实。
3. 禁止把媒体资产复用偷换成消息复用。
4. 禁止附件删除后继续通过 hash 复活媒体。
5. 禁止让播放器决定去重、ready、删除或权限。
6. 禁止因为 `source_hash` 命中而绕过当前房间发送事务。
7. 禁止为相同 canonical 字节重复生成互不相通的 swarm。
8. 禁止把 Video.js v10 beta 状态包装成“现在必须迁移”的理由。
9. 禁止把 Chrome / Safari 自动播放策略上抬成协作分发产品规则。
10. 禁止为了省上传而引入无法解释的模糊去重误判。

---

## 9. 验证门禁

后续 implementation plan 至少要验证：

1. 同一原始 MP4 在同一授权房间上传两次，第二次命中 `source_hash`，不重新转码、不重新上传媒体字节。
2. 同一原始图片上传两次，第二次命中 `source_hash`，不重新生成 `canonical.webp`。
3. `source_hash` 命中后，新消息仍有自己的 `room_event / message / attachment ref`。
4. `source_hash` 命中后，复用的 `content_hash / swarm_id / torrent_info_hash` 与原 canonical 资产一致。
5. 不同原文件但最终 canonical 字节相同，上传完成后仍通过 `content_hash` 共享 swarm。
6. 重新压缩后肉眼相同但原始字节不同的视频，不被 `source_hash` 命中。
7. 未授权房间不能通过同一 `source_hash` 探测到别处已有媒体。
8. 原附件删除后，`source_hash` 不能让新附件继续拿已删除 canonical 装作 ready。
9. Chrome / Safari 自动播放失败时，不影响后台协作补齐 owner 的判断。
10. 替换或升级播放器壳时，媒体身份层和 WebTorrent 分发层测试不需要重写。

---

## 10. 最终裁决

`koko` 后续要做的不是“像 Telegram / 微信一样神秘识别所有相似媒体”，而是先把最确定、最便宜、最不容易错的去重链做准：

**上传前用 `source_hash` 精确识别同一原始文件；上传后用 `content_hash` 精确识别同一 canonical 字节；分发层用 `swarm_id / torrent_info_hash` 复用 WebTorrent 平面；播放器只消费媒体源，不拥有身份与分发真相。**

这条链既能减少重复预处理、重复上传、重复 WebTorrent 种子和重复服务器冷源压力，也不会引入感知去重的误判、隐私泄漏和过度设计。
