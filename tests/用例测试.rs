use std::io;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

#[test]
fn 结构化日志字段存在() {
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

    let output = String::from_utf8(buffer.lock().expect("lock").clone()).expect("utf8");
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

#[derive(Default)]
struct 假仓储 {
    会话计数: usize,
    房间计数: usize,
    消息计数: usize,
    最新位置: i64,
    房间短码到标识: HashMap<String, String>,
    房间成员: HashMap<String, HashSet<String>>,
}

impl koko::usecase::仓储端口 for 假仓储 {
    fn 创建匿名会话(&mut self, 显示名: &str) -> Result<koko::contract::快照, koko::contract::错误码> {
        self.会话计数 += 1;
        Ok(koko::contract::快照::会话 {
            会话标识: format!("s-{}", self.会话计数),
            显示名: 显示名.to_string(),
        })
    }

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
            文本: 文本.to_string(),
            事件位置: self.最新位置,
        })
    }
}

#[test]
fn 引导匿名会话可返回会话快照() {
    let mut repo = 假仓储::default();
    let out = koko::usecase::引导匿名会话(&mut repo, "测试用户").expect("应创建会话");
    match out {
        koko::contract::快照::会话 { 会话标识, 显示名 } => {
            assert!(会话标识.starts_with("s-"));
            assert_eq!(显示名, "测试用户");
        }
        _ => panic!("应返回会话快照"),
    }
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
            文本,
            事件位置: 1,
            ..
        } if 房间标识 == room_id
            && 客户端消息标识 == "c-1"
            && 发送者会话标识 == "s-1"
            && 文本 == "hello"
    ));
}
