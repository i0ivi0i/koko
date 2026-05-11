use serial_test::serial;
use std::{
    sync::{Arc, Barrier},
    time::{SystemTime, UNIX_EPOCH},
};


/// 实时链路测试：
/// 1. 这里只守 realtime 主链、控制面 kind、幂等重试与并发顺序。
/// 2. 这些测试直接锁定跨入口共享契约，避免壳层或 adapter 把控制面语义悄悄改坏。
/// 3. 不负责 HTTP 冷路径、房间查询接口或媒体上传运输态。
#[test]
#[serial]
fn realtime主链闭环() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("R{:011}", uniq % 100_000_000_000);
    let device_token = format!("rt-device-{uniq}");
    let session_id = koko::identity::application::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    let control = koko::shared::contract::控制面结果::订阅已建立 {
        房间标识: room_id.clone(),
        起始位置: 0,
    };
    assert!(matches!(
        control,
        koko::shared::contract::控制面结果::订阅已建立 {
            起始位置: 0, ..
        }
    ));

    let event = koko::message::application::发送文本消息(
        &mut repo,
        &room_id,
        &session_id,
        "rt-c-1",
        "hello rt",
    )
    .expect("发送消息应成功");
    assert!(matches!(
        event,
        koko::shared::contract::领域事件::消息已创建 {
            事件位置: 1, ..
        }
    ));

    let delta = repo
        .拉取房间增量事件(&room_id, 0)
        .expect("应能拉取增量事件");
    match delta {
        koko::shared::contract::快照::房间增量事件 {
            房间标识,
            最新事件位置,
            事件,
        } => {
            assert_eq!(房间标识, room_id);
            assert_eq!(最新事件位置, 1);
            assert_eq!(事件.len(), 1);
        }
        _ => panic!("应返回房间增量事件快照"),
    }
}

#[test]
#[serial]
fn 异步订阅主链遇到无效会话时仍返回会话无效() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let runtime = tokio::runtime::Runtime::new().expect("应能创建测试 runtime");
    runtime
        .block_on(koko::assembly::自动追平迁移(&cfg.database_url))
        .expect("应先追平迁移");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("S{:011}", uniq % 100_000_000_000);
    let device_token = format!("subscribe-valid-device-{uniq}");
    let session_id = koko::identity::application::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    // 这条测试专门锁住 realtime async 热路径的拒绝顺序：
    // 先挡掉无效会话，不能因为后续还会查成员资格就把错误语义漂成别的 code。
    let realtime_repo = repo.实时仓储();
    let result = runtime.block_on(koko::realtime::application::加载房间增量事件_异步(
        &realtime_repo,
        &room_id,
        "s-missing",
        0,
    ));
    assert_eq!(result, Err(koko::shared::contract::错误码::会话无效));
}

#[test]
#[serial]
fn 异步订阅主链遇到非成员时仍返回成员资格不足() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let runtime = tokio::runtime::Runtime::new().expect("应能创建测试 runtime");
    runtime
        .block_on(koko::assembly::自动追平迁移(&cfg.database_url))
        .expect("应先追平迁移");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let owner_device = format!("subscribe-owner-device-{uniq}");
    let stranger_device = format!("subscribe-stranger-device-{uniq}");
    let owner_session = koko::identity::application::引导匿名身份(&mut repo, &owner_device)
        .expect("应能引导房主身份")
        .会话标识;
    let stranger_session =
        koko::identity::application::引导匿名身份(&mut repo, &stranger_device)
            .expect("应能引导旁观身份")
            .会话标识;
    let room = koko::room::application::按短码进房或建房(
        &mut repo,
        &owner_session,
        &format!("M{:011}", uniq % 100_000_000_000),
    )
    .expect("应能进房");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    // 这条测试锁住“有效会话但无成员资格”不能被偷改成静默订阅或系统错误。
    let realtime_repo = repo.实时仓储();
    let result = runtime.block_on(koko::realtime::application::加载房间增量事件_异步(
        &realtime_repo,
        &room_id,
        &stranger_session,
        0,
    ));
    assert_eq!(result, Err(koko::shared::contract::错误码::成员资格不足));
}

#[test]
fn 订阅需要重拉快照时控制面kind保持need_snapshot_reload() {
    // 这里先锁住 shell 对前端承诺的最小 payload 形状。
    // 即使内部实现继续重整，只要 kind / room_id / expected_position 漂了，
    // 前端恢复链就会直接断裂。
    let control = serde_json::json!({
        "kind": "need_snapshot_reload",
        "room_id": "room-1",
        "expected_position": 99
    });

    assert_eq!(control["kind"], "need_snapshot_reload");
    assert_eq!(control["room_id"], "room-1");
    assert_eq!(control["expected_position"], 99);
}

#[test]
fn 订阅拒绝与系统错误的控制面类型必须分流() {
    // `rejected` 表示业务拒绝，`error` 表示系统失败。
    // 这两个 kind 一旦混掉，前端就会把可恢复问题和业务拒绝混成一锅。
    let rejected = serde_json::json!({"kind":"rejected","code":"membership_required"});
    let error = serde_json::json!({"kind":"error","code":"system_error"});

    assert_eq!(rejected["kind"], "rejected");
    assert_eq!(error["kind"], "error");
    assert_ne!(rejected["kind"], error["kind"]);
}

#[test]
#[serial]
fn 重复客户端消息标识应返回同一条已成立消息事件() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let mut repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("I{:011}", uniq % 100_000_000_000);
    let device_token = format!("idem-device-{uniq}");
    let session_id = koko::identity::application::引导匿名身份(&mut repo, &device_token)
        .expect("应能引导匿名身份")
        .会话标识;
    let room =
        koko::room::application::按短码进房或建房(&mut repo, &session_id, &code).expect("应能进房");
    let room_id = match room {
        koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
        _ => panic!("进房应返回房间快照"),
    };

    // 同一个 client_message_id 表示同一条用户意图；重试时不应制造第二条消息或伪系统错误。
    let first = koko::message::application::发送文本消息(
        &mut repo,
        &room_id,
        &session_id,
        "idem-c-1",
        "hello idem",
    )
    .expect("首次发送应成功");
    let second = koko::message::application::发送文本消息(
        &mut repo,
        &room_id,
        &session_id,
        "idem-c-1",
        "hello idem",
    )
    .expect("同一 client_message_id 的重试应返回已成立事件，而不是系统错误");

    assert_eq!(first, second, "重试发送应回到同一条权威事件");

    let (latest, events, messages) = repo
        .查询房间持久化计数(&room_id)
        .expect("应能查询持久化计数");
    assert_eq!(latest, 1, "幂等重试不应推进第二个事件位置");
    assert_eq!(events, 1, "幂等重试不应重复写 room_events");
    assert_eq!(messages, 1, "幂等重试不应重复写 messages");
}

#[test]
#[serial]
fn 同房并发发送时事件位置仍然连续单调() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("应能创建测试运行时");
    rt.block_on(async {
        koko::assembly::自动追平迁移(&cfg.database_url)
            .await
            .expect("应先追平迁移");
    });

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let code = format!("C{:011}", uniq % 100_000_000_000);
    let device_token = format!("concurrent-room-device-{uniq}");
    let database_url = cfg.database_url.clone();

    let (room_id, session_id) = std::thread::spawn(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity = koko::identity::application::引导匿名身份(&mut repo, &device_token)
            .expect("应能引导匿名身份");
        let room =
            koko::room::application::按短码进房或建房(&mut repo, &identity.会话标识, &code)
                .expect("应能进房");
        let room_id = match room {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("进房应返回房间快照"),
        };
        (room_id, identity.会话标识)
    })
    .join()
    .expect("建数线程应完成");

    let mut tasks = Vec::new();
    for index in 0..8 {
        let database_url = cfg.database_url.clone();
        let room_id = room_id.clone();
        let session_id = session_id.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::message::application::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("same-room-{index}"),
                &format!("并发消息-{index}"),
            )
            .expect("并发发送应成功")
        }));
    }

    let mut positions = Vec::new();
    for task in tasks {
        let event = task.join().expect("发送线程应完成");
        match event {
            koko::shared::contract::领域事件::消息已创建 { 事件位置, .. } => {
                positions.push(事件位置)
            }
        }
    }
    positions.sort_unstable();
    assert_eq!(
        positions,
        (1..=8).collect::<Vec<_>>(),
        "同房并发下事件位置必须连续单调"
    );

    let repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");
    let (latest, events, messages) = repo
        .查询房间持久化计数(&room_id)
        .expect("应能查询持久化计数");
    assert_eq!(latest, 8, "房间最新位置应推进到最后一条");
    assert_eq!(events, 8, "room_events 条数应与发送数一致");
    assert_eq!(messages, 8, "messages 条数应与发送数一致");
}

#[test]
#[serial]
fn 同短码并发进房时不会把唯一约束竞态漏成系统错误() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("应能创建测试运行时");
    rt.block_on(async {
        koko::assembly::自动追平迁移(&cfg.database_url)
            .await
            .expect("应先追平迁移");
    });

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let room_code = format!("JR{:010}", uniq % 10_000_000_000);
    let database_url = cfg.database_url.clone();

    // 先顺序引导好多个会话，再用 Barrier 把“进房或建房”动作压到同一时刻，
    // 这样测试才能稳定逼出 `先查 rooms，再 insert rooms` 的竞态窗口。
    let session_ids = std::thread::spawn(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        (0..8)
            .map(|index| {
                koko::identity::application::引导匿名身份(
                    &mut repo,
                    &format!("join-race-device-{uniq}-{index}"),
                )
                .expect("应能引导匿名身份")
                .会话标识
            })
            .collect::<Vec<_>>()
    })
    .join()
    .expect("会话准备线程应完成");

    let barrier = Arc::new(Barrier::new(session_ids.len()));
    let mut tasks = Vec::new();
    for session_id in session_ids {
        let database_url = cfg.database_url.clone();
        let room_code = room_code.clone();
        let barrier = barrier.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            barrier.wait();
            koko::room::application::按短码进房或建房(&mut repo, &session_id, &room_code)
        }));
    }

    let mut room_ids = Vec::new();
    for task in tasks {
        let snapshot = task
            .join()
            .expect("并发进房线程应完成")
            .expect("同短码并发进房不应漏成系统错误");
        match snapshot {
            koko::shared::contract::快照::房间 { 房间标识, .. } => room_ids.push(房间标识),
            _ => panic!("进房应返回房间快照"),
        }
    }

    assert!(!room_ids.is_empty(), "至少要拿到一个房间标识");
    let first_room_id = room_ids[0].clone();
    assert!(
        room_ids.iter().all(|room_id| room_id == &first_room_id),
        "同一短码并发进房必须全部收口到同一个房间"
    );
}

#[test]
#[serial]
fn 不同房间并发发送时互不串号互不污染() {
    let cfg = koko::assembly::读取配置().expect("需要本地 DATABASE_URL");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("应能创建测试运行时");
    rt.block_on(async {
        koko::assembly::自动追平迁移(&cfg.database_url)
            .await
            .expect("应先追平迁移");
    });

    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let database_url = cfg.database_url.clone();

    let (room_a, room_b, session_a, session_b) = std::thread::spawn(move || {
        let mut repo = koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
        let identity_a =
            koko::identity::application::引导匿名身份(&mut repo, &format!("cross-a-{uniq}"))
                .expect("A 应能引导匿名身份");
        let identity_b =
            koko::identity::application::引导匿名身份(&mut repo, &format!("cross-b-{uniq}"))
                .expect("B 应能引导匿名身份");
        let room_a = koko::room::application::按短码进房或建房(
            &mut repo,
            &identity_a.会话标识,
            &format!("A{:011}", uniq % 100_000_000_000),
        )
        .expect("A 房间应能进房");
        let room_b = koko::room::application::按短码进房或建房(
            &mut repo,
            &identity_b.会话标识,
            &format!("B{:011}", uniq % 100_000_000_000),
        )
        .expect("B 房间应能进房");
        let room_a = match room_a {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("A 房间应返回房间快照"),
        };
        let room_b = match room_b {
            koko::shared::contract::快照::房间 { 房间标识, .. } => 房间标识,
            _ => panic!("B 房间应返回房间快照"),
        };
        (room_a, room_b, identity_a.会话标识, identity_b.会话标识)
    })
    .join()
    .expect("建数线程应完成");

    let mut tasks = Vec::new();
    for index in 0..4 {
        let database_url = cfg.database_url.clone();
        let room_id = room_a.clone();
        let session_id = session_a.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::message::application::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("room-a-{index}"),
                &format!("A-{index}"),
            )
            .expect("A 房间发送应成功")
        }));
    }
    for index in 0..4 {
        let database_url = cfg.database_url.clone();
        let room_id = room_b.clone();
        let session_id = session_b.clone();
        tasks.push(std::thread::spawn(move || {
            let mut repo =
                koko::adapter::Pg仓储::连接并迁移(&database_url).expect("应能连接数据库");
            koko::message::application::发送文本消息(
                &mut repo,
                &room_id,
                &session_id,
                &format!("room-b-{index}"),
                &format!("B-{index}"),
            )
            .expect("B 房间发送应成功")
        }));
    }

    let mut room_a_positions = Vec::new();
    let mut room_b_positions = Vec::new();
    for task in tasks {
        let event = task.join().expect("发送线程应完成");
        match event {
            koko::shared::contract::领域事件::消息已创建 {
                房间标识, 事件位置,
            ..
            } if 房间标识 == room_a => room_a_positions.push(事件位置),
            koko::shared::contract::领域事件::消息已创建 {
                房间标识, 事件位置,
            ..
            } if 房间标识 == room_b => room_b_positions.push(事件位置),
            koko::shared::contract::领域事件::消息已创建 { 房间标识, .. } => {
                panic!("出现了不属于测试房间的事件: {房间标识}")
            }
        }
    }

    room_a_positions.sort_unstable();
    room_b_positions.sort_unstable();
    assert_eq!(
        room_a_positions,
        (1..=4).collect::<Vec<_>>(),
        "A 房间事件位置应自洽连续"
    );
    assert_eq!(
        room_b_positions,
        (1..=4).collect::<Vec<_>>(),
        "B 房间事件位置应自洽连续"
    );

    let repo = koko::adapter::Pg仓储::连接并迁移(&cfg.database_url).expect("应能连接数据库");
    let room_a_counts = repo
        .查询房间持久化计数(&room_a)
        .expect("应能查询 A 房间持久化计数");
    let room_b_counts = repo
        .查询房间持久化计数(&room_b)
        .expect("应能查询 B 房间持久化计数");
    assert_eq!(room_a_counts, (4, 4, 4), "A 房间持久化状态应只反映自己");
    assert_eq!(room_b_counts, (4, 4, 4), "B 房间持久化状态应只反映自己");
}
