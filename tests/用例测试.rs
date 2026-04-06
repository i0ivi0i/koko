use serial_test::serial;
use std::collections::{HashMap, HashSet};
use std::io;
use std::sync::{Arc, Mutex};

/// 用例层测试：
/// - 用假仓储隔离数据库细节
/// - 验证用例编排、契约输出和日志字段约束
#[test]
#[serial]
fn 结构化日志字段存在且包含outcome() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();

    tracing::subscriber::with_default(subscriber, || {
        koko::entry::记录命令失败("测试用例", "test_adapter", "bad_request", "示例错误");
    });

    let output = 读取缓冲日志(&buffer);
    assert!(
        output.contains("usecase") && output.contains("测试用例"),
        "日志缺少 usecase 字段: {output}"
    );
    assert!(
        output.contains("adapter") && output.contains("test_adapter"),
        "日志缺少 adapter 字段: {output}"
    );
    assert!(
        output.contains("error_code") && output.contains("bad_request"),
        "日志缺少 error_code 字段: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("failed"),
        "日志缺少 outcome=failed 字段: {output}"
    );
}

#[test]
#[serial]
fn panic_hook会把panic写入统一日志主链() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();

    tracing::subscriber::set_global_default(subscriber).expect("测试进程内应能安装全局 subscriber");
    koko::assembly::安装panic日志钩子();

    let _ = std::panic::catch_unwind(|| panic!("测试 panic"));

    let output = 读取缓冲日志(&buffer);
    assert!(
        output.contains("adapter") && output.contains("panic_hook"),
        "panic 日志缺少 adapter=panic_hook: {output}"
    );
    assert!(
        output.contains("error_code") && output.contains("panic"),
        "panic 日志缺少 error_code=panic: {output}"
    );
    assert!(
        output.contains("outcome") && output.contains("failed"),
        "panic 日志缺少 outcome=failed: {output}"
    );
}

#[test]
#[serial]
fn http日志固定字段顺序里能看到usecase_adapter_outcome() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();

    tracing::subscriber::with_default(subscriber, || {
        tracing::info!(
            usecase = "引导匿名身份",
            adapter = "http",
            outcome = "accepted",
            request_kind = "bootstrap_session",
            "HTTP 请求已受理"
        );
    });

    let output = 读取缓冲日志(&buffer);
    let usecase_pos = output.find("usecase").expect("应存在 usecase 字段");
    let adapter_pos = output.find("adapter").expect("应存在 adapter 字段");
    let outcome_pos = output.find("outcome").expect("应存在 outcome 字段");
    assert!(
        usecase_pos < adapter_pos && adapter_pos < outcome_pos,
        "日志字段顺序应便于先读 usecase / adapter / outcome: {output}"
    );
}

#[derive(Clone)]
struct 共享写入器(Arc<Mutex<Vec<u8>>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for 共享写入器 {
    type Writer = 缓冲写入器;

    fn make_writer(&'a self) -> Self::Writer {
        缓冲写入器(self.0.clone())
    }
}

struct 缓冲写入器(Arc<Mutex<Vec<u8>>>);

impl io::Write for 缓冲写入器 {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().expect("lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn 读取缓冲日志(buffer: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8(buffer.lock().expect("lock").clone()).expect("utf8")
}

#[derive(Default)]
struct 假仓储 {
    会话计数: usize,
    匿名身份计数: usize,
    房间计数: usize,
    消息计数: usize,
    最新位置: i64,
    房间短码到标识: HashMap<String, String>,
    房间成员: HashMap<String, HashSet<String>>,
    设备匿名身份: HashMap<String, koko::contract::匿名身份引导结果>,
}

impl koko::usecase::仓储端口 for 假仓储 {
    /// 假实现：同一设备凭证恢复同一个匿名身份与稳定会话。
    fn 引导匿名身份(
        &mut self,
        设备匿名凭证: &str,
    ) -> Result<koko::contract::匿名身份引导结果, koko::contract::错误码> {
        if let Some(existing) = self.设备匿名身份.get(设备匿名凭证) {
            return Ok(existing.clone());
        }

        self.匿名身份计数 += 1;
        self.会话计数 += 1;
        let snapshot = koko::contract::匿名身份引导结果 {
            匿名身份标识: format!("a-{}", self.匿名身份计数),
            展示花名: format!("暴躁的企鹅-{}", self.匿名身份计数),
            会话标识: format!("s-{}", self.会话计数),
        };
        self.设备匿名身份
            .insert(设备匿名凭证.to_string(), snapshot.clone());
        Ok(snapshot)
    }

    /// 假实现：按短码创建或复用房间，并写入成员关系。
    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<koko::contract::快照, koko::contract::错误码> {
        let room_id = if let Some(existing) = self.房间短码到标识.get(房间短码) {
            existing.clone()
        } else {
            self.房间计数 += 1;
            let created = format!("r-{}", self.房间计数);
            self.房间短码到标识
                .insert(房间短码.to_string(), created.clone());
            created
        };
        self.房间成员
            .entry(room_id.clone())
            .or_default()
            .insert(会话标识.to_string());
        Ok(koko::contract::快照::房间 {
            房间标识: room_id,
            最新事件位置: self.最新位置,
        })
    }

    /// 假实现：当前测试里，形如 `s-*` 的会话都视为已存在。
    fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, koko::contract::错误码> {
        Ok(会话标识.starts_with("s-"))
    }

    /// 假实现：成员资格查询。
    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, koko::contract::错误码> {
        Ok(self
            .房间成员
            .get(房间标识)
            .is_some_and(|set| set.contains(会话标识)))
    }

    /// 假实现：房间快照读取。
    fn 拉取房间快照(
        &self,
        房间标识: &str,
    ) -> Result<koko::contract::快照, koko::contract::错误码> {
        if self.房间成员.contains_key(房间标识) {
            Ok(koko::contract::快照::房间 {
                房间标识: 房间标识.to_string(),
                最新事件位置: self.最新位置,
            })
        } else {
            Err(koko::contract::错误码::房间不存在)
        }
    }

    /// 假实现：直接生成消息已创建事件并推进本地事件位置。
    fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<koko::contract::领域事件, koko::contract::错误码> {
        self.消息计数 += 1;
        self.最新位置 += 1;
        Ok(koko::contract::领域事件::消息已创建 {
            房间标识: 房间标识.to_string(),
            消息标识: format!("m-{}", self.消息计数),
            客户端消息标识: 客户端消息标识.to_string(),
            发送者会话标识: 会话标识.to_string(),
            发送者花名: "测试用户".to_string(),
            文本: 文本.to_string(),
            事件位置: self.最新位置,
        })
    }
}

#[test]
fn bootstrap匿名身份时设备凭证与花名不会混成同一个字段() {
    let snapshot = koko::contract::快照::匿名身份 {
        匿名身份标识: "a-1".to_string(),
        展示花名: "暴躁的企鹅".to_string(),
    };

    match snapshot {
        koko::contract::快照::匿名身份 {
            匿名身份标识,
            展示花名,
        } => {
            assert_eq!(匿名身份标识, "a-1");
            assert_eq!(展示花名, "暴躁的企鹅");
            assert_ne!(匿名身份标识, 展示花名, "内部身份与展示花名必须分开");
        }
        _ => panic!("应返回匿名身份快照"),
    }
}

#[test]
fn 未来改花名不应要求替换匿名内部身份() {
    let before = koko::contract::快照::匿名身份 {
        匿名身份标识: "a-stable".to_string(),
        展示花名: "暴躁的企鹅".to_string(),
    };
    let after = koko::contract::快照::匿名身份 {
        匿名身份标识: "a-stable".to_string(),
        展示花名: "冷静的企鹅".to_string(),
    };

    match (before, after) {
        (
            koko::contract::快照::匿名身份 {
                匿名身份标识: before_id,
                展示花名: before_alias,
            },
            koko::contract::快照::匿名身份 {
                匿名身份标识: after_id,
                展示花名: after_alias,
            },
        ) => {
            assert_eq!(before_id, after_id, "未来改花名时内部身份不能跟着变");
            assert_ne!(
                before_alias, after_alias,
                "测试前提错误：这里必须是花名变化"
            );
        }
        _ => panic!("应返回匿名身份快照"),
    }
}

#[test]
fn 同一设备匿名凭证重复bootstrap会恢复同一个内部身份与花名() {
    let mut repo = 假仓储::default();

    let first =
        koko::usecase::引导匿名身份(&mut repo, "device-token-1").expect("首次 bootstrap 应成功");
    let second =
        koko::usecase::引导匿名身份(&mut repo, "device-token-1").expect("重复 bootstrap 应成功");

    assert_eq!(
        first.匿名身份标识, second.匿名身份标识,
        "同一设备匿名凭证必须恢复同一个内部身份"
    );
    assert_eq!(
        first.展示花名, second.展示花名,
        "同一设备匿名凭证必须恢复同一个展示花名"
    );
    assert_eq!(
        first.会话标识, second.会话标识,
        "当前 MVP 下同一设备应恢复同一个稳定会话锚点"
    );
}

#[test]
fn 不同设备匿名凭证会拿到不同内部身份() {
    let mut repo = 假仓储::default();

    let first =
        koko::usecase::引导匿名身份(&mut repo, "device-token-a").expect("首次 bootstrap 应成功");
    let second = koko::usecase::引导匿名身份(&mut repo, "device-token-b")
        .expect("第二个设备 bootstrap 应成功");

    assert_ne!(first.匿名身份标识, second.匿名身份标识);
    assert_ne!(first.会话标识, second.会话标识);
}

#[test]
fn 按短码进房或建房会返回房间快照() {
    let mut repo = 假仓储::default();
    let room = koko::usecase::按短码进房或建房(&mut repo, "s-1", "ABCD1234").expect("应成功");
    match room {
        koko::contract::快照::房间 { 房间标识, .. } => {
            assert!(房间标识.starts_with("r-"));
        }
        _ => panic!("应返回房间快照"),
    }
}

#[test]
fn 加载房间快照要求成员资格() {
    let mut repo = 假仓储::default();
    let room = koko::usecase::按短码进房或建房(&mut repo, "s-1", "ROOM0001").expect("应成功");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    let snap = koko::usecase::加载房间快照(&repo, &room_id, "s-1").expect("成员应能加载快照");
    assert!(matches!(snap, koko::contract::快照::房间 { .. }));
}

#[test]
fn 校验房间订阅资格会拒绝非成员() {
    let mut repo = 假仓储::default();
    let room = koko::usecase::按短码进房或建房(&mut repo, "s-1", "ROOM0009").expect("应成功");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };

    let result = koko::usecase::校验房间订阅资格(&repo, &room_id, "s-2");
    assert!(matches!(result, Err(koko::contract::错误码::成员资格不足)));
}

#[test]
fn 发送文本消息返回权威事件() {
    let mut repo = 假仓储::default();
    let room = koko::usecase::按短码进房或建房(&mut repo, "s-1", "ROOM0002").expect("应成功");
    let room_id = match room {
        koko::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    let event = koko::usecase::发送文本消息(&mut repo, &room_id, "s-1", "c-1", "hello")
        .expect("应成功创建消息");
    assert!(matches!(
        event,
        koko::contract::领域事件::消息已创建 {
            房间标识,
            客户端消息标识,
            发送者会话标识,
            发送者花名,
            文本,
            事件位置: 1,
            ..
        } if 房间标识 == room_id
            && 客户端消息标识 == "c-1"
            && 发送者会话标识 == "s-1"
            && 发送者花名 == "测试用户"
            && 文本 == "hello"
    ));
}
