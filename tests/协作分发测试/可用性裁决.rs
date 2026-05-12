use super::*;
use axum::{Json as AxumJson, Router, extract::State as AxumState, routing::post};
use bip_metainfo::{DirectAccessor, Metainfo, MetainfoBuilder, PieceLength};
use object_store::{ObjectStoreExt, path::Path as ObjectPath};
use std::sync::{Arc, Mutex};
use tokio::{
    net::{TcpListener, TcpStream},
    task::JoinHandle,
    time::{Duration, sleep},
};

use sqlx::PgPool;

#[derive(Default, Clone)]
struct 假Seeder控制面记录 {
    start_payloads: Vec<serde_json::Value>,
    reconcile_payloads: Vec<serde_json::Value>,
}

type 假Seeder控制面记录句柄 = Arc<Mutex<假Seeder控制面记录>>;

fn 构造有效测试torrent元信息(seed: &str) -> (Vec<u8>, String, i32) {
    let shared_bytes = format!("koko-valid-test-media-{seed}").into_bytes();
    let file_name = format!("content-{seed}.mp4");
    let accessor = DirectAccessor::new(file_name.as_str(), shared_bytes.as_slice());
    let torrent_bytes = MetainfoBuilder::new()
        .set_private_flag(Some(true))
        .set_piece_length(PieceLength::OptBalanced)
        .build(1, accessor, |_| ())
        .expect("测试 torrent metainfo 必须能生成");
    let metainfo = Metainfo::from_bytes(torrent_bytes.as_slice())
        .expect("测试 torrent metainfo 必须能解析");
    (
        torrent_bytes,
        hex::encode(metainfo.info().info_hash().as_ref()),
        metainfo.info().piece_length() as i32,
    )
}

async fn 启动假seeder控制面() -> (String, 假Seeder控制面记录句柄, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能绑定假的 seeder 控制面端口");
    let address = listener
        .local_addr()
        .expect("应能读取假的 seeder 控制面地址");
    let records: 假Seeder控制面记录句柄 = Arc::new(Mutex::new(假Seeder控制面记录::default()));
    let app = Router::new()
        .route("/seed/start", post(记录假seeder_start请求))
        .route("/seed/reconcile", post(记录假seeder_reconcile请求))
        .with_state(records.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("假的 seeder 控制面应能启动");
    });
    // 做种对账会先发 start、再发 reconcile。
    // 如果 helper 在 listener 还没真正 accept 前就返回，早到的 start 可能因为竞态丢掉，
    // 只留下更晚的 reconcile 成功，进而把测试误导成“权威附件没有触发 start”。
    等待假seeder控制面就绪(address).await;
    (format!("http://{address}"), records, server)
}

async fn 等待假seeder控制面就绪(address: std::net::SocketAddr) {
    for _ in 0..50 {
        if TcpStream::connect(address).await.is_ok() {
            return;
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("假的 seeder 控制面未能在预期时间内进入可连接状态");
}

async fn 记录假seeder_start请求(
    AxumState(records): AxumState<假Seeder控制面记录句柄>,
    AxumJson(payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .start_payloads
        .push(payload);
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "created": true,
            "done": true,
            "progress": 1.0,
            "capability": "hybrid"
        })),
    )
}

/// 返回 done: false 的假 seeder，模拟 WebTorrent 尚未完成下载的场景。
/// 用于验证 reconcile 在 sidecar 未 done 时不写 backend strong seed presence。
async fn 记录假notready_seeder_start请求(
    AxumState(records): AxumState<假Seeder控制面记录句柄>,
    AxumJson(payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .start_payloads
        .push(payload);
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "created": true,
            "done": false,
            "progress": 0.3,
            "capability": "hybrid"
        })),
    )
}

/// 启动返回 not-ready（done: false）的假 seeder 控制面。
async fn 启动假notready_seeder控制面() -> (String, 假Seeder控制面记录句柄, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应能绑定假的 not-ready seeder 控制面端口");
    let address = listener
        .local_addr()
        .expect("应能读取假的 not-ready seeder 控制面地址");
    let records: 假Seeder控制面记录句柄 = Arc::new(Mutex::new(假Seeder控制面记录::default()));
    let app = Router::new()
        .route("/seed/start", post(记录假notready_seeder_start请求))
        .route("/seed/reconcile", post(记录假seeder_reconcile请求))
        .with_state(records.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("假的 not-ready seeder 控制面应能启动");
    });
    等待假seeder控制面就绪(address).await;
    (format!("http://{address}"), records, server)
}

async fn 记录假seeder_reconcile请求(
    AxumState(records): AxumState<假Seeder控制面记录句柄>,
    AxumJson(payload): AxumJson<serde_json::Value>,
) -> (StatusCode, AxumJson<serde_json::Value>) {
    records
        .lock()
        .expect("seeder 控制面记录锁不应中毒")
        .reconcile_payloads
        .push(payload);
    (
        StatusCode::OK,
        AxumJson(serde_json::json!({
            "ok": true,
            "activeCount": 1
        })),
    )
}

async fn 写入指定类型peer存活记录(
    pool: &PgPool,
    附件标识: &str,
    会话标识: &str,
    peer_kind: &str,
    最近peer存活时间戳秒: i64,
) {
    sqlx::query(
        "INSERT INTO swarm_peer_presence \
            (swarm_id, session_id, attachment_id, peer_kind, last_seen_at) \
         SELECT swarm_id, $2, $1, $3, TO_TIMESTAMP($4) \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = $1 \
         ON CONFLICT (swarm_id, session_id, peer_kind) \
         DO UPDATE SET \
            attachment_id = EXCLUDED.attachment_id, \
            last_seen_at = EXCLUDED.last_seen_at",
    )
    .bind(附件标识)
    .bind(会话标识)
    .bind(peer_kind)
    .bind(最近peer存活时间戳秒)
    .execute(pool)
    .await
    .expect("应能写入指定类型的 peer 存活记录");
}

/// 可用性裁决测试要守住“presence 不是 available source”：
/// 1. 空 body presence 只能表达“我还在线”，不能直接把媒体抬成 READY；
/// 2. 真正可用来源必须是 strong seed 或 verified complete peer。
#[path = "可用性裁决_presence与partial_peer.rs"]
mod availability_ruling_presence_partial_peer_tests;
#[path = "可用性裁决_web_seed过期.rs"]
mod availability_ruling_web_seed_expiry_tests;
#[path = "可用性裁决_deleted与strong_seed.rs"]
mod availability_ruling_deleted_and_strong_seed_tests;
#[path = "可用性裁决_做种对账.rs"]
mod availability_ruling_seeder_reconcile_tests;
