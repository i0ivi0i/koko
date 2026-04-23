# 万人实时群聊 PostgreSQL 与 RoomRuntime 生产化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在第一阶段“单台 Linux 公网服务器”上支撑全站 `10 万+` 在线、最大单房间 `5000+` 在线、峰值 `20-50 msg/s` 的实时群聊，同时保持 PostgreSQL 只承载权威事实、历史查询和冷路径，不把房间实时扇出、观众态、媒体字节和 WebTorrent 高频 presence 压到数据库。

**Architecture:** 保留当前 Rust 模块化单体与 `socketioxide` 实时主通道。PostgreSQL 做持久事实源，RoomRuntime 做单房间热态 owner、广播背压、慢连接裁决和未来 Durable Objects 迁移边界。第一阶段只做单机生产化、池化、索引、查询收口和可观测性；不提前拆分集群、不引入 Kafka/Redis 作为主链、不用 PostgreSQL `LISTEN/NOTIFY` 做万人实时广播。

**Tech Stack:** Rust (`tokio`, `socketioxide`, `sqlx`, `axum`), PostgreSQL, PgBouncer, PowerShell, Cargo integration tests, Graphify

---

## Decision Lock

1. PostgreSQL 不承担实时房间总线，不承担每个观看者的在线态、已读态、播放态或 WebTorrent 片段态。
2. `socketioxide` 继续是第一阶段实时主通道；RoomRuntime 是边界与 owner，不是替换成熟实时轮子的私有协议。
3. 单台 Linux 阶段只做必要生产化：连接池、PgBouncer 适配、索引、查询形状、背压、监控和压测；不提前做多 PostgreSQL 主库、分库分表、CQRS 或全量事件中间件。
4. 后续迁移 Cloudflare Workers + Durable Objects 时，必须复用 RoomRuntime 的 command / event / snapshot / error 边界；不能把当前 Rust socket handler 写死成无法搬迁的业务真相 owner。
5. 媒体图片视频字节继续走对象存储 / WebSeed / WebTorrent 主链；数据库只存资产元数据、分发元数据和权威状态。
6. 所有优化先证明热路径，不做“看起来高级”的数据库重构；每一步必须能用测试、EXPLAIN、压测或日志指标证明。

## File Map

### PostgreSQL pool / config

- Modify: `src/总装.rs`
  责任：解析数据库连接池生产参数，保持迁移 pool 与应用 pool 分离。
- Modify: `src/外壳.rs`
  责任：用生产参数构建应用 `PgPool`，输出启动时 pool 配置日志。
- Modify: `src/适配.rs`
  责任：如仍存在测试/兼容连接入口，统一默认值与生产入口，不让旧 `max_connections(5)` 误导部署。
- Test: `tests/启动与迁移测试.rs`
  责任：验证连接池环境变量解析、默认值和迁移 pool 不被放大。

### PostgreSQL indexes / migrations

- Add: `migrations/0019_万人实时群聊生产化索引.sql`
  责任：补齐当前热查询所需索引，重点是 swarm presence 与房间历史读取。
- Modify: `tests/启动与迁移测试.rs`
  责任：验证 `0019` 存在并包含明确命名的生产索引。

### Realtime / RoomRuntime

- Modify: `src/实时外壳.rs`
  责任：把房间订阅、恢复、广播、慢客户端错误和 channel full 观测收口成 RoomRuntime 语义；第一阶段不强行新增 `.rs` 文件。
- Modify: `tests/实时链路测试.rs`
  责任：用行为测试证明广播不做 per-recipient DB 查询，慢客户端/已关闭连接只影响自身，不拖垮房间。

### Room queries / authoritative facts

- Modify: `src/房间阅读适配.rs`
  责任：确认历史读取使用 keyset / event position 语义，不做大 OFFSET 或全表扫描。
- Modify: `src/消息事件适配.rs`
  责任：确认写消息一事务落权威事实，广播只消费事件结果，不反向依赖数据库 fanout。
- Test: `tests/实时链路测试.rs`
- Test: `tests/用例测试.rs`

### Production proof

- Add or Modify: `tests/性能边界测试.rs` only if an existing test module cannot hold the check.
  责任：克制地加入数据库热路径/房间广播压力边界测试；如可并入现有测试，不新增 `.rs` 文件。
- Modify: `docs/superpowers/specs/2026-04-24-万人实时群聊PostgreSQL与RoomRuntime生产化设计.md`
  责任：实现完成后只按真实验证结果回填验收记录。

---

## Task 1: 连接池生产参数可配置，但迁移 pool 继续保持小而独立

**Files:**
- Modify: `src/总装.rs`
- Modify: `src/外壳.rs`
- Modify: `src/适配.rs`
- Test: `tests/启动与迁移测试.rs`

- [ ] **Step 1: 先写失败测试，锁住默认值和环境变量语义**

```rust
#[test]
fn 数据库连接池配置默认适合单机生产起步() {
    let cfg = 数据库连接池配置::from_env_with(|_| None).unwrap();
    assert_eq!(cfg.app_max_connections, 20);
    assert_eq!(cfg.migration_max_connections, 1);
    assert!(cfg.acquire_timeout_ms <= 5_000);
}

#[test]
fn 数据库连接池配置允许生产环境覆盖但拒绝无效值() {
    let cfg = 数据库连接池配置::from_env_with(|key| match key {
        "KOKO_DATABASE_MAX_CONNECTIONS" => Some("60".into()),
        "KOKO_DATABASE_ACQUIRE_TIMEOUT_MS" => Some("3000".into()),
        _ => None,
    }).unwrap();
    assert_eq!(cfg.app_max_connections, 60);
}
```

- [ ] **Step 2: 运行定向测试，确认当前硬编码 pool 会失败**

Run: `cargo test --test 启动与迁移测试 数据库连接池配置 -- --nocapture`

Expected: FAIL，因为当前 `src/外壳.rs` 仍硬编码 `PgPoolOptions::new().max_connections(20)`，没有可测配置对象。

- [ ] **Step 3: 最小实现连接池配置**

Implementation constraints:
- 新增配置优先放在现有 `src/总装.rs`，避免为了配置碎片新增 `.rs` 文件。
- 环境变量建议：
  - `KOKO_DATABASE_MAX_CONNECTIONS`
  - `KOKO_DATABASE_MIN_CONNECTIONS`
  - `KOKO_DATABASE_ACQUIRE_TIMEOUT_MS`
  - `KOKO_DATABASE_CONNECT_TIMEOUT_MS`
  - `KOKO_DATABASE_IDLE_TIMEOUT_SECONDS`
- `migration_max_connections` 固定默认 `1`，除非测试明确覆盖；不能被 app pool 参数误放大。
- 启动日志只输出配置摘要，不输出数据库 URL 或密码。
- 如果生产走 PgBouncer transaction pooling，不在连接级 `after_connect` 写入长期 session 状态；statement timeout 优先用数据库 role/default 或 PgBouncer 配置承接。

- [ ] **Step 4: 统一旧连接入口默认值**

Implementation constraints:
- `src/适配.rs` 中旧 `Pg仓储::连接并迁移` 若仍用于测试或兼容入口，默认值必须跟配置语义一致，不能保留一个没人知道的 `max_connections(5)` 暗入口。
- 迁移仍走单连接或极小连接池，不进入应用高并发 pool。

- [ ] **Step 5: 验证**

Run: `cargo test --test 启动与迁移测试 -- --nocapture`

Run: `cargo test -j 1`

Expected: PASS，且启动路径可通过环境变量调整应用 pool，不影响迁移 pool。

- [ ] **Step 6: Commit**

```bash
git add src/总装.rs src/外壳.rs src/适配.rs tests/启动与迁移测试.rs
git commit -m "生产化PostgreSQL连接池配置"
```

## Task 2: 补齐当前热查询索引，不做泛化分库分表

**Files:**
- Add: `migrations/0019_万人实时群聊生产化索引.sql`
- Modify: `tests/启动与迁移测试.rs`

- [ ] **Step 1: 先写迁移守卫测试，锁住必须存在的索引**

```rust
#[test]
fn 万人群聊生产化索引迁移必须覆盖当前热查询() {
    let sql = std::fs::read_to_string("migrations/0019_万人实时群聊生产化索引.sql").unwrap();
    assert!(sql.contains("idx_swarm_peer_presence_swarm_kind_seen"));
    assert!(sql.contains("idx_room_events_room_position_desc"));
    assert!(sql.contains("idx_messages_room_created_id_desc"));
}
```

- [ ] **Step 2: 运行测试，确认缺少 `0019` 会失败**

Run: `cargo test --test 启动与迁移测试 万人群聊生产化索引迁移必须覆盖当前热查询 -- --nocapture`

Expected: FAIL，因为当前最新迁移停在 `0018`。

- [ ] **Step 3: 新增 `0019` 索引迁移**

Minimum SQL shape:

```sql
CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_swarm_kind_seen
ON swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_events_room_position_desc
ON room_events (room_id, event_position DESC);

CREATE INDEX IF NOT EXISTS idx_messages_room_created_id_desc
ON messages (room_id, created_at DESC, id DESC);
```

Implementation constraints:
- 如果已有等价索引，优先调整测试断言为现有索引名，不重复建等价索引。
- `swarm_peer_presence` 当前 availability 查询按 `swarm_id + peer_kind + MAX(last_seen_at)` 命中；必须优先补这个复合索引。
- 房间历史读取只补当前查询真实会用到的索引，不为未来虚构功能加大而全量索引化。
- 不在本任务做分区表；只有当压测证明单表写入/清理成为瓶颈，再单独写分区计划。

- [ ] **Step 4: 验证迁移与 SQL 文本守卫**

Run: `cargo test --test 启动与迁移测试 -- --nocapture`

Run: `cargo test -j 1`

Expected: PASS，且迁移顺序仍可完整回放。

- [ ] **Step 5: Commit**

```bash
git add migrations/0019_万人实时群聊生产化索引.sql tests/启动与迁移测试.rs
git commit -m "补齐万人群聊PostgreSQL热路径索引"
```

## Task 3: 收口消息写入与历史读取查询形状

**Files:**
- Modify: `src/消息事件适配.rs`
- Modify: `src/房间阅读适配.rs`
- Test: `tests/用例测试.rs`
- Test: `tests/实时链路测试.rs`

- [ ] **Step 1: 先写行为测试，证明写入只落一次权威事实，广播不反查数据库**

```rust
#[tokio::test]
async fn 消息成立后广播消费同一份事件结果而不是逐连接查库() {
    let fixture = 实时链路测试夹具::new().await;
    let result = fixture.发送消息("1234b", "hello").await;
    assert_eq!(result.persisted_events, 1);
    assert_eq!(result.broadcast_payload_source, "committed_event");
    assert_eq!(result.per_recipient_db_reads, 0);
}
```

- [ ] **Step 2: 先写历史读取测试，锁住 keyset / position 语义**

```rust
#[tokio::test]
async fn 历史读取使用房间事件位置游标而不是offset分页() {
    let page1 = repo.加载房间事件页(room_id, None, 100).await.unwrap();
    let page2 = repo.加载房间事件页(room_id, page1.next_before_position, 100).await.unwrap();
    assert!(page2.events.iter().all(|event| event.position < page1.lowest_position));
}
```

- [ ] **Step 3: 运行定向测试，确认当前缺少这些明确边界证明**

Run: `cargo test --test 实时链路测试 消息成立后广播消费同一份事件结果而不是逐连接查库 -- --nocapture`

Run: `cargo test --test 用例测试 历史读取使用房间事件位置游标而不是offset分页 -- --nocapture`

Expected: FAIL，或需要先补测试夹具观测点。

- [ ] **Step 4: 最小实现或只补证明**

Implementation constraints:
- 如果当前代码已经符合要求，只补测试和清晰命名，不做无价值重构。
- 如果发现广播链路在 handler 内为每个 socket 重新查询消息/成员/房间状态，必须收口为一次用例结果 + 一次 RoomRuntime 广播。
- `src/房间阅读适配.rs` 禁止引入大 OFFSET；历史页默认按 `event_position` 或稳定 `(created_at, id)` 游标读取。
- 权限与成员资格仍归 application/domain 裁决；不得为了省 DB 在前端或 socket 连接态里伪造成员真相。

- [ ] **Step 5: 验证**

Run: `cargo test --test 实时链路测试 -- --nocapture`

Run: `cargo test --test 用例测试 -- --nocapture`

Run: `cargo test -j 1`

Expected: PASS，且测试能证明消息写入与广播边界，不只是源码 grep。

- [ ] **Step 6: Commit**

```bash
git add src/消息事件适配.rs src/房间阅读适配.rs tests/实时链路测试.rs tests/用例测试.rs
git commit -m "收口消息热路径查询与广播边界"
```

## Task 4: 在现有实时外壳内收口 RoomRuntime 背压与观测

**Files:**
- Modify: `src/实时外壳.rs`
- Test: `tests/实时链路测试.rs`

- [ ] **Step 1: 先写失败测试，证明慢连接和已关闭连接不拖垮房间**

```rust
#[tokio::test]
async fn 房间广播遇到慢连接只记录并隔离不影响其他在线用户() {
    let fixture = 实时链路测试夹具::new().await;
    fixture.制造慢连接("slow-user").await;
    let result = fixture.广播房间事件("1234b", 测试事件()).await;
    assert_eq!(result.delivered_to_healthy_users, 2);
    assert_eq!(result.slow_clients_detected, 1);
    assert_eq!(result.room_runtime_continues, true);
}
```

- [ ] **Step 2: 运行定向测试，确认当前缺少可测背压语义**

Run: `cargo test --test 实时链路测试 房间广播遇到慢连接只记录并隔离不影响其他在线用户 -- --nocapture`

Expected: FAIL，因为当前最多只有日志，没有稳定可测的 RoomRuntime 结果语义或观测点。

- [ ] **Step 3: 最小实现 RoomRuntime 语义**

Implementation constraints:
- 第一阶段优先在 `src/实时外壳.rs` 内收口私有类型/函数，不为了名字好看新增文件。
- 把现有 `BroadcastError::Send(ChannelFull)`、已关闭 socket、序列化失败等错误归类成稳定内部计数：
  - `broadcast_attempts`
  - `broadcast_delivered`
  - `broadcast_channel_full`
  - `broadcast_closed_socket`
  - `broadcast_adapter_errors`
- 慢客户端只影响自身，不触发房间级重试风暴。
- 不把这些 transient runtime 状态写入 PostgreSQL。

- [ ] **Step 4: 添加启动与运行时日志**

Implementation constraints:
- 日志用于无人值守诊断：房间 id、事件类型、连接数量区间、错误分类、耗时区间。
- 禁止输出消息正文、token、数据库 URL 或媒体私密 URL。
- 日志字段名应稳定，便于后续接 Prometheus / Loki / Cloudflare Analytics。

- [ ] **Step 5: 验证**

Run: `cargo test --test 实时链路测试 -- --nocapture`

Run: `cargo test -j 1`

Expected: PASS，且背压/错误分类有行为测试覆盖。

- [ ] **Step 6: Commit**

```bash
git add src/实时外壳.rs tests/实时链路测试.rs
git commit -m "收口RoomRuntime广播背压与观测"
```

## Task 5: 做单机生产压测入口，但不把压测工具做成新系统

**Files:**
- Prefer Modify: existing `tests/实时链路测试.rs` or existing scripts.
- Add: `scripts/load-room-runtime-smoke.ps1` only if existing scripts cannot express this.
- Modify: `docs/superpowers/specs/2026-04-24-万人实时群聊PostgreSQL与RoomRuntime生产化设计.md`

- [ ] **Step 1: 先定义最低压测验收，不追求一次模拟 10 万真连接**

Acceptance smoke:
- 单房间 `5000` 订阅者的模拟 fanout 不触发 per-recipient DB 查询。
- 峰值 `20-50 msg/s` 的消息写入在应用层被批量观测，不形成数据库连接池耗尽。
- 历史读取、恢复读取和媒体 availability 查询能在索引下稳定返回。
- 慢客户端被隔离，健康连接继续收到事件。

- [ ] **Step 2: 优先用现有测试夹具做压力边界测试**

Implementation constraints:
- 若能在 `tests/实时链路测试.rs` 用 fake sockets / adapter spy 证明 fanout 行为，不新增压测脚本。
- 只有真实浏览器或 socket 客户端压测不可替代时，才新增 `scripts/load-room-runtime-smoke.ps1`。
- 压测脚本必须有安全默认值，不默认打满本机，不默认连接公网。

- [ ] **Step 3: 增加 PostgreSQL 查询证明**

Recommended local proof:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT MAX(last_seen_at)
FROM swarm_peer_presence
WHERE swarm_id = $1 AND peer_kind = 'complete_peer';
```

Implementation constraints:
- 如果项目已有数据库测试容器/临时库，就把 EXPLAIN 结果纳入测试或文档记录。
- 如果没有稳定 EXPLAIN 测试环境，只把 SQL 写入验收手册，不伪造自动化通过。

- [ ] **Step 4: 验证**

Run: `cargo test --test 实时链路测试 -- --nocapture`

Run: `cargo test --test 启动与迁移测试 -- --nocapture`

Run: `cargo test -j 1`

Optional run if script exists: `pwsh -File scripts/load-room-runtime-smoke.ps1 -RoomId 1234b -Clients 500 -MessagesPerSecond 20 -DurationSeconds 30`

Expected: 自动化验证至少证明边界；真实大规模压测若未执行，spec 只能写“已补压测入口”，不能写“已证明 10 万真实在线”。

- [ ] **Step 5: Commit**

```bash
git add tests/实时链路测试.rs docs/superpowers/specs/2026-04-24-万人实时群聊PostgreSQL与RoomRuntime生产化设计.md
# 若本任务确实新增了压测脚本，再追加：
# git add scripts/load-room-runtime-smoke.ps1
git commit -m "补充RoomRuntime单机压力边界验证"
```

## Task 6: 总验收、图谱复核与 spec 回填

**Files:**
- Modify: `docs/superpowers/specs/2026-04-24-万人实时群聊PostgreSQL与RoomRuntime生产化设计.md`
- Modify: `graphify-out/GRAPH_REPORT.md` if code changed and graphify output changes.

- [ ] **Step 1: 跑全量后端验证**

Run: `cargo test --test 启动与迁移测试 -- --nocapture`

Run: `cargo test --test 实时链路测试 -- --nocapture`

Run: `cargo test --test 用例测试 -- --nocapture`

Run: `cargo test -j 1`

Expected: PASS。

- [ ] **Step 2: 若改了前端或媒体链路，再补前端验证**

Run only if relevant: `pnpm --dir frontend test`

Run only if relevant: `pnpm --dir frontend typecheck`

Run only if relevant: `pnpm --dir frontend build`

Expected: PASS；如果本计划只改后端/迁移/文档，可以说明未触发前端验证。

- [ ] **Step 3: 改了 Rust 代码后重建 graphify**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

Run: `Get-Content graphify-out/GRAPH_REPORT.md`

Expected:
- 不新增实时主通道/RoomRuntime/数据库访问的混写 god node。
- 如果高连接节点仍是既有壳层入口，spec 只能写这个证据强度，不写“图谱证明架构完美”。

- [ ] **Step 4: 只按真实证据回填 spec**

Spec update rules:
- 如果只完成连接池和索引，就写“单机数据库生产化第一阶段完成”，不要写“10 万在线已实测通过”。
- 如果压测只到 `500 / 1000` 模拟连接，就写真实数字。
- 如果未接 PgBouncer，只写“应用已具备 PgBouncer 兼容配置口径”，不写“PgBouncer 已部署”。
- 如果未迁移 DO，只写“RoomRuntime 边界为 DO 迁移预留”，不写“可无缝迁移完成”。

- [ ] **Step 5: 最终工作树复核并提交**

Run: `git status --short`

Then:

```bash
git add docs/superpowers/specs/2026-04-24-万人实时群聊PostgreSQL与RoomRuntime生产化设计.md
# 若本任务改动了 Rust 代码并重建 graphify 后输出发生变化，再追加：
# git add graphify-out/GRAPH_REPORT.md
git commit -m "回填万人群聊PostgreSQL生产化验收"
```

---

## Final Acceptance Checklist

- [ ] PostgreSQL 应用连接池可用环境变量调整，迁移 pool 保持独立且极小。
- [ ] 当前热查询至少补齐 `swarm_peer_presence (swarm_id, peer_kind, last_seen_at)` 复合索引。
- [ ] 房间历史读取和消息写入查询形状有行为测试覆盖，不靠大 OFFSET 或 per-recipient DB fanout。
- [ ] RoomRuntime 广播背压有稳定错误分类和测试覆盖，慢连接不会拖垮房间。
- [ ] 高频 viewer 状态、媒体字节、WebTorrent 片段态没有写入 PostgreSQL 主链。
- [ ] 压测入口或压力边界测试存在，且 spec 只记录真实执行过的规模。
- [ ] Graphify 复核没有新增实时/数据库混写热点。

## Risks To Watch

1. 不要把 PgBouncer 引入变成应用层 session state 依赖；transaction pooling 下不要在连接级假设固定 session。
2. 不要为了“无人值守”把自动治理写成自动删数据、自动踢用户或自动改业务事实；第一阶段只做观测、背压和清晰失败。
3. 不要把 RoomRuntime 写成第二套成员资格真相；成员、权限、消息成立仍归 application/domain。
4. 不要用模拟压测结果冒充公网 `10 万+` 真实在线证明；证据数字必须诚实。
5. 不要新增大量 `.rs` 文件制造碎片；能在现有模块清晰收口就先收口。

## Execution Handoff

按 Task 1 到 Task 6 顺序执行。每个 Task 先写失败测试，再最小实现，再验证，再提交。若执行者需要并行化，只有在主人明确授权 subagent 后，才把 Task 1/2、Task 3/4、Task 5/6 拆给不同 agent；默认当前主线单 agent 顺序执行。
