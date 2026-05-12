# 后端 WebTorrent 强种子生产化闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md` 修正强种子事实 owner，让 `backend_strong_seed` 只在 sidecar WebTorrent runtime 证明自己是完整、持票、同 `infoHash`、WebRTC-capable seed 后写入。

**Architecture:** Rust shell 保持唯一落库 owner，但不再用 `/seed/start` HTTP ack 推断强种子成立；Node sidecar 成为 WebTorrent runtime 事实 owner，返回稳定 `SeedSessionSnapshot`。domain/application/contract 不接触 sidecar runtime 字段，complete/reuse/forward/realtime/reconcile 统一复用同一个 shell 裁决函数。

**Tech Stack:** Rust 2021、Tokio、Reqwest、SQLx、Axum、futures-util、Node.js ESM、WebTorrent / webtorrent-hybrid、Vitest、PowerShell、Playwright/Chrome DevTools/browser-trace。

---

## 0. 已确认事实与风险

- **Spec source**: `docs/superpowers/specs/2026-05-12-后端WebTorrent强种子生产化闭环-design.md`
- **GitNexus index**: 已更新到 HEAD `6cabf1d6`。
- **CRITICAL impact**: `src/外壳/协作分发做种.rs::尝试启动协作分发做种` 影响 15 个符号、9 条执行流。
- **CRITICAL impact**: `src/外壳/协作分发做种.rs::执行一次协作分发做种对账` 影响 7 个符号、5 条执行流。
- **LOW impact**: `frontend/dev-seeder.mjs::启动做种会话` 当前没有 GitNexus 上游调用，但它是 sidecar 事实 owner。
- **直接调用者**:
  - `src/外壳/协作分发做种.rs::执行一次协作分发做种对账`
  - `src/媒体/上传/外壳/完成上传.rs::complete_media_upload`
  - `src/媒体/上传/外壳/附件响应.rs::构造ready媒体附件响应并触发做种`
  - `src/实时/外壳.rs::确认消息附件强种子`
- **现有测试入口**:
  - Rust: `cargo test --test 集成测试 <测试名> -- --nocapture`
  - Frontend: `pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts`
  - Script: `pwsh -NoProfile -File tests/启动器脚本检查.ps1`

## 1. 文件职责图

### Rust shell

- **Modify**: `src/外壳/协作分发做种.rs`
  - 定义 shell 私有 `SeedSessionSnapshot` 反序列化结构。
  - 定义 shell 私有 `后端强种子裁决` 枚举。
  - 定义纯函数 `裁决后端强种子快照`。
  - 修改 `尝试启动协作分发做种` 返回 sidecar 事实。
  - 修改 `执行一次协作分发做种对账` 只在 Ready 裁决下写 `backend_strong_seed` presence。
  - 增加有限并发、HTTP timeout、ICE 复用。
- **Modify**: `src/外壳/mod.rs`
  - 在 `应用状态` 内复用 `reqwest::Client`，避免 sidecar 控制面每次新建 client。
  - 只放 shell 基础设施，不放业务事实。

### Rust callers

- **Review**: `src/媒体/上传/外壳/完成上传.rs`
  - complete 后仍 fire-and-forget，不因 sidecar 未 Ready 回滚 attachment ready。
  - 成功返回 Degraded 时记录日志，不写 presence。
- **Review**: `src/媒体/上传/外壳/附件响应.rs`
  - reuse/forward 仍触发同一 sidecar start，不复制第二套 readiness 判断。
- **Review**: `src/实时/外壳.rs`
  - 广播后确认强种子仍调用同一 shell owner。
  - 未 Ready 只记录竞态窗口，不在 realtime handler 落库。

### Rust tests

- **Modify**: `tests/协作分发测试/可用性裁决.rs`
  - fake seeder 控制面支持按测试配置返回 Ready / Degraded / hang。
- **Modify**: `tests/协作分发测试/可用性裁决_做种对账.rs`
  - 增加 accepted-but-not-ready 不写 presence。
  - 增加 Ready 写 presence。
  - 增加 hang 不永久卡住。
  - 增加多条待做种项单条失败不阻塞 Ready 项。
- **Modify**: `tests/媒体上传测试/单文件主链.rs`
  - fake seeder 返回 `SeedSessionSnapshot`。
  - complete not-ready 仍返回 OK，不写假 strong seed。

### Node sidecar

- **Modify**: `frontend/dev-seeder.mjs`
  - 生产默认要求 `webtorrent-hybrid`，只有 `SWARM_SEEDER_FORCE_MOCK=1` 才允许 mock。
  - 增加 `SeedSessionSnapshot` 构造函数。
  - `/seed/start` 返回 snapshot。
  - 新增 `/seed/status`，返回同一 snapshot shape。
  - `/health` 保留 `capability`、`activeCount`、`sessions`。
- **Modify**: `frontend/dev-seeder.d.mts`
  - 暴露测试需要的最小类型声明。
- **Modify**: `frontend/tests/dev-seeder做种续租测试.spec.ts`
  - 增加 snapshot、status、hybrid enforcement 测试。
- **Modify**: `frontend/package.json`
  - 增加 `webtorrent-hybrid` 运行依赖。
- **Modify**: `frontend/pnpm-lock.yaml`
  - 通过 `pnpm --dir frontend add webtorrent-hybrid` 更新。

### Script checks

- **Modify**: `tests/启动器脚本检查.ps1`
  - 检查 `frontend/package.json` 声明 `webtorrent-hybrid`。
  - 检查 `frontend/dev-seeder.mjs` 暴露 `/seed/status`。
  - 检查生产默认不静默 mock。

---

## 2. 设计四问

1. **权威事实在哪里决定？**
   - sidecar 的 WebTorrent runtime 产生 `SeedSessionSnapshot`。
   - Rust shell 只把 snapshot 归纳成 Ready / Degraded / Unavailable，并且只有 Ready 写 presence。

2. **稳定交换契约是什么？**
   - sidecar 控制面 JSON：`SeedSessionSnapshot`。
   - 这个契约只在 Rust shell 与 sidecar 之间使用，不进入 domain/application/contract/room_event。

3. **同步锚点是什么？**
   - 会话身份只认归一化小写 40 hex `infoHash`。
   - reconcile 的 `activeInfoHashes` 仍来自 Rust 权威待强种集合。

4. **重试/重连/重入如何恢复和去重？**
   - 同 `infoHash` 重复 start 只刷新 `joinTicket` 与 source 线索，不创建第二会话。
   - 非 Ready 不写 presence，由同一 reconcile owner 下一轮补齐。
   - 权威集合移除时 sidecar reconcile 销毁非 active 会话，Rust 不再续写 presence。

---

## Task 1: Rust RED/GREEN - 定义强种子事实裁决纯函数

**Files:**
- Modify: `src/外壳/协作分发做种.rs:265-306`

- [ ] **Step 1: Write failing unit tests**

在 `src/外壳/协作分发做种.rs` 的 `#[cfg(test)] mod tests` 内追加：

```rust
fn 测试快照(
    info_hash: &str,
    capability: &str,
    ready: bool,
    progress: f64,
    has_join_ticket: bool,
) -> 后端强种子会话快照 {
    后端强种子会话快照 {
        info_hash: info_hash.to_string(),
        capability: capability.to_string(),
        ready,
        progress,
        has_join_ticket,
        num_peers: 0,
        failure_reason: None,
    }
}

#[test]
fn 只有hybrid完整持票同infohash快照才裁决为ready() {
    let expected = "0123456789abcdef0123456789abcdef01234567";
    let snapshot = 测试快照(expected, "hybrid", true, 1.0, true);

    let 裁决 = 裁决后端强种子快照(expected, &snapshot);

    assert_eq!(裁决, 后端强种子裁决::Ready);
}

#[test]
fn webtorrent能力不得裁决为backend强种子ready() {
    let expected = "0123456789abcdef0123456789abcdef01234567";
    let snapshot = 测试快照(expected, "webtorrent", true, 1.0, true);

    let 裁决 = 裁决后端强种子快照(expected, &snapshot);

    assert_eq!(裁决, 后端强种子裁决::Degraded);
}

#[test]
fn mock能力不得裁决为backend强种子ready() {
    let expected = "0123456789abcdef0123456789abcdef01234567";
    let snapshot = 测试快照(expected, "mock", true, 1.0, true);

    let 裁决 = 裁决后端强种子快照(expected, &snapshot);

    assert_eq!(裁决, 后端强种子裁决::Degraded);
}

#[test]
fn progress未完成不得裁决为backend强种子ready() {
    let expected = "0123456789abcdef0123456789abcdef01234567";
    let snapshot = 测试快照(expected, "hybrid", true, 0.999, true);

    let 裁决 = 裁决后端强种子快照(expected, &snapshot);

    assert_eq!(裁决, 后端强种子裁决::Degraded);
}

#[test]
fn 缺少join_ticket不得裁决为backend强种子ready() {
    let expected = "0123456789abcdef0123456789abcdef01234567";
    let snapshot = 测试快照(expected, "hybrid", true, 1.0, false);

    let 裁决 = 裁决后端强种子快照(expected, &snapshot);

    assert_eq!(裁决, 后端强种子裁决::Degraded);
}

#[test]
fn infohash不匹配不得裁决为backend强种子ready() {
    let expected = "0123456789abcdef0123456789abcdef01234567";
    let snapshot = 测试快照(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "hybrid",
        true,
        1.0,
        true,
    );

    let 裁决 = 裁决后端强种子快照(expected, &snapshot);

    assert_eq!(裁决, 后端强种子裁决::Degraded);
}
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
cargo test --test 集成测试 只有hybrid完整持票同infohash快照才裁决为ready -- --nocapture
```

Expected: compile fail mentioning missing `后端强种子会话快照`, `后端强种子裁决`, or `裁决后端强种子快照`.

- [ ] **Step 3: Add minimal shell-private model and pure decision**

在 `后端强种子系统会话标识` 下面增加：

```rust
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct 后端强种子会话快照 {
    #[serde(rename = "infoHash")]
    pub info_hash: String,
    pub capability: String,
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub progress: f64,
    #[serde(rename = "hasJoinTicket", default)]
    pub has_join_ticket: bool,
    #[serde(rename = "numPeers", default)]
    pub num_peers: usize,
    #[serde(rename = "failureReason", default)]
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum 后端强种子裁决 {
    Ready,
    Degraded,
    Unavailable,
}

pub(crate) fn 裁决后端强种子快照(
    expected_info_hash: &str,
    snapshot: &后端强种子会话快照,
) -> 后端强种子裁决 {
    let expected = expected_info_hash.trim().to_ascii_lowercase();
    let actual = snapshot.info_hash.trim().to_ascii_lowercase();
    if actual.is_empty() || actual != expected {
        return 后端强种子裁决::Degraded;
    }
    if snapshot.capability.trim() != "hybrid" {
        return 后端强种子裁决::Degraded;
    }
    if !snapshot.ready || snapshot.progress < 1.0 || !snapshot.has_join_ticket {
        return 后端强种子裁决::Degraded;
    }
    后端强种子裁决::Ready
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
cargo test --test 集成测试 强种子 -- --nocapture
```

Expected: the new pure decision tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- src/外壳/协作分发做种.rs
git commit -m "test: 锁定后端强种子事实裁决"
```

---

## Task 2: Rust RED - fake seeder 返回 not-ready 时不得写 presence

**Files:**
- Modify: `tests/协作分发测试/可用性裁决.rs:14-108`
- Modify: `tests/协作分发测试/可用性裁决_做种对账.rs:1-358`

- [ ] **Step 1: Extend fake seeder test control surface**

把 `假Seeder控制面记录` 改成：

```rust
#[derive(Clone)]
enum 假SeederStart响应 {
    Ready,
    NotReady,
    Hang,
}

impl Default for 假SeederStart响应 {
    fn default() -> Self {
        Self::Ready
    }
}

#[derive(Default, Clone)]
struct 假Seeder控制面记录 {
    start_payloads: Vec<serde_json::Value>,
    reconcile_payloads: Vec<serde_json::Value>,
    start_response: 假SeederStart响应,
}
```

新增 helper：

```rust
async fn 启动假seeder控制面响应(
    start_response: 假SeederStart响应,
) -> (String, 假Seeder控制面记录句柄, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能绑定假的 seeder 控制面端口");
    let address = listener
        .local_addr()
        .expect("应能读取假的 seeder 控制面地址");
    let records: 假Seeder控制面记录句柄 = Arc::new(Mutex::new(假Seeder控制面记录 {
        start_response,
        ..Default::default()
    }));
    let app = Router::new()
        .route("/seed/start", post(记录假seeder_start请求))
        .route("/seed/reconcile", post(记录假seeder_reconcile请求))
        .with_state(records.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("假的 seeder 控制面应能启动");
    });
    等待假seeder控制面就绪(address).await;
    (format!("http://{address}"), records, server)
}

async fn 启动假seeder控制面() -> (String, 假Seeder控制面记录句柄, JoinHandle<()>) {
    启动假seeder控制面响应(假SeederStart响应::Ready).await
}
```

更新 `记录假seeder_start请求` 的响应分支：

```rust
let response_mode = {
    let mut guard = records.lock().expect("seeder 控制面记录锁不应中毒");
    guard.start_payloads.push(payload.clone());
    guard.start_response.clone()
};
match response_mode {
    假SeederStart响应::Ready => (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "created": true,
            "infoHash": payload["infoHash"].clone(),
            "capability": "hybrid",
            "ready": true,
            "progress": 1.0,
            "hasJoinTicket": true,
            "numPeers": 0
        })),
    ),
    假SeederStart响应::NotReady => (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "created": true,
            "infoHash": payload["infoHash"].clone(),
            "capability": "hybrid",
            "ready": false,
            "progress": 0.25,
            "hasJoinTicket": true,
            "numPeers": 0,
            "failureReason": "warming_up"
        })),
    ),
    假SeederStart响应::Hang => {
        sleep(Duration::from_secs(30)).await;
        (
            StatusCode::OK,
            AxumJson(serde_json::json!({
                "ok": true,
                "infoHash": payload["infoHash"].clone(),
                "capability": "hybrid",
                "ready": true,
                "progress": 1.0,
                "hasJoinTicket": true,
                "numPeers": 0
            })),
        )
    }
}
```

新增 presence 查询 helper：

```rust
async fn 读取backend强种子presence数量(pool: &PgPool, attachment_id: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT
         FROM swarm_peer_presence
         WHERE attachment_id = $1
           AND peer_kind = 'backend_strong_seed'",
    )
    .bind(attachment_id)
    .fetch_one(pool)
    .await
    .expect("应能查询 backend strong seed presence 数量")
}
```

- [ ] **Step 2: Add RED integration test for not-ready**

在 `tests/协作分发测试/可用性裁决_做种对账.rs` 增加：

```rust
#[tokio::test]
#[serial]
async fn 做种对账在sidecar未ready时不得写backend强种子presence() {
    let (fake_seeder_base_url, _seeder_records, fake_seeder_server) =
        启动假seeder控制面响应(假SeederStart响应::NotReady).await;
    let backup = 备份并清空环境变量(&[
        "APP_PORT",
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var("APP_PORT", "18080");
    env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", fake_seeder_base_url.as_str());
    env::set_var("SWARM_TRACKER_PUBLIC_URL", "wss://im.example.com/api/swarm/announce");
    env::set_var("SWARM_TICKET_SECRET", "seed-not-ready-ticket-secret");

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state = koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
        .await
        .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let (_, bootstrap) = send_json(
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("seed-not-ready-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-seed-not-ready-{uniq}");
    let (torrent_bytes, info_hash, piece_length) =
        构造有效测试torrent元信息(format!("seed-not-ready-{uniq}").as_str());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4,
             web_seed_until = NOW() + INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(&info_hash)
    .bind(&torrent_bytes)
    .bind(piece_length)
    .execute(&pool)
    .await
    .expect("应能补齐 torrent_info_hash");

    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    assert_eq!(读取backend强种子presence数量(&pool, &attachment_id).await, 0);

    sqlx::query("DELETE FROM attachment_distribution_metadata WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理附件记录");
    pool.close().await;
    fake_seeder_server.abort();
    恢复环境变量(backup);
}
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
cargo test --test 集成测试 做种对账在sidecar未ready时不得写backend强种子presence -- --nocapture
```

Expected: FAIL because current Rust writes `backend_strong_seed` after any `/seed/start` HTTP 200.

- [ ] **Step 4: Commit RED test**

```powershell
git add -- tests/协作分发测试/可用性裁决.rs tests/协作分发测试/可用性裁决_做种对账.rs
git commit -m "test: 复现sidecar未ready却写强种子的错误"
```

---

## Task 3: Rust GREEN - `/seed/start` 返回事实，reconcile 只按 Ready 写 presence

**Files:**
- Modify: `src/外壳/协作分发做种.rs:98-263`
- Review: `src/媒体/上传/外壳/完成上传.rs:620-645`
- Review: `src/媒体/上传/外壳/附件响应.rs:48-64`
- Review: `src/实时/外壳.rs:987-1006`

- [ ] **Step 1: Change start return type and parse snapshot**

把 `尝试启动协作分发做种` 改为：

```rust
pub(crate) async fn 尝试启动协作分发做种(
    state: &应用状态,
    命令: &协作分发做种启动命令,
) -> io::Result<后端强种子会话快照> {
    let url = format!("{}/seed/start", state.swarm_seeder_control_base_url);
    let payload = serde_json::json!({
        "infoHash": 命令.info_hash,
        "announceUrls": 命令.announce_urls,
        "webSeedUrl": 命令.web_seed_url,
        "torrentUrl": 命令.torrent_url,
        "joinTicket": 命令.join_ticket,
    });
    let response = reqwest::Client::new()
        .post(url.as_str())
        .json(&payload)
        .send()
        .await
        .map_err(|err| io::Error::other(format!("调用 seeder start 失败: {err}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .text()
            .await
            .unwrap_or_else(|_| String::from("<empty>"));
        return Err(io::Error::other(format!(
            "调用 seeder start 返回非成功状态: status={status}, detail={detail}"
        )));
    }
    response
        .json::<后端强种子会话快照>()
        .await
        .map_err(|err| io::Error::other(format!("解析 seeder start 快照失败: {err}")))
}
```

- [ ] **Step 2: Gate presence write by pure decision**

在 `执行一次协作分发做种对账` 中替换 start + presence 写入段：

```rust
let start_snapshot = match 尝试启动协作分发做种(&state, &启动命令).await {
    Ok(snapshot) => snapshot,
    Err(err) => {
        tracing::warn!(
            application = "协作分发做种对账",
            adapter = "shell",
            outcome = "failed",
            attachment_id = 待做种.附件标识.as_str(),
            info_hash = 启动命令.info_hash.as_str(),
            error = %err,
            "周期做种 start 失败，等待下一轮重试"
        );
        continue;
    }
};
let seed_decision = 裁决后端强种子快照(启动命令.info_hash.as_str(), &start_snapshot);
if seed_decision != 后端强种子裁决::Ready {
    tracing::warn!(
        application = "协作分发做种对账",
        adapter = "shell",
        outcome = "degraded",
        attachment_id = 待做种.附件标识.as_str(),
        info_hash = 启动命令.info_hash.as_str(),
        sidecar_info_hash = start_snapshot.info_hash.as_str(),
        sidecar_capability = start_snapshot.capability.as_str(),
        sidecar_ready = start_snapshot.ready,
        sidecar_progress = start_snapshot.progress,
        sidecar_has_join_ticket = start_snapshot.has_join_ticket,
        sidecar_failure_reason = start_snapshot.failure_reason.as_deref().unwrap_or(""),
        "sidecar 尚未证明 backend strong seed 成立，本轮不写 presence"
    );
    continue;
}
```

在 Ready 分支后面紧接写入 `backend_strong_seed` presence：

```rust
let state_for_presence = state.clone();
let swarm_id = 待做种.swarm_id.clone();
let attachment_id = 待做种.附件标识.clone();
let upsert_presence = tokio::task::spawn_blocking(move || {
    let repo = 构建共享仓储(&state_for_presence);
    let mut media_repo = repo.媒体仓储();
    协作分发应用::写入协作分发swarm存活(
        &mut media_repo,
        &crate::media::模型::协作分发swarm存活写入请求 {
            swarm_id,
            附件标识: attachment_id,
            会话标识: 后端强种子系统会话标识.to_string(),
            存活类型: crate::media::模型::协作分发存活类型后端强种子.to_string(),
            最近peer存活时间戳秒: 当前时间戳秒,
        },
    )
    .map_err(|err| io::Error::other(format!("写入 backend strong seed 存活失败: {err:?}")))
})
.await;
match upsert_presence {
    Ok(Ok(())) => {}
    Ok(Err(err)) => tracing::warn!(
        application = "协作分发做种对账",
        adapter = "shell",
        outcome = "failed",
        attachment_id = 待做种.附件标识.as_str(),
        info_hash = 启动命令.info_hash.as_str(),
        error = %err,
        "sidecar ready 后写入 backend strong seed 存活失败，等待下一轮重试"
    ),
    Err(err) => tracing::warn!(
        application = "协作分发做种对账",
        adapter = "shell",
        outcome = "failed",
        attachment_id = 待做种.附件标识.as_str(),
        info_hash = 启动命令.info_hash.as_str(),
        error = %err,
        "写入 backend strong seed 存活任务失败，等待下一轮重试"
    ),
}
```

- [ ] **Step 3: Confirm callers remain single-owner and need no code edit**

下面三个调用点当前都是 `if let Err(err) = 尝试启动协作分发做种(&state, &启动命令).await` 同类形态；`io::Result<()>` 改成 `io::Result<后端强种子会话快照>` 后仍能编译并继续只处理错误：

- `src/媒体/上传/外壳/完成上传.rs:633-645`
- `src/媒体/上传/外壳/附件响应.rs:52-64`
- `src/实时/外壳.rs:993-1006`

不要在这三个文件新增 Ready 判断或 presence 写入。它们只负责触发同一个 sidecar start owner；Ready 落库仍只在 `src/外壳/协作分发做种.rs::执行一次协作分发做种对账` 内发生。

- [ ] **Step 4: Verify GREEN for RED test**

Run:

```powershell
cargo test --test 集成测试 做种对账在sidecar未ready时不得写backend强种子presence -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Verify existing seeding reconciliation tests**

Run:

```powershell
cargo test --test 集成测试 做种对账 -- --nocapture
```

Expected: existing dirty torrent skip tests and start/reconcile payload tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/外壳/协作分发做种.rs src/媒体/上传/外壳/完成上传.rs src/媒体/上传/外壳/附件响应.rs src/实时/外壳.rs
git commit -m "fix: 强种子presence只信sidecar runtime事实"
```

---

## Task 4: Rust GREEN - Ready 时写 presence，旧 ack 不再误写

**Files:**
- Modify: `tests/协作分发测试/可用性裁决_做种对账.rs`

- [ ] **Step 1: Add Ready positive integration test**

新增测试：

```rust
#[tokio::test]
#[serial]
async fn 做种对账在sidecar_ready时写backend强种子presence() {
    let (fake_seeder_base_url, _seeder_records, fake_seeder_server) =
        启动假seeder控制面响应(假SeederStart响应::Ready).await;
    let backup = 备份并清空环境变量(&[
        "APP_PORT",
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var("APP_PORT", "18080");
    env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", fake_seeder_base_url.as_str());
    env::set_var("SWARM_TRACKER_PUBLIC_URL", "wss://im.example.com/api/swarm/announce");
    env::set_var("SWARM_TICKET_SECRET", "seed-ready-ticket-secret");

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state = koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
        .await
        .expect("应能构建共享应用状态");
    let app = koko::shell::构建路由(state.clone());
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let (_, bootstrap) = send_json(
        app,
        Method::POST,
        "/api/session/bootstrap",
        Some(serde_json::json!({
            "device_anonymous_token": format!("seed-ready-{uniq}")
        })),
        &[],
    )
    .await;
    let session_id = bootstrap["session_id"].as_str().expect("session_id");
    let attachment_id = format!("att-seed-ready-{uniq}");
    let (torrent_bytes, info_hash, piece_length) =
        构造有效测试torrent元信息(format!("seed-ready-{uniq}").as_str());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&cfg.database_url)
        .await
        .expect("应能直连数据库插入附件");
    插入ready视频附件记录(&pool, session_id, &attachment_id).await;
    插入附件协作分发元数据记录(&pool, &attachment_id).await;
    sqlx::query(
        "UPDATE attachment_distribution_metadata
         SET torrent_info_hash = $2,
             torrent_bytes = $3,
             piece_length_bytes = $4,
             web_seed_until = NOW() + INTERVAL '5 minutes'
         WHERE attachment_id = $1",
    )
    .bind(&attachment_id)
    .bind(&info_hash)
    .bind(&torrent_bytes)
    .bind(piece_length)
    .execute(&pool)
    .await
    .expect("应能补齐 torrent_info_hash");

    koko::shell::协作分发做种::执行一次协作分发做种对账(state)
        .await
        .expect("做种对账应执行成功");

    assert_eq!(读取backend强种子presence数量(&pool, &attachment_id).await, 1);

    sqlx::query("DELETE FROM attachment_distribution_metadata WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理协作分发元数据");
    sqlx::query("DELETE FROM attachments WHERE attachment_id = $1")
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .expect("应能清理附件记录");
    pool.close().await;
    fake_seeder_server.abort();
    恢复环境变量(backup);
}
```

- [ ] **Step 2: Verify positive path**

Run:

```powershell
cargo test --test 集成测试 做种对账在sidecar_ready时写backend强种子presence -- --nocapture
```

Expected: PASS.

- [ ] **Step 3: Commit**

```powershell
git add -- tests/协作分发测试/可用性裁决_做种对账.rs
git commit -m "test: 覆盖sidecar ready才写强种子presence"
```

---

## Task 5: Rust performance - client 复用、timeout、ICE 复用、有限并发

**Files:**
- Modify: `src/外壳/mod.rs:89-130, 198-285`
- Modify: `src/外壳/协作分发做种.rs:1-263`
- Modify: `tests/协作分发测试/可用性裁决_做种对账.rs`

- [ ] **Step 1: RED - hang sidecar must not hang reconcile forever**

新增测试：

```rust
#[tokio::test]
#[serial]
async fn 做种对账遇到sidecar_hang时必须按控制面超时退出() {
    let (fake_seeder_base_url, _seeder_records, fake_seeder_server) =
        启动假seeder控制面响应(假SeederStart响应::Hang).await;
    let backup = 备份并清空环境变量(&[
        "APP_PORT",
        "SWARM_SEEDER_CONTROL_BASE_URL",
        "SWARM_TRACKER_PUBLIC_URL",
        "SWARM_TICKET_SECRET",
    ]);
    env::set_var("APP_PORT", "18080");
    env::set_var("SWARM_SEEDER_CONTROL_BASE_URL", fake_seeder_base_url.as_str());
    env::set_var("SWARM_TRACKER_PUBLIC_URL", "wss://im.example.com/api/swarm/announce");
    env::set_var("SWARM_TICKET_SECRET", "seed-hang-ticket-secret");

    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    koko::assembly::自动追平迁移(&cfg.database_url)
        .await
        .expect("应先追平附件迁移");
    let state = koko::shell::构建应用状态(cfg.database_url.clone(), cfg.admin_password.clone())
        .await
        .expect("应能构建共享应用状态");

    let result = tokio::time::timeout(
        Duration::from_secs(5),
        koko::shell::协作分发做种::执行一次协作分发做种对账(state),
    )
    .await;

    assert!(result.is_ok(), "sidecar hang 不得让一轮 reconcile 永久卡住");

    fake_seeder_server.abort();
    恢复环境变量(backup);
}
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
cargo test --test 集成测试 做种对账遇到sidecar_hang时必须按控制面超时退出 -- --nocapture
```

Expected: FAIL by timeout because current `reqwest::Client::new().send()` has no hard timeout.

- [ ] **Step 3: Add reusable sidecar HTTP client to `应用状态`**

在 `应用状态` 增加字段：

```rust
pub swarm_seeder_http_client: reqwest::Client,
```

在 `构建应用状态` 内构造：

```rust
let swarm_seeder_http_client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(3))
    .pool_idle_timeout(std::time::Duration::from_secs(30))
    .build()
    .map_err(|err| std::io::Error::other(format!("初始化 seeder 控制面 HTTP client 失败: {err}")))?;
```

在 `Ok(应用状态 {` 初始化字段列表内填入：

```rust
swarm_seeder_http_client,
```

- [ ] **Step 4: Use shared client for start and reconcile**

把 `reqwest::Client::new()` 替换为：

```rust
state.swarm_seeder_http_client
    .post(url.as_str())
```

以及：

```rust
state.swarm_seeder_http_client
    .post(reconcile_url.as_str())
```

- [ ] **Step 5: Reuse ICE once per reconcile round**

在循环前增加：

```rust
let ice_servers = state.get_turn_ice_servers().await;
```

循环内上下文使用：

```rust
ice_servers: ice_servers.clone(),
```

- [ ] **Step 6: Keep finite concurrency scoped to sidecar start**

在文件顶部 imports 增加：

```rust
use futures_util::stream::{self, StreamExt};
```

同时把原来的：

```rust
use std::{
    collections::HashSet,
    io,
    time::{SystemTime, UNIX_EPOCH},
};
```

改成：

```rust
use std::{
    io,
    time::{SystemTime, UNIX_EPOCH},
};
```

在 `后端强种子系统会话标识` 下方保留并发上限：

```rust
const 做种对账并发上限: usize = 16;
```

在 `执行一次协作分发做种对账` 里，用下面代码替换从 `let mut active_info_hashes = HashSet::new();` 到原待做种循环结束的整段循环：

```rust
let ice_servers = state.get_turn_ice_servers().await;
let outcomes = stream::iter(待做种项.into_iter().map(|待做种| {
    let state = state.clone();
    let ice_servers = ice_servers.clone();
    async move {
        let distribution_snapshot = crate::media::模型::协作分发元数据快照 {
            附件标识: 待做种.附件标识.clone(),
            content_id: 待做种.content_id.clone(),
            content_hash: 待做种.content_hash.clone(),
            swarm_id: 待做种.swarm_id.clone(),
            web_seed_until秒: 待做种.web_seed_until秒,
            最近片段peer存活时间戳秒: None,
            最近完整peer存活时间戳秒: None,
            最近后端强种子存活时间戳秒: None,
            torrent_info_hash: Some(待做种.torrent_info_hash.clone()),
        };
        let runtime_distribution = media_distribution::协作分发快照转响应值(
            &distribution_snapshot,
            media_distribution::协作分发响应上下文 {
                attachment_id: 待做种.附件标识.as_str(),
                session_id: 待做种.会话标识.as_str(),
                tracker_public_url: state.swarm_tracker_public_url.as_str(),
                web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
                ticket_secret: state.swarm_ticket_secret.as_deref(),
                ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
                冷源仍可用: 当前时间戳秒 <= 待做种.web_seed_until秒,
                附件已删除: false,
                now_epoch秒: 当前时间戳秒,
                stale_seconds: state.swarm_peer_presence_stale_seconds,
                ice_servers,
            },
        );
        let Some(启动命令) = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            state.swarm_seeder_tracker_url.as_str(),
        ) else {
            return None;
        };
        let active_info_hash = 启动命令.info_hash.clone();
        let start_snapshot = match 尝试启动协作分发做种(&state, &启动命令).await {
            Ok(snapshot) => snapshot,
            Err(err) => {
                tracing::warn!(
                    application = "协作分发做种对账",
                    adapter = "shell",
                    outcome = "failed",
                    attachment_id = 待做种.附件标识.as_str(),
                    info_hash = 启动命令.info_hash.as_str(),
                    error = %err,
                    "周期做种 start 失败，等待下一轮重试"
                );
                return Some(active_info_hash);
            }
        };
        let seed_decision = 裁决后端强种子快照(启动命令.info_hash.as_str(), &start_snapshot);
        if seed_decision != 后端强种子裁决::Ready {
            tracing::warn!(
                application = "协作分发做种对账",
                adapter = "shell",
                outcome = "degraded",
                attachment_id = 待做种.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                sidecar_info_hash = start_snapshot.info_hash.as_str(),
                sidecar_capability = start_snapshot.capability.as_str(),
                sidecar_ready = start_snapshot.ready,
                sidecar_progress = start_snapshot.progress,
                sidecar_has_join_ticket = start_snapshot.has_join_ticket,
                sidecar_failure_reason = start_snapshot.failure_reason.as_deref().unwrap_or(""),
                "sidecar 尚未证明 backend strong seed 成立，本轮不写 presence"
            );
            return Some(active_info_hash);
        }
        let state_for_presence = state.clone();
        let swarm_id = 待做种.swarm_id.clone();
        let attachment_id = 待做种.附件标识.clone();
        let upsert_presence = tokio::task::spawn_blocking(move || {
            let repo = 构建共享仓储(&state_for_presence);
            let mut media_repo = repo.媒体仓储();
            协作分发应用::写入协作分发swarm存活(
                &mut media_repo,
                &crate::media::模型::协作分发swarm存活写入请求 {
                    swarm_id,
                    附件标识: attachment_id,
                    会话标识: 后端强种子系统会话标识.to_string(),
                    存活类型: crate::media::模型::协作分发存活类型后端强种子.to_string(),
                    最近peer存活时间戳秒: 当前时间戳秒,
                },
            )
            .map_err(|err| io::Error::other(format!("写入 backend strong seed 存活失败: {err:?}")))
        })
        .await;
        match upsert_presence {
            Ok(Ok(())) => {}
            Ok(Err(err)) => tracing::warn!(
                application = "协作分发做种对账",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 待做种.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "sidecar ready 后写入 backend strong seed 存活失败，等待下一轮重试"
            ),
            Err(err) => tracing::warn!(
                application = "协作分发做种对账",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 待做种.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "写入 backend strong seed 存活任务失败，等待下一轮重试"
            ),
        }
        Some(active_info_hash)
    }
}))
.buffer_unordered(做种对账并发上限)
.collect::<Vec<Option<String>>>()
.await;

let mut active_info_hashes = outcomes.into_iter().flatten().collect::<Vec<_>>();
active_info_hashes.sort();
active_info_hashes.dedup();
```

约束：不要把数据库查询和权威集合读取并发化；只并发 sidecar start + Ready presence 写入。

- [ ] **Step 7: Verify timeout GREEN and existing tests**

Run:

```powershell
cargo test --test 集成测试 做种对账遇到sidecar_hang时必须按控制面超时退出 -- --nocapture
cargo test --test 集成测试 做种对账 -- --nocapture
```

Expected: both pass.

- [ ] **Step 8: Commit**

```powershell
git add -- src/外壳/mod.rs src/外壳/协作分发做种.rs tests/协作分发测试/可用性裁决_做种对账.rs
git commit -m "perf: 收口做种控制面超时与对账并发"
```

---

## Task 6: Node sidecar RED/GREEN - snapshot、status、hybrid enforcement

**Files:**
- Modify: `frontend/dev-seeder.mjs`
- Modify: `frontend/dev-seeder.d.mts`
- Modify: `frontend/tests/dev-seeder做种续租测试.spec.ts`

- [ ] **Step 1: RED - add snapshot tests**

在 `frontend/tests/dev-seeder做种续租测试.spec.ts` 追加：

```ts
it("SeedSessionSnapshot 只有 hybrid 完整持票会话才 ready", async () => {
  const module = (await import("../dev-seeder.mjs")) as unknown as {
    构造做种会话快照: (session: unknown, capability: string) => unknown;
  };

  const snapshot = module.构造做种会话快照(
    {
      infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "http://127.0.0.1:8080/api/media/att/torrent?session_id=s-1",
      joinTicket: "ticket-valid",
      torrent: {
        progress: 1,
        numPeers: 2,
        downloaded: 1024,
        uploaded: 2048,
      },
      addedAt: "2026-05-12T00:00:00.000Z",
    },
    "hybrid"
  );

  expect(snapshot).toMatchObject({
    infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    capability: "hybrid",
    ready: true,
    progress: 1,
    hasJoinTicket: true,
    numPeers: 2,
    downloaded: 1024,
    uploaded: 2048,
  });
});

it("SeedSessionSnapshot 在 mock 或未完成时不得 ready", async () => {
  const module = (await import("../dev-seeder.mjs")) as unknown as {
    构造做种会话快照: (session: unknown, capability: string) => Record<string, unknown>;
  };

  const snapshot = module.构造做种会话快照(
    {
      infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      joinTicket: "ticket-valid",
      torrent: { progress: 0.5, numPeers: 0, downloaded: 512, uploaded: 0 },
      addedAt: "2026-05-12T00:00:00.000Z",
    },
    "mock"
  );

  expect(snapshot.ready).toBe(false);
  expect(snapshot.capability).toBe("mock");
  expect(snapshot.progress).toBe(0.5);
});

it("生产默认不允许 webtorrent 或 mock 静默冒充 hybrid", async () => {
  const module = (await import("../dev-seeder.mjs")) as unknown as {
    确认做种运行时能力: (capability: string, forcedMock: boolean) => void;
  };

  expect(() => module.确认做种运行时能力("hybrid", false)).not.toThrow();
  expect(() => module.确认做种运行时能力("mock", true)).not.toThrow();
  expect(() => module.确认做种运行时能力("webtorrent", false)).toThrow("webtorrent-hybrid");
  expect(() => module.确认做种运行时能力("mock", false)).toThrow("webtorrent-hybrid");
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts
```

Expected: FAIL because `构造做种会话快照` and `确认做种运行时能力` do not exist.

- [ ] **Step 3: Implement snapshot and capability gate**

在 `frontend/dev-seeder.mjs` 中新增导出：

```js
export const 构造做种会话快照 = (session, currentCapability = capability) => {
  const progress = Number.isFinite(session?.torrent?.progress) ? session.torrent.progress : 0;
  const hasJoinTicket = typeof session?.joinTicket === "string" && session.joinTicket.trim().length > 0;
  const normalizedInfoHash = 归一化InfoHash(session?.infoHash) ?? "";
  const snapshot = {
    infoHash: normalizedInfoHash,
    capability: currentCapability,
    ready: currentCapability === "hybrid" && progress >= 1 && hasJoinTicket,
    progress,
    hasJoinTicket,
    numPeers: Number.isFinite(session?.torrent?.numPeers) ? session.torrent.numPeers : 0,
    downloaded: Number.isFinite(session?.torrent?.downloaded) ? session.torrent.downloaded : 0,
    uploaded: Number.isFinite(session?.torrent?.uploaded) ? session.torrent.uploaded : 0,
    source: typeof session?.source === "string" ? session.source : null,
    addedAt: typeof session?.addedAt === "string" ? session.addedAt : null,
    failureReason: null,
  };
  if (!snapshot.ready) {
    snapshot.failureReason =
      currentCapability !== "hybrid"
        ? "capability_not_hybrid"
        : !hasJoinTicket
          ? "missing_join_ticket"
          : progress < 1
            ? "torrent_not_complete"
            : "not_ready";
  }
  return snapshot;
};

export const 确认做种运行时能力 = (detectedCapability, forcedMock) => {
  if (detectedCapability === "hybrid") {
    return;
  }
  if (forcedMock && detectedCapability === "mock") {
    return;
  }
  throw new Error("生产做种 sidecar 必须加载 webtorrent-hybrid；禁止 webtorrent/mock 静默冒充强种子");
};
```

- [ ] **Step 4: Return snapshot from `/seed/start` and `/seed/status`**

把 `/seed/start` 响应改为包含 snapshot 字段和顶层兼容字段：

```js
const snapshot = 构造做种会话快照(session, capability);
发送JSON响应(response, 200, {
  ok: true,
  created,
  refreshedTicket,
  restarted,
  sourceChanged,
  activeCount: activeSessions.size,
  infoHash: snapshot.infoHash,
  capability: snapshot.capability,
  ready: snapshot.ready,
  progress: snapshot.progress,
  hasJoinTicket: snapshot.hasJoinTicket,
  numPeers: snapshot.numPeers,
  downloaded: snapshot.downloaded,
  uploaded: snapshot.uploaded,
  source: snapshot.source,
  addedAt: snapshot.addedAt,
  failureReason: snapshot.failureReason,
});
```

新增 status route：

```js
if (method === "GET" && url.pathname === "/seed/status") {
  const infoHash = 归一化InfoHash(url.searchParams.get("infoHash"));
  const session = infoHash ? activeSessions.get(infoHash) : null;
  if (!session) {
    发送JSON响应(response, 200, {
      ok: true,
      exists: false,
      infoHash: infoHash ?? null,
      capability,
      ready: false,
      progress: 0,
      hasJoinTicket: false,
      numPeers: 0,
      downloaded: 0,
      uploaded: 0,
      failureReason: "session_not_found",
    });
    return;
  }
  const snapshot = 构造做种会话快照(session, capability);
  发送JSON响应(response, 200, {
    ok: true,
    exists: true,
    infoHash: snapshot.infoHash,
    capability: snapshot.capability,
    ready: snapshot.ready,
    progress: snapshot.progress,
    hasJoinTicket: snapshot.hasJoinTicket,
    numPeers: snapshot.numPeers,
    downloaded: snapshot.downloaded,
    uploaded: snapshot.uploaded,
    source: snapshot.source,
    addedAt: snapshot.addedAt,
    failureReason: snapshot.failureReason,
  });
  return;
}
```

- [ ] **Step 5: Enforce hybrid in `main`**

在 `main` 读取构造器后增加：

```js
const forcedMock = process.env.SWARM_SEEDER_FORCE_MOCK?.trim() === "1";
try {
  确认做种运行时能力(capability, forcedMock);
} catch (error) {
  console.error("[dev-seeder]", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

删除或改写原本对 `mock` / `webtorrent` 的 warning 分支，避免静默启动。

- [ ] **Step 6: Update declaration file**

在 `frontend/dev-seeder.d.mts` 增加：

```ts
export interface DevSeeder做种会话快照 {
  infoHash: string;
  capability: string;
  ready: boolean;
  progress: number;
  hasJoinTicket: boolean;
  numPeers: number;
  downloaded: number;
  uploaded: number;
  source: string | null;
  addedAt: string | null;
  failureReason: string | null;
}

export declare const 构造做种会话快照: (
  session: unknown,
  capability: string
) => DevSeeder做种会话快照;

export declare const 确认做种运行时能力: (
  capability: string,
  forcedMock: boolean
) => void;
```

- [ ] **Step 7: Verify GREEN**

Run:

```powershell
pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- frontend/dev-seeder.mjs frontend/dev-seeder.d.mts frontend/tests/dev-seeder做种续租测试.spec.ts
git commit -m "fix: 让sidecar返回WebTorrent会话事实快照"
```

---

## Task 7: Dependency and launcher checks - 固化 `webtorrent-hybrid`

**Files:**
- Modify: `tests/启动器脚本检查.ps1`
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`

- [ ] **Step 1: RED - script checks dependency and status route**

在 `tests/启动器脚本检查.ps1` 读取 `$seederScript` 后增加：

```powershell
$frontendPackagePath = Join-Path $repoRoot "frontend\package.json"
Assert-True (Test-Path -LiteralPath $frontendPackagePath) "缺少 frontend/package.json。"
$frontendPackage = Get-Content -LiteralPath $frontendPackagePath -Raw | ConvertFrom-Json
Assert-True ($null -ne $frontendPackage.dependencies."webtorrent-hybrid") "frontend/package.json 必须显式声明 webtorrent-hybrid；生产强种子不能依赖 node_modules 偶然存在。"
```

在 sidecar 断言段追加：

```powershell
Assert-True ($seederScript -match '/seed/status') "frontend/dev-seeder.mjs 应该暴露 /seed/status，让 Rust 读取同一 SeedSessionSnapshot。"
Assert-True ($seederScript -match '确认做种运行时能力') "frontend/dev-seeder.mjs 应该显式阻止 webtorrent/mock 静默冒充生产强种子。"
Assert-True ($seederScript -match '构造做种会话快照') "frontend/dev-seeder.mjs 应该把 WebTorrent runtime 状态收口成稳定 SeedSessionSnapshot。"
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
pwsh -NoProfile -File tests/启动器脚本检查.ps1
```

Expected: FAIL because `frontend/package.json` does not declare `webtorrent-hybrid` yet.

- [ ] **Step 3: Add dependency through pnpm**

Run:

```powershell
pnpm --dir frontend add webtorrent-hybrid
```

Expected: `frontend/package.json` and `frontend/pnpm-lock.yaml` update together.

- [ ] **Step 4: Verify script GREEN**

Run:

```powershell
pwsh -NoProfile -File tests/启动器脚本检查.ps1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- tests/启动器脚本检查.ps1 frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: 固化webtorrent-hybrid强种子依赖"
```

---

## Task 8: Complete path - not-ready 不影响 attachment ready，也不写假 presence

**Files:**
- Modify: `tests/媒体上传测试/单文件主链.rs`
- Review: `src/媒体/上传/外壳/完成上传.rs`

- [ ] **Step 1: Update fake complete seeder response shape**

把 `记录假seeder_start请求` 响应改为：

```rust
(
    StatusCode::OK,
    AxumJson(serde_json::json!({
        "ok": true,
        "created": true,
        "infoHash": payload["infoHash"].clone(),
        "capability": "hybrid",
        "ready": false,
        "progress": 0.5,
        "hasJoinTicket": true,
        "numPeers": 0,
        "failureReason": "complete_fire_and_forget_warming_up"
    })),
)
```

- [ ] **Step 2: Add assertion to existing complete test**

在 `视频complete会触发seeder_start命令` 末尾读取 presence：

```rust
let pool = PgPoolOptions::new()
    .max_connections(1)
    .connect(&env.database_url)
    .await
    .expect("应能连接数据库读取 strong seed presence");
let strong_seed_count: i64 = sqlx::query_scalar(
    "SELECT COUNT(*)::BIGINT
     FROM swarm_peer_presence
     WHERE attachment_id = $1
       AND peer_kind = 'backend_strong_seed'",
)
.bind(&attachment_id)
.fetch_one(&pool)
.await
.expect("应能查询 backend strong seed presence");
pool.close().await;
assert_eq!(
    strong_seed_count, 0,
    "complete 的 sidecar not-ready 不能被写成 backend_strong_seed presence"
);
```

- [ ] **Step 3: Verify behavior**

Run:

```powershell
cargo test --test 集成测试 视频complete会触发seeder_start命令 -- --nocapture
```

Expected: PASS. A failure here means complete path has gained a second presence writer; stop and remove that writer so `backend_strong_seed` remains owned by reconcile Ready.

- [ ] **Step 4: Commit**

```powershell
git add -- tests/媒体上传测试/单文件主链.rs src/媒体/上传/外壳/完成上传.rs
git commit -m "test: complete不把sidecar未ready写成强种子"
```

---

## Task 9: Full verification and same-slice cleanup

**Files:**
- Review only unless failures require fixes:
  - `src/外壳/协作分发做种.rs`
  - `src/外壳/mod.rs`
  - `src/媒体/上传/外壳/完成上传.rs`
  - `src/媒体/上传/外壳/附件响应.rs`
  - `src/实时/外壳.rs`
  - `frontend/dev-seeder.mjs`
  - `frontend/dev-seeder.d.mts`
  - `tests/协作分发测试/可用性裁决.rs`
  - `tests/协作分发测试/可用性裁决_做种对账.rs`
  - `tests/媒体上传测试/单文件主链.rs`
  - `tests/启动器脚本检查.ps1`

- [ ] **Step 1: Run Rust targeted tests**

```powershell
cargo test --test 集成测试 强种子 -- --nocapture
cargo test --test 集成测试 做种对账 -- --nocapture
cargo test --test 集成测试 视频complete会触发seeder_start命令 -- --nocapture
```

Expected: all PASS.

- [ ] **Step 2: Run frontend sidecar tests**

```powershell
pnpm --dir frontend test tests/dev-seeder做种续租测试.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run script checks**

```powershell
pwsh -NoProfile -File tests/启动器脚本检查.ps1
```

Expected: prints `启动器脚本检查通过。`

- [ ] **Step 4: Run compile/type gates**

```powershell
cargo check
pnpm --dir frontend typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Same-slice redundancy sweep**

Check all of these before claiming done:

```powershell
git grep -n "reqwest::Client::new()" -- src/外壳/协作分发做种.rs src/外壳/mod.rs
git grep -n "backend_strong_seed" -- src tests
git grep -n "SWARM_SEEDER_FORCE_MOCK" -- frontend/dev-seeder.mjs tests/启动器脚本检查.ps1
git grep -n "/seed/status" -- frontend/dev-seeder.mjs tests/启动器脚本检查.ps1
```

Expected:

- `src/外壳/协作分发做种.rs` no longer creates a new reqwest client per sidecar call.
- Only reconcile Ready path writes `backend_strong_seed` presence.
- mock mode is explicit and test-only.
- `/seed/status` exists in sidecar and script check.

- [ ] **Step 6: GitNexus changed-flow check**

Run GitNexus detect changes:

```text
gitnexus_detect_changes(scope="all", repo="koko")
```

Expected: changed symbols match the planned Rust shell, sidecar, tests, and script surfaces. Any extra domain/application/contract change must be reverted unless separately justified.

- [ ] **Step 7: Commit final verification state**

```powershell
git add -- src/外壳/协作分发做种.rs src/外壳/mod.rs src/媒体/上传/外壳/完成上传.rs src/媒体/上传/外壳/附件响应.rs src/实时/外壳.rs frontend/dev-seeder.mjs frontend/dev-seeder.d.mts tests/协作分发测试/可用性裁决.rs tests/协作分发测试/可用性裁决_做种对账.rs tests/媒体上传测试/单文件主链.rs tests/启动器脚本检查.ps1 frontend/package.json frontend/pnpm-lock.yaml
git commit -m "test: 验证后端WebTorrent强种子闭环"
```

---

## Task 10: Real smoke - 同链路体验闭环

**Files:**
- No source edits unless smoke exposes a root-cause bug.

- [ ] **Step 1: Start real dev stack**

```powershell
.\run.ps1
```

Expected:

- backend starts.
- tracker starts.
- `webtorrent-seeder` starts.
- seeder log includes `capability=hybrid`.

- [ ] **Step 2: Check sidecar health**

```powershell
Invoke-RestMethod http://127.0.0.1:7073/health | ConvertTo-Json -Depth 8
```

Expected:

```json
{
  "ok": true,
  "capability": "hybrid",
  "activeCount": 0
}
```

- [ ] **Step 3: Browser smoke with required CLI skills**

Use all three required browser skills for this project:

```text
playwright-cli: open two browser contexts, join same room, upload a small mp4, send media message.
chrome-devtools-cli: inspect console/network, confirm no sidecar/control errors and no direct HLS/DASH/CDN/range formal playback path.
browser-trace: capture page trace around receiver media startup and swarm entry.
```

Expected:

- Sender upload complete returns ready media asset with WebTorrent distribution hints.
- Sidecar `/seed/status?infoHash=<hash>` eventually returns `ready: true`, `capability: "hybrid"`, `progress: 1`, `hasJoinTicket: true`.
- Receiver joins WebTorrent swarm path and media starts without direct HTTP formal playback path.

- [ ] **Step 4: Verify database presence truth**

Use the current local `DATABASE_URL` and query:

```sql
SELECT attachment_id, peer_kind, session_id, last_seen_at
FROM swarm_peer_presence
WHERE peer_kind = 'backend_strong_seed'
ORDER BY last_seen_at DESC
LIMIT 10;
```

Expected:

- The uploaded media has one recent `backend_strong_seed` presence.
- `session_id` is `__backend_strong_seed__`.
- No presence exists for sidecar not-ready attempts.

- [ ] **Step 5: Final git status**

```powershell
git status --short
```

Expected: no uncommitted code/test changes except intentionally updated smoke artifacts outside git.

---

## Self-review 1: 需求意图

- **检查**: plan 是否从根因 owner 纠偏出发，而不是堆 timeout、retry、guard。
- **修正点**: 把 Rust pure decision 放到 Task 1，not-ready RED 放到 Task 2，性能优化推迟到 Task 5。
- **结论**: 通过。计划先证明 HTTP 200 不是 strong seed，再做性能收敛。

## Self-review 2: 架构边界

- **检查**: 是否把 sidecar runtime 字段泄漏到 domain/application/contract。
- **修正点**: 文件职责图明确 `SeedSessionSnapshot` 只存在 Rust shell 与 Node sidecar 控制面；room_event 和 shared contract 不改。
- **结论**: 通过。domain/application 仍只认识附件 ready、torrent_info_hash、presence 类型等稳定事实。

## Self-review 3: 执行路径与验证闭环

- **检查**: 每个风险是否有 RED/GREEN、命令和 expected output。
- **修正点**: 补齐 Rust unit、Rust integration、Node Vitest、PowerShell script、cargo check、frontend typecheck、真实双浏览器 smoke。
- **结论**: 通过。CRITICAL Rust 函数按小提交推进，不允许一次性大改。

---

## 100% confidence loop

### Round 1

问题：我对当前 plan 是否事实 100% 有信心？

回答：不是。风险是 `tracker announce 已至少进入可用状态` 在 WebTorrent API 中没有一个稳定、跨版本的单一同步布尔字段。

修复：plan 不让 Rust 自己猜 tracker 成功；第一阶段 Ready 需要 sidecar 输出 `ready=true`、`capability=hybrid`、`progress>=1`、`hasJoinTicket=true`、同 `infoHash`。本轮不把 tracker wire 观测作为 Rust contract 字段，避免用不稳定外部 API 伪造强种子事实。

### Round 2

问题：我对当前 plan 是否事实 100% 有信心？

回答：不是。风险是有限并发重构把 `activeInfoHashes` 构造和 presence 写入搅在一起，产生漏回收或重复写。

修复：Task 5 明确权威待强种集合仍是 reconcile input；并发只包 sidecar start + Ready presence 写入；每个任务返回 `Option<info_hash>`，最后统一排序下发 reconcile。

### Round 3

问题：我对当前 plan 是否事实 100% 有信心？

回答：不是。风险是 `webtorrent-hybrid` 依赖安装涉及 lockfile，手写 lock 容易破坏 pnpm 真实解析。

修复：Task 7 明确通过 `pnpm --dir frontend add webtorrent-hybrid` 更新 `package.json` 与 `pnpm-lock.yaml`，不手写 lockfile。

### Round 4

问题：我对当前 plan 是否事实 100% 有信心？

回答：现在有事实信心。计划把唯一根因切开：sidecar runtime 产生事实，Rust shell 只归纳并落库；所有入口和测试都围绕“未 Ready 不得写 Ready”闭环，没有新增第二媒体主链、第二强种子 owner 或 bypass object store 的本地文件真相。
