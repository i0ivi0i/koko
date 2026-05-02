use super::{
    tus_hook外壳, 媒体上传运输方式_TUS, 媒体内容解析, 应用状态, 构建共享仓储,
};
use crate::adapter::{媒体上传会话授权写入请求, 媒体上传运输记录};
use crate::media::application::媒体仓储端口;
use crate::media::distribution::application as 协作分发应用;
use crate::media::upload::application as 上传应用;
use crate::shell::协议响应::{err_resp, event_to_json, map_domain_err_tuple};
use crate::{media_distribution, application};
use axum::{
    Json,
    body::Body,
    extract::{Path, Request, State},
    http::{
        HeaderMap, StatusCode, header,
        uri::{Authority, Uri},
    },
    response::{IntoResponse, Response},
};
use memmap2::{Mmap, MmapOptions};
use object_store::{ObjectStoreExt, path::Path as ObjectPath};
use serde::Deserialize;
use std::{
    fs::File as StdFile,
    path::Path as StdPath,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{fs, task};
use uuid::Uuid;

/// 上传授权只服务 prepare 返回值，不属于房间真相或资产读取真相。
const 媒体上传授权有效期秒数: u64 = 15 * 60;

/// complete 会短暂等待 sidecar 的 post-finish 回执，以吸收正常网络竞态。
const 完成媒体上传等待回执最大轮询次数: usize = 20;
const 完成媒体上传等待回执轮询间隔: Duration = Duration::from_millis(50);

/// 媒体 prepare 请求体。
#[derive(Deserialize)]
pub(super) struct PrepareMediaUploadBody {
    session_id: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
    byte_size: Option<i64>,
    source_hash: Option<String>,
    source_byte_size: Option<i64>,
    source_file_name: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct SourceHashReuseBody {
    session_id: Option<String>,
    room_id: Option<String>,
    source_hash: Option<String>,
    source_byte_size: Option<i64>,
    source_file_name: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ForwardMediaBody {
    session_id: Option<String>,
    target_room_id: Option<String>,
    source_attachment_id: Option<String>,
    client_message_id: Option<String>,
    text: Option<String>,
}

/// 媒体 complete 请求体。
#[derive(Deserialize)]
pub(super) struct CompleteMediaUploadBody {
    session_id: Option<String>,
}

/// 媒体 abandon 请求体。
/// 这条冷路径只表达“显式放弃旧上传”意图，不夹带 restart/prepare 之类的下一步动作。
#[derive(Deserialize)]
pub(super) struct AbandonMediaUploadBody {
    session_id: Option<String>,
}

async fn 回滚prepare失败留下的预备附件(
    state: 应用状态,
    attachment_id: String,
) -> Result<(), String> {
    match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state);
        repo.回滚预备媒体附件记录(&attachment_id)
            .map_err(map_domain_err_tuple)
    })
    .await
    {
        Ok(Ok(())) => Ok(()),
        Ok(Err((status, code, message))) => Err(format!(
            "status={}, code={}, message={message}",
            status.as_u16(),
            code
        )),
        Err(err) => Err(format!("回滚孤儿 prepared 附件任务执行失败: {err}")),
    }
}

/// 冷路径：申请媒体附件上传占位。
/// 这一步只创建 prepared 真相，并返回后续直传所需参数；不在这里上传字节。
pub(super) async fn prepare_media_upload(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    Json(body): Json<PrepareMediaUploadBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let file_name = match body
        .file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(file_name) => file_name,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 file_name",
            );
        }
    };
    let mime_type = match body
        .mime_type
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
    {
        Some(mime_type) => mime_type,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 mime_type",
            );
        }
    };
    let byte_size = match body.byte_size {
        Some(byte_size) => byte_size,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 byte_size",
            );
        }
    };
    if let Err((status, code, message)) =
        校验媒体准备请求(&media_kind, &mime_type, byte_size)
    {
        return err_resp(status, code, message);
    }
    let source_hash = body
        .source_hash
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let source_file_name = body
        .source_file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let attachment_id = 生成附件标识();
    let upload_session_id = 生成媒体上传会话标识();
    let storage_prefix = match media_kind {
        application::媒体附件类型::图片 => "images",
        application::媒体附件类型::视频 => "videos",
    };
    let original_storage_key = format!(
        "{storage_prefix}/{attachment_id}/original{}",
        推导原始内容扩展名(&media_kind, mime_type.as_str())
    );
    let prepare_request = application::媒体附件准备请求 {
        附件标识: attachment_id.clone(),
        种类: media_kind.clone(),
        mime_type: mime_type.clone(),
        字节大小: byte_size,
        原始内容存储键: original_storage_key.clone(),
        source_hash,
        source_byte_size: body.source_byte_size,
        source_file_name,
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let prepare_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        上传应用::准备媒体附件上传(&mut repo, &session_id_for_usecase, &prepare_request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let snapshot = match prepare_result {
        Ok(Ok(snapshot)) => snapshot,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("prepare 任务执行失败: {err}"),
            );
        }
    };

    // prepare 只负责：
    // 1. 落 prepared 附件真相；
    // 2. 下发一段短期 Tus 上传会话授权；
    // 3. token 只属于 upload_session，不再错误地复制到 partial/final transport 记录。
    let upload_token = 生成媒体上传令牌();
    let transport_auth = 媒体上传会话授权写入请求 {
        上传会话标识: upload_session_id.clone(),
        附件标识: snapshot.附件标识.clone(),
        运输方式: 媒体上传运输方式_TUS.to_string(),
        上传令牌: upload_token.clone(),
        令牌有效期秒数: 媒体上传授权有效期秒数 as i64,
    };
    let state_for_transport = state.clone();
    let transport_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_transport);
        repo.写入媒体上传会话授权(&transport_auth)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let transport_error = match transport_result {
        Ok(Ok(())) => None,
        Ok(Err((status, code, message))) => Some((status, code, message)),
        Err(err) => Some((
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("prepare 运输授权任务执行失败: {err}"),
        )),
    };
    if let Some((status, code, message)) = transport_error {
        if let Err(rollback_detail) =
            回滚prepare失败留下的预备附件(state.clone(), snapshot.附件标识.clone()).await
        {
            tracing::error!(
                application = "准备媒体上传",
                adapter = "http",
                outcome = "rollback_failed",
                request_kind = "媒体上传 prepare",
                session_id = session_id.as_str(),
                attachment_id = snapshot.附件标识.as_str(),
                upload_session_id = upload_session_id.as_str(),
                error_code = code,
                detail = %rollback_detail,
                original_error = %message,
                "prepare 第二阶段失败后回滚孤儿 prepared 附件失败"
            );
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!(
                    "prepare 运输授权失败且回滚孤儿附件失败: {rollback_detail}; 原始错误: {message}"
                ),
            );
        }
        tracing::warn!(
            application = "准备媒体上传",
            adapter = "http",
            outcome = "rolled_back",
            request_kind = "媒体上传 prepare",
            session_id = session_id.as_str(),
            attachment_id = snapshot.附件标识.as_str(),
            upload_session_id = upload_session_id.as_str(),
            error_code = code,
            detail = %message,
            "prepare 第二阶段失败，已回滚孤儿 prepared 附件"
        );
        return err_resp(status, code, message);
    }

    let expires_at = (SystemTime::now() + Duration::from_secs(媒体上传授权有效期秒数))
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    tracing::info!(
        application = "准备媒体上传",
        adapter = "http",
        outcome = "succeeded",
        request_kind = "媒体上传 prepare",
        session_id = session_id.as_str(),
        attachment_id = snapshot.附件标识.as_str(),
        upload_session_id = upload_session_id.as_str(),
        attachment_kind = super::媒体资产外壳::媒体类型转标签(&snapshot.种类),
        file_name = file_name.as_str(),
        byte_size = byte_size,
        "媒体上传占位已创建"
    );
    let response_attachment_id = snapshot.附件标识.clone();
    let response_kind = super::媒体资产外壳::媒体类型转标签(&snapshot.种类);
    let response_mime_type = snapshot.mime_type.clone();
    let response_byte_size = snapshot.字节大小;
    let tus_public_endpoint = 读取媒体_tus对外地址(&state);
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": response_attachment_id,
            "upload_session_id": upload_session_id,
            "kind": response_kind,
            "upload_method": 媒体上传运输方式_TUS,
            "tus_endpoint": tus_public_endpoint,
            "tus_headers": {
                "Authorization": format!("Bearer {upload_token}"),
            },
            "tus_metadata": {
                "attachment_id": snapshot.附件标识,
                "upload_session_id": upload_session_id,
                "file_name": file_name,
                "mime_type": response_mime_type,
                "byte_size": response_byte_size.to_string(),
            },
            "expires_at": expires_at,
        })),
    )
        .into_response()
}

async fn 构造ready媒体附件响应并触发做种(
    state: &应用状态,
    headers: &HeaderMap,
    session_id: &str,
    附件: &application::媒体附件快照,
    协作分发: &application::协作分发元数据快照,
    usecase_label: &'static str,
) -> serde_json::Value {
    let tracker_public_url = media_distribution::读取协作分发tracker对外地址(
        state.swarm_tracker_public_url.as_str(),
        headers,
    );
    let now_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let original_url = super::媒体资产外壳::构造附件受控地址(
        附件.附件标识.as_str(),
        session_id,
        "original",
    );
    let 冷源仍可用 = application::冷源当前可用(
        Some(original_url.as_str()),
        Some(协作分发.web_seed_until秒),
        None,
        now_epoch秒,
    );
    let runtime_distribution = media_distribution::协作分发快照转响应值(
        协作分发,
        media_distribution::协作分发响应上下文 {
            attachment_id: 附件.附件标识.as_str(),
            session_id,
            tracker_public_url: tracker_public_url.as_str(),
            web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
            ticket_secret: state.swarm_ticket_secret.as_deref(),
            ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
            冷源仍可用,
            附件已删除: false,
            now_epoch秒,
            stale_seconds: state.swarm_peer_presence_stale_seconds,
        },
    );
    if let Some(启动命令) = super::协作分发做种::从协作分发响应构造做种启动命令(
        &runtime_distribution,
        state.swarm_seeder_tracker_url.as_str(),
    ) {
        if let Err(err) = super::协作分发做种::尝试启动协作分发做种(state, &启动命令).await {
            tracing::warn!(
                application = usecase_label,
                phase = "seed_start_failed",
                attachment_id = 附件.附件标识.as_str(),
                info_hash = 启动命令.info_hash.as_str(),
                error = %err,
                "复用已有 canonical 资产后触发 sidecar 做种失败，等待后台对账重试"
            );
        }
    }
    let media_asset = super::媒体资产外壳::构造媒体资产响应体(
        附件,
        super::媒体资产外壳::媒体资产响应上下文 {
            运行态分发: Some(&runtime_distribution),
            分发快照: Some(协作分发),
            原始地址: original_url,
            原始冷源到期时间戳秒: Some(协作分发.web_seed_until秒),
            原始冷源删除时间戳秒: None,
            会话标识: session_id,
            当前时间戳秒: now_epoch秒,
        },
    );
    let preview_asset = super::媒体资产外壳::构造预览资源响应体(
        附件.附件标识.as_str(),
        Some(session_id),
        matches!(附件.种类, application::媒体附件类型::视频) && 附件.允许缩略图,
    );
    super::媒体资产外壳::媒体附件快照转响应体(附件, media_asset, preview_asset)
}

pub(super) async fn reuse_media_by_source_hash(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    headers: HeaderMap,
    Json(body): Json<SourceHashReuseBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let Some(room_id) = body
        .room_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(StatusCode::BAD_REQUEST, "invalid_argument", "缺少 room_id");
    };
    let Some(source_hash) = body
        .source_hash
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 source_hash",
        );
    };
    let Some(source_byte_size) = body.source_byte_size else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 source_byte_size",
        );
    };
    let source_file_name = body
        .source_file_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let attachment_id = 生成附件标识();
    let request = application::SourceHash媒体复用请求 {
        会话标识: session_id.clone(),
        房间标识: room_id.clone(),
        附件标识: attachment_id.clone(),
        种类: media_kind,
        source_hash,
        source_byte_size,
        source_file_name,
    };
    let state_for_usecase = state.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        crate::media::application::复用source_hash媒体附件(&mut repo, &request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let result = match result {
        Ok(Ok(result)) => result,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("source_hash 复用任务执行失败: {err}"),
            );
        }
    };

    let application::SourceHash媒体复用结果::Reused {
        附件,
        协作分发,
        torrent: _,
    } = result
    else {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "miss" })),
        )
            .into_response();
    };

    let attachment = 构造ready媒体附件响应并触发做种(
        &state,
        &headers,
        session_id.as_str(),
        &附件,
        &协作分发,
        "source_hash媒体复用",
    )
    .await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "reused",
            "attachment": attachment,
        })),
    )
        .into_response()
}

pub(super) async fn forward_media_attachment(
    Path(raw_kind): Path<String>,
    State(state): State<应用状态>,
    headers: HeaderMap,
    Json(body): Json<ForwardMediaBody>,
) -> impl IntoResponse {
    let media_kind = match 解析媒体类型(raw_kind.as_str()) {
        Ok(kind) => kind,
        Err(err) => return err_resp(err.0, err.1, err.2),
    };
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let Some(target_room_id) = body
        .target_room_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 target_room_id",
        );
    };
    let Some(source_attachment_id) = body
        .source_attachment_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 source_attachment_id",
        );
    };
    let Some(client_message_id) = body
        .client_message_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return err_resp(
            StatusCode::BAD_REQUEST,
            "invalid_argument",
            "缺少 client_message_id",
        );
    };
    let text = body
        .text
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let attachment_id = 生成附件标识();
    let request = application::媒体附件转发请求 {
        会话标识: session_id.clone(),
        目标房间标识: target_room_id,
        源附件标识: source_attachment_id,
        新附件标识: attachment_id,
        客户端消息标识: client_message_id,
        文本: text,
        种类: media_kind,
    };
    let state_for_usecase = state.clone();
    let result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        crate::media::application::转发媒体附件到房间(&mut repo, &request)
            .map_err(map_domain_err_tuple)
    })
    .await;
    let application::媒体附件转发结果 {
        消息事件,
        附件,
        协作分发,
        torrent: _,
    } = match result {
        Ok(Ok(result)) => result,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("媒体附件转发任务执行失败: {err}"),
            );
        }
    };
    let attachment = 构造ready媒体附件响应并触发做种(
        &state,
        &headers,
        session_id.as_str(),
        &附件,
        &协作分发,
        "媒体附件转发",
    )
    .await;

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "message": event_to_json(消息事件, Some(session_id.as_str())),
            "attachment": attachment,
        })),
    )
        .into_response()
}

/// 冷路径：完成媒体附件上传。
/// 这里消费 Tus sidecar finished 回执指向的 shared file，写回 canonical store 后，再把 prepared 升级成 ready。
pub(super) async fn complete_media_upload(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CompleteMediaUploadBody>,
) -> impl IntoResponse {
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let tracker_public_url = media_distribution::读取协作分发tracker对外地址(
        state.swarm_tracker_public_url.as_str(),
        &headers,
    );
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let prepared_and_transport = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let prepared = 上传应用::读取待完成媒体附件(
            &repo,
            &session_id_for_usecase,
            &attachment_id_for_usecase,
        )
        .map_err(map_domain_err_tuple)?;
        let transport = repo
            .查询附件当前最终运输记录(&attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>((prepared, transport))
    })
    .await
    {
        Ok(Ok(payload)) => payload,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("complete 任务执行失败: {err}"),
            );
        }
    };
    let (prepared, transport) = prepared_and_transport;
    let transport = match 等待complete所需运输回执(state.clone(), &attachment_id, transport).await
    {
        Ok(transport) => transport,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    // transport finished 是 complete 的前置 gate：
    // - prepare 成功不等于上传完成；
    // - sidecar 还没给出 finished 回执时，不能偷跑 ready 升级；
    // - 这一层先只做 gate，后续再把 shared file 消费完全切过来。
    let Some(transport) = transport else {
        tracing::warn!(
            application = "完成媒体上传",
            adapter = "http",
            outcome = "rejected",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "attachment_not_ready",
            "等待 transport finished 回执超时"
        );
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "原图尚未上传完成",
        );
    };
    if transport.完成时间戳秒.is_none() {
        tracing::warn!(
            application = "完成媒体上传",
            adapter = "http",
            outcome = "rejected",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "attachment_not_ready",
            "等待 transport finished 回执后仍未拿到 finished_at"
        );
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "原图尚未上传完成",
        );
    }

    let Some(storage_locator) = transport
        .storage_locator
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        tracing::warn!(
            application = "完成媒体上传",
            adapter = "http",
            outcome = "rejected",
            request_kind = "媒体上传 complete",
            session_id = session_id.as_str(),
            attachment_id = attachment_id.as_str(),
            error_code = "attachment_not_ready",
            "等待 transport finished 回执后仍缺少 storage_locator"
        );
        return err_resp(
            StatusCode::CONFLICT,
            "attachment_not_ready",
            "原图尚未上传完成",
        );
    };
    let temp_file_path =
        match tus_hook外壳::解析tus临时文件路径(&state.tus_upload_dir, storage_locator) {
            Ok(path) => path,
            Err((status, code, message)) => return err_resp(status, code, message),
        };
    let attachment_kind = super::媒体资产外壳::媒体类型转标签(&prepared.种类);
    let attachment_byte_size = prepared.字节大小;
    let _complete_heavy_work_permit =
        match 获取媒体上传完成重活许可(state.media_complete_gate.clone()).await {
            Ok(permit) => permit,
            Err(err) => {
                tracing::error!(
                    application = "完成媒体上传",
                    phase = "complete_heavy_work_failed",
                    attachment_id = attachment_id.as_str(),
                    kind = attachment_kind,
                    byte_size = attachment_byte_size,
                    duration_ms = 0_u64,
                    failure_reason = "permit_acquire_failed",
                    error_code = "system_error",
                    detail = %err,
                    "媒体上传 complete 重活失败"
                );
                return err_resp(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("获取媒体上传完成闸门许可失败: {err}"),
                );
            }
        };
    let complete_heavy_work_started_at = Instant::now();
    let complete失败上下文 = Complete重活失败上下文 {
        attachment_id: attachment_id.as_str(),
        attachment_kind,
        byte_size: attachment_byte_size,
        started_at: complete_heavy_work_started_at,
    };
    tracing::info!(
        application = "完成媒体上传",
        phase = "complete_heavy_work_enter",
        attachment_id = attachment_id.as_str(),
        kind = attachment_kind,
        byte_size = attachment_byte_size,
        media_complete_max_concurrency = state.media_complete_max_concurrency,
        "媒体上传 complete 重活开始"
    );
    // complete 是当前视频上传的主要重活热点。
    // 这里按稳定阶段输出耗时，便于把瓶颈收敛到“哪一段慢”，避免靠感觉继续误改上传层。
    let 记录complete阶段耗时 = |阶段: &'static str, 开始时间: Instant| {
        tracing::info!(
            application = "完成媒体上传",
            phase = "complete_heavy_work_stage",
            attachment_id = attachment_id.as_str(),
            kind = attachment_kind,
            byte_size = attachment_byte_size,
            stage = 阶段,
            duration_ms = 开始时间.elapsed().as_millis() as u64,
            "媒体上传 complete 阶段耗时"
        );
    };
    // ready 真相和 24 小时冷源窗口必须共用同一个完成时刻，
    // 否则后端存储、locator 冷源描述和分发窗口会各自漂成不同时间源。
    let ready_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);
    let 原始冷源到期时间戳秒 = ready_epoch秒 + application::媒体原始冷源保留秒数;
    let streaming_manifest_request = None;
    let (ready_request, distribution_request, torrent_request, canonical_asset_request) =
        match &prepared.种类 {
            application::媒体附件类型::图片 => {
                let original_bytes: Vec<u8> = match fs::read(&temp_file_path).await {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            "读取原图临时文件失败",
                            "read_temp_file_failed",
                            format!("读取 Tus 临时原图文件失败: {err}"),
                        );
                    }
                };
                let parsed =
                    match 媒体内容解析::校验canonical图片内容(original_bytes.as_ref()) {
                        Ok(parsed) => parsed,
                        Err(媒体内容解析::媒体内容解析错误::类型不允许(
                            message,
                        )) => {
                            return 记录并返回complete重活失败(
                                &complete失败上下文,
                                StatusCode::BAD_REQUEST,
                                "attachment_type_not_allowed",
                                message,
                                "parse_image_kind_not_allowed",
                                message,
                            );
                        }
                        Err(媒体内容解析::媒体内容解析错误::系统错误(
                            message,
                        )) => {
                            return 记录并返回complete重活失败(
                                &complete失败上下文,
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "system_error",
                                message,
                                "parse_image_system_error",
                                message,
                            );
                        }
                    };
                let 协作分发共享载荷 = 选择协作分发共享载荷(
                    &prepared.种类,
                    parsed.mime_type.as_str(),
                    original_bytes.as_ref(),
                    None,
                )
                .expect("图片协作分发应直接复用 canonical 原图字节");
                let distribution_request =
                    media_distribution::构造协作分发元数据写入请求(
                        &attachment_id,
                        协作分发共享载荷.字节,
                        ready_epoch秒,
                    );
                let torrent = match media_distribution::生成附件torrent元信息(
                    distribution_request.content_hash.as_str(),
                    协作分发共享载荷.稳定扩展名,
                    协作分发共享载荷.字节,
                ) {
                    Ok(torrent) => torrent,
                    Err(message) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message.clone(),
                            "generate_torrent_failed",
                            message,
                        );
                    }
                };
                let canonical_storage_key = 构造canonical内容寻址存储键(
                    distribution_request.content_hash.as_str(),
                    协作分发共享载荷.稳定扩展名,
                );
                let canonical_path = ObjectPath::from(canonical_storage_key.clone());
                if let Err(err) = state
                    .attachment_store
                    .put(&canonical_path, original_bytes.clone().into())
                    .await
                {
                    return 记录并返回complete重活失败(
                        &complete失败上下文,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "写入 canonical 图片对象失败",
                        "put_image_canonical_failed",
                        format!("写入 canonical 图片对象失败: {err}"),
                    );
                }
                let ready_request = application::媒体附件写入请求 {
                    附件标识: attachment_id.clone(),
                    种类: prepared.种类.clone(),
                    mime_type: parsed.mime_type,
                    字节大小: original_bytes.len() as i64,
                    宽: parsed.宽,
                    高: parsed.高,
                    // 图片主链已前移到客户端预制；后端只保存一份 canonical.webp。
                    // 缩略图、full、asset-original 派生对象全部退场，避免服务器继续吃 CPU/IO 重活。
                    原始内容存储键: canonical_storage_key,
                    缩略图存储键: None,
                    资产原图存储键: None,
                    完整图存储键: None,
                    原始冷源到期时间戳秒: Some(原始冷源到期时间戳秒),
                    回退母本存储键: None,
                    回退母本到期时间戳秒: None,
                };
                let torrent_request = application::协作分发torrent元信息写入请求 {
                    附件标识: attachment_id.clone(),
                    torrent_bytes: torrent.torrent_bytes,
                    torrent_info_hash: torrent.torrent_info_hash,
                    piece_length字节: torrent.piece_length_bytes,
                };
                let canonical_asset_request = application::Canonical媒体资产写入请求 {
                    content_hash: distribution_request.content_hash.clone(),
                    种类: ready_request.种类.clone(),
                    mime_type: ready_request.mime_type.clone(),
                    字节大小: ready_request.字节大小,
                    宽: ready_request.宽,
                    高: ready_request.高,
                    存储键: ready_request.原始内容存储键.clone(),
                    torrent_bytes: torrent_request.torrent_bytes.clone(),
                    torrent_info_hash: torrent_request.torrent_info_hash.clone(),
                    piece_length字节: torrent_request.piece_length字节,
                    web_seed_until秒: distribution_request.web_seed_until秒,
                    origin_expires_at秒: 原始冷源到期时间戳秒,
                };
                (
                    ready_request,
                    distribution_request,
                    torrent_request,
                    canonical_asset_request,
                )
            }
            application::媒体附件类型::视频 => {
                let 视频解析开始 = Instant::now();
                let parsed = match 媒体内容解析::校验canonical视频文件内容(
                    temp_file_path.as_path(),
                ) {
                    Ok(parsed) => parsed,
                    Err(媒体内容解析::媒体内容解析错误::类型不允许(message)) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::BAD_REQUEST,
                            "attachment_type_not_allowed",
                            message,
                            "parse_video_kind_not_allowed",
                            message,
                        );
                    }
                    Err(媒体内容解析::媒体内容解析错误::系统错误(message)) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message,
                            "parse_video_system_error",
                            message,
                        );
                    }
                };
                记录complete阶段耗时("parse_video", 视频解析开始);
                let canonical_video_mapping =
                    match 映射只读完成媒体临时文件(temp_file_path.as_path()) {
                        Ok(mapped) => mapped,
                        Err(err) => {
                            return 记录并返回complete重活失败(
                                &complete失败上下文,
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "system_error",
                                "映射 canonical 视频临时文件失败",
                                "map_canonical_video_failed",
                                format!("映射 canonical 视频失败: {err}"),
                            );
                        }
                    };
                let 分发元数据构造开始 = Instant::now();
                let 协作分发共享载荷 = match 选择协作分发共享载荷(
                    &prepared.种类,
                    parsed.mime_type.as_str(),
                    &[],
                    Some(canonical_video_mapping.as_ref()),
                ) {
                    Ok(payload) => payload,
                    Err(message) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message,
                            "select_swarm_payload_failed",
                            message,
                        );
                    }
                };
                let distribution_request =
                    media_distribution::构造协作分发元数据写入请求(
                        &attachment_id,
                        协作分发共享载荷.字节,
                        ready_epoch秒,
                    );
                记录complete阶段耗时("build_distribution_request", 分发元数据构造开始);
                let canonical_video_storage_key = 构造canonical内容寻址存储键(
                    distribution_request.content_hash.as_str(),
                    协作分发共享载荷.稳定扩展名,
                );
                let canonical_video_path = ObjectPath::from(canonical_video_storage_key.clone());
                let 视频canonical写入开始 = Instant::now();
                if let Err(err) = state
                    .attachment_store
                    .put(
                        &canonical_video_path,
                        canonical_video_mapping.as_ref().to_vec().into(),
                    )
                    .await
                {
                    return 记录并返回complete重活失败(
                        &complete失败上下文,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "写入 canonical 视频对象失败",
                        "put_video_canonical_failed",
                        format!("写入 canonical 视频对象失败: {err}"),
                    );
                }
                记录complete阶段耗时("put_canonical_video", 视频canonical写入开始);
                let torrent生成开始 = Instant::now();
                let torrent = match media_distribution::生成附件torrent元信息(
                    distribution_request.content_hash.as_str(),
                    协作分发共享载荷.稳定扩展名,
                    协作分发共享载荷.字节,
                ) {
                    Ok(torrent) => torrent,
                    Err(message) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message.clone(),
                            "generate_torrent_failed",
                            message,
                        );
                    }
                };
                记录complete阶段耗时("generate_torrent", torrent生成开始);
                drop(canonical_video_mapping);
                let ready_request = application::媒体附件写入请求 {
                    附件标识: attachment_id.clone(),
                    种类: prepared.种类.clone(),
                    mime_type: parsed.mime_type,
                    字节大小: attachment_byte_size,
                    宽: parsed.宽,
                    高: parsed.高,
                    // 视频主链已前移到客户端预制；后端只保存一份 canonical.mp4。
                    // HLS/DASH、mezzanine 和静态封面都不在 complete 阶段生成，避免服务端继续承担加工 owner。
                    原始内容存储键: canonical_video_storage_key,
                    缩略图存储键: None,
                    资产原图存储键: None,
                    完整图存储键: None,
                    原始冷源到期时间戳秒: Some(原始冷源到期时间戳秒),
                    回退母本存储键: None,
                    回退母本到期时间戳秒: None,
                };
                let torrent_request = application::协作分发torrent元信息写入请求 {
                    附件标识: attachment_id.clone(),
                    torrent_bytes: torrent.torrent_bytes,
                    torrent_info_hash: torrent.torrent_info_hash,
                    piece_length字节: torrent.piece_length_bytes,
                };
                let canonical_asset_request = application::Canonical媒体资产写入请求 {
                    content_hash: distribution_request.content_hash.clone(),
                    种类: ready_request.种类.clone(),
                    mime_type: ready_request.mime_type.clone(),
                    字节大小: ready_request.字节大小,
                    宽: ready_request.宽,
                    高: ready_request.高,
                    存储键: ready_request.原始内容存储键.clone(),
                    torrent_bytes: torrent_request.torrent_bytes.clone(),
                    torrent_info_hash: torrent_request.torrent_info_hash.clone(),
                    piece_length字节: torrent_request.piece_length字节,
                    web_seed_until秒: distribution_request.web_seed_until秒,
                    origin_expires_at秒: 原始冷源到期时间戳秒,
                };
                (
                    ready_request,
                    distribution_request,
                    torrent_request,
                    canonical_asset_request,
                )
            }
        };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let distribution_request_for_write = distribution_request.clone();
    let torrent_request_for_write = torrent_request.clone();
    let canonical_asset_request_for_write = canonical_asset_request.clone();
    let streaming_manifest_request_for_write = streaming_manifest_request.clone();
    let 写入权威真相开始 = Instant::now();
    let complete_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        let snapshot = 上传应用::完成媒体附件上传(
            &mut repo,
            &session_id_for_usecase,
            &ready_request,
        )
        .map_err(map_domain_err_tuple)?;
        // canonical 资产是内容身份层事实，先写资产再绑定附件引用；
        // 后续 source_hash 命中才能复用同一资产，而不是复制旧附件或旧消息。
        crate::media::application::媒体仓储端口::写入canonical媒体资产(
            &mut repo,
            &canonical_asset_request_for_write,
        )
        .map_err(map_domain_err_tuple)?;
        crate::media::application::媒体仓储端口::绑定附件canonical媒体资产(
            &mut repo,
            &snapshot.附件标识,
            canonical_asset_request_for_write.content_hash.as_str(),
        )
        .map_err(map_domain_err_tuple)?;
        协作分发应用::写入协作分发元数据(&mut repo, &distribution_request_for_write)
            .map_err(map_domain_err_tuple)?;
        协作分发应用::写入协作分发torrent元信息(&mut repo, &torrent_request_for_write)
            .map_err(map_domain_err_tuple)?;
        if let Some(request) = streaming_manifest_request_for_write.as_ref() {
            crate::media::application::写入流媒体清单元数据(&mut repo, request)
                .map_err(map_domain_err_tuple)?;
        }
        Ok::<_, (StatusCode, &'static str, String)>(snapshot)
    })
    .await;
    记录complete阶段耗时("write_authoritative_snapshot", 写入权威真相开始);
    match complete_result {
        Ok(Ok(snapshot)) => {
            let 上传临时文件退场开始 = Instant::now();
            match fs::remove_file(&temp_file_path).await {
                Ok(_) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return 记录并返回complete重活失败(
                        &complete失败上下文,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "删除上传临时文件失败",
                        "delete_upload_temp_file_failed",
                        format!("删除 Tus 上传临时文件失败: {err}"),
                    );
                }
            }
            记录complete阶段耗时("delete_upload_temp_file", 上传临时文件退场开始);
            // 图片和视频现在都只有一份 canonical 文件；complete 成功后只给它 24 小时服务器辅助窗口，
            // 不再把“上传母本已删”和“对外 canonical 冷源仍可用”拆成两套互相打架的删除事实。
            let (_原片删除时间戳秒, 冷备层到期时间戳秒, 冷备层删除时间戳秒): (
                Option<i64>,
                Option<i64>,
                Option<i64>,
            ) = (None, Some(原始冷源到期时间戳秒), None);
            let distribution_snapshot = application::协作分发元数据快照 {
                附件标识: attachment_id.clone(),
                content_id: distribution_request.content_id.clone(),
                content_hash: distribution_request.content_hash.clone(),
                swarm_id: distribution_request.swarm_id.clone(),
                web_seed_until秒: distribution_request.web_seed_until秒,
                最近片段peer存活时间戳秒: None,
                最近完整peer存活时间戳秒: None,
                最近后端强种子存活时间戳秒: None,
                torrent_info_hash: Some(torrent_request.torrent_info_hash.clone()),
            };
            let now_epoch秒 = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or_default();
            let original_url = super::媒体资产外壳::构造附件受控地址(
                attachment_id.as_str(),
                session_id.as_str(),
                "original",
            );
            let 冷源仍可用 = application::冷源当前可用(
                Some(original_url.as_str()),
                冷备层到期时间戳秒,
                冷备层删除时间戳秒,
                now_epoch秒,
            );
            let runtime_distribution = media_distribution::协作分发快照转响应值(
                &distribution_snapshot,
                media_distribution::协作分发响应上下文 {
                    attachment_id: attachment_id.as_str(),
                    session_id: session_id.as_str(),
                    tracker_public_url: tracker_public_url.as_str(),
                    web_seed_public_endpoint: state.swarm_web_seed_public_endpoint.as_deref(),
                    ticket_secret: state.swarm_ticket_secret.as_deref(),
                    ticket_ttl_seconds: state.swarm_ticket_ttl_seconds,
                    冷源仍可用,
                    附件已删除: false,
                    now_epoch秒,
                    stale_seconds: state.swarm_peer_presence_stale_seconds,
                },
            );
            // complete 成功后立刻尝试触发 sidecar 做种：
            // 1. 这里不改变“ready 真相已经落库”的结果；start 失败只记告警并交给后台对账补偿；
            // 2. 命令载荷严格来自同一份 runtime_distribution，避免再长第二套 transport 真相；
            // 3. 真正“谁该做种”的裁决仍在后端 owner，不在 sidecar 里发明业务语义。
            if let Some(启动命令) = super::协作分发做种::从协作分发响应构造做种启动命令(
                &runtime_distribution,
                state.swarm_seeder_tracker_url.as_str(),
            ) {
                if let Err(err) = super::协作分发做种::尝试启动协作分发做种(&state, &启动命令).await
                {
                    tracing::warn!(
                        application = "完成媒体上传",
                        phase = "seed_start_failed",
                        attachment_id = attachment_id.as_str(),
                        info_hash = 启动命令.info_hash.as_str(),
                        error = %err,
                        "complete 成功后触发 sidecar 做种失败，等待后台对账重试"
                    );
                }
            }
            let media_asset = super::媒体资产外壳::构造媒体资产响应体(
                &snapshot,
                super::媒体资产外壳::媒体资产响应上下文 {
                    运行态分发: Some(&runtime_distribution),
                    分发快照: Some(&distribution_snapshot),
                    原始地址: original_url,
                    原始冷源到期时间戳秒: 冷备层到期时间戳秒,
                    原始冷源删除时间戳秒: 冷备层删除时间戳秒,
                    会话标识: session_id.as_str(),
                    当前时间戳秒: now_epoch秒,
                },
            );
            let preview_asset = super::媒体资产外壳::构造预览资源响应体(
                snapshot.附件标识.as_str(),
                Some(session_id.as_str()),
                matches!(snapshot.种类, application::媒体附件类型::视频) && snapshot.允许缩略图,
            );
            tracing::info!(
                application = "完成媒体上传",
                phase = "complete_heavy_work_exit",
                attachment_id = attachment_id.as_str(),
                kind = attachment_kind,
                byte_size = attachment_byte_size,
                duration_ms = complete_heavy_work_started_at.elapsed().as_millis() as u64,
                "媒体上传 complete 重活完成"
            );
            (
                StatusCode::OK,
                Json(super::媒体资产外壳::媒体附件快照转响应体(
                    &snapshot,
                    media_asset,
                    preview_asset,
                )),
            )
                .into_response()
        }
        Ok(Err((status, code, message))) => 记录并返回complete重活失败(
            &complete失败上下文,
            status,
            code,
            message.clone(),
            "write_ready_snapshot_failed",
            message,
        ),
        Err(err) => 记录并返回complete重活失败(
            &complete失败上下文,
            StatusCode::INTERNAL_SERVER_ERROR,
            "system_error",
            format!("complete 任务执行失败: {err}"),
            "complete_write_task_failed",
            format!("complete 任务执行失败: {err}"),
        ),
    }
}

/// 冷路径：显式放弃旧上传。
/// 这里先让应用层把旧附件和 transport 一起标成 abandoned，
/// 然后 shell 再先协调官方 termination，最后继续按既有残留清理兜底收尾。
pub(super) async fn abandon_media_upload(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<AbandonMediaUploadBody>,
) -> impl IntoResponse {
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let request_id = 读取首个非空请求头(&headers, "x-request-id");
    let abandoned_epoch秒 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or_default();
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let abandon_result: (Option<String>, Vec<String>) = match task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        let current_upload_session_id = repo
            .查询待完成媒体附件(&attachment_id_for_usecase)
            .map_err(map_domain_err_tuple)?
            .and_then(|prepared| prepared.当前上传会话标识);
        let transport_upload_ids = match current_upload_session_id.as_deref() {
            Some(upload_session_id) => repo
                .列出上传会话运输上传标识(upload_session_id)
                .map_err(map_domain_err_tuple)?,
            None => Vec::new(),
        };
        crate::media::application::放弃媒体上传(
            &mut repo,
            &session_id_for_usecase,
            &attachment_id_for_usecase,
            abandoned_epoch秒,
        )
        .map_err(map_domain_err_tuple)?;
        Ok::<_, (StatusCode, &'static str, String)>((
            current_upload_session_id,
            transport_upload_ids,
        ))
    })
    .await
    {
        Ok(Ok(payload)) => payload,
        Ok(Err((status, code, message))) => return err_resp(status, code, message),
        Err(err) => {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("abandon 任务执行失败: {err}"),
            );
        }
    };

    let (upload_session_id, transport_upload_ids) = abandon_result;
    for transport_upload_id in &transport_upload_ids {
        if let Err(err) = 尝试终止媒体_tus上传(
            &state,
            transport_upload_id.as_str(),
            request_id.as_deref(),
        )
        .await
        {
            tracing::warn!(
                application = "放弃媒体上传",
                adapter = "http",
                outcome = "transport_termination_failed",
                attachment_id = attachment_id.as_str(),
                upload_session_id = upload_session_id.as_deref().unwrap_or(""),
                transport_upload_id = transport_upload_id.as_str(),
                request_id = request_id.as_deref().unwrap_or(""),
                error = %err,
                "媒体上传业务放弃已成立，但协调官方 Tus termination 失败"
            );
        }
    }

    if let Some(upload_session_id) = upload_session_id.as_deref() {
        if let Err(err) = super::媒体清理::执行一次媒体上传残留清理_按会话(
            state.clone(),
            Some(upload_session_id),
        )
        .await
        {
            return err_resp(
                StatusCode::INTERNAL_SERVER_ERROR,
                "system_error",
                format!("删除已放弃上传临时文件失败: {err}"),
            );
        }
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "attachment_id": attachment_id,
            "status": "abandoned",
        })),
    )
        .into_response()
}

/// 官方 termination 仍只是 transport 删除能力：
/// 1. 只有 business abandon 已经成功之后，shell 才会来协调它；
/// 2. 没配置内部 guard 时，继续退回本地残留清理兜底，不让取消主链直接失败；
/// 3. DELETE 失败只记日志，不回滚已经成立的 abandoned 真相。
///
/// 同源 Tus 上传透传入口：
/// 1. 只负责把 `/files...` 协议流量转发给 sidecar，不承载业务裁决；
/// 2. sidecar 不可达时显式返回 502 + 稳定错误码，避免前端停在“上传中”无诊断信号；
/// 3. 保持请求方法与关键头语义，避免再出现“prepare 给了地址但入口不存在”的双真相。
pub(super) async fn proxy_tus_upload_transport(
    State(state): State<应用状态>,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    let request_path = parts.uri.path();
    let tus_resource_tail = request_path
        .strip_prefix(normalized_tus_base_path.as_str())
        .unwrap_or(request_path);
    let internal_upload_endpoint = 读取媒体_tus内部上传入口(&state);
    let mut upstream_url = format!(
        "{}{}",
        internal_upload_endpoint.trim_end_matches('/'),
        tus_resource_tail
    );
    if let Some(query) = parts.uri.query() {
        upstream_url.push('?');
        upstream_url.push_str(query);
    }

    let upstream_method = match reqwest::Method::from_bytes(parts.method.as_str().as_bytes()) {
        Ok(method) => method,
        Err(err) => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                format!("不支持的 Tus 上传方法: {err}"),
            );
        }
    };
    let mut upstream_request = reqwest::Client::new().request(upstream_method, &upstream_url);
    for (name, value) in &parts.headers {
        if name.as_str().eq_ignore_ascii_case("host") {
            continue;
        }
        upstream_request = upstream_request.header(name, value);
    }
    let upstream_response = match upstream_request
        .body(reqwest::Body::wrap_stream(body.into_data_stream()))
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            return err_resp(
                StatusCode::BAD_GATEWAY,
                "media_tus_upstream_unreachable",
                format!("Tus sidecar 不可达: {err}"),
            );
        }
    };

    let status = StatusCode::from_u16(upstream_response.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let mut response_builder = Response::builder().status(status);
    for (name, value) in upstream_response.headers() {
        if name.as_str().eq_ignore_ascii_case("connection")
            || name.as_str().eq_ignore_ascii_case("keep-alive")
            || name.as_str().eq_ignore_ascii_case("proxy-authenticate")
            || name.as_str().eq_ignore_ascii_case("proxy-authorization")
            || name.as_str().eq_ignore_ascii_case("te")
            || name.as_str().eq_ignore_ascii_case("trailers")
            || name.as_str().eq_ignore_ascii_case("transfer-encoding")
            || name.as_str().eq_ignore_ascii_case("upgrade")
        {
            continue;
        }
        if name == header::LOCATION {
            let rewritten_location = value.to_str().ok().and_then(|raw_location| {
                改写媒体_tus_location到浏览器入口(
                    raw_location,
                    &parts.headers,
                    normalized_tus_base_path.as_str(),
                )
            });
            if let Some(rewritten_location) = rewritten_location {
                response_builder = response_builder.header(name, rewritten_location);
                continue;
            }
        }
        response_builder = response_builder.header(name, value);
    }
    let body = match upstream_response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            return err_resp(
                StatusCode::BAD_GATEWAY,
                "media_tus_upstream_invalid_response",
                format!("读取 Tus sidecar 响应失败: {err}"),
            );
        }
    };
    match response_builder.body(Body::from(body)) {
        Ok(response) => response,
        Err(err) => err_resp(
            StatusCode::BAD_GATEWAY,
            "media_tus_proxy_response_build_failed",
            format!("组装 Tus 代理响应失败: {err}"),
        ),
    }
}

async fn 尝试终止媒体_tus上传(
    state: &应用状态,
    upload_id: &str,
    request_id: Option<&str>,
) -> Result<(), String> {
    let Some(internal_termination_token) = state
        .tus_internal_termination_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let internal_delete_endpoint = 读取媒体_tus内部上传入口(state);
    let delete_url = format!(
        "{}/{}",
        internal_delete_endpoint.trim_end_matches('/'),
        upload_id.trim()
    );
    let client = reqwest::Client::new();
    let mut request = client
        .delete(delete_url.as_str())
        .header("Tus-Resumable", super::TUS协议版本_HEADER值)
        .header(
            super::TUS_INTERNAL_TERMINATION_GUARD_HEADER,
            internal_termination_token,
        );
    if let Some(request_id) = request_id.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header("X-Request-Id", request_id);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("调用 Tus termination DELETE 失败: {err}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Tus termination DELETE 返回 {status}，响应体: {body}"
        ));
    }
    Ok(())
}

fn 生成附件标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("att-{}", &raw[..12])
}

fn 生成媒体上传会话标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("upl-{}", raw)
}

fn 生成媒体上传令牌() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("tus-{}", raw)
}

pub(super) fn 标准化媒体_tus基础路径(raw_path: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/files".to_string();
    }
    format!("/{}", trimmed.trim_matches('/'))
}

fn 读取媒体_tus内部上传入口(state: &应用状态) -> String {
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    let raw_internal_base_url = state
        .tus_internal_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", state.tus_server_port));
    // `MEDIA_TUS_INTERNAL_BASE_URL` 既兼容“只给 sidecar origin”，也兼容“直接给到 /files endpoint”。
    // 这里统一归一成真正的上传资源前缀，避免测试、脚本和部署配置各猜各的。
    if raw_internal_base_url
        .trim_end_matches('/')
        .ends_with(normalized_tus_base_path.as_str())
    {
        raw_internal_base_url.trim_end_matches('/').to_string()
    } else {
        format!(
            "{}{}",
            raw_internal_base_url.trim_end_matches('/'),
            normalized_tus_base_path
        )
    }
}

fn 解析媒体类型(
    raw_kind: &str,
) -> Result<application::媒体附件类型, (StatusCode, &'static str, &'static str)> {
    match raw_kind {
        "image" => Ok(application::媒体附件类型::图片),
        "video" => Ok(application::媒体附件类型::视频),
        _ => Err((
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "只允许上传图片或视频",
        )),
    }
}

fn 推导原始内容扩展名(
    kind: &application::媒体附件类型, mime_type: &str
) -> &'static str {
    match kind {
        application::媒体附件类型::图片 => match mime_type {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".bin",
        },
        application::媒体附件类型::视频 => match mime_type {
            "video/mp4" => ".mp4",
            "video/webm" => ".webm",
            "video/quicktime" => ".mov",
            "video/3gpp" => ".3gp",
            _ => ".bin",
        },
    }
}

fn 构造canonical内容寻址存储键(content_hash: &str, extension: &str) -> String {
    format!("media-assets/{content_hash}/canonical{extension}")
}

struct 协作分发共享载荷<'a> {
    字节: &'a [u8],
    稳定扩展名: &'static str,
}

fn 选择协作分发共享载荷<'a>(
    kind: &application::媒体附件类型,
    原始mime_type: &str,
    原始字节: &'a [u8],
    canonical视频字节: Option<&'a [u8]>,
) -> Result<协作分发共享载荷<'a>, &'static str> {
    match kind {
        application::媒体附件类型::图片 => Ok(协作分发共享载荷 {
            字节: 原始字节,
            稳定扩展名: 推导原始内容扩展名(kind, 原始mime_type),
        }),
        // 视频对外长期可播放的 canonical 已经由客户端预制成 mp4；
        // swarm 也必须复用同一份字节与扩展，不能再等待后端 mezzanine 或分段产物。
        application::媒体附件类型::视频 => {
            let Some(canonical视频字节) = canonical视频字节 else {
                return Err("视频协作分发缺少 canonical 视频载荷");
            };
            Ok(协作分发共享载荷 {
                字节: canonical视频字节,
                稳定扩展名: ".mp4",
            })
        }
    }
}

fn 读取首个非空请求头(headers: &HeaderMap, name: &'static str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|part| !part.is_empty())
                .map(|part| part.to_string())
        })
}

fn 包装url主机(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn 是回环媒体_tus公开地址(url: &str) -> bool {
    let Ok(uri) = url.parse::<Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    matches!(authority.host(), "127.0.0.1" | "localhost" | "::1")
}

fn 裁决媒体_tus显式公开地址(
    raw_endpoint: &str,
    normalized_tus_base_path: &str,
) -> String {
    let trimmed = raw_endpoint.trim();
    if trimmed.is_empty() {
        return normalized_tus_base_path.to_string();
    }
    if trimmed.starts_with('/') {
        return 标准化媒体_tus基础路径(trimmed);
    }
    if 是回环媒体_tus公开地址(trimmed) {
        return normalized_tus_base_path.to_string();
    }
    trimmed.trim_end_matches('/').to_string()
}

/// 浏览器真正进入的是“当前请求这条 `/files` 公共入口”，而不是内部 tusd 监听端口。
/// 这里统一按当前请求头推导出浏览器可见的绝对 `/files` 入口，只给代理层改写 `Location` 使用。
fn 推导媒体tus浏览器公开入口(
    headers: &HeaderMap,
    tus_base_path: &str,
) -> Option<String> {
    let forwarded_host = 读取首个非空请求头(headers, "x-forwarded-host");
    let raw_host = forwarded_host
        .clone()
        .or_else(|| 读取首个非空请求头(headers, "host"))?;
    let authority = raw_host.parse::<Authority>().ok()?;
    let forwarded_proto = 读取首个非空请求头(headers, "x-forwarded-proto")
        .or_else(|| 读取首个非空请求头(headers, "x-forwarded-scheme"));
    let forwarded_port =
        读取首个非空请求头(headers, "x-forwarded-port").and_then(|value| value.parse::<u16>().ok());
    let scheme = forwarded_proto
        .clone()
        .unwrap_or_else(|| "http".to_string());
    let hostname = authority.host();
    let host_for_url = 包装url主机(hostname);

    let should_trust_authority_port =
        forwarded_host.is_some() || forwarded_proto.is_some() || forwarded_port.is_some();
    let inferred_proxy_default_port = if should_trust_authority_port {
        match scheme.as_str() {
            "https" => Some(443),
            "http" => Some(80),
            _ => None,
        }
    } else {
        None
    };
    let public_port = forwarded_port
        .or_else(|| authority.port_u16())
        .or(inferred_proxy_default_port);
    let should_omit_port = public_port.is_none()
        || (scheme == "http" && public_port == Some(80))
        || (scheme == "https" && public_port == Some(443));
    let authority_for_url = if should_omit_port {
        host_for_url
    } else {
        format!("{host_for_url}:{}", public_port.unwrap_or_default())
    };
    Some(format!("{scheme}://{authority_for_url}{tus_base_path}"))
}

fn 提取媒体_tus资源尾(location: &str, normalized_tus_base_path: &str) -> Option<String> {
    let trimmed = location.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(resource_tail) = trimmed.strip_prefix(normalized_tus_base_path) {
        return Some(resource_tail.to_string());
    }
    let path_and_query = trimmed
        .parse::<Uri>()
        .ok()
        .and_then(|uri| uri.path_and_query().map(|value| value.as_str().to_string()))
        .unwrap_or_else(|| trimmed.to_string());
    path_and_query
        .strip_prefix(normalized_tus_base_path)
        .map(|value| value.to_string())
}

fn 改写媒体_tus_location到浏览器入口(
    location: &str,
    headers: &HeaderMap,
    normalized_tus_base_path: &str,
) -> Option<String> {
    let browser_entry = 推导媒体tus浏览器公开入口(headers, normalized_tus_base_path)?
        .trim_end_matches('/')
        .to_string();
    let resource_tail = 提取媒体_tus资源尾(location, normalized_tus_base_path)?;
    Some(format!("{browser_entry}{resource_tail}"))
}

fn 读取媒体_tus对外地址(state: &应用状态) -> String {
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    state
        .tus_public_endpoint
        .as_deref()
        .map(|value| 裁决媒体_tus显式公开地址(value, normalized_tus_base_path.as_str()))
        .unwrap_or(normalized_tus_base_path)
}

fn 校验媒体准备请求(
    kind: &application::媒体附件类型,
    mime_type: &str,
    byte_size: i64,
) -> Result<(), (StatusCode, &'static str, &'static str)> {
    const 图片附件上传上限字节数: i64 = 10 * 1024 * 1024;
    const 视频附件上传上限字节数: i64 = 200 * 1024 * 1024;

    if byte_size <= 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "媒体大小非法"));
    }
    match kind {
        application::媒体附件类型::图片 => {
            if !mime_type.starts_with("image/") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "attachment_type_not_allowed",
                    "只允许上传图片",
                ));
            }
            if byte_size > 图片附件上传上限字节数 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "attachment_too_large",
                    "图片超过 10MB 上限",
                ));
            }
        }
        application::媒体附件类型::视频 => {
            if !mime_type.starts_with("video/") {
                return Err((
                    StatusCode::BAD_REQUEST,
                    "attachment_type_not_allowed",
                    "只允许上传视频",
                ));
            }
            if byte_size > 视频附件上传上限字节数 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "attachment_too_large",
                    "视频超过 200MB 上限",
                ));
            }
        }
    }
    Ok(())
}

fn 媒体上传运输回执已就绪(transport: &媒体上传运输记录) -> bool {
    transport.完成时间戳秒.is_some()
        && transport
            .storage_locator
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
}

pub(super) async fn 等待complete所需运输回执(
    state: 应用状态,
    attachment_id: &str,
    mut transport: Option<媒体上传运输记录>,
) -> Result<Option<媒体上传运输记录>, (StatusCode, &'static str, String)> {
    if transport.as_ref().is_some_and(媒体上传运输回执已就绪) {
        return Ok(transport);
    }
    // `upload-success` 只代表客户端拿到了最终 PATCH 响应；
    // 但主服务真正依赖的是 `post-finish` 已经把 finished 回执落库。
    // 这里做一个短暂、受控的等待窗口，吸收 sidecar hook 晚于浏览器成功回调的正常竞态，
    // 避免把基础设施时序细节直接泄漏给前端壳。
    for _ in 0..完成媒体上传等待回执最大轮询次数 {
        tokio::time::sleep(完成媒体上传等待回执轮询间隔).await;
        let state_for_usecase = state.clone();
        let attachment_id_for_usecase = attachment_id.to_string();
        transport = match task::spawn_blocking(move || {
            let repo = 构建共享仓储(&state_for_usecase);
            repo.查询附件当前最终运输记录(&attachment_id_for_usecase)
                .map_err(map_domain_err_tuple)
        })
        .await
        {
            Ok(result) => result?,
            Err(err) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    format!("等待上传运输回执任务执行失败: {err}"),
                ));
            }
        };
        if transport.as_ref().is_some_and(媒体上传运输回执已就绪) {
            return Ok(transport);
        }
    }
    Ok(transport)
}

fn 映射只读完成媒体临时文件(path: &StdPath) -> Result<Mmap, std::io::Error> {
    let file = StdFile::open(path)?;
    // 安全性：Tus `post-finish` 回执后的临时文件在 complete 阶段只做只读消费；
    // 这里既不写回文件，也不泄漏可变别名，因此只读映射满足 memmap 的前提。
    unsafe { MmapOptions::new().map(&file) }
}

async fn 获取媒体上传完成重活许可(
    gate: Arc<tokio::sync::Semaphore>,
) -> Result<tokio::sync::OwnedSemaphorePermit, tokio::sync::AcquireError> {
    gate.acquire_owned().await
}

struct Complete重活失败上下文<'a> {
    attachment_id: &'a str,
    attachment_kind: &'a str,
    byte_size: i64,
    started_at: Instant,
}

fn 记录并返回complete重活失败(
    上下文: &Complete重活失败上下文<'_>,
    status: StatusCode,
    code: &'static str,
    response_message: impl Into<String>,
    failure_reason: &'static str,
    log_detail: impl Into<String>,
) -> Response {
    let response_message = response_message.into();
    let log_detail = log_detail.into();
    let duration_ms = 上下文.started_at.elapsed().as_millis() as u64;
    if status.is_server_error() {
        tracing::error!(
            application = "完成媒体上传",
            phase = "complete_heavy_work_failed",
            attachment_id = 上下文.attachment_id,
            kind = 上下文.attachment_kind,
            byte_size = 上下文.byte_size,
            duration_ms,
            failure_reason,
            error_code = code,
            detail = %log_detail,
            "媒体上传 complete 重活失败"
        );
    } else {
        tracing::warn!(
            application = "完成媒体上传",
            phase = "complete_heavy_work_failed",
            attachment_id = 上下文.attachment_id,
            kind = 上下文.attachment_kind,
            byte_size = 上下文.byte_size,
            duration_ms,
            failure_reason,
            error_code = code,
            detail = %log_detail,
            "媒体上传 complete 重活失败"
        );
    }
    err_resp(status, code, response_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn 视频协作分发共享载荷会收口到canonical_mp4而不是继续沿用原片mime() {
        let 共享载荷 = 选择协作分发共享载荷(
            &application::媒体附件类型::视频,
            "video/quicktime",
            b"original-mov",
            Some(b"canonical-mp4"),
        )
        .expect("视频协作分发应能拿到 canonical mp4 载荷");

        assert_eq!(
            共享载荷.稳定扩展名, ".mp4",
            "视频协作分发 torrent 内文件名必须跟随长期可播放的 canonical mp4，而不是继续沿用上传原片后缀"
        );
        assert_eq!(
            共享载荷.字节, b"canonical-mp4",
            "视频协作分发的 content_hash / swarm payload 必须认 canonical mp4 字节，而不是认已退场原片"
        );
    }

    #[tokio::test]
    async fn 完成阶段并发闸门会阻止超过额度的重活同时进入() {
        let gate = Arc::new(tokio::sync::Semaphore::new(1));
        let first_permit = 获取媒体上传完成重活许可(gate.clone())
            .await
            .expect("第一份 permit 应可获取");

        let entered = Arc::new(tokio::sync::Notify::new());
        let released = Arc::new(tokio::sync::Notify::new());

        let gate_for_waiter = gate.clone();
        let entered_for_waiter = entered.clone();
        let released_for_waiter = released.clone();
        let waiter = tokio::spawn(async move {
            let _second_permit = 获取媒体上传完成重活许可(gate_for_waiter)
                .await
                .expect("第二份 permit 最终应可获取");
            entered_for_waiter.notify_one();
            released_for_waiter.notified().await;
        });

        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            !waiter.is_finished(),
            "额度已满时，第二个 complete 重活不应该直接闯进来"
        );

        drop(first_permit);
        entered.notified().await;
        released.notify_one();
        waiter.await.expect("waiter 应能正常结束");
    }
}
