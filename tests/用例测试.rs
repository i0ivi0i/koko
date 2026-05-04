use serial_test::serial;
use std::cell::{Cell, RefCell};
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
        output.contains("application") && output.contains("测试用例"),
        "日志缺少 application 字段: {output}"
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
fn http日志固定字段顺序里能看到usecase_adapter_outcome与中文请求类型() {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_ansi(false)
        .without_time()
        .with_writer(共享写入器(buffer.clone()))
        .with_target(false)
        .finish();

    tracing::subscriber::with_default(subscriber, || {
        tracing::info!(
            application = "引导匿名身份",
            adapter = "http",
            outcome = "accepted",
            request_kind = "匿名身份引导",
            "HTTP 请求已受理"
        );
    });

    let output = 读取缓冲日志(&buffer);
    let usecase_pos = output.find("application").expect("应存在 application 字段");
    let adapter_pos = output.find("adapter").expect("应存在 adapter 字段");
    let outcome_pos = output.find("outcome").expect("应存在 outcome 字段");
    assert!(
        usecase_pos < adapter_pos && adapter_pos < outcome_pos,
        "日志字段顺序应便于先读 application / adapter / outcome: {output}"
    );
    assert!(
        output.contains("request_kind") && output.contains("匿名身份引导"),
        "日志里的请求类型应改成中文稳定码，减少终端阅读噪音: {output}"
    );
}

#[derive(Clone)]
struct 共享写入器(Arc<Mutex<Vec<u8>>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for 共享写入器 {
    type Writer = 缓冲写入器;

    fn make_writer(&'a self) -> Self::Writer { 缓冲写入器(self.0.clone()) }
}

struct 缓冲写入器(Arc<Mutex<Vec<u8>>>);

impl io::Write for 缓冲写入器 {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().expect("lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

fn 读取缓冲日志(buffer: &Arc<Mutex<Vec<u8>>>) -> String {
    String::from_utf8(buffer.lock().expect("lock").clone()).expect("utf8")
}

#[derive(Default)]
struct 假仓储 {
    房间计数: usize,
    消息计数: usize,
    统一消息事件调用次数: usize,
    增量事件读取调用次数: Cell<usize>,
    引导结果查询调用次数: Cell<usize>,
    引导草案写入调用次数: Cell<usize>,
    最新位置: i64,
    房间短码到标识: HashMap<String, String>,
    房间成员: HashMap<String, HashSet<String>>,
    会话到匿名身份: HashMap<String, String>,
    设备匿名身份: HashMap<String, 测试匿名身份记录>,
    首次查询伪装为缺失: RefCell<HashSet<String>>,
    最近写入草案: Option<koko::identity::application::匿名身份引导草案>,
    房间阅读位置: HashMap<(String, String), i64>,
    历史页读取参数: RefCell<Vec<(String, i64, i64)>>,
    附件: HashMap<String, koko::media::模型::附件读取结果>,
}

#[derive(Clone)]
struct 测试匿名身份记录 {
    匿名身份标识: String, 引导结果: koko::shared::contract::匿名身份引导结果,
}

impl 假仓储 {
    /// 某些 red test 需要模拟“第一次查不到，但真正写入时撞上唯一约束”的 bootstrap 幂等竞态。
    /// 这里显式预置既有记录，再配合 `首次查询伪装为缺失` 使用，避免测试偷偷退化成第二套假业务逻辑。
    fn 预置设备匿名身份(
        &mut self,
        设备匿名凭证: &str,
        匿名身份标识: &str,
        展示花名: &str,
        会话标识: &str,
    ) {
        let snapshot = koko::shared::contract::匿名身份引导结果 {
            展示花名: 展示花名.to_string(),
            会话标识: 会话标识.to_string(),
        };
        self.会话到匿名身份
            .insert(会话标识.to_string(), 匿名身份标识.to_string());
        self.设备匿名身份.insert(
            设备匿名凭证.to_string(),
            测试匿名身份记录 {
                匿名身份标识: 匿名身份标识.to_string(),
                引导结果: snapshot,
            },
        );
    }

    /// 用例层红测需要显式控制附件 owner / kind / status，
    /// 这里用最小 helper 造假数据，避免每个测试都手拼同一坨附件快照。
    fn 放入附件(
        &mut self,
        附件标识: &str,
        所属匿名身份标识: &str,
        种类: koko::media::模型::附件种类读取结果,
        状态: koko::media::模型::附件状态读取结果,
    ) {
        self.附件.insert(
            附件标识.to_string(),
            koko::media::模型::附件读取结果 {
                附件标识: 附件标识.to_string(),
                所属匿名身份标识: 所属匿名身份标识.to_string(),
                种类,
                mime_type: "image/png".to_string(),
                状态,
                宽: Some(320),
                高: Some(240),
                允许缩略图: true,
                资产原图存储键: None,
                完整图存储键: None,
                原始冷源到期时间戳秒: None,
                原始冷源删除时间戳秒: None,
            },
        );
    }
}

impl koko::identity::application::会话身份读取端口 for 假仓储 {
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, koko::shared::contract::错误码> {
        Ok(self.会话到匿名身份.get(会话标识).cloned())
    }
}

impl koko::identity::application::身份引导仓储端口 for 假仓储 {
    fn 查询既有匿名身份引导结果(
        &self,
        设备匿名凭证: &str,
    ) -> Result<Option<koko::shared::contract::匿名身份引导结果>, koko::shared::contract::错误码> {
        self.引导结果查询调用次数
            .set(self.引导结果查询调用次数.get() + 1);
        if self
            .首次查询伪装为缺失
            .borrow_mut()
            .remove(设备匿名凭证)
        {
            return Ok(None);
        }
        Ok(self
            .设备匿名身份
            .get(设备匿名凭证)
            .map(|record| record.引导结果.clone()))
    }

    /// 假实现：
    /// 1. 正常路径按 application 生成的草案落库；
    /// 2. 已存在设备凭证时返回幂等冲突，由 application 负责二次回查。
    fn 写入匿名身份引导草案(
        &mut self,
        设备匿名凭证: &str,
        草案: &koko::identity::application::匿名身份引导草案,
    ) -> Result<koko::identity::application::匿名身份引导写入结果, koko::shared::contract::错误码> {
        self.引导草案写入调用次数
            .set(self.引导草案写入调用次数.get() + 1);
        self.最近写入草案 = Some(草案.clone());
        if let Some(existing) = self.设备匿名身份.get(设备匿名凭证) {
            self.会话到匿名身份.insert(
                existing.引导结果.会话标识.clone(),
                existing.匿名身份标识.clone(),
            );
            return Ok(koko::identity::application::匿名身份引导写入结果::设备匿名凭证已存在);
        }

        let snapshot = 草案.导出引导结果();
        self.会话到匿名身份
            .insert(snapshot.会话标识.clone(), 草案.匿名身份标识.clone());
        self.设备匿名身份.insert(
            设备匿名凭证.to_string(),
            测试匿名身份记录 {
                匿名身份标识: 草案.匿名身份标识.clone(),
                引导结果: snapshot.clone(),
            },
        );
        Ok(koko::identity::application::匿名身份引导写入结果::已写入(
            snapshot,
        ))
    }
}

impl koko::room::application::会话房间校验仓储端口 for 假仓储 {
    /// 假实现：当前测试里，形如 `s-*` 的会话都视为已存在。
    fn 检查会话存在(
        &self,
        会话标识: &str,
    ) -> Result<bool, koko::shared::contract::错误码> {
        Ok(会话标识.starts_with("s-"))
    }

    /// 假实现：房间存在性查询。
    fn 检查房间存在(
        &self,
        房间标识: &str,
    ) -> Result<bool, koko::shared::contract::错误码> {
        Ok(self.房间成员.contains_key(房间标识))
    }

    /// 假实现：成员资格查询。
    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, koko::shared::contract::错误码> {
        Ok(self
            .房间成员
            .get(房间标识)
            .is_some_and(|set| set.contains(会话标识)))
    }
}

impl koko::room::application::房间仓储端口 for 假仓储 {
    /// 假实现：按短码创建或复用房间，并写入成员关系。
    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<koko::shared::contract::快照, koko::shared::contract::错误码> {
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
        Ok(koko::shared::contract::快照::房间 {
            房间标识: room_id,
            最新事件位置: self.最新位置,
            上次已读事件位置: None,
            首条未读事件位置: None,
            首屏消息: Vec::new(),
            首屏前仍有更早历史: false,
        })
    }

    /// 假实现：房间最新事件位置就是本地计数器。
    fn 查询房间最新事件位置(
        &self,
        房间标识: &str,
    ) -> Result<Option<i64>, koko::shared::contract::错误码> {
        if self.房间成员.contains_key(房间标识) {
            Ok(Some(self.最新位置))
        } else {
            Ok(None)
        }
    }

    /// 假实现：房间快照读取。
    fn 拉取房间快照(
        &self,
        房间标识: &str,
        上次已读事件位置: Option<i64>,
        首条未读事件位置: Option<i64>,
    ) -> Result<koko::shared::contract::快照, koko::shared::contract::错误码> {
        if self.房间成员.contains_key(房间标识) {
            Ok(koko::shared::contract::快照::房间 {
                房间标识: 房间标识.to_string(),
                最新事件位置: self.最新位置,
                上次已读事件位置,
                首条未读事件位置,
                首屏消息: Vec::new(),
                首屏前仍有更早历史: false,
            })
        } else {
            Err(koko::shared::contract::错误码::房间不存在)
        }
    }

    /// 假实现：房间增量读取只返回当前位置之后的空增量。
    fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<koko::shared::contract::快照, koko::shared::contract::错误码> {
        self.增量事件读取调用次数
            .set(self.增量事件读取调用次数.get() + 1);
        if 从位置开始 < 0 {
            return Err(koko::shared::contract::错误码::参数非法);
        }
        if !self.房间成员.contains_key(房间标识) {
            return Err(koko::shared::contract::错误码::房间不存在);
        }
        Ok(koko::shared::contract::快照::房间增量事件 {
            房间标识: 房间标识.to_string(),
            事件: Vec::new(),
            最新事件位置: self.最新位置,
        })
    }

    /// 假实现：房间更早历史页读取当前返回空页。
    fn 拉取房间历史页(
        &self,
        房间标识: &str,
        截止位置之前: i64,
        限制条数: i64,
    ) -> Result<koko::shared::contract::快照, koko::shared::contract::错误码> {
        self.历史页读取参数
            .borrow_mut()
            .push((房间标识.to_string(), 截止位置之前, 限制条数));
        if 截止位置之前 <= 0 || 限制条数 <= 0 {
            return Err(koko::shared::contract::错误码::参数非法);
        }
        if !self.房间成员.contains_key(房间标识) {
            return Err(koko::shared::contract::错误码::房间不存在);
        }
        Ok(koko::shared::contract::快照::房间历史页 {
            房间标识: 房间标识.to_string(),
            消息: Vec::new(),
        })
    }

    /// 假实现：阅读锚点按 `(匿名身份, 房间)` 收口，且只能单调前进。
    fn 推进房间阅读位置(
        &mut self,
        房间标识: &str,
        会话标识: &str,
        已读到事件位置: i64,
    ) -> Result<(), koko::shared::contract::错误码> {
        let identity = self
            .会话到匿名身份
            .get(会话标识)
            .cloned()
            .ok_or(koko::shared::contract::错误码::会话无效)?;
        let key = (identity, 房间标识.to_string());
        let current = self.房间阅读位置.get(&key).copied().unwrap_or(0);
        self.房间阅读位置.insert(key, current.max(已读到事件位置));
        Ok(())
    }

    fn 查询房间阅读位置(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<Option<i64>, koko::shared::contract::错误码> {
        let Some(identity) = self.会话到匿名身份.get(会话标识) else {
            return Ok(None);
        };
        Ok(self
            .房间阅读位置
            .get(&(identity.clone(), 房间标识.to_string()))
            .copied())
    }
}

impl koko::message::application::消息仓储端口 for 假仓储 {
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<koko::media::模型::附件读取结果>, koko::shared::contract::错误码> {
        Ok(self.附件.get(附件标识).cloned())
    }

    /// 假实现：统一消息入口直接生成消息已创建事件并推进本地事件位置。
    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[koko::domain::message::已校验附件引用],
    ) -> Result<koko::shared::contract::领域事件, koko::shared::contract::错误码> {
        // 用例测试只关心“统一入口是否单路径提交”，这里保持最小可验证快照。
        let _ = 附件;
        self.统一消息事件调用次数 += 1;
        self.消息计数 += 1;
        self.最新位置 += 1;
        Ok(koko::shared::contract::领域事件::消息已创建 {
            房间标识: 房间标识.to_string(),
            消息标识: format!("m-{}", self.消息计数),
            客户端消息标识: 客户端消息标识.to_string(),
            发送者会话标识: 会话标识.to_string(),
            发送者花名: "测试用户".to_string(),
            文本: 文本.to_string(),
            附件: Vec::new(),
            事件位置: self.最新位置,
        })
    }
}

impl koko::realtime::application::实时会话房间校验仓储端口 for 假仓储 {
    async fn 检查会话存在(
        &self,
        会话标识: &str,
    ) -> Result<bool, koko::shared::contract::错误码> {
        <Self as koko::room::application::会话房间校验仓储端口>::检查会话存在(self, 会话标识)
    }

    async fn 检查房间存在(
        &self,
        房间标识: &str,
    ) -> Result<bool, koko::shared::contract::错误码> {
        <Self as koko::room::application::会话房间校验仓储端口>::检查房间存在(self, 房间标识)
    }

    async fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, koko::shared::contract::错误码> {
        <Self as koko::room::application::会话房间校验仓储端口>::检查成员资格(
            self,
            房间标识,
            会话标识,
        )
    }
}

impl koko::realtime::application::实时房间仓储端口 for 假仓储 {
    async fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<koko::shared::contract::快照, koko::shared::contract::错误码> {
        <Self as koko::room::application::房间仓储端口>::拉取房间增量事件(
            self,
            房间标识,
            从位置开始,
        )
    }
}

impl koko::message::application::Realtime消息仓储端口 for 假仓储 {
    async fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, koko::shared::contract::错误码> {
        <Self as koko::identity::application::会话身份读取端口>::查询会话所属匿名身份(
            self,
            会话标识,
        )
    }

    async fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<koko::media::模型::附件读取结果>, koko::shared::contract::错误码> {
        <Self as koko::message::application::消息仓储端口>::查询附件快照(self, 附件标识)
    }

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[koko::domain::message::已校验附件引用],
    ) -> Result<koko::shared::contract::领域事件, koko::shared::contract::错误码> {
        <Self as koko::message::application::消息仓储端口>::创建统一消息事件(
            self,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        )
    }
}

#[test]
fn bootstrap匿名身份时设备凭证与花名不会混成同一个字段() {
    let snapshot = koko::shared::contract::快照::匿名身份 {
        匿名身份标识: "a-1".to_string(),
        展示花名: "暴躁的企鹅".to_string(),
    };

    match snapshot {
        koko::shared::contract::快照::匿名身份 {
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
    let before = koko::shared::contract::快照::匿名身份 {
        匿名身份标识: "a-stable".to_string(),
        展示花名: "暴躁的企鹅".to_string(),
    };
    let after = koko::shared::contract::快照::匿名身份 {
        匿名身份标识: "a-stable".to_string(),
        展示花名: "冷静的企鹅".to_string(),
    };

    match (before, after) {
        (
            koko::shared::contract::快照::匿名身份 {
                匿名身份标识: before_id,
                展示花名: before_alias,
            },
            koko::shared::contract::快照::匿名身份 {
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
fn bootstrap用例会先查既有结果_缺失时再写入草案() {
    let mut repo = 假仓储::default();

    let result = koko::identity::application::引导匿名身份(&mut repo, "device-draft-1")
        .expect("首次 bootstrap 应成功");
    let 草案 = repo
        .最近写入草案
        .as_ref()
        .expect("application 应该先生成并提交 bootstrap 草案");

    assert_eq!(
        repo.引导结果查询调用次数.get(),
        1,
        "首次 bootstrap 必须先查询既有结果，再决定是否新建"
    );
    assert_eq!(
        repo.引导草案写入调用次数.get(),
        1,
        "首次 bootstrap 缺失时必须写入一次草案"
    );
    assert_eq!(草案.展示花名, result.展示花名);
    assert_eq!(草案.会话标识, result.会话标识);
    assert_eq!(
        repo.会话到匿名身份.get(&result.会话标识),
        Some(&草案.匿名身份标识),
        "application 生成的草案必须成为会话 -> 内部匿名身份的唯一映射"
    );
}

#[test]
fn bootstrap写入遇到设备幂等冲突时会回查既有结果() {
    let mut repo = 假仓储::default();
    repo.预置设备匿名身份("device-race-1", "a-existing", "旧花名", "s-existing");
    repo.首次查询伪装为缺失
        .borrow_mut()
        .insert("device-race-1".to_string());

    let result = koko::identity::application::引导匿名身份(&mut repo, "device-race-1")
        .expect("幂等冲突后应用层应回查并恢复既有结果");

    assert_eq!(result.展示花名, "旧花名");
    assert_eq!(result.会话标识, "s-existing");
    assert_eq!(
        repo.引导结果查询调用次数.get(),
        2,
        "写入撞上设备幂等冲突后，application 必须再次回查既有结果"
    );
    assert_eq!(
        repo.引导草案写入调用次数.get(),
        1,
        "冲突场景里 application 仍应只尝试写入一次草案"
    );
}

#[test]
fn 同一设备匿名凭证重复bootstrap会恢复同一个内部身份与花名() {
    let mut repo = 假仓储::default();

    let first = koko::identity::application::引导匿名身份(&mut repo, "device-token-1")
        .expect("首次 bootstrap 应成功");
    let second = koko::identity::application::引导匿名身份(&mut repo, "device-token-1")
        .expect("重复 bootstrap 应成功");

    assert_eq!(
        first.展示花名, second.展示花名,
        "同一设备匿名凭证必须恢复同一个展示花名"
    );
    assert_eq!(
        first.会话标识, second.会话标识,
        "当前 MVP 下同一设备应恢复同一个稳定会话锚点"
    );
    assert_eq!(
        repo.会话到匿名身份.get(&first.会话标识),
        repo.会话到匿名身份.get(&second.会话标识),
        "同一设备匿名凭证必须恢复同一个内部身份"
    );
}

#[test]
fn 不同设备匿名凭证会拿到不同内部身份() {
    let mut repo = 假仓储::default();

    let first = koko::identity::application::引导匿名身份(&mut repo, "device-token-a")
        .expect("首次 bootstrap 应成功");
    let second = koko::identity::application::引导匿名身份(&mut repo, "device-token-b")
        .expect("第二个设备 bootstrap 应成功");

    assert_ne!(first.会话标识, second.会话标识);
    assert_ne!(
        repo.会话到匿名身份.get(&first.会话标识),
        repo.会话到匿名身份.get(&second.会话标识),
        "不同设备不应共享同一个内部身份"
    );
}

#[test]
fn 按短码进房或建房会返回房间快照() {
    let mut repo = 假仓储::default();
    let room =
        koko::room::application::按短码进房或建房(&mut repo, "s-1", "ABCD1234").expect("应成功");
    match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => {
            assert!(房间标识.starts_with("r-"));
        }
        _ => panic!("应返回房间快照"),
    }
}

#[test]
fn 加载房间快照要求成员资格() {
    let mut repo = 假仓储::default();
    let room =
        koko::room::application::按短码进房或建房(&mut repo, "s-1", "ROOM0001").expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    let snap = koko::recovery::application::加载房间快照(&repo, &room_id, "s-1")
        .expect("成员应能加载快照");
    assert!(matches!(snap, koko::shared::contract::快照::房间 { .. }));
}

#[test]
fn 校验房间订阅资格会拒绝非成员() {
    let mut repo = 假仓储::default();
    let room =
        koko::room::application::按短码进房或建房(&mut repo, "s-1", "ROOM0009").expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };

    let result = koko::room::application::校验房间订阅资格(&repo, &room_id, "s-2");
    assert!(matches!(
        result,
        Err(koko::shared::contract::错误码::成员资格不足)
    ));
}

#[test]
fn 发送文本消息返回权威事件() {
    let mut repo = 假仓储::default();
    let room =
        koko::room::application::按短码进房或建房(&mut repo, "s-1", "ROOM0002").expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    let event =
        koko::message::application::发送文本消息(&mut repo, &room_id, "s-1", "c-1", "hello")
            .expect("应成功创建消息");
    assert!(matches!(
        event,
        koko::shared::contract::领域事件::消息已创建 {
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
    assert_eq!(
        repo.统一消息事件调用次数, 1,
        "发送文本消息时只能走一次 创建统一消息事件，不能暗中再走旧入口或第二条提交路径"
    );
}

#[test]
fn 非ready附件不能创建消息() {
    let mut repo = 假仓储::default();
    let identity =
        koko::identity::application::引导匿名身份(&mut repo, "device-attachment-processing")
            .expect("应能引导匿名身份");
    let room = koko::room::application::按短码进房或建房(
        &mut repo,
        &identity.会话标识,
        "ROOM0010",
    )
    .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    let sender_identity = repo
        .会话到匿名身份
        .get(&identity.会话标识)
        .expect("引导匿名身份后应能通过会话查到内部身份")
        .clone();
    repo.放入附件(
        "att-1",
        &sender_identity,
        koko::media::模型::附件种类读取结果::图片,
        koko::media::模型::附件状态读取结果::处理中,
    );

    let result = koko::message::application::创建消息(
        &mut repo,
        &room_id,
        &identity.会话标识,
        "c-attachment-processing",
        "",
        &["att-1".to_string()],
    );

    assert!(matches!(
        result,
        Err(koko::shared::contract::错误码::附件未就绪)
    ));
}

#[test]
fn 附件owner不匹配时拒绝创建消息() {
    let mut repo = 假仓储::default();
    let sender =
        koko::identity::application::引导匿名身份(&mut repo, "device-attachment-owner")
            .expect("应能引导匿名身份");
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &sender.会话标识, "ROOM0011")
            .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    repo.放入附件(
        "att-owner-mismatch",
        "a-other",
        koko::media::模型::附件种类读取结果::图片,
        koko::media::模型::附件状态读取结果::就绪,
    );

    let result = koko::message::application::创建消息(
        &mut repo,
        &room_id,
        &sender.会话标识,
        "c-attachment-owner",
        "hello",
        &["att-owner-mismatch".to_string()],
    );

    assert!(matches!(
        result,
        Err(koko::shared::contract::错误码::附件不属于当前发送者)
    ));
}

#[tokio::test]
async fn 异步附件owner不匹配时也必须拒绝创建消息() {
    let mut repo = 假仓储::default();
    let sender =
        koko::identity::application::引导匿名身份(&mut repo, "device-async-attachment-owner")
            .expect("应能引导匿名身份");
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &sender.会话标识, "ROOMA004")
            .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    repo.放入附件(
        "att-async-owner-mismatch",
        "a-other",
        koko::media::模型::附件种类读取结果::图片,
        koko::media::模型::附件状态读取结果::就绪,
    );

    // 这条测试锁住“异步入口只是另一种调用方式，不是另一套附件 owner 真相”。
    // 后面无论怎么拆实现，都不能让 realtime 主链放松这条裁决。
    let result = koko::message::application::创建消息_异步(
        &mut repo,
        &room_id,
        &sender.会话标识,
        "c-async-attachment-owner",
        "hello",
        &["att-async-owner-mismatch".to_string()],
    )
    .await;

    assert!(matches!(
        result,
        Err(koko::shared::contract::错误码::附件不属于当前发送者)
    ));
}

#[tokio::test]
async fn 异步ready视频附件也能进入统一消息主链() {
    let mut repo = 假仓储::default();
    let sender =
        koko::identity::application::引导匿名身份(&mut repo, "device-async-ready-video")
            .expect("应能引导匿名身份");
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &sender.会话标识, "ROOMA005")
            .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };
    let sender_identity = repo
        .会话到匿名身份
        .get(&sender.会话标识)
        .expect("引导匿名身份后应能通过会话查到内部身份")
        .clone();
    repo.放入附件(
        "att-async-ready-video",
        &sender_identity,
        koko::media::模型::附件种类读取结果::视频,
        koko::media::模型::附件状态读取结果::就绪,
    );

    let event = koko::message::application::创建消息_异步(
        &mut repo,
        &room_id,
        &sender.会话标识,
        "client-async-video-1",
        "",
        &["att-async-ready-video".to_string()],
    )
    .await
    .expect("ready 视频附件应能进入异步统一消息主链");

    match event {
        koko::shared::contract::领域事件::消息已创建 {
            房间标识, 文本,
        ..
        } => {
            assert_eq!(房间标识, room_id);
            assert_eq!(文本, "");
        }
    }
    assert_eq!(
        repo.统一消息事件调用次数, 1,
        "异步附件消息也只能提交一次统一消息事件"
    );
}

#[tokio::test]
async fn realtime连接认证异步用例会放行有效会话() {
    let repo = 假仓储::default();

    let result = koko::realtime::application::校验实时连接会话_异步(&repo, "s-async-ok").await;

    assert_eq!(result, Ok(()));
}

#[tokio::test]
async fn 房间增量事件异步用例会拒绝非成员() {
    let mut repo = 假仓储::default();
    let room = koko::room::application::按短码进房或建房(&mut repo, "s-member", "ROOMA001")
        .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };

    let result = koko::realtime::application::加载房间增量事件_异步(
        &repo,
        &room_id,
        "s-stranger",
        0,
    )
    .await;

    assert_eq!(result, Err(koko::shared::contract::错误码::成员资格不足));
}

#[tokio::test]
async fn 统一消息异步用例仍返回权威消息事件() {
    let mut repo = 假仓储::default();
    let sender =
        koko::identity::application::引导匿名身份(&mut repo, "device-async-msg").expect("应成功");
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &sender.会话标识, "ROOMA002")
            .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };

    let event = koko::message::application::创建消息_异步(
        &mut repo,
        &room_id,
        &sender.会话标识,
        "client-async-1",
        "hello async",
        &[],
    )
    .await
    .expect("应成功");

    match event {
        koko::shared::contract::领域事件::消息已创建 {
            房间标识, 文本,
        ..
        } => {
            assert_eq!(房间标识, room_id);
            assert_eq!(文本, "hello async");
        }
    }
    assert_eq!(
        repo.统一消息事件调用次数, 1,
        "异步创建消息也只能命中统一消息入口一次，不能靠源码 grep 代替真实行为证明"
    );
}

#[tokio::test]
async fn 异步消息成立只提交一次权威事件且不读取订阅历史() {
    let mut repo = 假仓储::default();
    let sender =
        koko::identity::application::引导匿名身份(&mut repo, "device-async-hot-path")
            .expect("应成功");
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &sender.会话标识, "ROOMA003")
            .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };

    let _ = koko::message::application::创建消息_异步(
        &mut repo,
        &room_id,
        &sender.会话标识,
        "client-hot-path-1",
        "hello hot path",
        &[],
    )
    .await
    .expect("应成功");

    assert_eq!(repo.统一消息事件调用次数, 1, "消息成立只能落一次权威事件");
    assert_eq!(
        repo.增量事件读取调用次数.get(),
        0,
        "创建消息热路径不能为了广播再反查订阅历史，广播必须消费提交返回的同一份事件"
    );
}

#[test]
fn 历史读取使用事件位置游标并限制批量大小() {
    let mut repo = 假仓储::default();
    let room =
        koko::room::application::按短码进房或建房(&mut repo, "s-history", "ROOMH001")
            .expect("应成功");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("应返回房间快照"),
    };

    let _ = koko::room::application::加载房间历史页(&repo, &room_id, "s-history", 120, 1000)
        .expect("成员应能读取历史页");

    assert_eq!(
        repo.历史页读取参数.borrow().clone(),
        vec![(room_id, 120, 55)],
        "历史读取必须把 event_position 游标和受控 limit 传给仓储，不能退回 OFFSET/全量历史模型"
    );
}

#[test]
fn 根用例文件必须删除且共享应用入口只能作为未下沉能力的临时owner() {
    assert!(
        !std::path::Path::new("src/用例.rs").exists(),
        "src/用例.rs 不能继续作为根目录超级用例文件存在"
    );
    let source = std::fs::read_to_string("src/应用/mod.rs").expect("应能读取 src/应用/mod.rs");
    // 现在锁的是“共享应用层只保留共享端口与校验逻辑”，
    // 不允许再把业务 owner 从这里重新回灌回来。
    assert!(
        !source.contains("pub use crate::identity::application")
            && !source.contains("pub use crate::room::application")
            && !source.contains("pub use crate::message::application")
            && !source.contains("pub use crate::recovery::application")
            && !source.contains("pub use crate::media::upload::application")
            && !source.contains("pub use crate::media::distribution::application")
            && !source.contains("pub use crate::realtime::application"),
        "共享应用入口不得继续回灌业务 owner，不能重新长成新的超级应用文件"
    );
}

#[test]
fn 根契约文件必须删除且共享契约只能留在共享基础owner() {
    assert!(
        !std::path::Path::new("src/契约.rs").exists(),
        "src/契约.rs 不能继续作为根目录超级契约文件存在"
    );
    let source =
        std::fs::read_to_string("src/共享/契约基础.rs").expect("应能读取 src/共享/契约基础.rs");
    // 这里锁的是“根契约文件已删除，仍需共享的稳定类型有明确共享 owner”。
    // 后续再把能按业务下沉的类型继续拆进 identity/room/message/media。
    assert!(
        source.contains("pub enum 错误码") && source.contains("pub enum 快照"),
        "共享契约基础 owner 必须承载当前跨业务仍共同消费的错误码与快照语义"
    );
}

#[test]
fn 房间外壳必须改走房间业务入口而不是继续直连统一用例细节() {
    let source = std::fs::read_to_string("src/房间/外壳.rs").expect("应能读取 src/房间/外壳.rs");
    // 房间外壳是第一波最容易继续偷连统一用例的入口之一。
    // 这里先要求它开始显式依赖 room 入口，避免后面“模块建好了，外壳还在走旧根结构”。
    assert!(
        source.contains("crate::room"),
        "房间外壳尚未切到房间业务入口，后续 owner 收口仍会被统一用例反向绑住"
    );
}
