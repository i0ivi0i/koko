//! DDoS/CC 纵深防御：自适应 PoW 门禁 + IP 追踪 + HTTP 限流端点。
//!
//! 设计原则：
//! 1. 纯 adapter 层——不承载业务语义，domain/application 零感知。
//! 2. 无状态 PoW：challenge 和 token 靠 HMAC 自验证，不存服务端状态、零 DB 查询。
//! 3. 自适应难度：30 秒滑动窗口计数器，纯原子操作，零锁竞争。
//! 4. IP 追踪用 DashMap 并发映射，被攻击时不退化成全局锁瓶颈。
//! 5. 正常用户零感知：低负载时 difficulty 极低（~20ms 解题），高负载时攻击者成本指数增长。

use axum::{extract::State, http::StatusCode, Json};
use dashmap::DashMap;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    net::IpAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// HMAC-SHA256 类型别名，用于 challenge 签名和 token 签发。
type HmacSha256 = Hmac<Sha256>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 自适应难度
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// 30 秒窗口内的握手请求数 → difficulty（SHA-256 前导零十六进制字符数）。
/// difficulty 越高，客户端解题越慢，攻击者成本指数增长。
/// 每多 1 个前导零字符 = 难度 ×16。
const 难度级别: &[(u64, u8)] = &[
    (50, 2),        // < 50 请求/30s: 2 个前导零 → ~几毫秒
    (500, 3),       // 50-500: 3 个前导零 → ~几十毫秒
    (5000, 4),      // 500-5000: 4 个前导零 → ~几百毫秒
    (u64::MAX, 5),  // > 5000: 5 个前导零 → ~几秒
];

/// 滑动窗口访客计数器：30 秒一轮，纯原子操作。
/// 被攻击时不会退化成全局锁瓶颈。
pub struct 访客计数器 {
    /// 当前窗口内的请求计数。
    当前计数: AtomicU64,
    /// 当前窗口起始时间戳（秒）。
    窗口起点秒: AtomicU64,
}

impl 访客计数器 {
    pub fn new() -> Self {
        Self {
            当前计数: AtomicU64::new(0),
            窗口起点秒: AtomicU64::new(当前时间戳秒()),
        }
    }

    /// 记录一次访客并返回当前窗口计数。
    pub fn 递增(&self) -> u64 {
        let now = 当前时间戳秒();
        let window_start = self.窗口起点秒.load(Ordering::Relaxed);
        // 窗口已过期，尝试翻窗口并重置计数。
        // compare_exchange 失败说明别的线程已翻窗口了，直接递增即可。
        if now.saturating_sub(window_start) >= 30 {
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

    /// 根据当前窗口访客数选择 difficulty（前导零十六进制字符数）。
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PoW 引擎（无状态）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// challenge 数据包：发给客户端的解题参数。
/// 所有字段对客户端透明，但 signature 防篡改。
#[derive(Clone, Debug)]
pub struct PoWChallenge {
    /// 随机盐值（hex 编码的 UUID）。
    pub salt: String,
    /// 要求的前导零十六进制字符数。
    pub difficulty: u8,
    /// UNIX 时间戳（秒），超过即过期。
    pub expires_at: u64,
    /// HMAC-SHA256(secret, salt + difficulty + expires_at) 的 hex 编码。
    pub signature: String,
}

/// PoW 解题验证结果。
pub enum PoW验证结果 {
    /// 验证通过，附带签发的短命 token。
    通过 { pow_token: String },
    /// challenge 已过期。
    过期,
    /// HMAC 签名不匹配（challenge 被篡改）。
    签名无效,
    /// 提交的 hash 不满足 difficulty 或与 nonce 不对应。
    解题错误,
}

/// 无状态 PoW 引擎：靠 HMAC 自验证，服务端不存任何 challenge 状态。
/// 生命周期与进程一致，secret 从环境变量加载后不再变更。
pub struct PoW引擎 {
    /// HMAC-SHA256 签名密钥。
    secret: Vec<u8>,
    /// 默认 difficulty（低负载时使用）。
    default_difficulty: u8,
}

impl PoW引擎 {
    pub fn new(secret: &[u8], default_difficulty: u8) -> Self {
        Self {
            secret: secret.to_vec(),
            default_difficulty,
        }
    }

    /// 用默认 difficulty 生成 challenge。
    pub fn 生成challenge(&self, ttl: Duration) -> PoWChallenge {
        self.生成challenge_with_difficulty(self.default_difficulty, ttl)
    }

    /// 用指定 difficulty 生成 challenge，附带 HMAC 签名防篡改。
    #[allow(non_snake_case)]
    pub fn 生成challenge_with_difficulty(&self, difficulty: u8, ttl: Duration) -> PoWChallenge {
        let salt = hex::encode(uuid::Uuid::new_v4().as_bytes());
        let expires_at = 当前时间戳秒() + ttl.as_secs();
        let signature = self.签名challenge(&salt, difficulty, expires_at);
        PoWChallenge {
            salt,
            difficulty,
            expires_at,
            signature,
        }
    }

    /// HMAC-SHA256(secret, salt + difficulty + expires_at) → hex。
    /// 这是 challenge 防篡改的唯一校验点。
    fn 签名challenge(&self, salt: &str, difficulty: u8, expires_at: u64) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC 密钥长度不应被拒绝");
        mac.update(salt.as_bytes());
        mac.update(&[difficulty]);
        mac.update(&expires_at.to_be_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    /// 计算 SHA-256(salt + nonce) → hex，与前端 SubtleCrypto 算法完全对齐。
    pub fn 计算hash(&self, salt: &str, nonce: u64) -> String {
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(nonce.to_string().as_bytes());
        hex::encode(hasher.finalize())
    }

    /// 检查 hash 是否满足 difficulty 个前导零十六进制字符。
    pub fn 满足难度(&self, hash_hex: &str, difficulty: u8) -> bool {
        let required = difficulty as usize;
        hash_hex.len() >= required && hash_hex[..required].bytes().all(|b| b == b'0')
    }

    /// 验证客户端提交的 solution：签名→过期→解题→签发 token。
    pub fn 验证solution(
        &self,
        challenge: &PoWChallenge,
        nonce: u64,
        submitted_hash: &str,
    ) -> PoW验证结果 {
        // 1. 验签名：拒绝被篡改的 challenge
        let expected_sig =
            self.签名challenge(&challenge.salt, challenge.difficulty, challenge.expires_at);
        if challenge.signature != expected_sig {
            return PoW验证结果::签名无效;
        }
        // 2. 验过期：拒绝超时 challenge
        if 当前时间戳秒() > challenge.expires_at {
            return PoW验证结果::过期;
        }
        // 3. 验解题：重算 hash 并检查 difficulty
        let actual_hash = self.计算hash(&challenge.salt, nonce);
        if actual_hash != submitted_hash || !self.满足难度(&actual_hash, challenge.difficulty) {
            return PoW验证结果::解题错误;
        }
        // 4. 签发短命 pow_token
        let token = self.签发token(challenge.expires_at);
        PoW验证结果::通过 { pow_token: token }
    }

    /// 签发 PoW token：格式为 `{expires_at}.{hmac_hex}`。
    /// Socket.IO connect middleware 用此 token 做零 DB 连接门禁。
    fn 签发token(&self, expires_at: u64) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC 密钥长度不应被拒绝");
        mac.update(b"pow_token");
        mac.update(&expires_at.to_be_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        format!("{expires_at}.{sig}")
    }

    /// 验证 pow_token 是否合法且未过期。
    /// 验证开销：一次 HMAC 计算 + 一次字符串比较，微秒级。
    pub fn 验证token(&self, token: &str) -> bool {
        let Some((expires_str, sig)) = token.split_once('.') else {
            return false;
        };
        let Ok(expires_at) = expires_str.parse::<u64>() else {
            return false;
        };
        if 当前时间戳秒() > expires_at {
            return false;
        }
        let expected = self.签发token(expires_at);
        let expected_sig = expected.split_once('.').map(|(_, s)| s).unwrap_or("");
        // 恒等时间比较不是必须的（token 不是密码），但 sig 长度固定可直接比较。
        sig == expected_sig
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IP 追踪与自动冷却
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// 单 IP 的运行态追踪：连接数 + 连续失败次数 + 冷却截止时间。
struct Ip状态 {
    /// 当前活跃 WebSocket 连接数。
    连接数: u32,
    /// 连续 PoW 验证失败次数（成功后重置）。
    失败次数: u32,
    /// UNIX 时间戳（秒），在此之前所有请求直接拒绝。
    冷却截止秒: u64,
}

/// 并发安全的 IP 追踪器：连接计数、失败追踪、自动冷却。
/// 用 DashMap 做无全局锁的 IP→状态映射，被攻击时不会成为瓶颈。
pub struct Ip追踪器 {
    /// IP → 运行态映射表。
    表: DashMap<IpAddr, Ip状态>,
    /// 单 IP 最大 WebSocket 连接数。
    单ip最大连接数: u32,
    /// 连续失败多少次后触发冷却。
    失败冷却阈值: u32,
    /// 冷却持续时长（秒）。
    冷却时长秒: u64,
}

impl Ip追踪器 {
    pub fn new() -> Self {
        Self {
            表: DashMap::new(),
            单ip最大连接数: 50,
            失败冷却阈值: 5,
            冷却时长秒: 60,
        }
    }

    /// 检查 IP 是否在冷却期（所有请求直接拒绝）。
    pub fn 已冷却(&self, ip: &IpAddr) -> bool {
        self.表
            .get(ip)
            .map(|s| 当前时间戳秒() < s.冷却截止秒)
            .unwrap_or(false)
    }

    /// 尝试增加连接计数。超过单 IP 上限返回 false。
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

    /// 减少连接计数（WebSocket 断开时调用）。
    /// 连接归零且不在冷却期时自动清理条目，避免内存泄漏。
    pub fn 减少连接(&self, ip: &IpAddr) {
        if let Some(mut entry) = self.表.get_mut(ip) {
            entry.连接数 = entry.连接数.saturating_sub(1);
            if entry.连接数 == 0 && 当前时间戳秒() >= entry.冷却截止秒 && entry.失败次数 == 0 {
                drop(entry);
                self.表.remove(ip);
            }
        }
    }

    /// 记录一次 PoW 验证失败。达到阈值后触发冷却（该 IP 所有请求直接拒绝）。
    pub fn 记录失败(&self, ip: IpAddr) {
        let mut entry = self.表.entry(ip).or_insert_with(|| Ip状态 {
            连接数: 0,
            失败次数: 0,
            冷却截止秒: 0,
        });
        entry.失败次数 += 1;
        if entry.失败次数 >= self.失败冷却阈值 {
            entry.冷却截止秒 = 当前时间戳秒() + self.冷却时长秒;
        }
    }

    /// PoW 验证成功后重置失败计数。
    pub fn 重置失败(&self, ip: &IpAddr) {
        if let Some(mut entry) = self.表.get_mut(ip) {
            entry.失败次数 = 0;
        }
    }

    /// 当前追踪条目数（监控/日志用）。
    pub fn 条目数(&self) -> usize {
        self.表.len()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 真实 IP 提取
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// 从请求头提取客户端真实 IP。
/// trusted_proxy=true 时读 X-Forwarded-For 最左侧（第一跳客户端 IP）。
/// 否则回退到 TCP peer_addr（直连场景）。
pub fn 提取客户端ip(
    headers: &axum::http::HeaderMap,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP 端点 + 防御共享状态
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// 防御共享状态：引擎 + 访客计数 + IP 追踪。
/// 这是纯 adapter 层运行态，不混入业务状态。
#[derive(Clone)]
pub struct 防御状态 {
    /// PoW 引擎（无状态，靠 HMAC 自验证）。
    pub engine: Arc<PoW引擎>,
    /// 30 秒滑动窗口访客计数器（决定自适应难度）。
    pub 访客: Arc<访客计数器>,
    /// IP 连接计数 + 失败追踪 + 自动冷却。
    pub ip追踪: Arc<Ip追踪器>,
    /// 是否信任反代 X-Forwarded-For。
    pub trusted_proxy: bool,
}

/// GET /api/pow/challenge 响应体。
#[derive(Serialize)]
pub(crate) struct ChallengeResponse {
    /// 固定 "SHA-256"，客户端据此选择解题算法。
    pub algorithm: &'static str,
    /// 随机盐值。
    pub salt: String,
    /// 要求的前导零十六进制字符数。
    pub difficulty: u8,
    /// challenge 过期时间戳（UNIX 秒）。
    pub expires_at: u64,
    /// HMAC 签名，客户端必须原样回传。
    pub signature: String,
}

/// POST /api/pow/verify 请求体。
#[derive(Deserialize)]
pub(crate) struct VerifyRequest {
    pub salt: String,
    pub difficulty: u8,
    pub expires_at: u64,
    pub signature: String,
    pub nonce: u64,
    pub hash: String,
}

/// POST /api/pow/verify 响应体。
#[derive(Serialize)]
pub(crate) struct VerifyResponse {
    /// 短命 PoW token，客户端在 Socket.IO auth 中携带。
    pub pow_token: String,
}

/// GET /api/pow/challenge — 签发自适应难度的 PoW challenge。
/// 开销：一次原子递增 + 一次 HMAC 签名，微秒级。
pub(crate) async fn handle_pow_challenge(
    State(defense): State<防御状态>,
) -> Json<ChallengeResponse> {
    // 先递增访客计数（用于自适应难度），再取当前难度。
    defense.访客.递增();
    let difficulty = defense.访客.当前难度();
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

/// POST /api/pow/verify — 验证客户端 PoW solution 并签发 token。
/// 开销：一次 HMAC 验签 + 一次 SHA-256 + 一次 HMAC 签发，微秒级。
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 工具函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// 当前 UNIX 时间戳（秒），所有时间比较统一走这个入口。
fn 当前时间戳秒() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
