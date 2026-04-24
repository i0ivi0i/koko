# 媒体全局资产去重与转发复用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按项目现有 Rust/TypeScript 代码，把媒体物理资产去重从“单房间 source_hash 命中”纠正为“canonical 资产全局唯一、source_hash 受权限复用、转发分享复用可见源附件”的完整链路。

**Architecture:** `application/usecase` 继续拥有媒体身份、发送权限、附件 owner、删除语义和复用裁决；`adapter/sql` 只回答受授权查询和持久化；`shell/http` 只做请求解析、错误转码和响应组装；前端只表达上传/转发意图，不拥有媒体去重真相。全局物理资产只按 `content_hash` 收口，`source_hash` 不能变成全站存在性探针，转发不能要求客户端持有原文件。

**Tech Stack:** Rust 2024 + Axum + SQLx + PostgreSQL；TypeScript + Vitest；现有 `canonical_media_assets`、`attachment_canonical_asset_refs`、`attachment_source_hashes` 迁移；现有 WebTorrent 分发元数据链路。

---

## 0. 当前代码事实

**已经存在：**

- `migrations/0020_媒体source_hash精确去重资产索引.sql` 已建立 `canonical_media_assets`、`attachment_canonical_asset_refs`、`attachment_source_hashes`。
- `src/用例.rs` 已有 `复用source_hash媒体附件`，命中后会新建 ready 附件、绑定 canonical 资产、写入协作分发元数据和 torrent 元信息。
- `src/媒体附件适配.rs` 已有 `查询房间可复用source_hash媒体资产_异步`，但 SQL 从 `rooms/messages/message_attachment_refs` 出发并 `WHERE r.room_id = $1`，仍是旧的单房间命中模型。
- `src/媒体上传外壳.rs` 已有 `/api/media/{kind}/source-dedupe`，请求体包含 `session_id / room_id / source_hash / source_byte_size / source_file_name`。
- `frontend/契约.ts`、`frontend/传输.ts`、`frontend/媒体/适配/媒体HTTP接口.ts`、`frontend/媒体/媒体发布.ts` 已接入上传前 source_hash 计算和复用尝试。
- `tests/媒体上传测试/source_hash.rs` 已覆盖“同一房间复用”“未授权房间 miss”“已删除 canonical 不复活”。

**必须纠正：**

- 禁止继续把“目标房间”当成媒体资产身份边界。
- 禁止 `source_hash` 查询只在当前房间内找资产；同一匿名身份自己在房间 A 上传过的资产，应允许在房间 B 创建新附件引用。
- 禁止跨用户、跨不可见房间通过 `source_hash` 探测存在性；这种场景只能 miss，然后正常上传，上传完成后由 `content_hash` 在物理层全局收口。
- 禁止把转发/分享做成重新上传；转发必须以“源附件当前可见 + 目标房间可发送”为授权，直接复用 canonical 资产。

## 1. 目标边界

**权威真相 owner：**

- `src/用例.rs`：媒体复用、转发、发送权限、附件 owner、删除语义。
- `src/媒体附件适配.rs`：受授权 SQL 查询与媒体资产持久化。
- `src/媒体上传外壳.rs`：HTTP 请求解析和响应组装，不做业务判断。
- `frontend/契约.ts`：多壳共享请求/响应语义，不夹带 Web 页面流程。
- `frontend/媒体/媒体发布.ts`：只做上传体验编排，不决定能不能复用。

**三条复用链：**

1. 上传前：`source_hash + 当前身份/目标房间权限 -> 已授权 canonical 资产 -> 新附件引用`。
2. 转发分享：`可见 source_attachment_id -> canonical 资产 -> 目标房间新消息/新附件引用`。
3. 上传完成后：`content_hash -> canonical_media_assets 全局唯一 -> 同一 WebTorrent swarm/torrent`。

**禁止事项：**

- 禁止新增全局 `source_hash` 唯一约束。
- 禁止返回旧房间、旧消息、旧上传者。
- 禁止让 HTTP handler 或前端决定复用权限。
- 禁止创建第二套并行媒体资产表或第二套 torrent 生成路径。
- 禁止为转发新增“客户端持有原文件证明”。

## 2. 文件改动地图

**后端领域/用例：**

- Modify: `src/用例.rs`
  - 重命名并扩展 `查询房间可复用source_hash媒体资产` 端口。
  - 保留 `复用source_hash媒体附件` 作为上传前秒传用例，但查询范围改成“当前身份可复用资产”。
  - 新增 `转发媒体附件到房间` 用例，复用可见源附件的 canonical 资产并创建目标房间新消息。

**后端适配：**

- Modify: `src/适配.rs`
  - 更新 `Pg仓储` 对新端口的实现转发。
- Modify: `src/媒体附件适配.rs`
  - 替换旧单房间 SQL 查询。
  - 新增“查询可转发源附件资产”的 SQL 查询。
  - 禁止新增表；优先复用 `attachments`、`message_attachment_refs`、`messages`、`room_members`、`attachment_canonical_asset_refs`、`canonical_media_assets`、`attachment_source_hashes`。

**后端 HTTP 壳：**

- Modify: `src/媒体上传外壳.rs`
  - 保留 `/api/media/{kind}/source-dedupe`，语义改为“目标房间内创建新附件引用”。
  - 新增转发入口，建议 `POST /api/media/{kind}/forward`，只接收 `session_id / target_room_id / source_attachment_id / client_message_id / text?`。
- Modify: `src/外壳.rs`
  - 注册转发路由。

**前端契约与传输：**

- Modify: `frontend/契约.ts`
  - 修正文档注释：`room_id` 是目标房间发送裁决锚点，不是 source_hash 搜索范围。
  - 新增 `媒体附件转发请求 / 媒体附件转发结果`。
- Modify: `frontend/传输.ts`
  - 媒体传输端口新增 `forwardMediaAttachment`。
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
  - 新增转发 HTTP 方法。
- Modify: `frontend/聊天媒体编排.ts`
  - 只暴露窄端口转发方法，不把转发业务写进壳层。
- Modify only if needed: `frontend/媒体/媒体发布.ts`
  - 上传前 source_hash 请求体保留 target `room_id`，不做转发逻辑。

**测试：**

- Modify: `tests/媒体上传测试/source_hash.rs`
  - 增加同一身份跨房间 source_hash 复用红测。
  - 增加不同身份不可见房间 source_hash miss 但上传后 `content_hash` 全局收口红测。
  - 增加转发可见源附件到目标房间红测。
  - 增加不可见源附件禁止转发红测。
- Modify: `tests/媒体上传测试.rs`
  - 不新增测试入口，优先复用现有 `source_hash_tests` 模块。
- Modify: `tests/启动与迁移测试.rs`
  - 保持“不加全局 source_hash unique”的断言，并补充 canonical 资产全局唯一说明。
- Modify: `frontend/tests/传输测试.spec.ts`
  - 更新 source_hash 复用用例文案。
  - 增加转发传输用例。
- Modify: `frontend/tests/媒体发布测试.spec.ts`
  - 确认上传前 source_hash 命中仍跳过预处理/prepare/Uppy。
  - 确认未命中仍正常 prepare 上传。

## 3. Task 1: 后端红测 - 同一身份跨房间 source_hash 可复用

**Files:**

- Modify: `tests/媒体上传测试/source_hash.rs`

- [ ] **Step 1: 写失败测试**

先在 `tests/媒体上传测试/source_hash.rs` 增加只服务本文件的 helper，避免用“同一 device token 再 bootstrap”误导成同一发送会话：

```rust
async fn 既有会话进房(app: axum::Router, session_id: &str, room_code: String) -> String {
    let (join_status, join) = send_json(
        app,
        Method::POST,
        "/api/rooms/join-or-create",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_code": room_code,
        })),
        &[],
    )
    .await;
    assert_eq!(join_status, StatusCode::OK, "既有会话进房失败: {join:?}");
    join["room_id"].as_str().expect("room_id").to_string()
}
```

新增测试函数：

```rust
#[tokio::test]
#[serial]
async fn 同一身份跨房间同source_hash会复用全局canonical资产但创建目标房间新附件事实() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (session_id, room_a) =
        启动会话并进房(app.clone(), format!("source-cross-owner-{uniq}"), format!("XA{:010}", uniq % 10_000_000_000)).await;
    let room_b =
        既有会话进房(app.clone(), &session_id, format!("XB{:010}", uniq % 10_000_000_000)).await;

    let original_attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_id,
        SOURCE_HASH_一号,
        "same-source-cross-room.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_a,
        session_id.clone(),
        original_attachment_id.clone(),
        format!("source-cross-original-{uniq}"),
    )
    .await;

    let (reuse_status, reuse_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_id,
            "room_id": room_b,
            "source_hash": SOURCE_HASH_一号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "same-source-cross-room.webp"
        })),
        &[],
    )
    .await;

    assert_eq!(reuse_status, StatusCode::OK, "source-dedupe 响应: {reuse_body:?}");
    assert_eq!(reuse_body["status"].as_str(), Some("reused"));

    let reused_attachment_id = reuse_body["attachment"]["attachment_id"]
        .as_str()
        .expect("复用命中必须创建新附件")
        .to_string();
    assert_ne!(original_attachment_id, reused_attachment_id);

    let asset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT acar.content_hash)
           FROM attachment_canonical_asset_refs acar
          WHERE acar.attachment_id = ANY($1)",
    )
    .bind(vec![original_attachment_id, reused_attachment_id])
    .fetch_one(&pool)
    .await
    .expect("应能统计两个附件绑定的 canonical 资产");
    assert_eq!(asset_count, 1, "跨房间复用只能新增附件引用，不能新增物理资产");
    pool.close().await;
}
```

- [ ] **Step 2: 跑红测确认失败**

Run:

```powershell
cargo test 同一身份跨房间同source_hash会复用全局canonical资产但创建目标房间新附件事实 --test 媒体上传测试 -- --nocapture
```

Expected: FAIL，当前 SQL 限制 `WHERE r.room_id = $1`，房间 B 找不到房间 A 的 source_hash 资产。

- [ ] **Step 3: 暂不改实现，先提交红测**

```powershell
git add tests/媒体上传测试/source_hash.rs
git commit -m "测试：刻画同一身份跨房间媒体复用"
```

## 4. Task 2: 后端红测 - 不可见跨用户不能 source_hash 探测，但 content_hash 必须全局收口

**Files:**

- Modify: `tests/媒体上传测试/source_hash.rs`

- [ ] **Step 1: 写失败或 characterization 测试**

新增测试函数：

```rust
#[tokio::test]
#[serial]
async fn 不同身份不可见房间source_hash只能miss但相同canonical上传后只保留一份物理资产() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (session_a, room_a) =
        启动会话并进房(app.clone(), format!("source-hidden-a-{uniq}"), format!("HA{:010}", uniq % 10_000_000_000)).await;
    let (session_b, room_b) =
        启动会话并进房(app.clone(), format!("source-hidden-b-{uniq}"), format!("HB{:010}", uniq % 10_000_000_000)).await;

    let attachment_a = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_a,
        SOURCE_HASH_二号,
        "same-canonical-a.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        room_a,
        session_a,
        attachment_a.clone(),
        format!("source-hidden-a-{uniq}"),
    )
    .await;

    let (reuse_status, reuse_body) = send_json(
        app.clone(),
        Method::POST,
        "/api/media/image/source-dedupe",
        Some(serde_json::json!({
            "session_id": session_b,
            "room_id": room_b,
            "source_hash": SOURCE_HASH_二号,
            "source_byte_size": 最小webp字节().len() as i64,
            "source_file_name": "same-canonical-b.webp"
        })),
        &[],
    )
    .await;
    assert_eq!(reuse_status, StatusCode::OK);
    assert_eq!(reuse_body["status"].as_str(), Some("miss"));
    assert!(reuse_body.get("attachment").is_none());

    let attachment_b = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_b,
        SOURCE_HASH_二号,
        "same-canonical-b.webp",
        uniq + 1,
    )
    .await;

    let distinct_asset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT content_hash)
           FROM attachment_canonical_asset_refs
          WHERE attachment_id = ANY($1)",
    )
    .bind(vec![attachment_a, attachment_b])
    .fetch_one(&pool)
    .await
    .expect("应能统计两个附件的 canonical 资产");
    assert_eq!(distinct_asset_count, 1, "物理资产必须按 content_hash 全局收口");
    pool.close().await;
}
```

- [ ] **Step 2: 运行测试**

Run:

```powershell
cargo test 不同身份不可见房间source_hash只能miss但相同canonical上传后只保留一份物理资产 --test 媒体上传测试 -- --nocapture
```

Expected: 如果已通过，记录为 characterization；如果失败，失败点必须指向 `content_hash` 全局收口缺口，不能用扩大 `source_hash` 权限来修。

- [ ] **Step 3: 提交测试**

```powershell
git add tests/媒体上传测试/source_hash.rs
git commit -m "测试：锁定不可见媒体的物理去重边界"
```

## 5. Task 3: 实现 source_hash 受权限跨房间复用

**Files:**

- Modify: `src/用例.rs`
- Modify: `src/适配.rs`
- Modify: `src/媒体附件适配.rs`
- Test: `tests/媒体上传测试/source_hash.rs`

- [ ] **Step 1: 重新读取目标文件**

Run:

```powershell
rg -n "查询房间可复用source_hash|复用source_hash媒体附件|SourceHash媒体复用请求" src tests -S
```

Expected: 找到所有旧命名和调用点。

- [ ] **Step 2: 修改用例端口命名与参数**

在 `src/用例.rs` 中把端口改成表达真实边界：

```rust
fn 查询可复用source_hash媒体资产(
    &self,
    会话标识: &str,
    目标房间标识: &str,
    当前匿名身份标识: &str,
    source_hash: &str,
    source_byte_size: i64,
    种类: 媒体附件类型,
) -> Result<Option<可复用媒体资产>, contract::错误码>
```

要求：

- `目标房间标识` 只用于确认当前发送上下文，不代表搜索范围。
- `当前匿名身份标识` 用于允许“自己曾上传过的资产跨房间复用”。
- 注释必须写清：禁止全站 source_hash 探测，允许自有资产和当前可见资产复用。

- [ ] **Step 3: 修改 `复用source_hash媒体附件`**

最小改动：

```rust
let Some(asset) = 仓储.查询可复用source_hash媒体资产(
    &请求.会话标识,
    &请求.房间标识,
    &所属匿名身份标识,
    &请求.source_hash,
    请求.source_byte_size,
    请求.种类.clone(),
)?
else {
    return Ok(SourceHash媒体复用结果::Miss);
};
```

要求：

- 保留 `校验房间订阅资格`，防止绕过目标房间发送权限。
- 查询端口显式传入当前 `会话标识`，因为“可见源消息”按会话成员资格判定，不能用匿名身份偷换当前连接的房间 membership。
- 命中后仍创建新附件，不能复用旧附件 id。
- 命中后仍写 `attachment_source_hashes`，方便后续自有资产复用链继续成立。

- [ ] **Step 4: 修改 SQL 查询**

在 `src/媒体附件适配.rs` 中替换旧 `查询房间可复用source_hash媒体资产_异步`。

核心 SQL 约束应等价于：

```sql
SELECT
    cma.content_hash,
    cma.kind,
    cma.mime_type,
    cma.byte_size,
    cma.width,
    cma.height,
    cma.storage_key,
    cma.torrent_bytes,
    cma.torrent_info_hash,
    cma.piece_length_bytes,
    EXTRACT(EPOCH FROM cma.web_seed_until)::BIGINT AS web_seed_until_epoch,
    EXTRACT(EPOCH FROM cma.origin_expires_at)::BIGINT AS origin_expires_at_epoch
FROM attachments a
JOIN anonymous_identities owner_ai ON owner_ai.id = a.owner_anonymous_identity_id
JOIN attachment_source_hashes ash ON ash.attachment_id = a.attachment_id
JOIN attachment_canonical_asset_refs acar ON acar.attachment_id = a.attachment_id
JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
WHERE ash.source_hash = $1
  AND ash.source_byte_size = $2
  AND a.kind = $3
  AND cma.kind = $3
  AND a.status = 'ready'
  AND a.origin_deleted_at IS NULL
  AND cma.origin_deleted_at IS NULL
  AND (
      owner_ai.identity_uuid::text = $4
      OR owner_ai.anonymous_identity_id = $4
      OR EXISTS (
          SELECT 1
            FROM message_attachment_refs mar
            JOIN messages m ON m.message_id = mar.message_id
            JOIN room_members rm ON rm.room_id = m.room_id
            JOIN sessions viewer_s ON viewer_s.session_id = rm.session_id
           WHERE mar.attachment_id = a.id
             AND rm.left_at IS NULL
             AND viewer_s.session_id = $5
      )
  )
ORDER BY a.created_at DESC
LIMIT 1
```

实现时可以按实际 schema 微调，但必须保留三点：

- 自己拥有的 ready 附件可跨房间复用。
- 当前会话可见消息里的 ready 附件可复用。
- 不可见别人的附件不能通过 `source_hash` 返回命中。
- `source_hash` 查询函数的实际 bind 必须包含当前 `会话标识`，不能只传匿名身份。

- [ ] **Step 5: 更新 `src/适配.rs` 转发方法**

要求：

- 旧方法名不应继续保留成第二条 live path。
- 如果短期必须保留兼容 wrapper，必须在同一任务内删除或改成私有转发，禁止两个公开端口并存。

- [ ] **Step 6: 跑目标测试**

Run:

```powershell
cargo test 同一身份跨房间同source_hash会复用全局canonical资产但创建目标房间新附件事实 --test 媒体上传测试 -- --nocapture
cargo test 未授权房间不能通过source_hash探测已有媒体 --test 媒体上传测试 -- --nocapture
cargo test canonical资产删除后source_hash不会复活ready附件 --test 媒体上传测试 -- --nocapture
```

Expected: PASS。

- [ ] **Step 7: 提交实现**

```powershell
git add src/用例.rs src/适配.rs src/媒体附件适配.rs tests/媒体上传测试/source_hash.rs
git commit -m "实现：source_hash按授权复用全局媒体资产"
```

## 6. Task 4: 修正前端契约文案和 source_hash 传输测试

**Files:**

- Modify: `frontend/契约.ts`
- Modify: `frontend/tests/传输测试.spec.ts`
- Modify only if wording asserts old boundary: `frontend/媒体/媒体发布.ts`

- [ ] **Step 1: 写前端文案守卫测试**

在 `frontend/tests/传输测试.spec.ts` 更新旧用例名：

```ts
it("reuseMediaBySourceHash 会调用受目标房间发送权限约束的 source_hash 复用路由并解析 ready 附件", async () => {
  // 保留现有 body 断言：room_id 仍然必须发送。
});
```

新增源码守卫：

```ts
it("契约禁止把 room_id 描述成 source_hash 的唯一搜索范围", () => {
  const source = readFileSync(resolve(process.cwd(), "契约.ts"), "utf8");

  expect(source).toContain("room_id 是目标房间发送裁决锚点");
  expect(source).not.toContain("只能在当前会话可见的房间事实内查询命中");
});
```

- [ ] **Step 2: 跑红测**

Run:

```powershell
pnpm --dir frontend test -- 传输测试.spec.ts
```

Expected: FAIL，当前 `frontend/契约.ts` 仍写着旧房间范围描述。

- [ ] **Step 3: 更新契约注释**

把 `媒体SourceHash复用请求` 注释改成：

```ts
/**
 * source_hash 复用请求必须带 room_id：
 * room_id 是目标房间发送裁决锚点，不是媒体资产身份边界。
 * 后端只能在当前身份有权复用的资产内命中，禁止返回全站存在性信号。
 */
```

- [ ] **Step 4: 跑前端目标测试**

Run:

```powershell
pnpm --dir frontend test -- 传输测试.spec.ts 媒体发布测试.spec.ts 源文件哈希测试.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add frontend/契约.ts frontend/tests/传输测试.spec.ts frontend/媒体/媒体发布.ts
git commit -m "修正：source_hash前端契约表达授权复用边界"
```

## 7. Task 5: 后端红测 - 转发可见源附件复用 canonical 资产

**Files:**

- Modify: `tests/媒体上传测试/source_hash.rs`

- [ ] **Step 1: 写转发成功红测**

新增测试函数：

```rust
#[tokio::test]
#[serial]
async fn 可见媒体附件转发到目标房间时只新增消息和附件引用不重建物理资产() {
    let (database_url, state, app) = 构建source_hash测试应用().await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("应能连接 source_hash 测试数据库");
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();

    let (session_id, source_room) =
        启动会话并进房(app.clone(), format!("forward-owner-{uniq}"), format!("FA{:010}", uniq % 10_000_000_000)).await;
    let target_room =
        既有会话进房(app.clone(), &session_id, format!("FB{:010}", uniq % 10_000_000_000)).await;

    let source_attachment_id = 上传带source_hash的最小图片(
        app.clone(),
        state.tus_upload_dir.clone(),
        &session_id,
        SOURCE_HASH_一号,
        "forward-source.webp",
        uniq,
    )
    .await;
    用附件创建房间消息(
        database_url.clone(),
        source_room,
        session_id.clone(),
        source_attachment_id.clone(),
        format!("forward-source-message-{uniq}"),
    )
    .await;

    let (forward_status, forward_body) = send_json(
        app,
        Method::POST,
        "/api/media/image/forward",
        Some(serde_json::json!({
            "session_id": session_id,
            "target_room_id": target_room,
            "source_attachment_id": source_attachment_id,
            "client_message_id": format!("forward-target-message-{uniq}"),
            "text": "转发"
        })),
        &[],
    )
    .await;

    assert_eq!(forward_status, StatusCode::OK, "转发响应: {forward_body:?}");
    let forwarded_attachment_id = forward_body["message"]["attachments"][0]["attachment_id"]
        .as_str()
        .expect("转发必须返回目标房间的新附件")
        .to_string();
    assert_ne!(source_attachment_id, forwarded_attachment_id);

    let distinct_asset_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT content_hash)
           FROM attachment_canonical_asset_refs
          WHERE attachment_id = ANY($1)",
    )
    .bind(vec![source_attachment_id, forwarded_attachment_id])
    .fetch_one(&pool)
    .await
    .expect("应能统计转发前后的 canonical 资产");
    assert_eq!(distinct_asset_count, 1);
    pool.close().await;
}
```

- [ ] **Step 2: 跑红测确认 404 或未实现**

Run:

```powershell
cargo test 可见媒体附件转发到目标房间时只新增消息和附件引用不重建物理资产 --test 媒体上传测试 -- --nocapture
```

Expected: FAIL，当前没有 `/api/media/image/forward`。

- [ ] **Step 3: 写不可见源附件禁止转发红测**

新增测试函数：

```rust
#[tokio::test]
#[serial]
async fn 不可见源附件不能被转发也不能泄漏旧附件线索() {
    // user A 在 room A 发源附件；user B 在 room B 请求转发 source_attachment_id。
    // 断言返回 403/404/业务错误，且响应不包含旧房间、旧消息、旧上传者、canonical content_hash。
}
```

实现测试时必须断言：

- 响应不是 `200 OK` 成功转发。
- 响应体不包含 `content_hash`、`swarm_id`、`source_room_id`、`source_message_id`、`owner`。

- [ ] **Step 4: 提交红测**

```powershell
git add tests/媒体上传测试/source_hash.rs
git commit -m "测试：刻画媒体附件转发复用边界"
```

## 8. Task 6: 实现转发分享用例与 HTTP 路由

**Files:**

- Modify: `src/用例.rs`
- Modify: `src/适配.rs`
- Modify: `src/媒体附件适配.rs`
- Modify: `src/媒体上传外壳.rs`
- Modify: `src/外壳.rs`
- Test: `tests/媒体上传测试/source_hash.rs`

- [ ] **Step 1: 新增用例请求/结果类型**

在 `src/用例.rs` 中新增：

```rust
pub struct 媒体附件转发请求 {
    pub 会话标识: String,
    pub 目标房间标识: String,
    pub 源附件标识: String,
    pub 新附件标识: String,
    pub 客户端消息标识: String,
    pub 文本: String,
    pub 种类: 媒体附件类型,
}

pub struct 媒体附件转发结果 {
    pub 消息事件: contract::领域事件,
    pub 附件: 媒体附件快照,
    pub 协作分发: 协作分发元数据快照,
    pub torrent: 协作分发Torrent元信息快照,
}
```

字段名可按现有命名调整，但结果必须能让 HTTP 层返回目标消息和新附件快照。

- [ ] **Step 2: 新增仓储端口**

在 `src/用例.rs` 的 `仓储端口` 增加：

```rust
fn 查询可转发媒体资产(
    &self,
    会话标识: &str,
    源附件标识: &str,
    种类: 媒体附件类型,
) -> Result<Option<可复用媒体资产>, contract::错误码>
```

注释必须写清：

- 只从当前会话可见消息里的源附件出发。
- 不接受 `source_hash`。
- 不返回旧消息/旧房间/旧上传者。

- [ ] **Step 3: 实现用例 `转发媒体附件到房间`**

核心流程：

```rust
pub fn 转发媒体附件到房间(
    仓储: &mut dyn 仓储端口,
    请求: &媒体附件转发请求,
) -> Result<媒体附件转发结果, contract::错误码> {
    校验房间订阅资格(仓储, &请求.目标房间标识, &请求.会话标识)?;
    let 所属匿名身份标识 = 仓储
        .查询会话所属匿名身份(&请求.会话标识)?
        .ok_or(contract::错误码::会话无效)?;
    let asset = 仓储
        .查询可转发媒体资产(&请求.会话标识, &请求.源附件标识, 请求.种类.clone())?
        .ok_or(contract::错误码::附件不存在)?;

    // 用 asset 创建当前发送者拥有的新 ready 附件。
    // 绑定同一 canonical 资产、写同一 content_hash 派生的 swarm、复制 torrent 元信息。
    // 然后调用现有 创建消息，复用 owner/status/kind 校验。
}
```

要求：

- 必须调用现有 `创建消息` 或等价的统一消息主链，禁止在转发用例里绕过消息成立规则。
- 新附件 owner 必须是当前发送者身份，这样现有 `创建消息` 的 owner 校验继续有效。
- 不记录新的 `source_hash`，除非源附件已有 source_hash 且业务明确要复制；本计划默认不复制，避免把转发伪装成原文件持有。

- [ ] **Step 4: 实现 SQL 查询**

在 `src/媒体附件适配.rs` 新增私有异步函数，查询当前会话可见的源附件：

```sql
SELECT
    cma.content_hash,
    cma.kind,
    cma.mime_type,
    cma.byte_size,
    cma.width,
    cma.height,
    cma.storage_key,
    cma.torrent_bytes,
    cma.torrent_info_hash,
    cma.piece_length_bytes,
    EXTRACT(EPOCH FROM cma.web_seed_until)::BIGINT AS web_seed_until_epoch,
    EXTRACT(EPOCH FROM cma.origin_expires_at)::BIGINT AS origin_expires_at_epoch
FROM attachments a
JOIN message_attachment_refs mar ON mar.attachment_id = a.id
JOIN messages m ON m.message_id = mar.message_id
JOIN room_members rm ON rm.room_id = m.room_id AND rm.left_at IS NULL
JOIN sessions viewer_s ON viewer_s.session_id = rm.session_id
JOIN attachment_canonical_asset_refs acar ON acar.attachment_id = a.attachment_id
JOIN canonical_media_assets cma ON cma.content_hash = acar.content_hash
WHERE viewer_s.session_id = $1
  AND a.attachment_id = $2
  AND a.kind = $3
  AND cma.kind = $3
  AND a.status = 'ready'
  AND a.origin_deleted_at IS NULL
  AND cma.origin_deleted_at IS NULL
LIMIT 1
```

- [ ] **Step 5: 实现 HTTP handler**

在 `src/媒体上传外壳.rs` 新增请求体：

```rust
pub(super) struct ForwardMediaBody {
    session_id: Option<String>,
    target_room_id: Option<String>,
    source_attachment_id: Option<String>,
    client_message_id: Option<String>,
    text: Option<String>,
}
```

handler 职责：

- 校验必填字段非空。
- 生成新附件 id。
- 调用 `usecase::转发媒体附件到房间`。
- 返回目标房间新消息事件和新附件媒体资产快照。
- 尝试启动协作分发做种失败只能 warn，不能把业务转发回滚。

- [ ] **Step 6: 注册路由**

在 `src/外壳.rs` 注册：

```rust
.route("/api/media/{kind}/forward", post(媒体上传外壳::forward_media_attachment))
```

实际 path 参数写法必须跟当前 Axum 版本和现有路由风格一致。

- [ ] **Step 7: 跑转发目标测试**

Run:

```powershell
cargo test 可见媒体附件转发到目标房间时只新增消息和附件引用不重建物理资产 --test 媒体上传测试 -- --nocapture
cargo test 不可见源附件不能被转发也不能泄漏旧附件线索 --test 媒体上传测试 -- --nocapture
```

Expected: PASS。

- [ ] **Step 8: 提交实现**

```powershell
git add src/用例.rs src/适配.rs src/媒体附件适配.rs src/媒体上传外壳.rs src/外壳.rs tests/媒体上传测试/source_hash.rs
git commit -m "实现：媒体转发复用可见源附件资产"
```

## 9. Task 7: 前端转发契约与传输

**Files:**

- Modify: `frontend/契约.ts`
- Modify: `frontend/传输.ts`
- Modify: `frontend/媒体/适配/媒体HTTP接口.ts`
- Modify: `frontend/聊天媒体编排.ts`
- Modify: `frontend/tests/传输测试.spec.ts`

- [ ] **Step 1: 写传输红测**

在 `frontend/tests/传输测试.spec.ts` 新增：

```ts
it("forwardMediaAttachment 会调用媒体转发路由且不提交 source_hash 或原文件字节", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        message: {
          type: "message_created",
          room_id: "target-room",
          message_id: "m-forward-1",
          client_message_id: "c-forward-1",
          sender_session_id: "s-1",
          sender_display_alias: "暴躁的企鹅",
          text: "转发",
          attachments: [{ kind: "image", attachment_id: "att-forward-1", width: 1, height: 1 }],
          event_position: 12,
        },
        attachment: {
          attachment_id: "att-forward-1",
          kind: "image",
          mime_type: "image/webp",
          byte_size: 88,
          width: 1,
          height: 1,
          status: "ready",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
  const transport = 创建测试传输();

  await transport.forwardMediaAttachment("image", {
    session_id: "s-1",
    target_room_id: "target-room",
    source_attachment_id: "att-source-1",
    client_message_id: "c-forward-1",
    text: "转发",
  });

  const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
  expect(fetchSpy).toHaveBeenCalledWith(
    "http://localhost:3000/api/media/image/forward",
    expect.objectContaining({ method: "POST" })
  );
  expect(body).toEqual({
    session_id: "s-1",
    target_room_id: "target-room",
    source_attachment_id: "att-source-1",
    client_message_id: "c-forward-1",
    text: "转发",
  });
  expect(body.source_hash).toBeUndefined();
  expect(body.source_byte_size).toBeUndefined();
});
```

- [ ] **Step 2: 跑红测**

Run:

```powershell
pnpm --dir frontend test -- 传输测试.spec.ts
```

Expected: FAIL，当前传输端口没有 `forwardMediaAttachment`。

- [ ] **Step 3: 新增契约**

在 `frontend/契约.ts` 增加：

```ts
export interface 媒体附件转发请求 {
  session_id: string;
  target_room_id: string;
  source_attachment_id: string;
  client_message_id: string;
  text?: string;
}

export interface 媒体附件转发结果 {
  message: 消息事件;
  attachment: 媒体附件上传结果;
}
```

注释必须写清：转发以源附件可见性授权，不依赖 `source_hash` 和原文件字节。

- [ ] **Step 4: 实现媒体 HTTP 方法**

在 `frontend/媒体/适配/媒体HTTP接口.ts` 增加：

```ts
async forwardMediaAttachment(
  kind: 媒体种类,
  input: 媒体附件转发请求
): Promise<媒体附件转发结果> {
  return await this.deps.post<媒体附件转发结果>(`/api/media/${kind}/forward`, {
    session_id: input.session_id,
    target_room_id: input.target_room_id,
    source_attachment_id: input.source_attachment_id,
    client_message_id: input.client_message_id,
    text: input.text ?? "",
  });
}
```

- [ ] **Step 5: 更新组合根窄端口**

在 `frontend/传输.ts` 和 `frontend/聊天媒体编排.ts` 暴露窄端口：

```ts
forwardMediaAttachment(
  kind: 媒体种类,
  input: 媒体附件转发请求
): Promise<媒体附件转发结果>;
```

要求：不要把转发 UI 状态、菜单文案或页面流程放进 `contract`。

- [ ] **Step 6: 跑前端目标测试**

Run:

```powershell
pnpm --dir frontend test -- 传输测试.spec.ts 媒体发布测试.spec.ts
pnpm --dir frontend typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add frontend/契约.ts frontend/传输.ts frontend/媒体/适配/媒体HTTP接口.ts frontend/聊天媒体编排.ts frontend/tests/传输测试.spec.ts
git commit -m "实现：前端媒体转发传输契约"
```

## 10. Task 8: 迁移与注释守卫

**Files:**

- Modify: `migrations/0020_媒体source_hash精确去重资产索引.sql`
- Modify: `tests/启动与迁移测试.rs`

- [ ] **Step 1: 更新迁移注释，不改 schema**

只允许改注释，不新增 `source_hash` unique：

```sql
-- source_hash 是上传前精确命中索引，不是全站可见资产身份；
-- 允许同一身份或可见授权范围复用，禁止跨权限存在性探测。
```

- [ ] **Step 2: 更新迁移守卫测试**

在 `tests/启动与迁移测试.rs` 的 `source_hash精确去重迁移会建立内容资产和受权限索引` 中增加：

```rust
assert!(sql.contains("禁止跨权限存在性探测"));
assert!(!sql.contains("UNIQUE (source_hash"));
assert!(sql.contains("content_hash TEXT PRIMARY KEY"));
```

- [ ] **Step 3: 跑迁移测试**

Run:

```powershell
cargo test source_hash精确去重迁移会建立内容资产和受权限索引 --test 启动与迁移测试 -- --nocapture
```

Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add migrations/0020_媒体source_hash精确去重资产索引.sql tests/启动与迁移测试.rs
git commit -m "文档：收口source_hash迁移权限边界"
```

## 11. Task 9: 全量回归与噪音清理

**Files:**

- Verify only.

- [ ] **Step 1: 后端目标回归**

Run:

```powershell
cargo test source_hash --test 媒体上传测试 -- --nocapture
cargo test complete --test 媒体上传测试 -- --nocapture
cargo test source_hash精确去重迁移会建立内容资产和受权限索引 --test 启动与迁移测试 -- --nocapture
cargo test 共享canonical资产超过24小时只删除一次并同步标记所有引用附件 --test 媒体后台测试 -- --nocapture
```

Expected: PASS。

- [ ] **Step 2: 前端目标回归**

Run:

```powershell
pnpm --dir frontend test -- 传输测试.spec.ts 媒体发布测试.spec.ts 源文件哈希测试.spec.ts
pnpm --dir frontend typecheck
```

Expected: PASS。

- [ ] **Step 3: 格式与脏尾巴检查**

Run:

```powershell
cargo fmt --check
git diff --check
git status --short
```

Expected:

- `cargo fmt --check` PASS。
- `git diff --check` 无输出。
- `git status --short` 只包含本任务预期文件。

- [ ] **Step 4: 如果改过代码文件，刷新 graphify**

Run:

```powershell
python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

Expected: graphify 刷新完成。若本地 Python 环境缺 graphify，记录失败原因，不用改业务代码绕过。

- [ ] **Step 5: 最终提交**

```powershell
git add src tests frontend migrations graphify-out
git commit -m "完成：媒体全局资产去重与转发复用"
```

## 12. 自审清单

**按 writing-plans 审查：**

- [ ] 计划已保存到 `docs/superpowers/plans/2026-04-24-媒体source_hash精确去重执行计划.md`。
- [ ] 每个任务都有明确文件、红测、运行命令、期望结果、提交点。
- [ ] 没有要求执行者凭记忆修改；关键任务都要求先 `rg` 或重新读取目标文件。
- [ ] 没有新增非必要 `.rs` 文件；优先复用现有 `source_hash.rs` 测试模块。

**按 supxcode 审查：**

- [ ] 真相 owner 明确：媒体身份和复用权限在 `usecase`，SQL adapter 不做业务裁决，前端不做权限裁决。
- [ ] 没有把“全局唯一”偷换成“全局可见”。
- [ ] 没有引入第二套媒体资产表、第二套 torrent 生成路径或第二条消息成立路径。
- [ ] 转发路径不依赖 `source_hash` 或原文件持有证明。
- [ ] 不可见跨用户场景只能 miss；上传完成后的物理去重由 `content_hash` 收口。
- [ ] 删除语义优先于 `source_hash`、转发和 `content_hash` 复用。

**按项目约束审查：**

- [ ] 业务核心不依赖 Axum/Dioxus/socketioxide/sqlx 类型。
- [ ] `contract` 不携带 Web UI 文案、菜单状态或页面流程。
- [ ] HTTP handler 只做协议翻译和错误转码。
- [ ] 没有把转发 UI 功能混进上传发布流程。
- [ ] 代码实现阶段必须补克制中文注释，解释权限边界、资产 owner 和禁止探测原因。

## 13. 执行建议

建议选择 **Inline Execution**：

1. 这个计划多数任务共享同一组热点文件，平行 worker 容易造成冲突。
2. TDD 顺序强，必须先把 source_hash 权限边界改对，再做转发。
3. 每个任务都有提交点，适合当前主干线逐步推进。

如果后续要并行，最多并行前端传输契约与后端转发红测；不要并行修改 `src/用例.rs` 和 `src/媒体附件适配.rs`。
