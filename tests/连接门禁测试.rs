use koko::shell::连接门禁::{PoWChallenge, PoW引擎, PoW验证结果, Ip追踪器, 访客计数器};
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PoW 引擎核心测试
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TEST_SECRET: &[u8] = b"test-secret-must-be-32-bytes-long";

#[test]
fn 合法解题应通过验证() {
    let engine = PoW引擎::new(TEST_SECRET, 1);
    let challenge = engine.生成challenge(Duration::from_secs(30));
    // 模拟客户端暴力解题（difficulty=1 → 1 个前导零十六进制字符 → ~16 次内解出）
    let mut nonce: u64 = 0;
    loop {
        let hash = engine.计算hash(&challenge.salt, nonce);
        if engine.满足难度(&hash, challenge.difficulty) {
            let result = engine.验证solution(&challenge, nonce, &hash);
            assert!(matches!(result, PoW验证结果::通过 { .. }), "合法解题应通过");
            break;
        }
        nonce += 1;
        assert!(nonce < 100_000, "difficulty=1 应在十万次内解出");
    }
}

#[test]
fn 过期challenge应被拒绝() {
    let engine = PoW引擎::new(TEST_SECRET, 1);
    let mut challenge = engine.生成challenge(Duration::from_secs(30));
    // 强制过期：把 expires_at 设为过去
    challenge.expires_at = 0;
    // expires_at 被改了但签名没重签 → 签名不匹配 → 拒绝
    let result = engine.验证solution(&challenge, 0, "fake");
    assert!(matches!(result, PoW验证结果::签名无效), "篡改 expires_at 应导致签名无效");
}

#[test]
fn 篡改签名应被拒绝() {
    let engine = PoW引擎::new(TEST_SECRET, 1);
    let mut challenge = engine.生成challenge(Duration::from_secs(30));
    challenge.signature = "tampered_signature_hex".to_string();
    let result = engine.验证solution(&challenge, 0, "fake");
    assert!(matches!(result, PoW验证结果::签名无效), "篡改签名应被拒绝");
}

#[test]
fn 错误nonce应被拒绝() {
    let engine = PoW引擎::new(TEST_SECRET, 2);
    let challenge = engine.生成challenge(Duration::from_secs(30));
    // 提交一个不满足难度的 hash
    let wrong_hash = engine.计算hash(&challenge.salt, 99999999);
    if !engine.满足难度(&wrong_hash, challenge.difficulty) {
        let result = engine.验证solution(&challenge, 99999999, &wrong_hash);
        assert!(matches!(result, PoW验证结果::解题错误), "不满足难度应被拒绝");
    }
}

#[test]
fn token签发后应能验证通过() {
    let engine = PoW引擎::new(TEST_SECRET, 1);
    let challenge = engine.生成challenge(Duration::from_secs(30));
    let mut nonce: u64 = 0;
    loop {
        let hash = engine.计算hash(&challenge.salt, nonce);
        if engine.满足难度(&hash, challenge.difficulty) {
            if let PoW验证结果::通过 { pow_token } =
                engine.验证solution(&challenge, nonce, &hash)
            {
                assert!(engine.验证token(&pow_token), "签发的 token 应能验证通过");
                break;
            }
        }
        nonce += 1;
    }
}

#[test]
fn 伪造token应被拒绝() {
    let engine = PoW引擎::new(TEST_SECRET, 1);
    assert!(!engine.验证token("fake.token"), "伪造 token 应被拒绝");
    assert!(!engine.验证token(""), "空 token 应被拒绝");
    assert!(!engine.验证token("9999999999.0000"), "伪造签名应被拒绝");
    assert!(!engine.验证token("not-a-number.abcd"), "非数字过期时间应被拒绝");
}

#[test]
fn 不同密钥签发的token不互认() {
    let engine_a = PoW引擎::new(b"secret-a-must-be-32-bytes-long!!", 1);
    let engine_b = PoW引擎::new(b"secret-b-must-be-32-bytes-long!!", 1);
    let challenge = engine_a.生成challenge(Duration::from_secs(30));
    let mut nonce: u64 = 0;
    loop {
        let hash = engine_a.计算hash(&challenge.salt, nonce);
        if engine_a.满足难度(&hash, challenge.difficulty) {
            if let PoW验证结果::通过 { pow_token } =
                engine_a.验证solution(&challenge, nonce, &hash)
            {
                assert!(!engine_b.验证token(&pow_token), "不同密钥的 token 不应互认");
                break;
            }
        }
        nonce += 1;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 满足难度测试
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn 满足难度_边界条件() {
    let engine = PoW引擎::new(TEST_SECRET, 1);
    // difficulty=2 → 需要 2 个前导零十六进制字符
    assert!(engine.满足难度("00abcdef", 2));
    assert!(!engine.满足难度("0fabcdef", 2));
    assert!(engine.满足难度("0abcdef0", 1));
    assert!(!engine.满足难度("fabcdef0", 1));
    // difficulty=0 → 不需要前导零
    assert!(engine.满足难度("anything", 0));
    // 空字符串
    assert!(!engine.满足难度("", 1));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 访客计数器测试
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn 访客计数器_递增应返回递增值() {
    let counter = 访客计数器::new();
    let first = counter.递增();
    let second = counter.递增();
    assert!(second > first, "第二次递增应大于第一次");
}

#[test]
fn 访客计数器_低负载应返回最低难度() {
    let counter = 访客计数器::new();
    // 不递增，计数为 0
    let difficulty = counter.当前难度();
    assert_eq!(difficulty, 2, "零负载应返回最低难度 2");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IP 追踪器测试
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn ip追踪器_连接计数基本流程() {
    let tracker = Ip追踪器::new();
    let ip: IpAddr = IpAddr::V4(Ipv4Addr::new(1, 2, 3, 4));
    assert!(tracker.尝试增加连接(ip), "首次连接应成功");
    assert!(tracker.尝试增加连接(ip), "第二次连接应成功");
    tracker.减少连接(&ip);
    tracker.减少连接(&ip);
    // 连接归零后条目应被清理
    assert_eq!(tracker.条目数(), 0, "连接归零后应清理条目");
}

#[test]
fn ip追踪器_超过单ip上限应拒绝() {
    let tracker = Ip追踪器::new();
    let ip: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
    for i in 0..50 {
        assert!(tracker.尝试增加连接(ip), "第 {} 次连接应成功", i + 1);
    }
    assert!(!tracker.尝试增加连接(ip), "第 51 次连接应被拒绝");
}

#[test]
fn ip追踪器_冷却机制() {
    let tracker = Ip追踪器::new();
    let ip: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1));
    assert!(!tracker.已冷却(&ip), "初始状态不应在冷却期");
    // 记录 5 次失败触发冷却
    for _ in 0..5 {
        tracker.记录失败(ip);
    }
    assert!(tracker.已冷却(&ip), "5 次失败后应触发冷却");
}

#[test]
fn ip追踪器_成功后重置失败计数() {
    let tracker = Ip追踪器::new();
    let ip: IpAddr = IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1));
    // 记录 4 次失败（不到阈值）
    for _ in 0..4 {
        tracker.记录失败(ip);
    }
    assert!(!tracker.已冷却(&ip), "4 次失败不应触发冷却");
    // 成功后重置
    tracker.重置失败(&ip);
    // 再记录 4 次失败仍不应触发冷却
    for _ in 0..4 {
        tracker.记录失败(ip);
    }
    assert!(!tracker.已冷却(&ip), "重置后再 4 次失败不应触发冷却");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 真实 IP 提取测试
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[test]
fn 提取客户端ip_信任代理时读取xff() {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        "x-forwarded-for",
        "203.0.113.50, 70.41.3.18".parse().unwrap(),
    );
    let peer = Some(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
    let ip = koko::shell::连接门禁::提取客户端ip(&headers, peer, true);
    assert_eq!(
        ip,
        Some(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50))),
        "应提取 X-Forwarded-For 最左侧 IP"
    );
}

#[test]
fn 提取客户端ip_不信任代理时回退peer() {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        "x-forwarded-for",
        "203.0.113.50".parse().unwrap(),
    );
    let peer = Some(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)));
    let ip = koko::shell::连接门禁::提取客户端ip(&headers, peer, false);
    assert_eq!(
        ip,
        Some(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))),
        "不信任代理时应回退到 peer_addr"
    );
}
