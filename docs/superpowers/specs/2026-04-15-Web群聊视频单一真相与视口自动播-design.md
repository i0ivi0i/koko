# Web 群聊视频单一真相与视口自动播设计

日期：2026-04-15  
状态：Draft  
适用范围：`koko` 仓库 `Web 前端 + Rust 媒体后端` 当前阶段的群聊视频消息预览、正式播放、视频缩略图真相、视口自动播策略。  
关联文档：

- `docs/superpowers/specs/2026-04-14-Web单一视频播放器壳与外置分发层-design.md`
- `docs/superpowers/specs/2026-04-14-Web媒体P2P能力补满-design.md`
- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/plans/2026-04-14-Web单一视频播放器壳迁移与双壳退场实施计划.md`

## 1. 为什么要写这份 spec

本机模拟公网群聊时，视频链路暴露出三个稳定可复现的问题：

1. 消息流里的视频卡片看起来像有两套播放入口；
2. 新进群用户以及部分老成员，偶尔看不到视频缩略图；
3. `PC Chrome` 点开正式播放器后，会出现“控件和声音正常、画面不出来”。

这些问题表面上分别像 `UI`、`缩略图`、`播放器渲染` 三个独立缺陷，  
但根因指向同一个架构漂移：

- 视频预览没有唯一真相；
- 消息流预览和正式播放没有被严格区分；
- 播放壳、播放源、缩略图来源在不同层里各自兜底，已经接近“多条链路并存”。

这份 spec 的目标不是单点打补丁。  
目标是把 Web 群聊视频收口成：

**唯一正式播放器壳 + 唯一视频预览真相 + 同屏唯一自动播 owner。**

## 2. 当前现场证据

本次在本机真实运行项目并通过 Chrome DevTools 抓到以下证据：

### 2.1 消息流视频卡片当前结构

- `frontend/房间消息窗.ts` 当前会在消息流里渲染真实 `<video class="message-video-preview">`；
- 同时外层再叠一个 `message-video-preview-trigger` 播放入口；
- 这意味着消息流里目前不是“纯静态封面 + 入口”，而是“预览 video + 入口”。

这虽然还不等于第二套正式播放器壳，  
但用户视觉上已经容易感知成“两套播放按钮”。

### 2.2 视频缩略图真相当前缺失

- 新进群用户打开同一条视频消息时，`locator` 返回中的 `thumbnail_url` 为 `null`；
- 前端实际回退成 `original_url#t=0.1`，由浏览器自己去原视频里抠首帧；
- `frontend/契约.ts` 里的 `视频附件快照` 当前没有 poster / preview 字段；
- `frontend/视图.ts` 派生视频展示项时，`posterSrc` 直接写死为 `null`。

这说明“视频缩略图”目前不是权威稳定事实，  
而是前端临时兜底行为。

### 2.3 正式播放器当前的出画面故障

打开正式视频查看器时，Chrome 里可以看到：

- `master.m3u8`、音视频清单和分片都成功返回；
- `videoWidth/videoHeight` 有真实值；
- 但 `video-player / video-skin / media-container / video` 的实际显示尺寸是 `0x0`。

所以第 3 个问题不是“流没拉到”，而是：

**唯一正式播放器壳已经拿到了流，但查看器挂载尺寸塌陷，导致实际画面不可见。**

## 3. 官方最佳实践给出的方向

基于官方文档和一手资料，这条设计方向是明确的：

### 3.1 `Video.js v10`

- `Video.js v10` 的定位是唯一播放器壳；
- `player / skin / media element` 属于同一套播放会话；
- 适合承接正式视频播放、控制条、全屏、快捷键等正式交互。

### 3.2 `hls.js`

- `hls.js` 是 HLS playback engine；
- 直接挂在标准 `<video>` 上工作；
- 适合作为 `Video.js` 壳下面的 HLS provider，不应该再自带第二套 UI。

### 3.3 `WebTorrent`

- 浏览器侧官方推荐是把 torrent 文件流灌给现有 `<video>` 元素；
- 它适合作为文件级播放源和协作分发层；
- 不应该膨胀成第二套播放器外壳。

### 3.4 自动播

- 浏览器层通行做法是用 `IntersectionObserver` 判断视口可见性；
- 自动播必须走 `muted + playsinline`；
- 消息流内自动播属于轻量预览策略，不应直接等同于正式播放器。

## 4. 设计目标

本次设计要同时达成五件事：

1. 正式视频播放只保留一个 `Video.js` 壳；
2. 视频预览真相变成后端稳定产物，而不是前端临时抠首帧；
3. 消息流默认是静态封面卡片，而不是常驻真实 `<video>` 预览；
4. 消息流支持类似 Telegram / 推特的视口自动播，但同屏同时只允许一个；
5. 自动播和正式播放共享同一个媒体真相 owner，不再新增第二套来源、第二套恢复逻辑或第二套 UI 真相。

## 5. 核心原则

### 5.1 唯一正式播放器壳

- 正式播放唯一入口：`Video.js v10`
- `hls.js / WebTorrent / P2P` 只能作为底层源与传输增强层
- 不允许消息流、查看器、P2P runtime 各自长一套正式视频 UI

### 5.2 唯一视频预览真相

- 视频预览只指静态封面，由后端生成并持久化
- 预览真相不是 UI 临时变量，而是共享合同的一部分
- `message snapshot` 与 `locator` 只是投影同一份 preview 真相
- 前端不再把 `original#t=0.1` 当默认缩略图来源
- 不再新增面向消息流自动播的第二份视频 preview 资产

### 5.3 唯一自动播 owner

- 自动播属于 `shell` 层视口编排策略
- 同一时刻只允许一个视频卡片拥有自动播资格
- 自动播不产生第二套媒体会话真相

### 5.4 纯静态默认态

- 消息流视频卡片默认只显示封面 + 播放入口
- 只有在被选为“当前自动播 owner”时，才切入无控件、静音、内联的轻量播放态

## 6. 架构收口

### 6.1 `domain / application / contract / adapter / shell` 分层裁决

- `domain / application`
  - 不承载浏览器视口判断
  - 继续只裁决媒体状态、定位结果、协作分发事实、恢复语义
- `contract`
  - 必须稳定表达视频 preview 真相
  - 不能再让消息快照和 locator 分别表达不同的视频预览来源
- `adapter`
  - 后端 adapter 负责把视频 preview 真相翻译成稳定合同字段
  - 前端 transport 负责把该字段解析成统一地址
- `shell`
  - 只负责视口观察、自动播 owner 竞争、静态封面与轻量播放态切换
  - 不负责决定 preview 真相，也不负责决定正式播放来源

### 6.2 视频 preview 的 canonical contract

为避免 `snapshot.poster + locator.thumbnail_url + 其他新字段` 的 add-only 漂移，  
视频 preview 必须先收口成一个共享合同面，再谈自动播。

推荐的共享语义是：

- `preview_asset.still_url`
  - 稳定静态封面图
  - 默认消息流卡片总是先吃它
- `preview_asset.width / height`
  - preview 资产自身几何
- `preview_asset.version`
  - preview 资产版本或稳定标识
  - 供前端避免脏缓存或旧 preview 漂移

这里的 `preview_asset` 是唯一静态 preview 真相。
它只表达“看什么封面”，不表达“自动播吃什么视频源”。
自动播视频源必须继续复用现有正式媒体 contract 与同一个 media owner，
`message snapshot` 和 `locator` 都只能投影这份静态 preview 真相，不能再各自长视频专属字段。

### 6.3 `snapshot` / `locator` 的职责

- `snapshot.attachments`
  - 负责首屏和历史恢复时的稳定 preview 展示
  - 必须直接带 `preview_asset`
- `locator`
  - 负责正式播放定位、协作分发、运行态补充
  - 也必须带同一个 `preview_asset`
  - 不再单独为视频维护顶层 `thumbnail_url`
  - 自动播若需要视频源，也必须经由同一个媒体 owner / source resolver 解析

迁移期间允许保留旧字段兼容旧调用方，  
但必须明确它只是从 `preview_asset.still_url` 派生的过渡投影，  
不能继续作为视频 preview 的真实来源。

### 6.4 正式播放边界

- 正式播放一律进入 `媒体查看器 -> Video.js 壳`
- 查看器内只保留一个挂载容器
- `mountTarget` 是查看器尺寸真相 owner
- `Video.js` 壳内部只允许填充 `mountTarget`
- 不能再出现壳拿到流但显示区域塌成 `0x0`

### 6.5 消息流边界

- 消息流卡片不再长期保留真实 `<video>` 默认态
- 默认态：`poster + play entry`
- 自动播态：`muted + playsinline + no controls` 的轻量 `<video>`
- 自动播态只承接同一媒体 owner 解析出的正式播放源
- 正式播放态：交给页面级查看器，不在消息流里继续扩张

### 6.6 `manifest` 视频的单链路自动播裁决

这是本次设计的关键阻断点，必须明确写死：

- 消息流自动播不再生成、持有或依赖额外 `preview clip / motion_url`
- `manifest/HLS` 视频若要自动播，必须复用现有正式播放资产
- 具体吃 `hls_master_url / file / blob / swarm`，必须由同一个媒体 owner / source resolver 裁决
- 壳层不允许自己拼 URL、猜来源、绕过 locator 或私造第二套恢复逻辑
- 如果该视频当前没有可播放正式源，消息流就保持 `poster-only`
- `inline_autoplay -> anchor/original 优先` 只允许作为已经退场的止血版历史说明，不再作为长期裁决
- 当前正式裁决收口为：`inline_autoplay -> swarm/web seed 优先 -> anchor/original fallback`
- 前提是 `WebTorrent/swarm` 已支持多消费者 owner，自动播与时间线媒体会话只共享同一个 runtime，不再互相误释放
- 这意味着：
  - 自动播和正式播放共享同一条媒体主链
  - 消息流里不会再为 preview clip 养第二套视频资产
  - 消息流里的轻量 `<video>` 只是展示模式，不是第二套真相
  - `Video.js` 仍然只属于正式播放器壳

换句话说：

**消息流自动播和正式播放看的是同一条正式媒体主链。
两者区别只在壳层模式，不在来源真相。**

## 7. 数据流设计

### 7.1 上传完成后的后端职责

视频上传 `complete` 后，后端必须完成：

1. 生成稳定 `preview_asset.still_url`；
2. 持久化 preview 元数据与可读地址；
3. 继续产出当前已经存在的正式播放资产，例如 `HLS + DASH + 原始冷备`；
4. 让后续 `message snapshot` 与 `locator` 都能读到同一份视频预览真相；
5. 不再额外生成仅服务消息流自动播的第二份视频 preview 资产。

### 7.2 消息恢复与晚进群

进入房间或恢复消息流时：

1. `snapshot_messages.attachments` 直接带稳定 `preview_asset`；
2. 前端展示层先用 `preview_asset.still_url` 渲染静态封面；
3. 若该卡片后续获得自动播 owner，再向同一个媒体 owner 取当前正式播放源；
4. 若用户打开查看器，继续向同一个媒体 owner 取正式播放源；
5. 不再依赖“先没有图，等 locator 再补”这条弱链路。

### 7.3 自动播数据流

1. 浏览器层 `IntersectionObserver / visibilitychange / viewer open-close` 只产生信号；
2. `AppRuntime` 把这些浏览器信号翻译成应用事件；
3. `视频预览自动播编排` 在壳层只维护“当前 preview owner 是谁”；
4. 满足阈值的视频进入候选集合；
5. owner 选择器只挑一个“离视口中心最近”的候选；
6. owner 确认后，壳层向同一个媒体 owner / source resolver 申请当前正式播放源；
7. 若源可播放，就以 `muted + playsinline + 无控件` 进入轻量自动播；
8. 若当前无可播放源，或浏览器策略拒绝自动播，就保持静态封面；
9. 失去 owner 后立即 `pause`、释放当前源，并退回静态封面。

这里的壳层编排只拥有：

- 视口候选状态
- 当前唯一 owner
- 是否暂停所有自动播

它不拥有：

- 正式播放真相
- preview 真相
- HLS / WebTorrent / locator 恢复语义

### 7.4 正式播放数据流

1. 点击视频卡片；
2. 当前自动播若存在，先释放；
3. 打开页面级媒体查看器；
4. 查看器把当前视频项目交给唯一 `Video.js` 壳；
5. `Video.js` 壳下面再按 `file / hls / WebTorrent blob` 切底层 provider；
6. 关闭查看器后，由壳层重新评估当前视口里的自动播 owner。

### 7.5 旧视频与灰度迁移

为真正关闭“晚进群偶尔没图”，必须补齐旧资产和灰度顺序：

1. 新上传视频先开始生成 `preview_asset.still_url`
2. 后台补历史视频 preview backfill
3. `snapshot` 与 `locator` 同时接入 `preview_asset`
4. 前端优先消费 `preview_asset` 作为静态封面真相
5. 消息流自动播与正式播放统一走既有正式媒体主链
6. 所有 Web 入口完成切换后，再退场视频专用旧字段和 `original#t=0.1` 兜底

灰度期间：

- 对已有 preview 的视频，前端只认 `preview_asset`
- 对尚未回填的视频，只显示统一占位图且不参与自动播
- 不允许为了回填过渡期重新启用 `original#t=0.1` 作为主链

这样虽然会让部分旧视频暂时只有占位图，  
但可以守住“唯一 preview 真相”边界，避免再次演化出第二来源。

## 8. 自动播规则

### 8.1 候选资格

- 视频卡片可见比例至少达到 `60%`
- 进入阈值后稳定停留约 `200ms`
- 只有当前房间主视口内的视频才允许参与竞争

### 8.2 唯一 owner 规则

- 同屏同时只允许一个自动播 owner
- 当多个视频都满足阈值时，选“离视口中心最近”的那个
- 新 owner 上位后，旧 owner 立即暂停

### 8.3 启播规则

- 只允许 `muted + playsinline + 无控件`
- 自动播只属于轻量预览，不拉起正式播放器壳
- 自动播不会修改媒体真相，只是壳层展示策略
- 自动播复用与正式播放相同的媒体 source resolver
- 自动播可以命中 `file / blob / swarm` 等正式资产，但列表态仍不直接吃 `hls_master_url`
- 自动播对视频的默认优先级是：`swarm/web seed -> anchor/original fallback`
- 没有静态 preview 时不回退成 `original#t=0.1`

### 8.4 停播规则

- 可见比例掉到 `25%` 以下即停
- 页面失焦、切后台、打开正式查看器、用户手动关闭当前自动播卡片时即停
- 停播后退回封面图，不保留半激活播放 UI

## 9. 三个现有问题的关闭方式

### 9.1 双三角按钮

关闭方式：

- 默认态不再渲染真实 `<video>`；
- 改成静态封面 + 单一播放入口；
- 自动播激活后，入口样式退成轻提示，不再和真实 video 叠成双按钮。

### 9.2 新进群用户偶尔没有缩略图

关闭方式：

- 后端提供稳定 `preview_asset` 真相；
- `消息快照 + locator` 共同消费该真相；
- 旧视频通过 backfill 补齐 preview；
- 前端删除“默认拿 original#t=0.1 抠首帧”这条兜底主链。

### 9.3 有控件有声音但没有画面

关闭方式：

- 修正页面级查看器挂载容器尺寸；
- 明确 `mountTarget` 是尺寸真相 owner；
- 明确 `overlay -> mount -> video-player -> media-container -> video` 的可见尺寸约束；
- 为“首次打开 / 同步切源 / 关闭再开 / fullscreen 往返”补 UI 尺寸保护测试，禁止再次出现 `0x0` 显示区。

## 10. 测试策略

### 10.1 后端测试

- 视频 `complete` 后能生成稳定 `preview_asset.still_url`
- 视频 `complete` 后不会额外生成只服务消息流的第二份 preview 视频资产
- 晚进群 session 能通过 `snapshot` 和 `locator` 看到同一 `preview_asset`
- 旧 session / 新 session / sender / late joiner 的 preview 字段一致
- 历史视频 backfill 完成后，旧消息也能拿到同一 `preview_asset`

### 10.2 前端单测

- 消息流默认只显示静态封面，不默认渲染真实 `<video>` 播放态
- `manifest` 视频在消息流自动播时，必须走和正式播放同一个 media owner / source resolver
- 同屏多个视频时，只能选出一个自动播 owner
- 自动播卡片离开阈值后会暂停并回退成封面
- 没有稳定 preview 的视频保持占位图且不参与自动播
- 打开正式查看器时，列表里的自动播 owner 会被释放
- 浏览器事件会先转应用事件，再更新自动播 owner
- 正式查看器挂载后的 `mount` / `video-player` / `media-container` / `video` 不能为 `0x0`

### 10.3 浏览器验收

- `Chrome Stable`
- 发送者、原有成员、晚进群成员均能看到同一视频封面
- 消息流滚动时，同屏只有一个视频自动播
- 消息流自动播与正式播放复用同一条正式媒体主链，不再出现额外 preview 视频请求
- 打开正式查看器后，视频画面可见、控件正常、声音正常
- 关闭查看器后，列表重新按照视口规则选择唯一自动播 owner

## 11. 回退与容错

### 11.1 preview 缺失

如果后端尚未产出 preview：

- 消息流显示统一占位图；
- 该视频不参与自动播；
- 不再默认回退成 `original#t=0.1`；
- 这是为了坚守唯一真相边界，避免再把临时兜底误升级成长期主链。

### 11.2 自动播失败

- 自动播失败只影响当前卡片体验；
- 失败后退回静态封面；
- 不升级成正式播放失败，也不生成第二条恢复逻辑。

### 11.3 P2P / WebTorrent / HLS 增强失败

- 仍然只能降级成“无增强的同一正式播放器壳”；
- 不允许因为增强失败而回退成第二套 UI 或第二套播放器入口。

### 11.4 preview 迁移灰度失败

如果 preview backfill 或新链路灰度失败：

- 允许回滚到“静态占位图 + 正式播放器仍可打开”
- 不允许回滚到 `original#t=0.1` 主链
- 不允许为了维持自动播而新增第二份 preview 视频资产或壳层私有源链

优先级永远是：

1. 单一真相不破
2. 正式播放不坏
3. 自动播可暂时降级

## 12. 非目标

这份 spec 不做以下事情：

1. 不在消息流里引入第二套正式播放器壳；
2. 不把 WebTorrent 或 P2P runtime 做成第二套视频 UI；
3. 不允许前端长期依赖首帧抠图代替稳定视频 preview 真相；
4. 不让多个视频在同一屏里同时自动播；
5. 不为了自动播去下放业务真相到壳层；
6. 不再额外生成只服务消息流自动播的第二份视频 preview 资产。

## 13. 最终裁决

本次视频链路收口的标准是：

**默认静态、视口唯一自动播、正式播放唯一 Video.js 壳、静态封面唯一后端真相、自动播复用正式媒体主链。**

只要还存在下面任意一条，这次收口就算失败：

1. 消息流默认态仍靠真实 `<video>` 抠首帧；
2. 消息流自动播又长出额外 preview clip、私有 source resolver 或第二份视频资产；
3. 视频 preview 仍然不是后端权威事实；
4. 正式查看器还能出现 `0x0` 尺寸塌陷；
5. 同屏能同时自动播多个视频；
6. 正式播放又长出第二套壳、第二套入口或第二套真相。
