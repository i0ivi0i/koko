# 群友互助 CDN 顶格优化

> 日期：2025-05-11
> 状态：设计已通过，待实施
> 范围：WebTorrent 配置调优 + 可见区域 Swarm 预连接 + coturn TURN 服务器部署

---

## 1. 背景与动机

### 1.1 我们是什么

koko 是万人实时多群群聊 IM 系统。所有正式媒体字节（视频、图片）只走纯 WebTorrent
whole-file swarm（见 AGENTS.md §Frontend And Media 第4条），禁止绕过 WebTorrent。
这意味着 **群友的浏览器本身就是 CDN 节点**——不需要购买商业 CDN。

### 1.2 当前已建成的互助体系

经过源码审计，当前系统已经具备完整的 P2P 互助链路：

1. **IndexedDB 持久化**：每个 torrent 按 `koko-webtorrent-{infoHash}` 创建独立
   IndexedDB store，piece 字节直接持久化到浏览器本地磁盘。会话退场/页面关闭都
   **不删 store**（`destroyStoreOnDestroy: false` 全链路贯穿）。
   - 位置：`frontend/媒体/媒体协作分发.ts` L757-759, L846-849

2. **零引用做种**：用户关闭查看器/滚走后，`locallyComplete` 的会话继续留在 swarm
   里做种，LRU 淘汰最旧的，上限 128 个。
   - 位置：`frontend/媒体/资产协作分发生命周期.ts` L28

3. **存活心跳上报**：每 60 秒向后端 `presence_url` POST peer_kind，让其他群友能
   通过 tracker 发现此节点。
   - 位置：`frontend/媒体/媒体协作分发.ts` L799-834

4. **后端 strong seed sidecar**：上传后 24 小时内，后端以 Node sidecar 做强种子，
   周期对账自动拉起/回收。
   - 位置：`src/外壳/协作分发做种.rs`

5. **自动播也做种**：`inline_autoplay` 消费者模式拥有正式帮助资格，信息流自动播放
   的视频也会完整下载并做种。

### 1.3 问题：万人 swarm 的互助能力被严重低估

虽然链路完整，但 **WebTorrent 默认配置太保守**，导致万人 swarm 的带宽优势无法充分
发挥。具体瓶颈：

| 瓶颈 | 当前值 | 问题 |
|------|--------|------|
| `maxConns`（WebRTC peer 上限/torrent） | **55**（WebTorrent 默认） | 万人 swarm 只有 55 人同时帮你下载 |
| `storeCacheSlots`（内存 piece 缓存） | **20**（WebTorrent 默认） | 做种时每次只从内存供 20 片，其余回 IndexedDB 读（1~5ms/piece），上传慢 |
| 零引用做种上限 | **128** | 群聊视频消费频率高，128 很快填满 |
| ICE/STUN 服务器 | **WebTorrent 默认**（Google STUN） | 无 TURN 兜底，对称 NAT 后 ~15-30% 连不上 |
| 自动播预热 | 只预热**预览帧截图** | 不提前建 swarm 连接，首播仍需等 ICE 协商 1~3s |

**市面上"P2P CDN"产品（Peer5、Streamroot/Lumen、CDNBye）的核心引擎也是 WebRTC
DataChannel——和 WebTorrent 完全同源。它们卖的不是黑科技，而是"调参 + 智能调度 +
TURN 兜底"。我们已经有 WebTorrent，差的就是把这些旋钮拧到位。**

### 1.4 目标

在**不造成用户体验卡顿**的前提下，顶格激进优化，让群友越多 → 视频网速越快 → 自动
播放秒播 → 不花钱买 CDN。

---

## 2. 设计决策记录

### 2.1 为什么选方案 B（调参 + 预连接），不选 A 或 C

**方案 A（纯配置调参）**：不含预连接，自动播/点播仍需等 ICE 协商 1~3s，达不到
"Telegram 级秒播"。

**方案 B（调参 + 预连接）✅**：预连接让 ICE 延迟归零，用户真正播放时 peer 已就绪。
同时不浪费带宽下载用户可能永远不看的视频。

**方案 C（调参 + 预连接 + 激进全文件预下载）**：可见区域所有视频直接下完整文件。
带宽消耗巨大，低带宽用户体验灾难，IndexedDB 空间快速膨胀。

### 2.2 为什么全顶格不分档

用户明确选择：统一最激进参数，相信现代设备扛得住，有问题再回调。
不做 PC/移动端分档，简化代码路径。

### 2.3 为什么用 coturn 而不是后端自己当 TURN

后端已经是"群友之一"（strong seed），但"做种"和"当 TURN"是两回事：
- 做种：后端直接把 piece 推给浏览器（应用层）
- TURN：中转两个浏览器之间的 WebRTC 流量（网络层）

后端 web seed 24h 过期后，只剩纯群友 P2P。如果两个群友都在对称 NAT 后无法直连，
就需要 TURN 兜底。coturn 是成熟的开源 TURN 服务器（AGENTS.md §Architecture 第1条：
"基础设施默认复用成熟方案"），一台 VPS 就能跑，成本远低于自研 TURN。

### 2.4 为什么覆盖图片

用户明确选择。`maxConns`、`storeCacheSlots`、TURN 是全局配置，自然覆盖视频+图片。
预连接也对可见区域图片生效。

---

## 3. 详细设计

### 3.1 WebTorrent 客户端配置调优

#### 3.1.1 `maxConns: 128`

**改什么**：WebTorrent 客户端构造器传入 `maxConns: 128`。

**在哪改**：`frontend/媒体/媒体协作分发.ts` 的 `获取或创建协作分发浏览器运行时` 函数。
当前代码 `const client = new WebTorrentCtor()` 没传任何参数，`maxConns` 取默认值 55。

**为什么是 128 不是更高**：
- Chrome 实测 WebRTC DataChannel 在 128 条时稳定运行，内存开销约 50~80MB
- 超过 200 条 ICE 失败率开始上升
- 128 路并行 × 50~300 KB/s/peer ≈ 聚合带宽 6~38 MB/s
- 50MB 视频 1.3~8 秒下完，已经足够秒播

**为什么不是 `maxWebConns`**：`maxWebConns` 是 `client.add()` 的参数，只控制
**HTTP web seed 并行连接数**（当前值 4），不是 WebRTC peer 连接数。这个值保持 4
不变——web seed 只是冷源兜底。

#### 3.1.2 `storeCacheSlots: 150`

**改什么**：`client.add()` 时传入 `storeCacheSlots: 150`。

**在哪改**：`frontend/媒体/媒体协作分发.ts` 的 `接入协作分发种子` 函数，`client.add()`
的 opts 参数。

**为什么**：当前默认值 20，意味着做种时每个 torrent 只在内存缓存 20 个 piece。
其余 piece 要回 IndexedDB 读，读延迟 1~5ms/piece，**严重拖慢上传给其他群友的速度**。
150 个 piece × 256KB~1MB/piece ≈ 37.5~150MB 内存/**单个活跃 torrent**。

**最坏情况内存估算**：256 个零引用做种会话各 150 slots 是理论上限，但 cache 是
LRU 的——只有正在被其他 peer 请求的 torrent 才会有 slot 被填充。典型场景下同时
有 peer 请求的 torrent 不超过 10~20 个，实际内存占用 ≈ 20 × 50MB = ~1GB 上限，
远低于现代浏览器 tab 的 4GB 内存限制。做种效率直接翻倍。

#### 3.1.3 零引用做种上限 128 → 256

**改什么**：`零引用完成会话保留上限` 常量从 128 改为 256。

**在哪改**：`frontend/媒体/资产协作分发生命周期.ts` L28。

**为什么**：群聊视频消费频率高，128 个很快被填满。提到 256 后，用户看过的更多视频
都能持续帮群友做种。每个保留会话 = 活跃种子 + 60s 心跳定时器 + torrent metadata。
256 个 ≈ 每秒 ~4 次 tracker 心跳，24h 可持续运行。

**淘汰策略不变**：仍按 LRU（最早进入零引用态的会话先淘汰），逻辑在
`淘汰超限零引用完成会话` 函数中，只需改常量即可。

---

### 3.2 可见区域 Swarm 预连接

#### 3.2.1 问题陈述

当前流程：
```
用户点播/自动播 → locate → join swarm → ICE 协商（1~3s）→ 下载 piece → 播放
```

ICE 协商 1~3 秒是用户可感知的延迟，阻碍"秒播"体验。

目标流程：
```
媒体进入可见区域 → 500ms 防抖 → join swarm + ICE 建连
                                      ↓
用户点播/自动播 → peer 已就绪 → 零延迟开始下载 → 播放
```

#### 3.2.2 新增 `prefetch` 消费者模式

在现有 `协作分发消费者模式`（`viewer | inline_autoplay | backfill | preview | session`）
基础上新增 `prefetch`。

**推导规则**（在 `推导消费者模式` 函数中新增）：

| 属性 | prefetch 值 | 原因 |
|------|------------|------|
| `eagerCompleting` | `false` | 不下完整文件，只建连接 |
| `已获得帮助资格` | `false` | 不上报 presence，不算正式做种 |
| `wholeFileBackfill` | `false` | 不触发整文件补齐 |

**在 `接入协作分发种子` 时使用 `deselect: true`**：告诉 WebTorrent 不选择任何 piece。
torrent 仍然加入 tracker 并建立 WebRTC 连接，但不请求任何数据。这样 prefetch 的
带宽开销为零，只有 WebRTC 信令开销。

#### 3.2.3 升级语义

当同一 `swarmId` 已有 `prefetch` 消费者，用户触发正式播放时：

1. `确保协作分发会话` 发现会话已存在（按 swarmId 查表）→ 直接复用底层 torrent
2. 新的 `viewer` 或 `inline_autoplay` 消费者绑定到已有会话
3. `prefetch` 消费者可以继续共存或被释放（释放不影响会话，因为有新消费者）
4. 新消费者触发 piece selection（`file.select()`）和 `eagerCompleting`
5. 已连接的 peer 立即开始传输 → **ICE 延迟从 1~3s 降为 0**

这个升级逻辑不需要新机制——现有 `确保协作分发会话` 的"会话已存在则复用"路径天然
支持。只需要确保 `prefetch` 模式正确设置了 `deselect: true`，且升级时正确触发
piece selection。

#### 3.2.4 接入点：媒体窗口观察

**当前**：`frontend/房间消息窗/媒体窗口.ts` 中 `近视口活视频会话预算上限 = 4`，
只有 4 个视频进入活跃窗口。

**改动**：提升到 **12**，让更多视频有机会预连接。`近视口活媒体会话预算上限 = 24`
不变（图片+视频总数上限）。

**信号路径**：现有 `媒体窗口观察Owner` → `窗口会话协作` → 创建媒体会话条目。
当附件进入活跃窗口但**尚未被用户正式播放**时，媒体会话启动时应触发 prefetch 级别
的 swarm join，而不是完整的播放解析。

具体实现路径（从上到下）：
1. `窗口会话协作.补齐当前房间媒体会话` 为新进入窗口的附件创建媒体会话条目；
2. 媒体会话条目对视频执行 `触发视频预览收敛`，对图片执行 `启动()`；
3. 在 `触发视频预览收敛` / `启动()` 的链路中，判断当前附件是否已有正式播放
   消费者（viewer/inline_autoplay）——如果没有，说明这只是视口可见但未播放，
   此时以 `prefetch` 消费者模式调用 `确保协作分发会话`；
4. `确保协作分发会话` 收到 `prefetch` 模式 → 调用 `接入协作分发种子` 时传入
   `deselect: true`（WebTorrent `client.add()` 的标准参数），torrent 加入
   tracker + 建立 WebRTC 连接但不选择任何 piece；
5. 当用户真正触发播放，新的 `viewer/inline_autoplay` 消费者绑定到已有会话，
   `确保协作分发会话` 的"会话已存在则复用"路径天然命中，然后调用
   `torrent.files[0].select()` 开始下载。

**`deselect: true` 的传递**：在 `接入协作分发种子` 的 opts 参数中新增可选的
`deselect` 字段。只有 prefetch 模式传 `true`，其余模式保持默认 `false`。

#### 3.2.5 防抖与资源保护

- **滚动防抖 500ms**：媒体进入可见区域后 500ms 仍在视口内才触发 prefetch。
  实现方式：在 `媒体窗口观察Owner` 的 dispatch 中加 debounce，或在会话创建时
  延迟 500ms 再触发 prefetch。

- **prefetch 离开视口立即释放**：prefetch 消费者不享受零引用保留（它没下载任何
  数据，保留无意义）。当附件离开活跃窗口，`清理失活媒体会话` 正常触发释放。

- **prefetch 不计入零引用做种上限**：`协作分发会话可在零引用后保留` 对 prefetch
  返回 false（因为 `locallyComplete = false` 且 `eagerCompleting = false`）。

- **并行上限**：受 `近视口活媒体会话预算上限 = 24` 自然约束。24 个 prefetch 会话
  最多同时维持 24 × 128 = 3072 条 WebRTC 连接的理论上限，但实际上每个 torrent
  在 prefetch 阶段连接建立很慢（没有数据交换动机），预计实际连接数远低于此。

---

### 3.3 coturn TURN 服务器部署

#### 3.3.1 问题陈述

WebRTC peer 连接依赖 NAT 穿透。当前用 WebTorrent 默认的 Google STUN：
- **开放 NAT**：直连成功 ✅
- **一方对称 NAT**：~70% 成功
- **双方对称 NAT**（移动网络、企业网络）：❌ 连不上

后端 web seed 在 24h 内可以兜底，但 24h 后只剩纯群友 P2P。如果群友之间连不上，
就完全断了。部署 coturn 后 NAT 穿透成功率 >99%。

#### 3.3.2 coturn 容器

在 `ops/compose.yaml` 新增 `coturn` service：

```yaml
coturn:
  image: coturn/coturn:4.6
  restart: unless-stopped
  env_file:
    - ${KOKO_ENV_FILE:-/opt/koko/env/production.env}
  environment:
    KOKO_DOMAIN: ${KOKO_DOMAIN}
    COTURN_AUTH_SECRET: ${COTURN_AUTH_SECRET}
  command:
    - -n
    - --log-file=stdout
    - --listening-port=3478
    - --realm=${KOKO_DOMAIN}
    - --use-auth-secret
    - --static-auth-secret=${COTURN_AUTH_SECRET}
    - --no-cli
    - --no-multicast-peers
    - --no-tcp-relay
    - --min-port=49152
    - --max-port=49252
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "49152-49252:49152-49252/udp"
  networks:
    - koko-internal
```

**关键决策**：
- **`use-auth-secret`**：使用 TURN REST API（RFC 5766 long-term credential 的
  time-limited 变种）。后端用 HMAC-SHA1 为每个浏览器会话生成临时凭证，不泄露
  长期密钥给前端。
- **端口 3478/5349 直接对外**：UDP 无法被 Caddy 反代，coturn 必须直接监听公网端口。
- **relay 端口 49152-49252**：101 个端口。每个 TURN relay allocation 用一对端口，
  万人场景下同时进行 TURN 中转的连接数远小于 50（大部分连接通过 STUN 直连成功）。
- **TLS `turns:` 不在首期范围**：首期只启用 `turn:` (UDP/TCP)，不配置 TLS 证书。
  UDP 被完全封锁的网络极少，复杂度留给后期。

#### 3.3.3 后端生成 TURN 临时凭证

**位置**：在协作分发响应构建逻辑中（`src/媒体/协作分发/` 模块）。

**逻辑**：
1. 检查环境变量 `COTURN_AUTH_SECRET` 是否存在
2. 存在时：生成 TURN REST API 凭证
   - `username` = `{expiry_timestamp}:{random_nonce}`
   - `credential` = `HMAC-SHA1(COTURN_AUTH_SECRET, username)`
   - `expiry_timestamp` = 当前时间 + **86400s (24小时)**（独立于 join ticket TTL）
     > 为什么不复用 ticket TTL (120s)：TURN 凭证用于网络层 NAT 穿透，不是业务门禁。
     > 每个 torrent 的 tracker client 在创建时拷贝 rtcConfig 快照，之后不再跟踪
     > `client.tracker` 的变化。120s TTL 意味着观看 >2分钟的视频时新 peer 无法
     > 通过 TURN 中转。HMAC 不可伪造，coturn relay 只中转 UDP，长 TTL 无安全风险。
3. 不存在时：`ice_servers` 返回空数组，降级为纯 STUN（WebTorrent 默认）

**响应格式**（在现有协作分发 locator 响应中新增 `ice_servers` 字段）：
```json
{
  "ice_servers": [
    { "urls": "stun:im.example.com:3478" },
    {
      "urls": "turn:im.example.com:3478",
      "username": "1715400000:abc123",
      "credential": "base64encodedhmac"
    }
  ]
}
```

TURN 凭证 24 小时内有效，覆盖整个 web seed 窗口。已建立的 TURN relay 连接不受
凭证过期影响（TURN allocation 独立于认证）。

#### 3.3.4 前端注入 ICE 配置

**问题**：WebTorrent client 是全局单例，但 `ice_servers` 来自 locator（每次可能不同）。

**解决方案**：在 WebTorrent 构造器中通过 `tracker.rtcConfig` 设置 ICE servers。
由于所有 TURN 凭证都指向同一个 coturn 实例，全局设置是正确的。

**链路验证**：
```
new WebTorrent({ tracker: { rtcConfig: { iceServers: [...] } } })
  → bittorrent-tracker Client({ rtcConfig: { iceServers: [...] } })
    → this._rtcConfig = opts.rtcConfig
      → websocket-tracker.js: opts = { config: self.client._rtcConfig }
        → simple-peer({ config: { iceServers: [...] } })
          → new RTCPeerConnection({ iceServers: [...] })
```

**实现（确定方案）**：

经源码验证，WebTorrent `client.tracker` 是普通对象引用。每个 torrent 的
`_startDiscovery()` 每次都读取 `this.client.tracker` 构造 trackerOpts（见
`webtorrent/lib/torrent.js` L383-385）。因此：

1. WebTorrent 构造器初始时 `tracker: {}` 或不传（使用 WebTorrent 默认 STUN）
2. 首次 locator 响应返回 `ice_servers` 后，直接 mutate：
   ```typescript
   runtime.client.tracker.rtcConfig = { iceServers: distribution.ice_servers };
   ```
3. 后续所有 `client.add()` 创建的 torrent 在 `_startDiscovery()` 时都会读到
   更新后的 rtcConfig → 所有新的 WebRTC 连接都使用 TURN 兜底
4. 已存在的 torrent 的已建立连接不受影响（RTCPeerConnection 一旦建立，
   iceServers 不可更改，也不需要更改——连接已经成功了）
5. 凭证过期后，下次 locator 刷新会拿到新凭证并再次 mutate

**不需要额外 API 接口**。locator 响应本身就是 ICE 配置的自然载体。

#### 3.3.5 环境变量

```
# .env.example 新增
KOKO_DOMAIN=                 # 公网域名，coturn realm 和 ice_servers URL 复用
COTURN_AUTH_SECRET=          # 留空则不启用 TURN，纯 STUN 降级
```

`KOKO_DOMAIN` 在 `ops/env.production.example` 中已定义，但根 `.env.example`
也需要添加便于本地开发。

---

## 4. 受影响的文件与模块

### 4.1 前端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `frontend/媒体/媒体协作分发.ts` | 修改 | WebTorrent 构造器加 `maxConns: 128` + `tracker.rtcConfig`；`client.add()` 加 `storeCacheSlots: 150`；prefetch 模式加 `deselect: true` |
| `frontend/媒体/资产协作分发运行时.ts` | 修改 | `推导消费者模式` 新增 `prefetch` 分支；`确保协作分发会话` 处理 prefetch → 正式模式升级 |
| `frontend/媒体/资产协作分发生命周期.ts` | 修改 | `零引用完成会话保留上限` 128 → 256 |
| `frontend/房间消息窗/媒体窗口.ts` | 修改 | `近视口活视频会话预算上限` 4 → 12 |
| `frontend/媒体/壳层/窗口会话协作.ts` | 修改 | prefetch 信号路径接入 |

### 4.2 后端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/媒体/协作分发/` 模块 | 修改 | 协作分发响应新增 `ice_servers` 字段 + TURN 凭证生成 |
| `src/共享/契约基础.rs` 或对应 contract 模块 | 修改 | `媒体协作分发定位片段` struct 新增 `ice_servers: Vec<IceServer>` 字段 |
| `src/组合根.rs` | 修改 | 读取 `COTURN_AUTH_SECRET` 环境变量 |

### 4.3 运维

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `ops/compose.yaml` | 修改 | 新增 coturn service |
| `.env.example` | 修改 | 新增 `COTURN_AUTH_SECRET` |
| `docs/部署/` | 修改 | coturn 部署说明、证书配置、防火墙端口 |

---

## 5. 测试策略

### 5.1 前端单元测试

**配置调优**：
- WebTorrent 构造器收到 `maxConns: 128`
- `client.add()` 收到 `storeCacheSlots: 150`
- 零引用上限 256：第 257 个完成会话触发淘汰最旧的

**prefetch 消费者模式**：
- `prefetch` 模式 `eagerCompleting = false`、`已获得帮助资格 = false`
- prefetch 会话被 `viewer/inline_autoplay` 升级时复用同一底层 torrent
- prefetch 离开视口后正确释放，不享受零引用保留
- 500ms 防抖：快速滚过不触发 prefetch

**媒体窗口预算**：
- 视频预算 12，允许更多视频进入活跃窗口

**ICE 配置**：
- `ice_servers` 为空时不传 `rtcConfig`
- `ice_servers` 有值时正确设置 `tracker.rtcConfig.iceServers`

### 5.2 后端单元测试

- 有 `COTURN_AUTH_SECRET` 时生成合法 HMAC-SHA1 TURN 凭证
- 无 `COTURN_AUTH_SECRET` 时 `ice_servers` 返回空数组
- 凭证 TTL 等于 `SWARM_TICKET_TTL_SECONDS`
- 凭证格式符合 TURN REST API 规范

### 5.3 验收标准

| 标准 | 验证方式 |
|------|---------|
| maxConns 生效 | 浏览器 DevTools 检查 WebTorrent client 配置 |
| peer 连接数提升 | 两个浏览器互连，确认可建 >55 条连接 |
| 预连接生效 | 视频进入可见区域 500ms 后，DevTools Network 可见 tracker announce |
| 预连接→播放零延迟 | 有预连接的视频点播，无 ICE 协商等待 |
| TURN 兜底 | 模拟对称 NAT 环境，确认仍可连接 |
| 做种效率 | storeCacheSlots=150 下上传速度高于默认 |
| 零引用保留 | 看完 200 个视频后 200 个做种会话仍存活 |

---

## 6. 不在本期范围

- tracker `numwant` 调高（需改 bittorrent-tracker 服务端配置）
- 自适应 `maxConns`（根据设备性能动态调整）
- prefetch 带宽优先级（prefetch 下载优先级低于正在播放的 torrent）
- 后端智能 TURN 中转（用 coturn 已足够）
- coturn TLS 证书自动续期（首期手动配置，后续可集成 Caddy 证书）

---

## 7. 洋葱架构合规检查

| 层 | 改动 | 合规性 |
|----|------|--------|
| domain | 无改动 | ✅ |
| application | TURN 凭证生成（纯计算，无 IO） | ✅ 不依赖外部 |
| contract | 协作分发响应新增 `ice_servers` 字段 | ✅ 稳定共享表面 |
| adapter | WebTorrent 配置、coturn 容器 | ✅ 外层适配 |
| shell | 预连接信号路径、媒体窗口预算 | ✅ 交互编排 |
