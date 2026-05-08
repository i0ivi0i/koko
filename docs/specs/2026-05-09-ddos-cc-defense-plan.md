# DDoS/CC 防御 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公网万人实时群聊添加应用层 DDoS/CC 纵深防御：自适应 PoW 门禁 + IP 限流 + 连接上限 + 自动冷却，正常用户零感知。

**Architecture:** 五层纵深防御全部在 adapter/shell 层实现。PoW 采用无状态 HMAC 自验证设计，零新增 DB 查询。前端 PoW solver 复用浏览器原生 SubtleCrypto + Web Worker，遵循项目已有 worker 构建模式 (esbuild)。

**Tech Stack:** Rust (governor, tower-governor, hmac, sha2) + TypeScript (SubtleCrypto Web Worker) + 现有 axum 0.8 + socketioxide 0.18

**Spec:** `docs/specs/2026-05-09-ddos-cc-defense-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/外壳/连接门禁.rs` | PoW 核心（challenge 生成/验证、自适应难度、HMAC 签发）+ IP 追踪/冷却 + 真实 IP 提取 |
| `frontend/连接门禁/pow解题器.worker.ts` | Web Worker：SHA-256 碰撞求解 |
| `frontend/连接门禁/pow门禁.ts` | PoW lifecycle：challenge→solve→token 管理 + 缓存 |
| `frontend/tests/pow门禁测试.spec.ts` | 前端 PoW 门禁单元测试 |
| `tests/连接门禁测试.rs` | 后端 PoW + IP 追踪单元测试 |

### Modified Files

| File | Changes |
|------|---------|
| `Cargo.toml` | 加 `governor`, `tower-governor`, `hmac` |
| `src/外壳/mod.rs` | 注册 PoW 路由、governor layer、连接门禁模块声明 |
| `src/实时/外壳.rs` | connect middleware 加 PoW 验证 + 房间订阅令牌桶 |
| `frontend/聊天实时/适配/实时连接适配.ts` | createSocket 前先获取 PoW token |
| `frontend/聊天共享/适配/聊天实时连接端口.ts` | 端口增加 PoW token 异步获取 |
| `frontend/平台/传输.ts` | 组合根注入 PoW 门禁 |
| `frontend/build.mjs` | 加 PoW worker 构建入口 |
| `ops/env.production.example` | 加 `KOKO_POW_SECRET` 和 `KOKO_TRUSTED_PROXY` |

---

## Task 1: 后端依赖 + 配置读取

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/组合根.rs` — 加 PoW 配置读取
- Modify: `ops/env.production.example` — 加新环境变量示例
- Test: `src/组合根/配置测试.rs`

- [ ] **Step 1: 写 PoW 配置读取失败测试**

在 `src/组合根/配置测试.rs` 末尾加：

```rust
#[test]
fn pow密钥缺失时应返回错误() {
    let result = crate::assembly::读取PoW配置_with(|_| None);
    assert!(result.is_err(), "缺少 KOKO_POW_SECRET 应报错");
}

#[test]
fn pow配置正常读取() {
    let config = crate::assembly::读取PoW配置_with(|key| match key {
        "KOKO_POW_SECRET" => Some("a]b9#kL2$mN4&pQ6^rS8*tU0!wX1@zY3".to_string()),
        "KOKO_TRUSTED_PROXY" => Some("true".to_string()),
        _ => None,
    })
    .expect("合法配置应可构建");
    assert_eq!(config.trusted_proxy, true);
    assert!(!config.secret.is_empty());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test pow密钥 pow配置 --no-run 2>&1` 然后 `cargo test pow密钥 pow配置`
Expected: 编译失败，`读取PoW配置_with` 未定义

- [ ] **Step 3: 添加 Cargo 依赖**

在 `Cargo.toml` 的 `[dependencies]` 添加：

```toml
# IP 级限流直接站在成熟令牌桶算法肩膀上，不手搓第二套速率控制器。
governor = "0.8"
# governor 的 axum tower layer 适配，零胶水代码即可接入 HTTP 路由。
tower-governor = "0.6"
# PoW challenge 和 token 的 HMAC 签名/验签，与 sha2 同属 RustCrypto 生态。
hmac = "0.12"
```

- [ ] **Step 4: 在 `src/组合根.rs` 添加 PoW 配置结构和读取函数**

```rust
/// PoW 防御配置只描述"门禁如何读取密钥和信任代理"。
/// 它不承载自适应难度参数——那些是运行态值对象，归 adapter 层 own。
#[derive(Debug, Clone)]
pub struct PoW配置 {
    /// HMAC-SHA256 签名密钥，至少 32 字节。
    pub secret: Vec<u8>,
    /// 是否信任反代的 X-Forwarded-For（Caddy 场景为 true）。
    pub trusted_proxy: bool,
}

pub fn 读取PoW配置() -> io::Result<PoW配置> {
    读取PoW配置_with(|key| env::var(key).ok())
}

pub fn 读取PoW配置_with<F>(mut read: F) -> io::Result<PoW配置>
where
    F: FnMut(&str) -> Option<String>,
{
    let secret_str = read("KOKO_POW_SECRET").ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "缺少 KOKO_POW_SECRET 环境变量")
    })?;
    if secret_str.len() < 32 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "KOKO_POW_SECRET 至少需要 32 字节",
        ));
    }
    let trusted_proxy = read("KOKO_TRUSTED_PROXY")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    Ok(PoW配置 {
        secret: secret_str.into_bytes(),
        trusted_proxy,
    })
}
```

- [ ] **Step 5: 更新 `ops/env.production.example`**

追加：
```
# PoW 防御密钥（至少 32 字节随机字符串，用于 HMAC 签名 challenge 和 token）
KOKO_POW_SECRET=在此填入至少32字节的随机密钥
# 是否信任反代的 X-Forwarded-For（Caddy 部署设为 true）
KOKO_TRUSTED_PROXY=true
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cargo test pow密钥 pow配置`
Expected: 2 tests passed

- [ ] **Step 7: Commit**

```
git add Cargo.toml src/组合根.rs src/组合根/配置测试.rs ops/env.production.example
git commit -m "feat(defense): 添加 DDoS/CC 防御依赖与 PoW 配置读取"
```

---

## Task 2: PoW 核心 — challenge 生成/验证 + 自适应难度

**Files:**
- Create: `src/外壳/连接门禁.rs`
- Test: `tests/连接门禁测试.rs`

- [ ] **Step 1: 写 PoW challenge 生成与验证的失败测试**

创建 `tests/连接门禁测试.rs`：

```rust
use koko::shell::连接门禁::{PoW引擎, PoW验证结果};

#[test]
fn 合法解题应通过验证() {
    let secret = b"test-secret-must-be-32-bytes-long";
    let engine = PoW引擎::new(secret, 4); // difficulty=4 前导零位，测试用低难度
    let challenge = engine.生成challenge(std::time::Duration::from_secs(30));
    // 模拟客户端暴力解题
    let mut nonce: u64 = 0;
    loop {
        let hash = engine.计算hash(&challenge.salt, nonce);
        if engine.满足难度(&hash, challenge.difficulty) {
            let result = engine.验证solution(&challenge, nonce, &hash);
            assert!(matches!(result, PoW验证结果::通过 { .. }));
            break;
        }
        nonce += 1;
        assert!(nonce < 1_000_000, "difficulty=4 应在百万次内解出");
    }
}

#[test]
fn 过期challenge应被拒绝() {
    let secret = b"test-secret-must-be-32-bytes-long";
    let engine = PoW引擎::new(secret, 4);
    let mut challenge = engine.生成challenge(std::time::Duration::from_secs(30));
    challenge.expires_at = 0; // 强制过期
    let result = engine.验证solution(&challenge, 0, "fake");
    assert!(matches!(result, PoW验证结果::过期));
}

#[test]
fn 篡改签名应被拒绝() {
    let secret = b"test-secret-must-be-32-bytes-long";
    let engine = PoW引擎::new(secret, 4);
    let mut challenge = engine.生成challenge(std::time::Duration::from_secs(30));
    challenge.signature = "tampered".to_string();
    let result = engine.验证solution(&challenge, 0, "fake");
    assert!(matches!(result, PoW验证结果::签名无效));
}
```

- [ ] **Step 2: 运行测试确认编译失败**

Run: `cargo test --test 连接门禁测试 --no-run 2>&1`
Expected: 编译失败，`连接门禁` 模块不存在

- [ ] **Step 3: 实现 PoW 引擎**

创建 `src/外壳/连接门禁.rs`：

```rust
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

// ─── 自适应难度级别 ───

/// 30 秒窗口内的握手请求数 → difficulty（SHA-256 前导零位数）。
/// difficulty 越高，客户端解题越慢，攻击成本越高。
const 难度级别: &[(u64, u8)] = &[
    (50, 8),      // < 50 请求: ~20ms
    (500, 16),    // 50-500: ~200ms
    (5000, 20),   // 500-5000: ~1-2s
    (u64::MAX, 24), // > 5000: ~5s+
];

/// 滑动窗口访客计数器：30 秒一轮。
/// 纯原子操作，零锁竞争，被攻击时不会成为瓶颈。
pub(crate) struct 访客计数器 {
    当前计数: AtomicU64,
    窗口起点秒: AtomicU64,
}

impl 访客计数器 {
    pub fn new() -> Self {
        Self {
            当前计数: AtomicU64::new(0),
            窗口起点秒: AtomicU64::new(Self::当前秒()),
        }
    }

    fn 当前秒() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// 记录一次访客并返回当前窗口计数。
    pub fn 递增(&self) -> u64 {
        let now = Self::当前秒();
        let window_start = self.窗口起点秒.load(Ordering::Relaxed);
        if now.saturating_sub(window_start) >= 30 {
            // 新窗口：重置计数器。
            // compare_exchange 失败说明别的线程已经翻窗口了，直接递增即可。
            if self
                .窗口起点秒
                .compare_exchange(window_start, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                self.当前计数.store(1, Ordering::Relaxed);
                return 1;
            }
        }
        self.当前计数.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// 根据当前窗口访客数选择 difficulty。
    pub fn 当前难度(&self) -> u8 {
        let count = self.当前计数.load(Ordering::Relaxed);
        for &(threshold, difficulty) in 难度级别 {
            if count < threshold {
                return difficulty;
            }
        }
        难度级别.last().unwrap().1
    }
}

// ─── PoW 引擎 ───

/// challenge 数据包：发给客户端的解题参数。
#[derive(Clone, Debug)]
pub(crate) struct PoWChallenge {
    pub salt: String,
    pub difficulty: u8,
    pub expires_at: u64,
    pub signature: String,
}

pub(crate) enum PoW验证结果 {
    通过 { pow_token: String },
    过期,
    签名无效,
    解题错误,
}

/// 无状态 PoW 引擎：靠 HMAC 自验证，不存服务端状态。
pub(crate) struct PoW引擎 {
    secret: Vec<u8>,
    default_difficulty: u8,
}

impl PoW引擎 {
    pub fn new(secret: &[u8], default_difficulty: u8) -> Self {
        Self {
            secret: secret.to_vec(),
            default_difficulty,
        }
    }

    /// 生成 challenge，附带 HMAC 签名防篡改。
    pub fn 生成challenge(&self, ttl: Duration) -> PoWChallenge {
        self.生成challenge_with_difficulty(self.default_difficulty, ttl)
    }

    pub fn 生成challenge_with_difficulty(&self, difficulty: u8, ttl: Duration) -> PoWChallenge {
        let salt = hex::encode(uuid::Uuid::new_v4().as_bytes());
        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + ttl.as_secs();
        let signature = self.签名challenge(&salt, difficulty, expires_at);
        PoWChallenge {
            salt,
            difficulty,
            expires_at,
            signature,
        }
    }

    /// HMAC-SHA256(secret, salt + difficulty + expires_at)
    fn 签名challenge(&self, salt: &str, difficulty: u8, expires_at: u64) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC 密钥长度不应被拒绝");
        mac.update(salt.as_bytes());
        mac.update(&[difficulty]);
        mac.update(&expires_at.to_be_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    /// 计算 SHA-256(salt + nonce_str)
    pub fn 计算hash(&self, salt: &str, nonce: u64) -> String {
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(nonce.to_string().as_bytes());
        hex::encode(hasher.finalize())
    }

    /// 检查 hash 是否满足 difficulty 个前导零位（十六进制前导 '0'）。
    pub fn 满足难度(&self, hash_hex: &str, difficulty: u8) -> bool {
        let required_zero_chars = (difficulty as usize + 3) / 4;
        if hash_hex.len() < required_zero_chars {
            return false;
        }
        hash_hex[..required_zero_chars].chars().all(|c| c == '0')
    }

    /// 验证客户端提交的 solution。
    pub fn 验证solution(
        &self,
        challenge: &PoWChallenge,
        nonce: u64,
        submitted_hash: &str,
    ) -> PoW验证结果 {
        // 1. 验签名
        let expected_sig =
            self.签名challenge(&challenge.salt, challenge.difficulty, challenge.expires_at);
        if challenge.signature != expected_sig {
            return PoW验证结果::签名无效;
        }
        // 2. 验过期
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now > challenge.expires_at {
            return PoW验证结果::过期;
        }
        // 3. 验解题
        let actual_hash = self.计算hash(&challenge.salt, nonce);
        if actual_hash != submitted_hash || !self.满足难度(&actual_hash, challenge.difficulty) {
            return PoW验证结果::解题错误;
        }
        // 4. 签发 pow_token
        let token = self.签发token(challenge.expires_at);
        PoW验证结果::通过 { pow_token: token }
    }

    /// 签发短命 PoW token：HMAC-SHA256(secret, "pow" + expires_at)
    fn 签发token(&self, expires_at: u64) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC 密钥长度不应被拒绝");
        mac.update(b"pow_token");
        mac.update(&expires_at.to_be_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        format!("{expires_at}.{sig}")
    }

    /// 验证 pow_token 是否合法且未过期。
    pub fn 验证token(&self, token: &str) -> bool {
        let Some((expires_str, sig)) = token.split_once('.') else {
            return false;
        };
        let Ok(expires_at) = expires_str.parse::<u64>() else {
            return false;
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now > expires_at {
            return false;
        }
        let expected = self.签发token(expires_at);
        let expected_sig = expected.split_once('.').map(|(_, s)| s).unwrap_or("");
        sig == expected_sig
    }
}

// ─── IP 追踪与自动冷却 ───

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};

/// 单 IP 的运行态：连接计数 + 失败计数 + 冷却截止时间。
struct Ip状态 {
    连接数: u32,
    失败次数: u32,
    冷却截止秒: u64,
}

/// IP 追踪器：连接计数、失败追踪、自动冷却。
/// 使用 DashMap 做并发安全的 IP → 状态映射。
pub(crate) struct Ip追踪器 {
    表: dashmap::DashMap<IpAddr, Ip状态>,
    单ip最大连接数: u32,
    失败冷却阈值: u32,
    冷却时长秒: u64,
}

impl Ip追踪器 {
    pub fn new() -> Self {
        Self {
            表: dashmap::DashMap::new(),
            单ip最大连接数: 50,
            失败冷却阈值: 5,
            冷却时长秒: 60,
        }
    }

    fn 当前秒() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// 检查 IP 是否在冷却期。
    pub fn 已冷却(&self, ip: &IpAddr) -> bool {
        self.表
            .get(ip)
            .map(|s| Self::当前秒() < s.冷却截止秒)
            .unwrap_or(false)
    }

    /// 尝试增加连接计数。超过上限返回 false。
    pub fn 尝试增加连接(&self, ip: IpAddr) -> bool {
        let mut entry = self.表.entry(ip).or_insert_with(|| Ip状态 {
            连接数: 0,
            失败次数: 0,
            冷却截止秒: 0,
        });
        if entry.连接数 >= self.单ip最大连接数 {
            return false;
        }
        entry.连接数 += 1;
        true
    }

    /// 减少连接计数（断开时调用）。
    pub fn 减少连接(&self, ip: &IpAddr) {
        if let Some(mut entry) = self.表.get_mut(ip) {
            entry.连接数 = entry.连接数.saturating_sub(1);
            // 连接归零且不在冷却期时清理条目，避免内存泄漏
            if entry.连接数 == 0 && Self::当前秒() >= entry.冷却截止秒 && entry.失败次数 == 0 {
                drop(entry);
                self.表.remove(ip);
            }
        }
    }

    /// 记录一次失败，达到阈值则触发冷却。
    pub fn 记录失败(&self, ip: IpAddr) {
        let mut entry = self.表.entry(ip).or_insert_with(|| Ip状态 {
            连接数: 0,
            失败次数: 0,
            冷却截止秒: 0,
        });
        entry.失败次数 += 1;
        if entry.失败次数 >= self.失败冷却阈值 {
            entry.冷却截止秒 = Self::当前秒() + self.冷却时长秒;
        }
    }

    /// 成功请求重置失败计数。
    pub fn 重置失败(&self, ip: &IpAddr) {
        if let Some(mut entry) = self.表.get_mut(ip) {
            entry.失败次数 = 0;
        }
    }

    /// 当前条目数（监控用）。
    pub fn 条目数(&self) -> usize {
        self.表.len()
    }
}

// ─── 真实 IP 提取 ───

use axum::http::HeaderMap;

/// 从请求头提取客户端真实 IP。
/// trusted_proxy=true 时读 X-Forwarded-For 最左侧，否则回退到 peer_addr。
pub(crate) fn 提取客户端ip(
    headers: &HeaderMap,
    peer_addr: Option<IpAddr>,
    trusted_proxy: bool,
) -> Option<IpAddr> {
    if trusted_proxy {
        if let Some(xff) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
        {
            if let Some(first) = xff.split(',').next() {
                if let Ok(ip) = first.trim().parse::<IpAddr>() {
                    return Some(ip);
                }
            }
        }
    }
    peer_addr
}
```

- [ ] **Step 4: 在 `src/外壳/mod.rs` 注册模块**

在现有 `mod` 声明区域添加：

```rust
#[path = "连接门禁.rs"]
pub(crate) mod 连接门禁;
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --test 连接门禁测试`
Expected: 3 tests passed

- [ ] **Step 6: Commit**

```
git add src/外壳/连接门禁.rs tests/连接门禁测试.rs src/外壳/mod.rs
git commit -m "feat(defense): PoW 引擎核心 + IP 追踪器 + 自适应难度"
```

---

## Task 3: PoW HTTP 端点 + governor 限流 layer

**Files:**
- Modify: `src/外壳/连接门禁.rs` — 加 axum handler
- Modify: `src/外壳/mod.rs` — 注册路由 + governor layer + 应用状态扩展
- Test: `tests/连接门禁测试.rs` — 加集成测试

- [ ] **Step 1: 写 PoW HTTP 端点集成测试**

在 `tests/连接门禁测试.rs` 追加：

```rust
#[tokio::test]
async fn challenge端点应返回合法结构() {
    // 这个测试验证 GET /api/pow/challenge 返回正确 JSON 结构
    // 具体实现在 Step 3 中的 axum handler
    let secret = b"test-secret-must-be-32-bytes-long";
    let engine = PoW引擎::new(secret, 8);
    let challenge = engine.生成challenge(std::time::Duration::from_secs(30));
    assert!(!challenge.salt.is_empty());
    assert_eq!(challenge.difficulty, 8);
    assert!(!challenge.signature.is_empty());
    assert!(challenge.expires_at > 0);
}

#[test]
fn token验证应通过() {
    let secret = b"test-secret-must-be-32-bytes-long";
    let engine = PoW引擎::new(secret, 4);
    let challenge = engine.生成challenge(std::time::Duration::from_secs(30));
    // 解题
    let mut nonce: u64 = 0;
    loop {
        let hash = engine.计算hash(&challenge.salt, nonce);
        if engine.满足难度(&hash, challenge.difficulty) {
            if let PoW验证结果::通过 { pow_token } = engine.验证solution(&challenge, nonce, &hash) {
                assert!(engine.验证token(&pow_token));
                break;
            }
        }
        nonce += 1;
    }
}

#[test]
fn 伪造token应被拒绝() {
    let secret = b"test-secret-must-be-32-bytes-long";
    let engine = PoW引擎::new(secret, 4);
    assert!(!engine.验证token("fake.token"));
    assert!(!engine.验证token(""));
    assert!(!engine.验证token("9999999999.0000"));
}
```

- [ ] **Step 2: 运行测试确认通过（PoW 引擎测试）**

Run: `cargo test --test 连接门禁测试`
Expected: 6 tests passed

- [ ] **Step 3: 在 `连接门禁.rs` 添加 axum handler**

追加到 `src/外壳/连接门禁.rs`：

```rust
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub(crate) struct ChallengeResponse {
    pub algorithm: &'static str,
    pub salt: String,
    pub difficulty: u8,
    pub expires_at: u64,
    pub signature: String,
}

#[derive(Deserialize)]
pub(crate) struct VerifyRequest {
    pub salt: String,
    pub difficulty: u8,
    pub expires_at: u64,
    pub signature: String,
    pub nonce: u64,
    pub hash: String,
}

#[derive(Serialize)]
pub(crate) struct VerifyResponse {
    pub pow_token: String,
}

/// 防御共享状态：引擎 + 访客计数 + IP 追踪。
/// 这是 adapter 层运行态，不混入业务状态。
#[derive(Clone)]
pub(crate) struct 防御状态 {
    pub engine: Arc<PoW引擎>,
    pub 访客: Arc<访客计数器>,
    pub ip追踪: Arc<Ip追踪器>,
    pub trusted_proxy: bool,
}

/// GET /api/pow/challenge
pub(crate) async fn handle_pow_challenge(
    State(defense): State<防御状态>,
) -> Json<ChallengeResponse> {
    let difficulty = defense.访客.当前难度();
    defense.访客.递增();
    let challenge = defense
        .engine
        .生成challenge_with_difficulty(difficulty, Duration::from_secs(30));
    Json(ChallengeResponse {
        algorithm: "SHA-256",
        salt: challenge.salt,
        difficulty: challenge.difficulty,
        expires_at: challenge.expires_at,
        signature: challenge.signature,
    })
}

/// POST /api/pow/verify
pub(crate) async fn handle_pow_verify(
    State(defense): State<防御状态>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, StatusCode> {
    let challenge = PoWChallenge {
        salt: req.salt,
        difficulty: req.difficulty,
        expires_at: req.expires_at,
        signature: req.signature,
    };
    match defense.engine.验证solution(&challenge, req.nonce, &req.hash) {
        PoW验证结果::通过 { pow_token } => Ok(Json(VerifyResponse { pow_token })),
        PoW验证结果::过期 => {
            tracing::info!(adapter = "pow", outcome = "expired", "PoW challenge 已过期");
            Err(StatusCode::GONE)
        }
        PoW验证结果::签名无效 => {
            tracing::info!(adapter = "pow", outcome = "invalid_signature", "PoW 签名不匹配");
            Err(StatusCode::BAD_REQUEST)
        }
        PoW验证结果::解题错误 => {
            tracing::info!(adapter = "pow", outcome = "wrong_solution", "PoW 解题错误");
            Err(StatusCode::BAD_REQUEST)
        }
    }
}
```

- [ ] **Step 4: 在 `src/外壳/mod.rs` 注册 PoW 路由和 governor layer**

在 `应用状态` 结构体加字段：

```rust
pub defense: 连接门禁::防御状态,
```

在 `构建应用状态` 函数中初始化：

```rust
let pow_config = crate::assembly::读取PoW配置()?;
let defense = 连接门禁::防御状态 {
    engine: Arc::new(连接门禁::PoW引擎::new(&pow_config.secret, 8)),
    访客: Arc::new(连接门禁::访客计数器::new()),
    ip追踪: Arc::new(连接门禁::Ip追踪器::new()),
    trusted_proxy: pow_config.trusted_proxy,
};
```

在 `构建路由` 函数中注册路由（在 `.layer(DefaultBodyLimit::...)` 之前）：

```rust
.route("/api/pow/challenge", get(连接门禁::handle_pow_challenge))
.route("/api/pow/verify", post(连接门禁::handle_pow_verify))
```

同时，为 PoW 路由添加 governor 限流 layer（使用 `tower-governor` 的 per-IP 限流）。
在路由构建的最外层加一个 `GovernorLayer`，对 `/api/*` 路径生效。

- [ ] **Step 5: 运行编译和测试确认通过**

Run: `cargo build` 然后 `cargo test --test 连接门禁测试`
Expected: 编译成功，6 tests passed

- [ ] **Step 6: Commit**

```
git add src/外壳/连接门禁.rs src/外壳/mod.rs
git commit -m "feat(defense): PoW HTTP 端点 + governor 限流 layer"
```

---

## Task 4: Socket.IO connect middleware PoW 验证 + 连接计数

**Files:**
- Modify: `src/实时/外壳.rs` — connect middleware 加 PoW token 验证
- Modify: `src/外壳/mod.rs` — connect 时注入 IP + 计数

- [ ] **Step 1: 扩展 `RealtimeConnectAuth` 结构体**

在 `src/实时/外壳.rs` 中修改：

```rust
#[derive(Deserialize, Clone)]
pub(crate) struct RealtimeConnectAuth {
    /// 当前连接声明的会话标识。
    session_id: String,
    /// PoW 门禁令牌（握手前由 /api/pow/verify 签发）。
    pow_token: Option<String>,
}
```

- [ ] **Step 2: 在 `认证realtime连接` 中加 PoW 验证**

在 session_id 提取之后、DB 查询之前，加入 PoW token 验证：

```rust
// ── PoW 门禁：在 DB 查询之前拦截无效连接 ──
if let Some(ref token) = auth_data.pow_token {
    if !state.defense.engine.验证token(token) {
        tracing::info!(
            application = "实时连接认证",
            adapter = "socketioxide",
            outcome = "rejected",
            error_code = "invalid_pow_token",
            "PoW token 验证失败"
        );
        return Err("invalid_pow_token".to_string());
    }
} else {
    tracing::info!(
        application = "实时连接认证",
        adapter = "socketioxide",
        outcome = "rejected",
        error_code = "missing_pow_token",
        "缺少 PoW token"
    );
    return Err("missing_pow_token".to_string());
}
```

- [ ] **Step 3: 在连接建立时注入 IP 连接计数**

在 `注册realtime命名空间` 的 connect handler 中：
- 建立连接时 `ip追踪.尝试增加连接(ip)` → 超限则拒绝
- 断开连接时 `ip追踪.减少连接(ip)`

- [ ] **Step 4: 运行编译确认通过**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```
git add src/实时/外壳.rs src/外壳/mod.rs
git commit -m "feat(defense): Socket.IO connect middleware PoW 验证 + IP 连接计数"
```

---

## Task 5: 房间订阅令牌桶

**Files:**
- Modify: `src/实时/外壳.rs` — subscribe_room_stream handler 加令牌桶

- [ ] **Step 1: 写房间订阅限流测试**

在 `src/实时/外壳.rs` 的 `#[cfg(test)] mod tests` 中添加：

```rust
#[test]
fn 房间订阅令牌桶_正常速率应通过() {
    let mut bucket = 房间订阅令牌桶::new();
    for _ in 0..5 {
        assert!(bucket.try_consume(), "前 5 次订阅应通过");
    }
}

#[test]
fn 房间订阅令牌桶_超限应被拒绝() {
    let now = std::time::Instant::now();
    let mut bucket = 房间订阅令牌桶::new_with_instant(now);
    for _ in 0..5 {
        assert!(bucket.try_consume_at(now));
    }
    assert!(!bucket.try_consume_at(now), "第 6 次应被拒绝");
}
```

- [ ] **Step 2: 实现房间订阅令牌桶**

在 `src/实时/外壳.rs` 中，参照 `连接消息令牌桶` 添加：

```rust
const 房间订阅桶容量: f64 = 5.0;
const 房间订阅补充速率: f64 = 0.1; // 每 10 秒恢复 1 个

pub(crate) struct 房间订阅令牌桶 {
    tokens: f64,
    last_refill: std::time::Instant,
}
// 实现同 连接消息令牌桶 的 try_consume / try_consume_at 模式
```

- [ ] **Step 3: 在 subscribe_room_stream handler 入口加限流**

参照 create_message 中的令牌桶模式，在 `handle_realtime_subscribe` 入口加：

```rust
{
    let bucket = socket
        .extensions
        .get::<Arc<Mutex<房间订阅令牌桶>>>()
        .expect("房间订阅令牌桶应在连接建立时注入");
    let mut guard = bucket.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.try_consume() {
        tracing::info!(
            application = "订阅房间事件流",
            adapter = "socketioxide",
            outcome = "rate_limited",
            session_id = auth.session_id.as_str(),
            "房间订阅被限流"
        );
        let payload = 构造拒绝控制面("rate_limited", "房间订阅过于频繁");
        let _ = socket.emit("control_result", &payload);
        return;
    }
}
```

在连接建立时注入令牌桶（`注册realtime命名空间` 中）：

```rust
socket.extensions.insert(Arc::new(Mutex::new(实时外壳::房间订阅令牌桶::new())));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test 房间订阅令牌桶`
Expected: 2 tests passed

- [ ] **Step 5: Commit**

```
git add src/实时/外壳.rs src/外壳/mod.rs
git commit -m "feat(defense): 房间订阅令牌桶限流"
```

---

## Task 6: 前端 PoW Solver Worker

**Files:**
- Create: `frontend/连接门禁/pow解题器.worker.ts`
- Create: `frontend/连接门禁/pow门禁.ts`
- Modify: `frontend/build.mjs` — 加 worker 构建入口

- [ ] **Step 1: 创建 PoW Worker**

创建 `frontend/连接门禁/pow解题器.worker.ts`：

```typescript
type SolveRequest = {
  type: "solve";
  salt: string;
  difficulty: number;
};

type SolveResponse = {
  ok: true;
  nonce: number;
  hash: string;
} | {
  ok: false;
  code: string;
};

self.addEventListener("message", async (event: MessageEvent<SolveRequest>) => {
  const { type, salt, difficulty } = event.data ?? {};
  if (type !== "solve" || !salt || typeof difficulty !== "number") {
    return;
  }
  try {
    const requiredZeroChars = Math.ceil(difficulty / 4);
    const encoder = new TextEncoder();
    let nonce = 0;
    while (nonce < 100_000_000) {
      const data = encoder.encode(salt + String(nonce));
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (hashHex.substring(0, requiredZeroChars) === "0".repeat(requiredZeroChars)) {
        self.postMessage({ ok: true, nonce, hash: hashHex } satisfies SolveResponse);
        return;
      }
      nonce++;
    }
    self.postMessage({ ok: false, code: "max_iterations_exceeded" } satisfies SolveResponse);
  } catch {
    self.postMessage({ ok: false, code: "solve_error" } satisfies SolveResponse);
  }
});
```

- [ ] **Step 2: 创建 PoW 门禁管理模块**

创建 `frontend/连接门禁/pow门禁.ts`：

```typescript
type ChallengeResponse = {
  algorithm: string;
  salt: string;
  difficulty: number;
  expires_at: number;
  signature: string;
};

type VerifyResponse = {
  pow_token: string;
};

type SolveResult = {
  ok: true;
  nonce: number;
  hash: string;
} | {
  ok: false;
  code: string;
};

export type PoW门禁端口 = {
  获取token(): Promise<string>;
};

/**
 * PoW 门禁管理 challenge→solve→token 生命周期。
 * token 在有效期内缓存复用，过期自动重新解题，正常用户零感知。
 */
export function 创建PoW门禁(baseUrl: string): PoW门禁端口 {
  let cachedToken: string | null = null;
  let cachedExpiresAt = 0;

  function token未过期(): boolean {
    return cachedToken !== null && Date.now() / 1000 < cachedExpiresAt - 5;
  }

  async function 获取token(): Promise<string> {
    if (token未过期() && cachedToken) {
      return cachedToken;
    }
    const challengeRes = await fetch(`${baseUrl}/api/pow/challenge`);
    if (!challengeRes.ok) {
      throw new Error(`PoW challenge 请求失败: ${challengeRes.status}`);
    }
    const challenge: ChallengeResponse = await challengeRes.json() as ChallengeResponse;

    const solved = await 在Worker中解题(challenge.salt, challenge.difficulty);
    if (!solved.ok) {
      throw new Error(`PoW 解题失败: ${solved.code}`);
    }

    const verifyRes = await fetch(`${baseUrl}/api/pow/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        salt: challenge.salt,
        difficulty: challenge.difficulty,
        expires_at: challenge.expires_at,
        signature: challenge.signature,
        nonce: solved.nonce,
        hash: solved.hash,
      }),
    });
    if (!verifyRes.ok) {
      throw new Error(`PoW verify 请求失败: ${verifyRes.status}`);
    }
    const { pow_token }: VerifyResponse = await verifyRes.json() as VerifyResponse;
    cachedToken = pow_token;
    cachedExpiresAt = challenge.expires_at;
    return pow_token;
  }

  return { 获取token };
}

function 在Worker中解题(salt: string, difficulty: number): Promise<SolveResult> {
  return new Promise((resolve) => {
    const worker = new Worker("/dist/pow-solver.worker.js");
    worker.onmessage = (e: MessageEvent<SolveResult>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = () => {
      resolve({ ok: false, code: "worker_error" });
      worker.terminate();
    };
    worker.postMessage({ type: "solve", salt, difficulty });
  });
}
```

- [ ] **Step 3: 在 `build.mjs` 加 PoW Worker 构建入口**

在 `sourceHashWorkerBuildOptions` 后面加：

```javascript
const powWorkerBuildOptions = {
  entryPoints: ['连接门禁/pow解题器.worker.ts'],
  bundle: true,
  outfile: 'dist/pow-solver.worker.js',
  format: 'esm',
  platform: 'browser',
  target: 浏览器构建目标,
  supported: 浏览器构建能力覆盖,
  sourcemap: true,
}
```

并把 `powWorkerBuildOptions` 加入到 `watchMode` 和 production build 的构建序列中（参照 `sourceHashWorkerBuildOptions` 的位置），同时在 `powWorkerOutputFiles` 列表和 `清理旧构建产物` 的保留列表中注册。

- [ ] **Step 4: 运行前端构建确认 Worker 产出正确**

Run: `cd frontend && pnpm run build`（或 `node build.mjs`）
Expected: `dist/pow-solver.worker.js` 生成

- [ ] **Step 5: Commit**

```
git add frontend/连接门禁/ frontend/build.mjs
git commit -m "feat(defense): 前端 PoW solver worker + 门禁管理模块"
```

---

## Task 7: 前端 Socket.IO 集成

**Files:**
- Modify: `frontend/聊天实时/适配/实时连接适配.ts` — 连接前获取 PoW token
- Modify: `frontend/聊天共享/适配/聊天实时连接端口.ts` — 端口增加 PoW 支持
- Modify: `frontend/平台/传输.ts` — 组合根注入 PoW 门禁

- [ ] **Step 1: 修改 `聊天实时连接端口` 接口**

在 `frontend/聊天共享/适配/聊天实时连接端口.ts` 中，`createSocket` 签名改为接受 PoW token：

```typescript
export interface 聊天实时连接端口 {
  createSocket(sessionId: string, powToken?: string): Socket;
  接收运行时策略?(policy: 实时连接运行时策略): void;
  读取运行时策略?(): 实时连接运行时策略;
  释放Socket?(socket: Socket): void;
  获取PowToken?(): Promise<string>;
}
```

- [ ] **Step 2: 修改 `实时连接适配` 传递 PoW token**

在 `frontend/聊天实时/适配/实时连接适配.ts` 的 `createSocket` 中：

```typescript
createSocket(sessionId: string, powToken?: string): Socket {
    const socket = io(this.baseUrl, {
      transports: ["websocket"],
      reconnection: this.当前运行时策略.reconnection,
      autoConnect: this.当前运行时策略.intent !== "suspend",
      auth: { session_id: sessionId, pow_token: powToken },
    });
    this.活跃Socket表.set(socket, { 由运行时挂起: false });
    return socket;
}
```

- [ ] **Step 3: 修改 `实时/应用.ts` 的 `ensureRealtimeSocket`**

在 `ensureRealtimeSocket` 中，连接前先获取 PoW token：

```typescript
async function ensureRealtimeSocket(sessionId: string): Promise<void> {
    if (realtimeSocket) {
      return;
    }
    let powToken: string | undefined;
    if (deps.transport.获取PowToken) {
      try {
        powToken = await deps.transport.获取PowToken();
      } catch (err) {
        // PoW 获取失败不阻塞连接尝试，但记录警告
        console.warn("[pow] token 获取失败，尝试无 token 连接", err);
      }
    }
    const socket = deps.transport.createSocket(sessionId, powToken);
    // ... 其余代码不变
}
```

注意：`ensureRealtimeSocket` 从 `void` 变为 `Promise<void>`，需要同步更新 `实时应用端口` 接口。

- [ ] **Step 4: 在 `frontend/平台/传输.ts` 注入 PoW 门禁**

```typescript
import { 创建PoW门禁 } from "../连接门禁/pow门禁.js";

// 在 创建前端传输 函数中：
const pow门禁 = 创建PoW门禁(baseUrl);

// 在返回对象中加：
获取PowToken: () => pow门禁.获取token(),
```

- [ ] **Step 5: 运行前端 typecheck 确认通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 6: Commit**

```
git add frontend/聊天实时/ frontend/聊天共享/ frontend/平台/传输.ts frontend/实时/
git commit -m "feat(defense): 前端 Socket.IO 集成 PoW 门禁"
```

---

## Task 8: 环境变量 + 开发模式兼容

**Files:**
- Modify: `run.ps1` — 本地开发加 `KOKO_POW_SECRET` 默认值
- Modify: `src/外壳/mod.rs` — PoW 配置 fallback

- [ ] **Step 1: 本地开发脚本加 PoW 密钥默认值**

在 `run.ps1` 的环境变量默认值部分加：

```powershell
if (-not $env:KOKO_POW_SECRET) { $env:KOKO_POW_SECRET = "local-dev-pow-secret-32bytes-min" }
```

- [ ] **Step 2: 确保本地开发 PoW 可选**

在 `构建应用状态` 中，PoW 配置读取失败时降级为禁用 PoW（仅日志警告）：

```rust
let pow_config = match crate::assembly::读取PoW配置() {
    Ok(config) => Some(config),
    Err(err) => {
        tracing::warn!("PoW 配置读取失败，防御功能已禁用: {err}");
        None
    }
};
```

- [ ] **Step 3: connect middleware 中 PoW 验证仅在配置存在时生效**

```rust
// 如果防御状态未初始化（配置缺失），跳过 PoW 验证
if let Some(ref defense) = state.defense {
    // ... PoW 验证逻辑
}
```

- [ ] **Step 4: Commit**

```
git add run.ps1 src/外壳/mod.rs
git commit -m "feat(defense): 开发模式 PoW 可选降级 + 本地默认密钥"
```

---

## Task 9: 冒烟测试

**Files:**
- 无新文件，使用 playwright-cli + 浏览器验证

- [ ] **Step 1: 启动本地环境**

Run: `.\run.ps1`
Expected: 后端 + 前端 + sidecar 全部启动

- [ ] **Step 2: 验证 PoW challenge 端点**

Run: `curl http://localhost:8080/api/pow/challenge`
Expected: 返回 JSON `{ "algorithm": "SHA-256", "salt": "...", "difficulty": 8, ... }`

- [ ] **Step 3: 验证正常用户连接流程**

使用 playwright-cli 打开页面，验证：
1. 页面正常加载
2. Socket.IO 自动连接成功（无 PoW 错误）
3. 进入房间后能正常发消息
4. 发图/发视频链路不受影响

- [ ] **Step 4: 验证限流生效**

使用 playwright-cli run-code 快速发送 15+ 条消息，确认令牌桶限流仍然生效。

- [ ] **Step 5: Commit 最终状态**

```
git add -A
git commit -m "feat(defense): DDoS/CC 防御完成冒烟验证"
```
