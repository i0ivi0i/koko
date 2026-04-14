# Web 媒体 P2P 能力补满设计

日期：2026-04-14  
状态：Draft  
适用范围：`koko` 仓库 `Web 前端` 当前阶段的 `HLS P2P`、`WebTorrent 文件级视频边下边播`、`图片秒开与补齐`。  
关联文档：

- `docs/superpowers/specs/2026-04-14-Web单一视频播放器壳与外置分发层-design.md`
- `docs/superpowers/specs/2026-04-13-跨端志愿者媒体资产与P2P分发协议-design.md`
- `docs/superpowers/specs/2026-04-12-浏览器端应用平台化-design.md`
- `学习/整理笔记/Video.js-v10-beta-播放器候选笔记.md`

## 1. 为什么要写这份 spec

上一阶段已经把 Web 视频正式播放路径收口到单一播放器壳。  
但“壳收口”不等于“P2P 优势吃满”。

当前还存在三个现实缺口：

1. `HLS` 主链仍主要是 `hls.js` 单点拉流，`p2p-media-loader-hlsjs` 还没有形成真实生产增益；
2. `WebTorrent` 已经接入了 swarm / backfill / release，但文件级视频“边下边播”的真实收益还没有被验证闭环；
3. 图片当前主要靠 `preview/full + cache` 秒开，`WebTorrent` 更像后台补齐与协作分发，而不是首开主链。

对于万人万群实时群聊，这三个问题不能继续混着看。  
需要单独写一份 spec，把“谁负责首播、谁负责 P2P、谁负责补齐、谁负责 complete/release”重新讲清楚。

这份 spec 的目标不是再换播放器壳，也不是为了追新把所有媒体主链一起重写。  
目标是：

**在保持单一播放器壳和单一媒体会话 owner 不变的前提下，把 HLS P2P、WebTorrent 文件级视频、图片秒开与补齐这三条能力线真正补满。**

## 2. 当前现状

### 2.1 HLS 主链

- 当前 `manifest` 视频优先走 `Video.js v10 + hls.js`；
- `p2p-media-loader-hlsjs` 已经安装，但生产代码里还没有真实接线；
- 现有测试只证明了“增强层不能阻断首播，也不能变成必经路径”，还没有证明它真的在运行时生效。

### 2.2 WebTorrent 文件级视频

- 当前 `manifest` 不可用时，视频可以回落到 `swarm/blob` 路径；
- 运行时已经具备 `WebTorrent client`、`service worker`、`streamURL`、`presence`、`release`、`ASSET_COMPLETE` 等能力；
- 但还没有证明多人场景下，文件级视频真的达到了“边下边播极佳”的效果。

### 2.3 图片首开与补齐

- 当前图片首开主链优先走 `blob_asset.preview/full`；
- `media-sw` 会给图片 blob 资产做受控缓存命中；
- 图片进入 `backfilling` 时，才会真正激活协作分发 runtime；
- 这说明项目当前的图片策略是“先秒开，再补齐”，而不是“先走 WebTorrent 再开图”。

## 3. 官方最佳实践给出的方向

### 3.1 `hls.js`

`hls.js` 的角色是 `HLS playback engine`，不是播放器壳。  
它适合作为 `Video.js v10` 壳下面的 HLS provider。

### 3.2 `p2p-media-loader-hlsjs`

`p2p-media-loader-hlsjs` 的角色是 `HLS 分片级 P2P 增强层`。  
它应该挂在 HLS 引擎旁边，提升 HLS 主链的 peer 协作能力，而不是自成一套 UI 或播放入口。

### 3.3 `WebTorrent`

`WebTorrent` 更适合做：

- 文件级视频分发
- 字节流传输
- backfill
- seeding
- release

它不是 HLS 播放器，也不应该被硬塞进 HLS 主链充当第二个播放内核。

### 3.4 图片秒开

图片秒开的正确目标是“用户尽快看到正确图片”，而不是“必须走 WebTorrent”。  
如果 `preview/full + cache` 已经更适合秒开，那 `WebTorrent` 就应该退回补齐、协作和后续分享，而不是反过来拖慢首开。

## 4. 目标能力

这份 spec 要补齐四件事：

1. `HLS P2P` 在生产路径里真实生效；
2. `WebTorrent MP4/文件级视频` 真正做到多人场景下的边下边播闭环；
3. 图片秒开继续稳定，不被 P2P 方案拖慢；
4. sender / viewer / late joiner 在群聊里都能真实受益于协作分发。

## 5. 架构边界

### 5.1 不变的东西

- 单一播放器壳不变；
- `MediaSessionOwner` 继续是唯一媒体会话真相 owner；
- 不允许第二套正式播放器实现；
- 不允许把 P2P 增强层变成首播必经路径。

### 5.2 `HLS P2P`

- 只属于 `HLS provider`；
- 只增强 HLS 主链；
- 失败时只能降级为“无 P2P 增强的 HLS”，不能把首播拖死。

### 5.3 `WebTorrent`

- 只属于文件级视频和分发/补齐平面；
- 不进入 HLS 主链；
- 不生成第二个 `<video>` 主链；
- 继续负责 `backfill / seeding / release / presence`。

### 5.4 图片

- 首开继续优先 `preview/full + cache`；
- `WebTorrent` 继续只做补齐与协作分发；
- 不为了证明 P2P 而牺牲图片首开体验。

## 6. 能力矩阵

### 6.1 HLS 视频

- 正式主链：`Video.js v10 + hls.js`
- P2P 增强：`p2p-media-loader-hlsjs`
- 真相 owner：`MediaSessionOwner`

### 6.2 MP4 / 文件级视频

- 正式主链：`Video.js v10 + WebTorrent streamURL`
- 协作能力：`swarm / backfill / release / presence`
- 真相 owner：`MediaSessionOwner`

### 6.3 图片

- 首开主链：`preview/full + cache`
- 补齐平面：`WebTorrent`
- 真相 owner：`MediaSessionOwner + MediaCacheOwner`

## 7. TDD 验收方向

### 7.1 HLS P2P

- 真正接线测试
- 不阻断首播测试
- 有 peer / 无 peer 降级测试
- 不制造第二套播放器实现测试

### 7.2 WebTorrent 文件级视频

- 双 peer 边下边播测试
- seek / 恢复测试
- sender / viewer / late joiner 闭环测试
- complete / release 测试

### 7.3 图片

- preview/full 秒开测试
- backfill 激活测试
- complete/release 不退化测试
- 不让 WebTorrent 拖慢首开测试

### 7.4 浏览器验收

- HLS 恢复同步
- 文件级视频边播
- 图片秒开
- 多 peer 行为

## 8. 观测指标

至少要观测这些指标：

- 首帧时间
- stall 次数
- 恢复时间
- peer 命中
- web seed 命中
- P2P 命中占比
- complete 成功率
- release 成功率

没有这些观测，就不能宣称“吃满了 WebTorrent / P2P 优势”。

## 9. 分阶段落地

1. 先把 `p2p-media-loader-hlsjs` 真接上，并补 HLS P2P 红灯测试；
2. 再把 `WebTorrent MP4` 双 peer 边下边播闭环补齐；
3. 再把图片首开与补齐边界锁死；
4. 最后做浏览器侧验收和指标验证。

## 10. 完成定义

做到下面这些，才算这份 spec 落地：

1. `HLS P2P` 有真实生产接线和运行证据；
2. `WebTorrent` 文件级视频在多人场景下有真实收益；
3. 图片秒开不退化；
4. `backfill / seeding / release / complete` 都没有掉；
5. sender / viewer / late joiner 都能稳定受益；
6. 全程没有长出第二套播放器实现。
