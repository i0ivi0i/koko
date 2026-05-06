use super::{应用状态, 构建共享仓储};
use crate::media::distribution::application as 协作分发应用;
use crate::media_distribution;
use crate::shell::协议响应::{err_resp, map_domain_err_tuple};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use object_store::{path::Path as ObjectPath, GetOptions, GetRange, ObjectStoreExt};
use std::{
    collections::HashMap,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::task;

#[path = "响应投影.rs"]
mod 响应投影;

pub(super) use 响应投影::{
    媒体允许投影静态预览, 媒体类型转标签, 媒体资产响应上下文, 媒体附件快照转响应体,
    定位媒体资产响应上下文, 构造媒体资产响应体, 构造定位媒体资产响应体, 构造附件受控地址,
    构造预览资源响应体, 附件状态转标签,
};

/// 附件内容 query 的内部稳定形状。
struct ParsedAttachmentContentQuery {
    session_id: String,
    variant: crate::media::模型::附件内容变体,
}

/// 只需要 session_id 的媒体资源 query 内部稳定形状。
struct ParsedSessionQuery {
    session_id: String,
}

struct ParsedDistributionPresencePayload {
    peer_kind: String,
}

/// 标准化后的单段 bytes Range。
struct 标准字节范围 {
    请求: GetRange,
    起始字节: u64,
    结束字节_不含: u64,
}

fn parse_attachment_content_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedAttachmentContentQuery, (StatusCode, &'static str, &'static str)> {
    let Some(session_id) = raw_query
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ));
    };
    let variant = match raw_query
        .get("variant")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        None | Some("original") => crate::media::模型::附件内容变体::原图,
        Some("thumbnail") => crate::media::模型::附件内容变体::缩略图,
        Some(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "variant 必须是 original 或 thumbnail",
            ));
        }
    };
    Ok(ParsedAttachmentContentQuery {
        session_id: session_id.to_string(),
        variant,
    })
}

fn parse_session_query(
    raw_query: HashMap<String, String>,
) -> Result<ParsedSessionQuery, (StatusCode, &'static str, &'static str)> {
    let Some(session_id) = raw_query
        .get("session_id")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 session_id",
        ));
    };
    Ok(ParsedSessionQuery {
        session_id: session_id.to_string(),
    })
}

fn parse_distribution_presence_payload(
    raw_body: &[u8],
) -> Result<ParsedDistributionPresencePayload, (StatusCode, &'static str, String)> {
    if raw_body.is_empty() {
        return Ok(ParsedDistributionPresencePayload {
            peer_kind: crate::media::模型::协作分发存活类型旁观意图.to_string(),
        });
    }
    let value: serde_json::Value = serde_json::from_slice(raw_body).map_err(|err| {
        (
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!("presence body 不是合法 JSON: {err}"),
        )
    })?;
    let peer_kind = value
        .get("peer_kind")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or(crate::media::模型::协作分发存活类型旁观意图);
    if !crate::media::模型::是有效协作分发存活类型(peer_kind) {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            format!(
                "peer_kind 仅支持 {} / {} / {} / {}",
                crate::media::模型::协作分发存活类型旁观意图,
                crate::media::模型::协作分发存活类型片段peer,
                crate::media::模型::协作分发存活类型完整peer,
                crate::media::模型::协作分发存活类型后端强种子
            ),
        ));
    }
    Ok(ParsedDistributionPresencePayload {
        peer_kind: peer_kind.to_string(),
    })
}

fn 解析标准字节范围(
    raw_range: Option<&axum::http::HeaderValue>,
    总字节数: u64,
) -> Result<Option<标准字节范围>, (StatusCode, &'static str, String)> {
    let Some(raw_range) = raw_range else {
        return Ok(None);
    };
    let raw_range = raw_range.to_str().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Range 请求头必须是合法 ASCII".to_string(),
        )
    })?;
    let raw_range = raw_range.trim();
    let Some(range_spec) = raw_range.strip_prefix("bytes=") else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Range 只支持 bytes 单位".to_string(),
        ));
    };
    if range_spec.contains(',') {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "当前只支持单段 bytes Range".to_string(),
        ));
    }
    let Some((start_raw, end_raw)) = range_spec.split_once('-') else {
        return Err((
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "Range 必须形如 bytes=start-end".to_string(),
        ));
    };

    let range = if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range suffix 必须是非负整数".to_string(),
            )
        })?;
        GetRange::Suffix(suffix_len)
    } else if end_raw.is_empty() {
        let start = start_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range 起始偏移必须是非负整数".to_string(),
            )
        })?;
        GetRange::Offset(start)
    } else {
        let start = start_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range 起始偏移必须是非负整数".to_string(),
            )
        })?;
        let end_inclusive = end_raw.parse::<u64>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "Range 结束偏移必须是非负整数".to_string(),
            )
        })?;
        GetRange::Bounded(start..end_inclusive.saturating_add(1))
    };

    let resolved = range.as_range(总字节数).map_err(|err| {
        (
            StatusCode::RANGE_NOT_SATISFIABLE,
            "requested_range_not_satisfiable",
            format!("Range 超出对象范围: {err}"),
        )
    })?;
    Ok(Some(标准字节范围 {
        请求: range,
        起始字节: resolved.start,
        结束字节_不含: resolved.end,
    }))
}

fn 构造content_range值(range: &标准字节范围, 总字节数: u64) -> String {
    format!(
        "bytes {}-{}/{}",
        range.起始字节,
        range.结束字节_不含.saturating_sub(1),
        总字节数
    )
}

/// 连接窗口状态只属于运行态调度，不进入持久化真相。
const 连接窗口状态最大保留秒: i64 = 60 * 60;
const 连接窗口状态清理阈值: usize = 4096;

fn 构造协作分发连接窗口键(attachment_id: &str, session_id: &str) -> String {
    format!("{attachment_id}:{session_id}")
}

/// 统一裁决“连接群友 <-> 无在线种子”的轮转节奏。
///
/// 规则：
/// 1. 没有窗口起点时，首次进入 `MEDIA_CONNECTING_TO_PEERS`；
/// 2. 起点后的前 8 秒保持连接态；
/// 3. 8 秒后进入 `MEDIA_NO_ONLINE_SEED`；
/// 4. 15 秒重试预算到点后，开启下一轮连接态。
fn 裁决连接群友窗口轮转(
    窗口起点秒: Option<i64>,
    当前时间戳秒: i64,
) -> (i64, &'static str, i64) {
    let 无在线种子重试周期秒 = media_distribution::无在线种子默认重试毫秒 / 1_000;
    let 当前起点秒 = 窗口起点秒.unwrap_or(当前时间戳秒);
    let 已过去秒 = 当前时间戳秒.saturating_sub(当前起点秒);

    if 窗口起点秒.is_none() || 已过去秒 >= 无在线种子重试周期秒 {
        return (
            当前时间戳秒,
            media_distribution::媒体状态连接群友中,
            media_distribution::连接群友默认重试毫秒,
        );
    }

    if 已过去秒 < media_distribution::连接群友窗口秒 {
        (
            当前起点秒,
            media_distribution::媒体状态连接群友中,
            media_distribution::连接群友默认重试毫秒,
        )
    } else {
        (
            当前起点秒,
            media_distribution::媒体状态无在线种子,
            media_distribution::无在线种子默认重试毫秒,
        )
    }
}

/// 把后端连接窗口节奏收口到 locator 运行态：
/// 1. `READY/DELETED` 清理窗口；
/// 2. `NO_ONLINE_SEED` 按 8 秒连接 + 15 秒重试周期轮转；
/// 3. `CONNECTING_TO_PEERS` 写回短重试节奏，避免壳层自猜。
fn 同步协作分发连接窗口状态(
    state: &应用状态,
    attachment_id: &str,
    session_id: &str,
    当前时间戳秒: i64,
    运行态分发: &mut serde_json::Value,
) {
    let Some(分发表面) = 运行态分发.as_object_mut() else {
        return;
    };
    let Some(媒体状态) = 分发表面
        .get_mut("media_state")
        .and_then(|value| value.as_object_mut())
    else {
        return;
    };
    let Some(状态码) = 媒体状态
        .get("code")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return;
    };
    let 键 = 构造协作分发连接窗口键(attachment_id, session_id);
    let Ok(mut 窗口表) = state.swarm_connecting_window_started_at.lock() else {
        return;
    };

    if 窗口表.len() > 连接窗口状态清理阈值 {
        窗口表.retain(|_, 起点秒| {
            当前时间戳秒.saturating_sub(*起点秒) <= 连接窗口状态最大保留秒
        });
    }

    match 状态码.as_str() {
        media_distribution::媒体状态已就绪 | media_distribution::媒体状态已删除 => {
            窗口表.remove(&键);
        }
        media_distribution::媒体状态连接群友中 => {
            窗口表.entry(键).or_insert(当前时间戳秒);
            媒体状态.insert(
                "retry_after_ms".to_string(),
                serde_json::json!(media_distribution::连接群友默认重试毫秒),
            );
        }
        media_distribution::媒体状态无在线种子 => {
            let (新起点秒, 新状态码, 重试毫秒) =
                裁决连接群友窗口轮转(窗口表.get(&键).copied(), 当前时间戳秒);
            窗口表.insert(键, 新起点秒);
            媒体状态.insert("code".to_string(), serde_json::json!(新状态码));
            媒体状态.insert("retry_after_ms".to_string(), serde_json::json!(重试毫秒));
        }
        _ => {}
    }
}

/// locator 只暴露受控 transport 线索：
/// - 当前先统一收口成受控 HTTP 内容地址；
/// - 后续接入 WebTorrent/锚点时，也继续在这里追加 transport 线索，而不是把存储键下发给壳层。
pub(super) async fn load_media_locator(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let locator = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let media_repo = repo.媒体仓储();
        协作分发应用::查询媒体定位(
            &media_repo,
            &attachment_id_for_usecase,
            &session_id_for_usecase,
        )
        .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(locator)) => locator,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("locator 任务执行失败: {err}"),
            );
        }
    };
    let original_url = 构造附件受控地址(
        attachment_id.as_str(),
        query.session_id.as_str(),
        "original",
    );
    let 允许静态预览 = 媒体允许投影静态预览(&locator.种类, locator.允许缩略图);
    let thumbnail_url = 允许静态预览.then(|| {
        构造附件受控地址(
            attachment_id.as_str(),
            query.session_id.as_str(),
            "thumbnail",
        )
    });
    let preview_asset = 构造预览资源响应体(
        attachment_id.as_str(),
        Some(query.session_id.as_str()),
        允许静态预览,
    );
    let tracker_public_url = media_distribution::读取协作分发tracker对外地址(
        state.swarm_tracker_public_url.as_str(),
    );
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let 冷源仍可用 = crate::media::模型::冷源当前可用(
        Some(original_url.as_str()),
        locator.原始冷源到期时间戳秒,
        locator.原始冷源删除时间戳秒,
        now_epoch秒,
    );
    let mut runtime_distribution = locator.协作分发.as_ref().map(|snapshot| {
        media_distribution::协作分发快照转响应值(
            snapshot,
            media_distribution::协作分发响应上下文 {
                attachment_id: attachment_id.as_str(),
                session_id: query.session_id.as_str(),
                tracker_public_url: tracker_public_url.as_str(),
                web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
                ticket_secret: state.swarm_ticket_secret.as_deref(),
                ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
                冷源仍可用,
                附件已删除: locator.状态
                    == crate::media::模型::附件状态读取结果::已过期,
                now_epoch秒,
                stale_seconds: state.swarm_peer_presence_stale_seconds,
            },
        )
    });
    if let Some(distribution) = runtime_distribution.as_mut() {
        同步协作分发连接窗口状态(
            &state,
            attachment_id.as_str(),
            query.session_id.as_str(),
            now_epoch秒,
            distribution,
        );
    }
    let mut response = serde_json::json!({
        "attachment_id": locator.附件标识,
        "kind": 媒体类型转标签(&locator.种类),
        "status": 附件状态转标签(&locator.状态),
        "preview_asset": preview_asset,
        "thumbnail_url": thumbnail_url,
        "distribution": runtime_distribution.clone(),
    });
    if let Some((field, asset)) = 构造定位媒体资产响应体(
        &locator,
        定位媒体资产响应上下文 {
            运行态分发: runtime_distribution.as_ref(),
            // 顶层 locator 已不再重复暴露 original_url；
            // 资产投影继续直接复用这份受控冷源地址，避免再从响应 JSON 倒读一遍旧顶层别名。
            原始地址: original_url.clone(),
            会话标识: query.session_id.as_str(),
            当前时间戳秒: now_epoch秒,
        },
    ) {
        response[field] = asset;
    }
    (StatusCode::OK, Json(response)).into_response()
}

/// blob 图片读取入口现在只剩 legacy/迁移壳：
/// - 它继续复用附件 storage_key 真相，不复制第二套读取实现；
/// - 但新图片 locator / media_asset 已不再把这条 URL 当正式主链暴露给前端；
/// - 因而这里的职责只剩兼容读取，而不是正式图片字节真相。
pub(super) async fn load_blob_asset_content(
    State(state): State<应用状态>,
    Path((attachment_id, blob_variant)): Path<(String, String)>,
    Query(raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let query = match parse_session_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let attachment_variant = match blob_variant.as_str() {
        "canonical" => crate::media::模型::附件内容变体::原图,
        _ => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "blob variant 必须是 canonical",
            );
        }
    };
    /*
     * `blob/canonical` 现在只允许继续留在 legacy/迁移读取面：
     * 1. 新图片一旦已经进入协作分发表面，正式字节真相就只剩 WebTorrent swarm；
     * 2. 这里如果继续对新附件返回 200，只会让旧 blob 别名重新变成第二正式读取面；
     * 3. 我们先用当前会话可见的 locator 真相判一次“是不是新附件正式面”，命中时直接 410；
     * 4. 没命中或 locator 查询失败时，不发明第二套鉴权/删除语义，继续复用下面原有受控读取链。
     */
    let state_for_locator = state.clone();
    let attachment_id_for_locator = attachment_id.clone();
    let session_id_for_locator = query.session_id.clone();
    let locator_result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_locator);
        let media_repo = repo.媒体仓储();
        协作分发应用::查询媒体定位(
            &media_repo,
            &attachment_id_for_locator,
            &session_id_for_locator,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    match locator_result {
        Ok(Ok(locator))
            if matches!(locator.种类, crate::media::模型::媒体附件类型::图片)
                && locator.状态 == crate::media::模型::附件状态读取结果::就绪
                && locator.协作分发.is_some() =>
        {
            return err_resp(
                StatusCode::GONE,
                "legacy_surface_only",
                "新附件正式图片已切到 WebTorrent 主链，blob canonical 仅保留给 legacy/迁移读取面",
            );
        }
        Ok(Ok(_)) | Ok(Err(_)) => {}
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("blob canonical legacy gate 任务执行失败: {err}"),
            );
        }
    }
    读取受控附件内容响应(
        state,
        attachment_id,
        query.session_id,
        attachment_variant,
        headers,
    )
    .await
    .into_response()
}

async fn 读取受控附件内容响应(
    state: 应用状态,
    attachment_id: String,
    session_id: String,
    variant: crate::media::模型::附件内容变体,
    headers: HeaderMap,
) -> axum::response::Response {
    tracing::info!(
        application = "读取附件内容",
        adapter = "http",
        outcome = "accepted",
        request_kind = "附件内容读取",
        attachment_id = attachment_id.as_str(),
        session_id = session_id.as_str(),
        "HTTP 请求已受理"
    );

    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let media_repo = repo.媒体仓储();
        协作分发应用::读取附件内容(
            &media_repo,
            &attachment_id_for_usecase,
            &session_id_for_usecase,
            variant,
        )
        .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "读取附件内容任务执行失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("任务执行失败: {err}"),
            );
        }
    };

    let target = match result {
        Ok(target) => target,
        Err((status, code, message)) => {
            tracing::warn!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "rejected",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = code,
                "读取附件内容被拒绝"
            );
            return err_resp(status, code, message);
        }
    };

    let object_path = ObjectPath::from(target.存储键.clone());
    let range = if headers.contains_key(header::RANGE) {
        let head_result = match state.attachment_store.head(&object_path).await {
            Ok(meta) => meta,
            Err(err) => {
                tracing::error!(
                    application = "读取附件内容",
                    adapter = "http",
                    outcome = "failed",
                    request_kind = "附件内容读取",
                    attachment_id = attachment_id.as_str(),
                    session_id = session_id.as_str(),
                    error_code = "system_error",
                    error = %err,
                    "对象存储读取元数据失败"
                );
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "附件内容读取失败",
                );
            }
        };
        match 解析标准字节范围(headers.get(header::RANGE), head_result.size) {
            Ok(range) => range,
            Err((status, code, message)) => return err_resp(status, code, message),
        }
    } else {
        None
    };
    let get_result = match range.as_ref() {
        Some(range) => {
            state
                .attachment_store
                .get_opts(
                    &object_path,
                    GetOptions::new().with_range(Some(range.请求.clone())),
                )
                .await
        }
        None => state.attachment_store.get(&object_path).await,
    };
    let get_result = match get_result {
        Ok(result) => result,
        Err(err) => {
            tracing::error!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "对象存储读取失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "附件内容读取失败",
            );
        }
    };
    let object_size = get_result.meta.size;
    let body = match get_result.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            tracing::error!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "failed",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                session_id = session_id.as_str(),
                error_code = "system_error",
                error = %err,
                "对象内容读取失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                "附件内容读取失败",
            );
        }
    };

    tracing::info!(
        application = "读取附件内容",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "附件内容读取",
        attachment_id = attachment_id.as_str(),
        session_id = session_id.as_str(),
        "读取附件内容成功"
    );
    match range {
        Some(range) => (
            StatusCode::PARTIAL_CONTENT,
            [
                (header::CONTENT_TYPE, target.mime_type),
                (header::ACCEPT_RANGES, "bytes".to_string()),
                (
                    header::CONTENT_RANGE,
                    构造content_range值(&range, object_size),
                ),
            ],
            body,
        )
            .into_response(),
        None => (
            [
                (header::CONTENT_TYPE, target.mime_type),
                (header::ACCEPT_RANGES, "bytes".to_string()),
            ],
            body,
        )
            .into_response(),
    }
}

/// 冷路径：受控读取附件对应的 torrent metainfo。
/// 它先复用 locator 的成员资格与 ready 校验，再返回稳定 metainfo 字节。
pub(super) async fn load_media_torrent(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    let torrent_result = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let media_repo = repo.媒体仓储();
        协作分发应用::查询媒体定位(
            &media_repo,
            &attachment_id_for_usecase,
            &session_id_for_usecase,
        )
        .map_err(map_domain_err_tuple)?;
        crate::media::application::读取协作分发torrent元信息(
            &media_repo,
            &attachment_id_for_usecase,
        )
        .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(torrent)) => torrent,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("torrent 任务执行失败: {err}"),
            );
        }
    };
    let Some(torrent) = torrent_result else {
        return err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            "附件已就绪但缺少 torrent 元信息",
        );
    };
    (
        [(header::CONTENT_TYPE, "application/x-bittorrent")],
        torrent.torrent_bytes,
    )
        .into_response()
}

/// cooperative 分发 presence 只回答“当前会话仍在参与这份附件的协作分发”。
/// 真正能不能看这份附件，仍然必须复用现有 locator 可见性主链来裁决。
pub(super) async fn update_media_distribution_presence(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
    body: Bytes,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let presence_payload = match parse_distribution_presence_payload(body.as_ref()) {
        Ok(payload) => payload,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = query.session_id.clone();
    match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let mut media_repo = repo.媒体仓储();
        crate::media::application::写入协作分发存活(
            &mut media_repo,
            &crate::media::模型::协作分发存活写入请求 {
                附件标识: attachment_id_for_usecase,
                会话标识: session_id_for_usecase,
                存活类型: presence_payload.peer_kind.clone(),
                最近peer存活时间戳秒: now_epoch秒,
            },
        )
        .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("presence 任务执行失败: {err}"),
            );
        }
    };
    StatusCode::NO_CONTENT.into_response()
}

/// 冷路径：受控读取附件内容。
pub(super) async fn load_attachment_content(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let query = match parse_attachment_content_query(raw_query) {
        Ok(query) => query,
        Err((status, code, message)) => {
            tracing::warn!(
                application = "读取附件内容",
                adapter = "http",
                outcome = "rejected",
                request_kind = "附件内容读取",
                attachment_id = attachment_id.as_str(),
                error_code = code,
                "读取附件内容缺少必要参数"
            );
            return err_resp(status, code, message);
        }
    };
    读取受控附件内容响应(
        state,
        attachment_id,
        query.session_id,
        query.variant,
        headers,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 连接窗口首次探测会进入连接群友态() {
        let (起点秒, 状态码, 重试毫秒) = 裁决连接群友窗口轮转(None, 1_000);
        assert_eq!(起点秒, 1_000);
        assert_eq!(状态码, media_distribution::媒体状态连接群友中);
        assert_eq!(重试毫秒, media_distribution::连接群友默认重试毫秒);
    }

    #[test]
    fn 连接窗口预算内保持连接群友态预算后进入无在线种子态() {
        let (预算内起点秒, 预算内状态码, 预算内重试毫秒) =
            裁决连接群友窗口轮转(Some(1_000), 1_007);
        assert_eq!(预算内起点秒, 1_000);
        assert_eq!(预算内状态码, media_distribution::媒体状态连接群友中);
        assert_eq!(预算内重试毫秒, media_distribution::连接群友默认重试毫秒);

        let (预算后起点秒, 预算后状态码, 预算后重试毫秒) =
            裁决连接群友窗口轮转(Some(1_000), 1_010);
        assert_eq!(预算后起点秒, 1_000);
        assert_eq!(预算后状态码, media_distribution::媒体状态无在线种子);
        assert_eq!(预算后重试毫秒, media_distribution::无在线种子默认重试毫秒);
    }

    #[test]
    fn 无在线种子重试周期到点后会开启下一轮连接群友态() {
        let (新起点秒, 状态码, 重试毫秒) = 裁决连接群友窗口轮转(Some(1_000), 1_016);
        assert_eq!(新起点秒, 1_016);
        assert_eq!(状态码, media_distribution::媒体状态连接群友中);
        assert_eq!(重试毫秒, media_distribution::连接群友默认重试毫秒);
    }
}
