use axum::{
    Router,
    extract::{
        DefaultBodyLimit, OriginalUri, State,
        ws::{CloseFrame as AxumCloseFrame, Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{any, get, post},
};
use futures_util::{SinkExt, StreamExt};
use object_store::{
    ObjectStore, ObjectStoreExt,
    aws::{AmazonS3, AmazonS3Builder},
    local::LocalFileSystem,
    path::Path as ObjectPath,
};
use socketioxide::{
    SocketIo,
    extract::{Data, Extension, SocketRef, TryData},
    handler::ConnectHandler,
};
use sqlx::PgPool;
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_tungstenite::tungstenite;
use crate::{
    adapter::Pg仓储, media::distribution::application as 协作分发应用, media_distribution,
    realtime::shell as 实时外壳,
};

// 这三个私有子模块是 shell 内部的职责收口点。
// 总壳只保留装配与公共转码，具体协议逻辑分别沉到对应子模块。
#[path = "媒体/上传/外壳/tus回调.rs"]
mod tus_hook外壳;
#[path = "后台/外壳.rs"]
mod 后台外壳;
#[path = "媒体/上传/外壳/媒体上传.rs"]
mod 媒体上传外壳;
#[path = "媒体/上传/内容解析.rs"]
mod 媒体内容解析;
#[path = "媒体/资产/外壳.rs"]
mod 媒体资产外壳;
#[path = "房间/外壳.rs"]
mod 房间外壳;
#[path = "外壳/前端静态入口.rs"]
mod 前端静态入口;
#[path = "外壳/协议响应.rs"]
pub(crate) mod 协议响应;
/// 当前媒体上传运输契约仍统一走 TUS sidecar。
/// 先把常量收在 shell 父层，供上传外壳与 Tus hook 外壳共享，避免兄弟模块重复手抄字符串。
const 媒体上传运输方式_TUS: &str = "tus";
pub(crate) const TUS协议版本_HEADER值: &str = "1.0.0";
pub(crate) const TUS_INTERNAL_TERMINATION_GUARD_HEADER: &str = "X-Koko-Internal-Termination";

/// HTTP 入口只负责限制“单次请求体能进壳多少字节”，这是纯资源门禁，不是业务时长或媒体真相。
/// 把它显式收成常量，避免 prepare/脚本/body limit 三处再各写各的数字。
pub(crate) const 媒体上传HTTP请求体上限字节数: usize = 200 * 1024 * 1024;

/// 外壳层统一解析“必填但允许空字符串传进来的 session_id”。
/// 这属于多个 HTTP 壳共享的协议清洗，不应该继续挂在某个具体业务壳名下。
pub(super) fn 读取非空会话标识(
    raw_session_id: Option<String>,
) -> Result<String, (StatusCode, &'static str, &'static str)> {
    raw_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ))
}

/// 外壳层共享运行态，只存放“接线所需配置”，不承载业务事实。
#[derive(Clone)]
pub struct 应用状态 {
    pub pool: PgPool,
    pub runtime_handle: tokio::runtime::Handle,
    pub admin_password: String,
    pub attachment_storage_dir: String,
    pub attachment_store: Arc<dyn ObjectStore>,
    pub ffmpeg_bin: String,
    pub ffprobe_bin: String,
    pub shaka_packager_bin: String,
    pub swarm_tracker_public_url: String,
    pub swarm_tracker_port: u16,
    pub swarm_tracker_upstream_url: String,
    pub swarm_web_seed_public_endpoint: Option<String>,
    pub swarm_seeder_control_base_url: String,
    pub swarm_seeder_tracker_url: String,
    pub swarm_ticket_secret: Option<String>,
    pub swarm_ticket_ttl_seconds: i64,
    pub swarm_peer_presence_stale_seconds: i64,
    /// 连接群友窗口是 shell 运行态节奏，不是持久化业务真相：
    /// 1. 只用于把 locator 的连接/无种子状态节奏保持一致；
    /// 2. key 粒度是 `attachment_id + session_id`；
    /// 3. 进程重启后可重建，不参与 domain 权威事实。
    pub swarm_connecting_window_started_at: Arc<Mutex<HashMap<String, i64>>>,
    pub tus_public_endpoint: Option<String>,
    pub tus_server_port: u16,
    pub tus_base_path: String,
    pub tus_upload_dir: String,
    pub tus_internal_base_url: Option<String>,
    pub tus_internal_termination_token: Option<String>,
    pub media_complete_max_concurrency: usize,
    pub media_complete_gate: Arc<tokio::sync::Semaphore>,
}

fn 推导对象父前缀(存储键: &str) -> Option<ObjectPath> {
    let (前缀, _) = 存储键.rsplit_once('/')?;
    if 前缀.trim().is_empty() {
        return None;
    }
    Some(ObjectPath::from(前缀))
}

/// manifest 清理必须递归删除同目录下的 playlist/segment。
/// 这里只负责对象删除，不承担“该不该删”的业务判断。
async fn 删除对象前缀下所有文件(
    attachment_store: &Arc<dyn ObjectStore>,
    前缀: &ObjectPath,
) -> io::Result<()> {
    let mut 待遍历前缀 = vec![前缀.clone()];
    while let Some(当前前缀) = 待遍历前缀.pop() {
        let list_result = attachment_store
            .list_with_delimiter(Some(&当前前缀))
            .await
            .map_err(|err| io::Error::other(format!("列出对象前缀失败: {err}")))?;
        for object_meta in list_result.objects {
            match attachment_store.delete(&object_meta.location).await {
                Ok(_) | Err(object_store::Error::NotFound { .. }) => {}
                Err(err) => {
                    return Err(io::Error::other(format!(
                        "删除对象失败(prefix={}, object={}): {err}",
                        当前前缀, object_meta.location
                    )));
                }
            }
        }
        待遍历前缀.extend(list_result.common_prefixes);
    }
    Ok(())
}

/// 组装 HTTP 冷路径 + Realtime 热路径路由。
///
/// 分层约束：
/// 1. 这里做协议接线，不做业务裁决。
/// 2. 命令是否成立必须交给 application + domain + repository 主链。
/// 3. 前端静态资源同源托管，减少开发期跨域噪音和双端口复杂度。
pub async fn 构建应用状态(
    database_url: String,
    admin_password: String,
) -> std::io::Result<应用状态> {
    let media_storage = crate::assembly::读取媒体存储配置()?;
    let media_packaging = crate::assembly::读取媒体打包配置();
    let swarm = crate::assembly::读取协作分发配置()?;
    let tus = crate::assembly::读取媒体_tus侧车配置()?;
    let media_complete_max_concurrency = crate::assembly::读取媒体上传完成并发上限()?;
    let database_pool = crate::assembly::读取数据库连接池配置()?;
    let attachment_storage_dir = crate::assembly::读取附件存储目录();
    fs::create_dir_all(&tus.upload_dir)
        .map_err(|err| std::io::Error::other(format!("创建媒体 Tus 上传目录失败: {err}")))?;
    let attachment_store = 构建附件对象存储(&media_storage, &attachment_storage_dir)?;
    tracing::info!(
        database_pool_max_connections = database_pool.app_max_connections,
        database_pool_min_connections = database_pool.app_min_connections,
        database_pool_acquire_timeout_ms = database_pool.acquire_timeout_ms,
        database_pool_connect_timeout_ms = database_pool.connect_timeout_ms,
        "应用数据库连接池配置已加载"
    );
    let pool = tokio::time::timeout(
        database_pool.connect_timeout(),
        database_pool.应用连接池选项().connect(&database_url),
    )
    .await
    .map_err(|_| std::io::Error::other("连接数据库超时"))?
    .map_err(|err| std::io::Error::other(format!("连接数据库失败: {err}")))?;

    Ok(应用状态 {
        pool,
        runtime_handle: tokio::runtime::Handle::current(),
        admin_password,
        attachment_storage_dir,
        attachment_store,
        ffmpeg_bin: media_packaging.ffmpeg_bin,
        ffprobe_bin: media_packaging.ffprobe_bin,
        shaka_packager_bin: media_packaging.shaka_packager_bin,
        swarm_tracker_public_url: swarm.tracker_public_url,
        swarm_tracker_port: swarm.tracker_port,
        swarm_tracker_upstream_url: swarm.tracker_upstream_url,
        swarm_web_seed_public_endpoint: swarm.web_seed_public_endpoint,
        swarm_seeder_control_base_url: swarm.seeder_control_base_url,
        swarm_seeder_tracker_url: swarm.seeder_tracker_url,
        swarm_ticket_secret: swarm.ticket_secret,
        swarm_ticket_ttl_seconds: swarm.ticket_ttl_seconds,
        swarm_peer_presence_stale_seconds: swarm.peer_presence_stale_seconds,
        swarm_connecting_window_started_at: Arc::new(Mutex::new(HashMap::new())),
        tus_public_endpoint: tus.public_endpoint,
        tus_server_port: tus.server_port,
        tus_base_path: tus.base_path,
        tus_upload_dir: tus.upload_dir,
        tus_internal_base_url: tus.internal_base_url,
        tus_internal_termination_token: tus.internal_termination_token,
        media_complete_max_concurrency,
        media_complete_gate: Arc::new(tokio::sync::Semaphore::new(media_complete_max_concurrency)),
    })
}

/// 执行一次媒体冷源清理：
/// 1. 应用层先给出“哪些图片原图 / 视频 mezzanine / 流媒体清单该删了”；
/// 2. 壳层真正删除对象存储里的短期回退对象；
/// 3. 删除成功后再把删除时间回写到附件真相。
///
/// 这样 24 小时规则就不再只是一个时间戳约定，而会真的落成“对象退场 + 真相留痕”的闭环。
pub async fn 执行一次媒体冷源清理(state: 应用状态) -> io::Result<()> {
    let 当前时间戳秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_query = state.clone();
    let 待清理冷源 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        crate::application::列出待清理媒体冷源(&repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理媒体冷源失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("冷源清理查询任务失败: {err}")))??;

    for 冷源 in 待清理冷源 {
        let object_path = ObjectPath::from(冷源.原始内容存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(object_store::Error::NotFound { .. }) => {}
            Err(err) => {
                tracing::error!(
                    application = "媒体冷源清理",
                    adapter = "shell",
                    outcome = "failed",
                    attachment_id = 冷源.附件标识.as_str(),
                    storage_key = 冷源.原始内容存储键.as_str(),
                    error = %err,
                    "删除原始冷源对象失败"
                );
                continue;
            }
        }

        let state_for_mark = state.clone();
        let attachment_id = 冷源.附件标识.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_mark);
            crate::application::标记媒体冷源已删除(&mut repo, &attachment_id, 当前时间戳秒)
                .map_err(|err| io::Error::other(format!("标记媒体冷源已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("冷源清理写回任务失败: {err}")))??;
    }

    let state_for_query = state.clone();
    let 待清理canonical资产 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        crate::application::列出待清理canonical媒体资产(&repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理 canonical 媒体资产失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("canonical 媒体资产清理查询任务失败: {err}")))??;

    for 资产 in 待清理canonical资产 {
        let object_path = ObjectPath::from(资产.存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(object_store::Error::NotFound { .. }) => {}
            Err(err) => {
                tracing::error!(
                    application = "媒体冷源清理",
                    adapter = "shell",
                    outcome = "failed",
                    content_hash = 资产.content_hash.as_str(),
                    storage_key = 资产.存储键.as_str(),
                    error = %err,
                    "删除 canonical 媒体资产对象失败"
                );
                continue;
            }
        }

        let state_for_mark = state.clone();
        let content_hash = 资产.content_hash.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_mark);
            crate::application::标记canonical媒体资产已删除(
                &mut repo,
                &content_hash,
                当前时间戳秒,
            )
            .map_err(|err| io::Error::other(format!("标记 canonical 媒体资产已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("canonical 媒体资产清理写回任务失败: {err}")))??;
    }

    let state_for_query = state.clone();
    let 待清理回退母本 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        crate::application::列出待清理媒体回退母本(&repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理媒体回退母本失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("回退母本清理查询任务失败: {err}")))??;

    for 回退母本 in 待清理回退母本 {
        let object_path = ObjectPath::from(回退母本.回退母本存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(object_store::Error::NotFound { .. }) => {}
            Err(err) => {
                tracing::error!(
                    application = "媒体冷源清理",
                    adapter = "shell",
                    outcome = "failed",
                    attachment_id = 回退母本.附件标识.as_str(),
                    storage_key = 回退母本.回退母本存储键.as_str(),
                    error = %err,
                    "删除视频 mezzanine 回退母本失败"
                );
                continue;
            }
        }

        let state_for_mark = state.clone();
        let attachment_id = 回退母本.附件标识.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_mark);
            crate::application::标记媒体回退母本已删除(
                &mut repo,
                &attachment_id,
                当前时间戳秒,
            )
            .map_err(|err| io::Error::other(format!("标记媒体回退母本已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("回退母本清理写回任务失败: {err}")))??;
    }

    let state_for_query = state.clone();
    let 待清理流媒体清单 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        crate::application::列出待清理流媒体清单(&repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理流媒体清单失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("流媒体清理查询任务失败: {err}")))??;

    for 清单 in 待清理流媒体清单 {
        let Some(hls前缀) = 推导对象父前缀(清单.hls主清单存储键.as_str()) else {
            tracing::error!(
                application = "媒体冷源清理",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 清单.附件标识.as_str(),
                storage_key = 清单.hls主清单存储键.as_str(),
                "流媒体清单缺少可删除的 HLS 父前缀"
            );
            continue;
        };
        let Some(dash前缀) = 推导对象父前缀(清单.dash主清单存储键.as_str()) else {
            tracing::error!(
                application = "媒体冷源清理",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 清单.附件标识.as_str(),
                storage_key = 清单.dash主清单存储键.as_str(),
                "流媒体清单缺少可删除的 DASH 父前缀"
            );
            continue;
        };

        if let Err(err) = 删除对象前缀下所有文件(&state.attachment_store, &hls前缀).await
        {
            tracing::error!(
                application = "媒体冷源清理",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 清单.附件标识.as_str(),
                storage_key = 清单.hls主清单存储键.as_str(),
                error = %err,
                "删除 HLS 流媒体对象前缀失败"
            );
            continue;
        }
        if let Err(err) = 删除对象前缀下所有文件(&state.attachment_store, &dash前缀).await
        {
            tracing::error!(
                application = "媒体冷源清理",
                adapter = "shell",
                outcome = "failed",
                attachment_id = 清单.附件标识.as_str(),
                storage_key = 清单.dash主清单存储键.as_str(),
                error = %err,
                "删除 DASH 流媒体对象前缀失败"
            );
            continue;
        }

        let state_for_mark = state.clone();
        let attachment_id = 清单.附件标识.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_mark);
            crate::application::标记流媒体清单已删除(&mut repo, &attachment_id, 当前时间戳秒)
                .map_err(|err| io::Error::other(format!("标记流媒体清单已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("流媒体清理写回任务失败: {err}")))??;
    }

    Ok(())
}

fn 上传残留清理原因标签(
    原因: crate::application::上传残留清理原因
) -> &'static str {
    match 原因 {
        crate::application::上传残留清理原因::已放弃会话 => "abandoned_session",
        crate::application::上传残留清理原因::最终合并后的分片残留 => {
            "finalized_partial"
        }
        crate::application::上传残留清理原因::已过期未完成上传 => "expired_unfinished",
    }
}

async fn 执行一次媒体上传残留清理_按会话(
    state: 应用状态,
    仅清理上传会话: Option<&str>,
) -> io::Result<()> {
    let 当前时间戳秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let 限定上传会话 = 仅清理上传会话.map(str::to_string);
    let state_for_query = state.clone();
    let 待清理残留 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        crate::application::列出待清理上传残留(&repo, 当前时间戳秒, 256)
            .map_err(|err| io::Error::other(format!("查询待清理上传残留失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("上传残留清理查询任务失败: {err}")))??;

    let mut 分组结果: HashMap<
        (String, crate::application::上传残留清理原因),
        Vec<crate::application::待清理上传残留>,
    > = HashMap::new();
    for 残留 in 待清理残留 {
        if 限定上传会话
            .as_deref()
            .is_some_and(|target| target != 残留.上传会话标识)
        {
            continue;
        }
        分组结果
            .entry((残留.上传会话标识.clone(), 残留.清理原因))
            .or_default()
            .push(残留);
    }

    for ((上传会话标识, 清理原因), 残留列表) in 分组结果 {
        let mut 全部删除成功 = true;
        for 残留 in &残留列表 {
            let temp_file_path = match tus_hook外壳::解析tus残留清理目标(
                &state.tus_upload_dir,
                残留.临时文件定位.as_str(),
            ) {
                Ok(tus_hook外壳::Tus残留清理定位结果::当前上传目录文件(path)) => {
                    path
                }
                Ok(tus_hook外壳::Tus残留清理定位结果::当前上传目录文件已缺失) =>
                {
                    tracing::info!(
                        application = "上传残留清理",
                        adapter = "shell",
                        outcome = "skipped_missing_file",
                        attachment_id = 残留.附件标识.as_str(),
                        upload_session_id = 上传会话标识.as_str(),
                        cleanup_reason = 上传残留清理原因标签(清理原因),
                        storage_locator = 残留.临时文件定位.as_str(),
                        "上传残留文件已不存在，直接收口数据库真相"
                    );
                    continue;
                }
                Ok(tus_hook外壳::Tus残留清理定位结果::历史外部定位) => {
                    // 这里专门兜住历史 rustus 测试数据和旧 locator：
                    // 它们已经不属于当前 tus upload dir，继续报错只会在每次启动时制造噪音；
                    // 但 cleanup 也绝不能越权删当前 upload dir 之外的文件，所以这里只收口数据库真相。
                    tracing::info!(
                        application = "上传残留清理",
                        adapter = "shell",
                        outcome = "skipped_legacy_external_locator",
                        attachment_id = 残留.附件标识.as_str(),
                        upload_session_id = 上传会话标识.as_str(),
                        cleanup_reason = 上传残留清理原因标签(清理原因),
                        storage_locator = 残留.临时文件定位.as_str(),
                        "历史外部 storage locator 已不再属于当前 Tus upload dir，仅收口数据库真相"
                    );
                    continue;
                }
                Err(message) => {
                    tracing::error!(
                        application = "上传残留清理",
                        adapter = "shell",
                        outcome = "failed",
                        attachment_id = 残留.附件标识.as_str(),
                        upload_session_id = 上传会话标识.as_str(),
                        cleanup_reason = 上传残留清理原因标签(清理原因),
                        storage_locator = 残留.临时文件定位.as_str(),
                        error = %message,
                        "解析上传残留临时文件路径失败"
                    );
                    全部删除成功 = false;
                    continue;
                }
            };
            match tokio::fs::remove_file(temp_file_path.as_path()).await {
                Ok(_) => {}
                Err(err) if err.kind() == io::ErrorKind::NotFound => {}
                Err(err) => {
                    tracing::error!(
                        application = "上传残留清理",
                        adapter = "shell",
                        outcome = "failed",
                        attachment_id = 残留.附件标识.as_str(),
                        upload_session_id = 上传会话标识.as_str(),
                        cleanup_reason = 上传残留清理原因标签(清理原因),
                        storage_locator = 残留.临时文件定位.as_str(),
                        error = %err,
                        "删除上传残留临时文件失败"
                    );
                    全部删除成功 = false;
                }
            }
        }
        if !全部删除成功 {
            continue;
        }

        let state_for_mark = state.clone();
        let 上传会话标识 = 上传会话标识.clone();
        tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_mark);
            crate::application::标记上传残留已清理(
                &mut repo,
                &上传会话标识,
                清理原因,
                当前时间戳秒,
            )
            .map_err(|err| io::Error::other(format!("标记上传残留已清理失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("上传残留清理写回任务失败: {err}")))??;
    }

    Ok(())
}

/// 上传残留清理属于“上传生命周期尾处理”，不属于冷源 TTL。
/// 这里单独公开入口，给后台 loop 和 abandon 冷路径共用，避免两处各自发明第二套文件清理逻辑。
pub async fn 执行一次媒体上传残留清理(state: 应用状态) -> io::Result<()> {
    执行一次媒体上传残留清理_按会话(state, None).await
}

/// 后端 owner 发给 seeder sidecar 的最小启动命令。
/// 这里只保留协议执行所需字段，不把业务裁决泄漏到 sidecar。
#[derive(Debug, Clone)]
pub(super) struct 协作分发做种启动命令 {
    pub info_hash: String,
    pub announce_urls: Vec<String>,
    pub web_seed_url: Option<String>,
    pub torrent_url: Option<String>,
    pub join_ticket: Option<String>,
}

/// 后端 strong seed 是基础设施 owner，不应冒充任何前端会话。
/// 这里使用固定系统会话标识，专门记录 backend seeder 的 swarm presence。
#[allow(non_upper_case_globals)]
const 后端强种子系统会话标识: &str = "__backend_strong_seed__";

/// sidecar 拉取 `.torrent` / `web seed` 时必须拿到绝对 URL：
/// 1. 优先允许运维显式指定 `SWARM_SEEDER_MEDIA_BASE_URL`；
/// 2. 没配时回退到本机后端 `APP_PORT`（默认 8080）；
/// 3. 只在 sidecar 命令面使用，不影响前端 contract 里继续保留相对地址真相。
fn 读取sidecar媒体基准地址() -> String {
    let from_env = std::env::var("SWARM_SEEDER_MEDIA_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    if let Some(value) = from_env {
        return value;
    }
    let app_port = std::env::var("APP_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(8080);
    format!("http://127.0.0.1:{app_port}")
}

/// 把 runtime 分发里的相对路径收口成 sidecar 可直接请求的绝对 URL。
/// 这样可以避免 Node 端把 `/api/...` 误判成 `Invalid torrent identifier`。
fn 归一化sidecar媒体地址(raw: Option<&str>) -> Option<String> {
    let value = raw.map(str::trim).filter(|value| !value.is_empty())?;
    if value.starts_with("http://") || value.starts_with("https://") {
        return Some(value.to_string());
    }
    let base_url = 读取sidecar媒体基准地址();
    if value.starts_with('/') {
        return Some(format!("{base_url}{value}"));
    }
    Some(format!("{base_url}/{}", value.trim_start_matches('/')))
}

/// 把 runtime 分发响应收口成 sidecar 可执行命令。
/// 约束：
/// 1. 缺少 `torrent_info_hash` 时不能启动做种；
/// 2. 缺少 `join_ticket` 时不能启动做种；后端 strong seed 也必须走同源 tracker 门禁；
/// 3. sidecar 只吃 transport 线索，不承载页面态字段；
/// 4. 浏览器 public announce 已在 locator contract 里返回，这里只能使用 sidecar 私有 announce。
pub(super) fn 从协作分发响应构造做种启动命令(
    runtime_distribution: &serde_json::Value,
    seeder_tracker_url: &str,
) -> Option<协作分发做种启动命令> {
    let info_hash = runtime_distribution["torrent_info_hash"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let seeder_tracker_url = seeder_tracker_url.trim();
    // 注意：runtime_distribution["announce_urls"] 是浏览器公开入口，HTTPS 下通常是 WSS 反代地址。
    // Node sidecar 在服务端本机做强种子，应走内网 tracker，避免把公开反代入口误当成基础设施回环。
    let announce_urls = if seeder_tracker_url.is_empty() {
        Vec::new()
    } else {
        vec![seeder_tracker_url.to_string()]
    };
    let web_seed_url = 归一化sidecar媒体地址(runtime_distribution["web_seed_url"].as_str());
    let torrent_url = 归一化sidecar媒体地址(runtime_distribution["torrent_url"].as_str());
    let join_ticket = runtime_distribution["join_ticket"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)?;
    Some(协作分发做种启动命令 {
        info_hash,
        announce_urls,
        web_seed_url,
        torrent_url,
        join_ticket: Some(join_ticket),
    })
}

/// 尝试触发一次 seeder start。
/// 失败时调用方可自行决定是否降级重试；这里保持错误可见，不吞掉基础设施问题。
pub(super) async fn 尝试启动协作分发做种(
    state: &应用状态,
    命令: &协作分发做种启动命令,
) -> io::Result<()> {
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
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let detail = response
        .text()
        .await
        .unwrap_or_else(|_| String::from("<empty>"));
    Err(io::Error::other(format!(
        "调用 seeder start 返回非成功状态: status={status}, detail={detail}"
    )))
}

/// 周期性做种对账：
/// 1. 从权威库拉取仍在 0-24h 强 seed 窗口的附件；
/// 2. 逐条尝试 start（幂等）；
/// 3. 再把当前活跃 info_hash 集合下发给 sidecar reconcile，回收过期会话。
pub async fn 执行一次协作分发做种对账(state: 应用状态) -> io::Result<()> {
    let 当前时间戳秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_query = state.clone();
    let 待做种项 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        协作分发应用::列出待做种协作分发项(&repo, 当前时间戳秒, 256)
            .map_err(|err| io::Error::other(format!("查询待做种协作分发项失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("做种对账查询任务失败: {err}")))??;

    let mut active_info_hashes = HashSet::new();
    for 待做种 in 待做种项 {
        let distribution_snapshot = crate::application::协作分发元数据快照 {
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
            },
        );
        let Some(启动命令) = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            state.swarm_seeder_tracker_url.as_str(),
        ) else {
            continue;
        };
        active_info_hashes.insert(启动命令.info_hash.clone());
        if let Err(err) = 尝试启动协作分发做种(&state, &启动命令).await {
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
        let state_for_presence = state.clone();
        let swarm_id = 待做种.swarm_id.clone();
        let attachment_id = 待做种.附件标识.clone();
        let upsert_presence = tokio::task::spawn_blocking(move || {
            let mut repo = 构建共享仓储(&state_for_presence);
            协作分发应用::写入协作分发swarm存活(
                &mut repo,
                &crate::application::协作分发swarm存活写入请求 {
                    swarm_id,
                    附件标识: attachment_id,
                    会话标识: 后端强种子系统会话标识.to_string(),
                    存活类型: crate::application::协作分发存活类型后端强种子.to_string(),
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
                "做种 start 成功但写入 backend strong seed 存活失败，等待下一轮重试"
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
    }

    let mut active_info_hashes = active_info_hashes.into_iter().collect::<Vec<_>>();
    active_info_hashes.sort();
    let reconcile_payload = serde_json::json!({
        "activeInfoHashes": active_info_hashes
    });
    let reconcile_url = format!("{}/seed/reconcile", state.swarm_seeder_control_base_url);
    let reconcile_response = reqwest::Client::new()
        .post(reconcile_url.as_str())
        .json(&reconcile_payload)
        .send()
        .await
        .map_err(|err| io::Error::other(format!("调用 seeder reconcile 失败: {err}")))?;
    if reconcile_response.status().is_success() {
        return Ok(());
    }
    let status = reconcile_response.status();
    let detail = reconcile_response
        .text()
        .await
        .unwrap_or_else(|_| String::from("<empty>"));
    Err(io::Error::other(format!(
        "调用 seeder reconcile 返回非成功状态: status={status}, detail={detail}"
    )))
}

/// 统一装配附件对象存储：
/// - local 继续服务测试与回滚窗；
/// - s3 兼容模式只负责 canonical 附件对象读写，不再承担浏览器直传签名。
fn 构建附件对象存储(
    media_storage: &crate::assembly::媒体存储配置,
    attachment_storage_dir: &str,
) -> std::io::Result<Arc<dyn ObjectStore>> {
    match media_storage.驱动 {
        crate::assembly::媒体存储驱动::本地目录 => {
            fs::create_dir_all(attachment_storage_dir)
                .map_err(|err| std::io::Error::other(format!("创建附件目录失败: {err}")))?;
            let attachment_store = LocalFileSystem::new_with_prefix(attachment_storage_dir)
                .map_err(|err| std::io::Error::other(format!("初始化附件存储失败: {err}")))?;
            Ok(Arc::new(attachment_store))
        }
        crate::assembly::媒体存储驱动::S3兼容 => {
            let bucket = media_storage.bucket.as_deref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "缺少 MEDIA_STORAGE_BUCKET",
                )
            })?;
            let access_key_id = media_storage.access_key_id.as_deref().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "缺少 MEDIA_STORAGE_ACCESS_KEY_ID",
                )
            })?;
            let secret_access_key =
                media_storage.secret_access_key.as_deref().ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "缺少 MEDIA_STORAGE_SECRET_ACCESS_KEY",
                    )
                })?;

            let store = 构建_s3客户端(
                media_storage.endpoint.as_deref(),
                bucket,
                media_storage.region.as_str(),
                access_key_id,
                secret_access_key,
                media_storage.path_style,
            )?;
            Ok(Arc::new(store))
        }
    }
}

fn 构建_s3客户端(
    endpoint: Option<&str>,
    bucket: &str,
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
    path_style: bool,
) -> std::io::Result<AmazonS3> {
    let mut builder = AmazonS3Builder::new()
        .with_region(region)
        .with_bucket_name(bucket)
        .with_access_key_id(access_key_id)
        .with_secret_access_key(secret_access_key)
        .with_virtual_hosted_style_request(!path_style);
    if let Some(endpoint) = endpoint {
        builder = builder.with_endpoint(endpoint);
        if endpoint.starts_with("http://") {
            builder = builder.with_allow_http(true);
        }
    }
    builder
        .build()
        .map_err(|err| std::io::Error::other(format!("初始化 S3 兼容对象存储失败: {err}")))
}

/// 协作分发 tracker 同源代理：
/// 1. 浏览器永远连当前应用域名下的 `/api/swarm/announce`，不再直连 tracker upstream；
/// 2. 壳层只做首帧入场门禁和 websocket 字节转发，不承载 peer/offer/swarm 状态；
/// 3. 验证通过后首帧原样透传给成熟 tracker，保证 WebTorrent 协议语义不漂移。
async fn proxy_swarm_tracker_announce(
    State(state): State<应用状态>,
    original_uri: OriginalUri,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let announce_query = original_uri.0.query().unwrap_or_default();
    let upstream_url =
        拼接tracker上游查询(state.swarm_tracker_upstream_url.as_str(), announce_query);
    let ticket_secret = state.swarm_ticket_secret.clone();
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = relay_swarm_tracker_socket(socket, upstream_url, ticket_secret).await {
            if error.应该写启动器warn() {
                tracing::warn!(
                    application = "协作分发tracker代理",
                    adapter = "http",
                    outcome = "failed",
                    error_code = "swarm_tracker_proxy_failed",
                    detail = %error,
                    "同源 tracker 代理转发失败"
                );
            } else {
                tracing::debug!(
                    application = "协作分发tracker验票",
                    adapter = "http",
                    outcome = "rejected",
                    error_code = "swarm_tracker_join_ticket_rejected",
                    invalid_reason = error.invalid_reason().unwrap_or("unknown"),
                    info_hash = error.info_hash().unwrap_or("unknown"),
                    detail = %error,
                    "tracker 首帧被入场门禁拒绝"
                );
            }
        }
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tracker代理错误 {
    门禁拒绝 {
        invalid_reason: &'static str,
        detail: String,
        info_hash: Option<String>,
    },
    代理转发失败(String),
}

impl Tracker代理错误 {
    fn 应该写启动器warn(&self) -> bool {
        matches!(self, Self::代理转发失败(_))
    }

    fn invalid_reason(&self) -> Option<&'static str> {
        match self {
            Self::门禁拒绝 { invalid_reason, .. } => Some(*invalid_reason),
            Self::代理转发失败(_) => None,
        }
    }

    fn info_hash(&self) -> Option<&str> {
        match self {
            Self::门禁拒绝 { info_hash, .. } => info_hash.as_deref(),
            Self::代理转发失败(_) => None,
        }
    }
}

impl std::fmt::Display for Tracker代理错误 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::门禁拒绝 { detail, .. } | Self::代理转发失败(detail) => {
                formatter.write_str(detail)
            }
        }
    }
}

async fn relay_swarm_tracker_socket(
    socket: WebSocket,
    upstream_url: String,
    ticket_secret: Option<String>,
) -> Result<(), Tracker代理错误> {
    let (mut client_writer, mut client_reader) = socket.split();
    let first_client_message = client_reader
        .next()
        .await
        .ok_or_else(|| Tracker代理错误::门禁拒绝 {
            invalid_reason: "client_closed_before_first_frame",
            detail: "客户端在发送 tracker 首帧前已断开".to_string(),
            info_hash: None,
        })?
        .map_err(|error| Tracker代理错误::门禁拒绝 {
            invalid_reason: "read_first_frame_failed",
            detail: format!("读取客户端 tracker 首帧失败: {error}"),
            info_hash: None,
        })?;

    // 这里不是自研 tracker：只做业务入场门禁，验证首帧后不维护 peer、offer、swarm 状态。
    // WebTorrent signaling 全部交给成熟 tracker upstream。
    校验tracker首帧门禁(&first_client_message, ticket_secret.as_deref())?;

    let first_upstream_message = axum_ws_message_to_tungstenite(first_client_message)
        .ok_or_else(|| Tracker代理错误::门禁拒绝 {
            invalid_reason: "non_forwardable_first_frame",
            detail: "tracker 首帧不是可转发消息".to_string(),
            info_hash: None,
        })?;
    let (upstream_socket, _) = tokio_tungstenite::connect_async(upstream_url.as_str())
        .await
        .map_err(|error| {
            Tracker代理错误::代理转发失败(format!("连接 tracker upstream 失败: {error}"))
        })?;
    let (mut upstream_writer, mut upstream_reader) = upstream_socket.split();
    upstream_writer
        .send(first_upstream_message)
        .await
        .map_err(|error| {
            Tracker代理错误::代理转发失败(format!("写入 tracker upstream 首帧失败: {error}"))
        })?;

    let client_to_upstream = async {
        while let Some(message_result) = client_reader.next().await {
            let message = message_result.map_err(|error| {
                Tracker代理错误::代理转发失败(format!("读取客户端 websocket 失败: {error}"))
            })?;
            let Some(upstream_message) = axum_ws_message_to_tungstenite(message) else {
                continue;
            };
            upstream_writer
                .send(upstream_message)
                .await
                .map_err(|error| {
                    Tracker代理错误::代理转发失败(format!(
                        "写入 tracker upstream websocket 失败: {error}"
                    ))
                })?;
        }
        Ok::<(), Tracker代理错误>(())
    };

    let upstream_to_client = async {
        while let Some(message_result) = upstream_reader.next().await {
            let message = message_result.map_err(|error| {
                Tracker代理错误::代理转发失败(format!(
                    "读取 tracker upstream websocket 失败: {error}"
                ))
            })?;
            let Some(client_message) = tungstenite_message_to_axum_ws(message) else {
                continue;
            };
            client_writer
                .send(client_message)
                .await
                .map_err(|error| {
                    Tracker代理错误::代理转发失败(format!("写入客户端 websocket 失败: {error}"))
                })?;
        }
        Ok::<(), Tracker代理错误>(())
    };

    tokio::select! {
        forward_result = client_to_upstream => forward_result?,
        backward_result = upstream_to_client => backward_result?,
    }
    Ok(())
}

fn 拼接tracker上游查询(base_url: &str, announce_query: &str) -> String {
    if announce_query.is_empty() {
        return base_url.to_string();
    }
    let separator = if base_url.contains('?') { '&' } else { '?' };
    format!("{base_url}{separator}{announce_query}")
}

fn 校验tracker首帧门禁(
    message: &AxumWsMessage,
    ticket_secret: Option<&str>,
) -> Result<(), Tracker代理错误> {
    let Some(secret) = ticket_secret else {
        return Ok(());
    };

    let (info_hash, ticket) = 解析tracker首帧门禁字段(message).map_err(|error| {
        // 旧页面、旧 service worker 或探测流可能发来不完整首帧；这里仍然拒绝，
        // 但它不是 tracker upstream 故障，不能污染 run.ps1 的 WARN 面。
        Tracker代理错误::门禁拒绝 {
            invalid_reason: "malformed_first_frame",
            detail: error,
            info_hash: None,
        }
    })?;
    let Some(ticket) = ticket else {
        return Err(Tracker代理错误::门禁拒绝 {
            invalid_reason: "missing_ticket",
            detail: "join_ticket_invalid".to_string(),
            info_hash: Some(info_hash),
        });
    };

    match media_distribution::诊断协作分发join_ticket(secret, info_hash.as_str(), ticket.as_str())
    {
        media_distribution::协作分发入群票据校验诊断::通过 => Ok(()),
        media_distribution::协作分发入群票据校验诊断::票据解码失败 => {
            Err(Tracker代理错误::门禁拒绝 {
                invalid_reason: "ticket_decode_failed",
                detail: "join_ticket_invalid".to_string(),
                info_hash: Some(info_hash),
            })
        }
        media_distribution::协作分发入群票据校验诊断::InfoHash不匹配 {
            票据内info_hash,
            session_id,
            attachment_id,
        } => Err(Tracker代理错误::门禁拒绝 {
            invalid_reason: "ticket_info_hash_mismatch",
            detail: format!(
                "join_ticket_invalid: expected_info_hash={info_hash}, ticket_info_hash={票据内info_hash}, session_id={}, attachment_id={}",
                session_id.as_deref().unwrap_or("unknown"),
                attachment_id.as_deref().unwrap_or("unknown")
            ),
            info_hash: Some(info_hash),
        }),
    }
}

fn 解析tracker首帧门禁字段(
    message: &AxumWsMessage,
) -> Result<(String, Option<String>), String> {
    let raw = match message {
        AxumWsMessage::Text(text) => text.as_str().as_bytes().to_vec(),
        AxumWsMessage::Binary(bytes) => bytes.to_vec(),
        _ => return Err("tracker 首帧必须是 JSON 文本或二进制 JSON".to_string()),
    };
    let value = serde_json::from_slice::<serde_json::Value>(raw.as_slice())
        .map_err(|error| format!("解析 tracker 首帧 JSON 失败: {error}"))?;
    let info_hash = value
        .get("info_hash")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "tracker 首帧缺少 info_hash".to_string())
        .and_then(归一化tracker_info_hash)?;
    let ticket = value
        .get("ticket")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    Ok((info_hash, ticket))
}

fn 归一化tracker_info_hash(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.len() == 40 && value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Ok(value.to_ascii_lowercase());
    }

    let mut bytes = Vec::with_capacity(20);
    for ch in value.chars() {
        let code = ch as u32;
        if code > u8::MAX as u32 {
            return Err("tracker 首帧 info_hash 不是 20 字节或 40 位 hex".to_string());
        }
        bytes.push(code as u8);
    }
    if bytes.len() != 20 {
        return Err("tracker 首帧 info_hash 不是 20 字节或 40 位 hex".to_string());
    }
    Ok(hex::encode(bytes))
}

fn axum_ws_message_to_tungstenite(message: AxumWsMessage) -> Option<tungstenite::Message> {
    match message {
        AxumWsMessage::Text(text) => Some(tungstenite::Message::Text(text.to_string().into())),
        AxumWsMessage::Binary(bytes) => Some(tungstenite::Message::Binary(bytes)),
        AxumWsMessage::Ping(bytes) => Some(tungstenite::Message::Ping(bytes)),
        AxumWsMessage::Pong(bytes) => Some(tungstenite::Message::Pong(bytes)),
        AxumWsMessage::Close(_) => Some(tungstenite::Message::Close(None)),
    }
}

fn tungstenite_message_to_axum_ws(message: tungstenite::Message) -> Option<AxumWsMessage> {
    match message {
        tungstenite::Message::Text(text) => Some(AxumWsMessage::Text(text.to_string().into())),
        tungstenite::Message::Binary(bytes) => Some(AxumWsMessage::Binary(bytes)),
        tungstenite::Message::Ping(bytes) => Some(AxumWsMessage::Ping(bytes)),
        tungstenite::Message::Pong(bytes) => Some(AxumWsMessage::Pong(bytes)),
        tungstenite::Message::Close(_) => Some(AxumWsMessage::Close(None::<AxumCloseFrame>)),
        tungstenite::Message::Frame(_) => None,
    }
}

pub fn 构建路由(state: 应用状态) -> Router {
    let (socket_layer, io) = SocketIo::new_layer();
    注册realtime命名空间(&io, state.clone());
    let normalized_tus_base_path =
        媒体上传外壳::标准化媒体_tus基础路径(state.tus_base_path.as_str());
    let tus_resource_proxy_path = format!("{normalized_tus_base_path}/{{*tus_upload_tail}}");

    Router::new()
        .route(
            normalized_tus_base_path.as_str(),
            any(媒体上传外壳::proxy_tus_upload_transport),
        )
        .route(
            tus_resource_proxy_path.as_str(),
            any(媒体上传外壳::proxy_tus_upload_transport),
        )
        .route("/api/session/bootstrap", post(房间外壳::bootstrap_session))
        .route(
            "/api/rooms/join-or-create",
            post(房间外壳::join_or_create_room),
        )
        .route(
            "/api/media/{attachment_kind}/prepare",
            post(媒体上传外壳::prepare_media_upload),
        )
        .route(
            "/api/media/{attachment_kind}/source-dedupe",
            post(媒体上传外壳::reuse_media_by_source_hash),
        )
        .route(
            "/api/media/{attachment_kind}/forward",
            post(媒体上传外壳::forward_media_attachment),
        )
        .route(
            "/api/media/{attachment_id}/complete",
            post(媒体上传外壳::complete_media_upload),
        )
        .route(
            "/api/media/{attachment_id}/abandon",
            post(媒体上传外壳::abandon_media_upload),
        )
        .route("/internal/tus/hooks", post(tus_hook外壳::handle_tus_hook))
        .route(
            "/api/media/{attachment_id}/locator",
            get(媒体资产外壳::load_media_locator),
        )
        .route(
            "/api/media/{attachment_id}/blob/{asset_variant}",
            get(媒体资产外壳::load_blob_asset_content),
        )
        .route(
            "/api/media/{attachment_id}/torrent",
            get(媒体资产外壳::load_media_torrent),
        )
        .route(
            media_distribution::同源协作分发ANNOUNCE路径,
            get(proxy_swarm_tracker_announce),
        )
        .route(
            "/api/media/{attachment_id}/presence",
            post(媒体资产外壳::update_media_distribution_presence),
        )
        .route(
            "/api/attachments/{attachment_id}/content",
            get(媒体资产外壳::load_attachment_content),
        )
        .route(
            "/api/rooms/{room_id}/snapshot",
            get(房间外壳::load_room_snapshot),
        )
        .route(
            "/api/rooms/{room_id}/read-anchor",
            post(房间外壳::update_room_read_anchor),
        )
        .route(
            "/api/rooms/{room_id}/history",
            get(房间外壳::load_room_history),
        )
        .route(
            "/api/rooms/{room_id}/events",
            get(房间外壳::load_room_events),
        )
        .route("/api/admin/login", post(后台外壳::admin_login))
        .route("/api/admin/overview", get(后台外壳::admin_overview))
        .route("/api/admin/rooms", get(后台外壳::admin_rooms))
        .route(
            "/api/admin/rooms/{room_id}",
            get(后台外壳::admin_room_detail),
        )
        .merge(前端静态入口::构建前端静态资源路由())
        .layer(DefaultBodyLimit::max(媒体上传HTTP请求体上限字节数))
        .layer(socket_layer)
        .with_state(state)
}

/// 注册单节点 realtime 命名空间。
/// 约束：连接级认证在 connect middleware 完成，消息 handler 不再相信 payload 身份。
/// 这里故意只保留 wiring；控制面 payload 翻译和热路径失败分级都继续沉在 `src/实时/外壳.rs`。
fn 注册realtime命名空间(io: &SocketIo, state: 应用状态) {
    let connect_state = state.clone();
    io.ns(
        "/",
        (move |socket: SocketRef| {
            let state_for_subscribe = state.clone();
            let state_for_send = state.clone();
            async move {
                socket.on_disconnect(|s: SocketRef, reason| async move {
                    实时外壳::记录realtime断开(s, reason);
                });

                // 控制面命令：建立订阅与补洞续接。
                socket.on(
                    "subscribe_room_stream",
                    move |s: SocketRef,
                          Extension(auth): Extension<实时外壳::已认证会话>,
                          Data::<实时外壳::RealtimeSubscribeBody>(payload)| {
                        let state = state_for_subscribe.clone();
                        async move {
                            实时外壳::handle_realtime_subscribe(s, auth, payload, state).await;
                        }
                    },
                );

                // 业务热命令：创建统一消息。
                socket.on(
                    "create_message",
                    move |s: SocketRef,
                          Extension(auth): Extension<实时外壳::已认证会话>,
                          Data::<实时外壳::RealtimeCreateMessageBody>(payload)| {
                        let state = state_for_send.clone();
                        async move {
                            实时外壳::handle_realtime_create_message(s, auth, payload, state)
                                .await;
                        }
                    },
                );
            }
        })
        .with(
            move |socket: SocketRef, TryData(auth): TryData<实时外壳::RealtimeConnectAuth>| {
                let state = connect_state.clone();
                async move { 实时外壳::认证realtime连接(socket, auth, state).await }
            },
        ),
    );
}

/// 共享状态 -> 仓储 的唯一构造入口。
/// 约束：热路径只复用共享连接池，不在 handler 里重复建池。
pub(crate) fn 构建共享仓储(state: &应用状态) -> Pg仓储 {
    Pg仓储::从连接池构建(state.pool.clone(), state.runtime_handle.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 做种启动命令缺少join_ticket时不得启动受保护tracker() {
        let runtime_distribution = serde_json::json!({
            "torrent_info_hash": "0123456789abcdef0123456789abcdef01234567",
            "torrent_url": "/api/media/att-test/torrent?session_id=s-test",
            "web_seed_url": "/api/attachments/att-test/content?session_id=s-test&variant=original",
            "join_ticket": null,
        });

        let 命令 = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            "ws://127.0.0.1:18080/api/swarm/announce",
        );

        assert!(
            命令.is_none(),
            "sidecar 强种子也必须持票入群；缺票时不能构造 start 命令再让 tracker 打 missing_ticket"
        );
    }

    #[test]
    fn 做种启动命令会保留有效join_ticket() {
        let runtime_distribution = serde_json::json!({
            "torrent_info_hash": "0123456789abcdef0123456789abcdef01234567",
            "torrent_url": "/api/media/att-test/torrent?session_id=s-test",
            "web_seed_url": "/api/attachments/att-test/content?session_id=s-test&variant=original",
            "join_ticket": "ticket-valid",
        });

        let 命令 = 从协作分发响应构造做种启动命令(
            &runtime_distribution,
            "ws://127.0.0.1:18080/api/swarm/announce",
        )
        .expect("有 info_hash 与 join_ticket 时应能构造做种命令");

        assert_eq!(命令.join_ticket.as_deref(), Some("ticket-valid"));
    }

    #[test]
    fn tracker首帧缺少join_ticket是门禁拒绝而不是代理失败() {
        let message = AxumWsMessage::Text(
            r#"{"action":"announce","info_hash":"0123456789abcdef0123456789abcdef01234567","peer_id":"aaaaaaaaaaaaaaaaaaaa"}"#
                .to_string()
                .into(),
        );

        let error = 校验tracker首帧门禁(&message, Some("tracker-proxy-secret"))
            .expect_err("缺少 join_ticket 的首帧必须被门禁拒绝");

        assert!(
            !error.应该写启动器warn(),
            "旧浏览器或旧 service worker 的无票 announce 只是入场门禁拒绝，不能再冒充 run.ps1 的代理失败 WARN"
        );
        assert!(matches!(
            error,
            Tracker代理错误::门禁拒绝 {
                invalid_reason: "missing_ticket",
                info_hash: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn tracker首帧info_hash畸形是门禁拒绝而不是代理失败() {
        let message = AxumWsMessage::Text(
            r#"{"action":"announce","info_hash":"not-a-valid-info-hash","peer_id":"aaaaaaaaaaaaaaaaaaaa","ticket":"stale-ticket"}"#
                .to_string()
                .into(),
        );

        let error = 校验tracker首帧门禁(&message, Some("tracker-proxy-secret"))
            .expect_err("畸形 info_hash 的首帧必须被门禁拒绝");

        assert!(
            !error.应该写启动器warn(),
            "畸形旧首帧同样属于协议门禁拒绝，不应污染启动器 WARN"
        );
        assert!(matches!(
            error,
            Tracker代理错误::门禁拒绝 {
                invalid_reason: "malformed_first_frame",
                ..
            }
        ));
    }

    #[test]
    fn tracker真实转发失败仍然要写启动器warn() {
        let error = Tracker代理错误::代理转发失败("连接 tracker upstream 失败: refused".to_string());

        assert!(
            error.应该写启动器warn(),
            "真正的 upstream/转发故障仍必须保留 WARN，不能被门禁降噪一起吞掉"
        );
    }
}
