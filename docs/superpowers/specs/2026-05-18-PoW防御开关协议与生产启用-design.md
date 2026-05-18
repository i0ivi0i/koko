# PoW 防御开关协议与生产启用设计

日期：2026-05-18
状态：Design / Ready for owner review

关联：

- `docs/superpowers/specs/2026-05-09-ddos-cc-defense-design.md`
- `frontend/平台/传输.ts`
- `frontend/实时/应用.ts`
- `frontend/连接门禁/pow门禁.ts`
- `src/外壳/mod.rs`
- `src/外壳/连接门禁.rs`
- `src/实时/外壳.rs`
- `src/组合根.rs`
- `ops/env.production.example`
- `ops/healthcheck.sh`

---

## 1. 一句话结论

当前 PoW 防御主体已经存在，但“前端如何知道服务端是否启用 PoW”仍靠请求 `/api/pow/challenge` 后得到 404 来推断。这个设计能跑，但不是稳定协议。

正确修复是：把 PoW 是否启用变成显式启动/会话协议字段，例如 `pow_required: true | false`，前端只在 `true` 时请求 challenge。同时把生产部署收成“默认安全”：正式部署自动生成 secret 并启用 PoW，只有显式 `KOKO_POW_ENABLED=false` 才关闭。

---

## 2. 前因后果

### 2.1 线上现象

公网冒烟时，控制台稳定出现：

```text
GET https://kokoqun.com/api/pow/challenge -> 404
```

聊天、进房、视频上传和 WebTorrent 播放都能继续工作。说明这不是功能阻塞，而是前端在探测一个未启用的防御端点。

### 2.2 为什么这个 404 会出现

后端 `src/外壳/mod.rs` 当前逻辑：

```text
如果 state.defense = Some(...)
  注册 /api/pow/challenge 和 /api/pow/verify
否则
  不注册 PoW 路由
```

`state.defense` 来自 `KOKO_POW_SECRET`。生产环境没有配置合法 `KOKO_POW_SECRET` 时，PoW 防御降级关闭，路由自然不存在。

前端 `frontend/平台/传输.ts` 当前逻辑：

```text
先请求 /api/pow/challenge
如果成功 -> 解题并带 pow_token 连 realtime
如果首次 404 -> 认为服务端未启用 PoW，后续跳过
```

这条路径的行为是可理解的，但它把“功能未启用”表达成了一个浏览器控制台错误。

---

## 3. 为什么必须修

### 3.1 产品层原因

公网万人实时 IM 是高攻击面系统。WebSocket 连接、房间订阅、消息创建和媒体上传都是真实成本入口。Cloudflare 能挡一部分通用 DDoS，但应用层仍需要自己的门禁，尤其是 WebSocket 建连前的低成本过滤。

### 3.2 工程层原因

404 探测不是稳定协议：

1. 控制台永远有红色错误，掩盖真正故障；
2. 监控系统会把预期 404 当异常；
3. 未来启用 PoW 时，前端状态切换依赖“第一次失败”这个隐式缓存；
4. 防御开关没有进入会话事实，排障时只能猜环境变量。

### 3.3 安全层原因

不启用 PoW 时，实时连接防线少一层。攻击者可以更便宜地发起大量 socket 握手，让请求更快进入 IP 计数、session DB 校验和 socketioxide 连接管理。

PoW 的目标不是替代 Cloudflare，而是补齐应用层：

```text
Cloudflare/WAF/Rate Limit
  -> PoW 解题
  -> IP 连接计数
  -> session DB 校验
  -> realtime 建连
```

---

## 4. 官方和成熟实践依据

### 4.1 OWASP / API 资源消耗

OWASP API 安全建议限制资源消耗，避免未受限的请求把 CPU、内存、连接、第三方服务或数据库资源打满。对实时 IM 来说，WebSocket 建连和握手前置检查是关键。

### 4.2 WebSocket 防御实践

WebSocket 攻击常见形态：

1. 连接洪水；
2. 握手洪水；
3. 已建连接后的消息洪水；
4. 大量碎片帧或异常帧造成内存/CPU 压力。

Cloudflare/WAF 主要看 upgrade 前的 HTTP 请求；连接建立后的应用语义仍要靠应用自己限速和裁决。

### 4.3 Hashcash / PoW 实践

PoW 的成熟思想是：服务端生成带签名的 challenge，客户端计算一个满足难度的 hash，服务端快速验证。服务端验证必须便宜，客户端成本可随攻击强度提高。

本项目现有 `src/外壳/连接门禁.rs` 已符合这个方向：

- HMAC 签名 challenge；
- token 短时有效；
- 30 秒窗口自适应难度；
- 验证在内存中完成，不查询 DB。

---

## 5. 当前源码事实

### 5.1 已有能力

后端已有：

- `PoW引擎`
- `访客计数器`
- `Ip追踪器`
- `handle_pow_challenge`
- `handle_pow_verify`
- realtime connect middleware 里验证 `pow_token`

前端已有：

- `frontend/连接门禁/pow门禁.ts`
- Web Worker 解题器
- `获取PowToken`
- realtime 建连前取 token

也就是说：主体能力不是缺失，缺的是开关协议和生产启用闭环。

### 5.2 当前缺口

1. 没有 `pow_required` 显式字段；
2. 前端把 404 当功能关闭信号；
3. `ops/healthcheck.sh` 不检查 PoW 开启/关闭两种路径；
4. `ops/env.production.example` 没把生产启用防御的必填项讲清楚；
5. Cloudflare WAF / Rate Limit 规则不在仓库内形成可执行检查。

---

## 6. 修复目标

### 6.0 正常用户丝滑体验红线

PoW 防御的产品目标不是“所有连接都变慢”，而是“批量攻击者变贵”。正常用户必须保持无感：

```text
打开页面
  -> 后台自动判断是否需要 PoW
  -> 低负载时几十毫秒内解题
  -> token 随 realtime 握手提交
  -> 进房、聊天、发视频、播放视频不再碰 PoW
```

硬红线：

1. 不出现验证码、确认弹窗或手动挑战；
2. 不把 PoW 放进发消息、发图、发视频、WebTorrent 播放热路径；
3. 不让每条消息都重复解题；
4. 不让视频上传或播放器等待 PoW；
5. PoW 失败必须有明确错误和自动重试路径，不能让用户卡在“进房无反应”；
6. 低负载难度必须足够低，目标是浏览器后台无感完成。

参数原则：

| 场景 | 目标体验 | 建议策略 |
|---|---|---|
| 正常低负载 | 用户无感 | 低 difficulty，token 短时复用 |
| 轻微异常 | 最多轻微延迟 | 逐步加难，不直接拒绝 |
| 明显攻击 | 攻击者成本升高 | 提升 difficulty + IP/session 限速 |
| 持续失败 | 快速卸载 | 冷却或拒绝，不进入 DB |

这里的“丝滑”不是不防御，而是把成本只压到批量攻击者身上。

### 6.1 第一阶段：消除 404 探测

新增稳定协议字段：

```json
{
  "pow_required": false
}
```

字段放置建议：

1. 优先放在 `/api/session/bootstrap` 响应里，因为前端建 realtime 前必经 bootstrap；
2. 如果 bootstrap contract 不适合扩大，也可以新增 `GET /api/pow/status`，永远返回 200。

推荐选择：**放进 bootstrap**。理由：

- 少一次请求；
- 用户打开页面时就知道是否需要 PoW；
- `session_id` 和 realtime 建连策略同属会话启动事实。

### 6.2 第二阶段：前端按显式字段决定是否解题

前端状态从：

```text
先请求 challenge，404 后缓存“未启用”
```

改成：

```text
bootstrap.pow_required=false -> 不请求 challenge
bootstrap.pow_required=true  -> 请求 challenge + verify + socket auth 带 pow_token
```

### 6.3 第三阶段：生产默认自动启用防御

生产环境只暴露一个人能读懂的开关：

```dotenv
KOKO_POW_ENABLED=true
```

默认值为 `true`。部署脚本负责：

1. 如果 `KOKO_POW_ENABLED` 缺失，写入 `true`；
2. 如果 `KOKO_POW_ENABLED=true` 且 `KOKO_POW_SECRET` 缺失，自动生成 32+ 字节随机 secret；
3. 正式部署固定写入 `KOKO_TRUSTED_PROXY=true`，因为当前正式链路是 Cloudflare + Caddy + Rust app；
4. 如果用户显式写 `KOKO_POW_ENABLED=false`，后端不启用 PoW，且前端 `pow_required=false`。

这样用户不需要理解 secret 细节，只需要知道“防御默认开着，需要时可显式关闭”。

### 6.4 第四阶段：健康检查

`ops/healthcheck.sh` 增加两种检查：

1. PoW 关闭时：bootstrap 返回 `pow_required=false`，前端不应请求 challenge；
2. PoW 开启时：`/api/pow/challenge` 返回 200，`/api/pow/verify` 能返回 token，realtime 带 token 能连接。

---

## 7. 不做的事

1. 不把 PoW 加到媒体上传、图片查看、视频播放热路径；
2. 不在前端引入第三方验证码；
3. 不让 PoW token 持久化到长期存储；
4. 不用 404/500 作为功能开关；
5. 不把 Cloudflare WAF 当成唯一防线；
6. 不把攻击防御逻辑放入 domain/application。

---

## 8. TDD 设计

### 8.1 RED：bootstrap 明确返回 pow_required

后端测试：

```text
未配置 KOKO_POW_SECRET -> bootstrap.pow_required=false
配置 KOKO_POW_SECRET -> bootstrap.pow_required=true
```

### 8.2 RED：前端 pow_required=false 不请求 challenge

前端测试：

```text
bootstrap 返回 pow_required=false
调用 ensureRealtimeSocket
断言 transport.获取PowToken 未被调用
```

### 8.3 RED：pow_required=true 会请求 challenge 并带 token

前端测试：

```text
bootstrap 返回 pow_required=true
获取PowToken 返回 token
createSocket(sessionId, token) 被调用
```

### 8.4 GREEN：最小实现

1. 后端 bootstrap 响应增加 `pow_required`；
2. 前端把该字段写入既有 `实时连接运行时策略`；
3. realtime 建连从 `聊天实时连接端口.读取运行时策略()` 读取该字段，决定是否调用 `获取PowToken`；
4. 删除“404 表示未启用”的正常路径，只保留真正异常处理。

---

## 9. 验证计划

1. `cargo test 连接门禁`：确认 PoW 引擎不退化；
2. 后端 session/bootstrap 测试：确认 `pow_required`；
3. 前端实时编排测试：确认启用/关闭两种建连路径；
4. `pnpm typecheck`；
5. 正常用户丝滑体验验证：
   - PoW 低负载时首次建连额外耗时应在后台完成；
   - 发消息、发视频、播放视频不触发 PoW 请求；
   - token 有效期内重连不重复解题；
6. 公网冒烟：
   - PoW 关闭：控制台不再出现 `/api/pow/challenge` 404；
   - PoW 开启：challenge/verify 200，socket 正常连接；
   - 视频上传播放不受影响。

---

## 10. 风险与回滚

### 风险 1：启用 PoW 后正常用户连不上

原因可能是前端没拿到 token、token 过期、系统时间偏差或代理真实 IP 配置不对。

回滚方式只需要一个开关：

```dotenv
KOKO_POW_ENABLED=false
```

服务重启后 `pow_required=false`，前端不再请求 challenge。

### 风险 2：攻击时难度过高影响真人

当前难度逻辑基于 30 秒窗口计数，正常低负载难度低。后续如果真实用户被影响，应先调难度阈值，不要删除整套防御。

### 风险 3：Cloudflare / Caddy 真实 IP 配置错误

如果 `KOKO_TRUSTED_PROXY=true` 但上游没传可信 `X-Forwarded-For`，IP 连接计数会不准。生产启用前必须确认 Caddy 反代头行为。

---

## 11. 成功标准

1. PoW 关闭时，控制台不再出现 `/api/pow/challenge` 404；
2. PoW 开启时，正常用户自动解题并连接 realtime；
3. 无 token / 错 token 的 socket 握手在 DB 校验前被拒绝；
4. 媒体上传、WebTorrent 播放、房间实时消息不增加额外热路径延迟；
5. 生产默认自动启用，且能通过一个开关关闭，回滚简单明确。

---

## 12. 自审记录

### 第一遍：需求意图

本 spec 解决用户担心的“公网 IM 不开防御是否危险”和当前线上 `/api/pow/challenge` 404 噪音。它不把“修控制台”偷换成“放弃防御”，而是先修协议再启用防御。通过。

### 第二遍：架构边界

PoW 仍在 adapter/shell 层，domain/application 不感知。前端只消费会话启动契约，不自作安全判断。通过。

### 第三遍：验证闭环

覆盖关闭、开启、错误 token、正常 realtime、媒体链路不受影响、低负载无感六类验证。通过。

### 100% 自信循环

当前设计没有新增安全轮子，复用既有 PoW 引擎和前端解题器；修复点集中在“显式开关协议 + 生产默认安全”。主要风险是开启后误伤正常连接，已用单开关回滚和双路径测试收口。作为下一步实现依据有事实层面的充分信心。
