use super::{
    err_resp, map_domain_err_tuple, tus_hook外壳, 媒体上传运输方式_TUS, 媒体内容解析, 应用状态,
    构建共享仓储, 流媒体打包,
};
use crate::{
    adapter::{媒体上传会话授权写入请求, 媒体上传运输记录},
    media_distribution, usecase,
    usecase::仓储端口,
};
use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{uri::Authority, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use memmap2::{Mmap, MmapOptions};
use object_store::{path::Path as ObjectPath, ObjectStoreExt};
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
    headers: HeaderMap,
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
            )
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
            )
        }
    };
    let byte_size = match body.byte_size {
        Some(byte_size) => byte_size,
        None => {
            return err_resp(
                StatusCode::BAD_REQUEST,
                "invalid_argument",
                "缺少 byte_size",
            )
        }
    };
    if let Err((status, code, message)) =
        校验媒体准备请求(&media_kind, &mime_type, byte_size)
    {
        return err_resp(status, code, message);
    }

    let attachment_id = 生成附件标识();
    let upload_session_id = 生成媒体上传会话标识();
    let storage_prefix = match media_kind {
        usecase::媒体附件类型::图片 => "images",
        usecase::媒体附件类型::视频 => "videos",
    };
    let original_storage_key = format!(
        "{storage_prefix}/{attachment_id}/original{}",
        推导原始内容扩展名(&media_kind, mime_type.as_str())
    );
    let prepare_request = usecase::媒体附件准备请求 {
        附件标识: attachment_id.clone(),
        种类: media_kind.clone(),
        mime_type: mime_type.clone(),
        字节大小: byte_size,
        原始内容存储键: original_storage_key.clone(),
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let prepare_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        usecase::准备媒体附件上传(&mut repo, &session_id_for_usecase, &prepare_request)
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
            )
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
                usecase = "准备媒体上传",
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
            usecase = "准备媒体上传",
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
        usecase = "准备媒体上传",
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
    let tus_public_endpoint = 读取媒体_tus对外地址(&state, &headers);
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
        let prepared = usecase::读取待完成媒体附件(
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
            )
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
            usecase = "完成媒体上传",
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
            usecase = "完成媒体上传",
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
            usecase = "完成媒体上传",
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
                    usecase = "完成媒体上传",
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
    tracing::info!(
        usecase = "完成媒体上传",
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
            usecase = "完成媒体上传",
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
    let 原始冷源到期时间戳秒 = ready_epoch秒 + usecase::媒体原始冷源保留秒数;
    let mut streaming_manifest_request = None;
    let (ready_request, distribution_request, torrent_request) = match &prepared.种类 {
        usecase::媒体附件类型::图片 => {
            let original_bytes: Vec<u8> = match fs::read(&temp_file_path).await {
                Ok(bytes) => bytes,
                Err(err) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "读取原图临时文件失败",
                        "read_temp_file_failed",
                        format!("读取 Tus 临时原图文件失败: {err}"),
                    );
                }
            };
            let parsed = match 媒体内容解析::解析图片内容(original_bytes.as_ref()) {
                Ok(parsed) => parsed,
                Err(媒体内容解析::媒体内容解析错误::类型不允许(message)) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::BAD_REQUEST,
                        "attachment_type_not_allowed",
                        message,
                        "parse_image_kind_not_allowed",
                        message,
                    )
                }
                Err(媒体内容解析::媒体内容解析错误::系统错误(message)) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        message,
                        "parse_image_system_error",
                        message,
                    )
                }
            };
            let original_path = ObjectPath::from(prepared.原始内容存储键.clone());
            if let Err(err) = state
                .attachment_store
                .put(&original_path, original_bytes.clone().into())
                .await
            {
                return 记录并返回complete重活失败(
                    attachment_id.as_str(),
                    attachment_kind,
                    attachment_byte_size,
                    complete_heavy_work_started_at,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "写入原图对象失败",
                    "put_original_object_failed",
                    format!("写入 canonical 原图对象失败: {err}"),
                );
            }
            let thumbnail_storage_key = format!("images/{attachment_id}/thumbnail.png");
            let thumbnail_path = ObjectPath::from(thumbnail_storage_key.clone());
            let asset_original_storage_key = format!(
                "images/{attachment_id}/asset-original{}",
                推导原始内容扩展名(&prepared.种类, parsed.mime_type.as_str())
            );
            let asset_original_path = ObjectPath::from(asset_original_storage_key.clone());
            let full_storage_key = format!("images/{attachment_id}/full.webp");
            let full_path = ObjectPath::from(full_storage_key.clone());
            if let Err(err) = state
                .attachment_store
                .put(&thumbnail_path, parsed.缩略图字节.into())
                .await
            {
                return 记录并返回complete重活失败(
                    attachment_id.as_str(),
                    attachment_kind,
                    attachment_byte_size,
                    complete_heavy_work_started_at,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "写入图片缩略图对象失败",
                    "put_image_thumbnail_failed",
                    format!("写入图片缩略图对象失败: {err}"),
                );
            }
            if let Err(err) = state
                .attachment_store
                .put(&asset_original_path, original_bytes.clone().into())
                .await
            {
                return 记录并返回complete重活失败(
                    attachment_id.as_str(),
                    attachment_kind,
                    attachment_byte_size,
                    complete_heavy_work_started_at,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "写入图片长期原图资产失败",
                    "put_image_asset_original_failed",
                    format!("写入图片长期原图资产失败: {err}"),
                );
            }
            if let Err(err) = state
                .attachment_store
                .put(&full_path, parsed.完整图字节.into())
                .await
            {
                return 记录并返回complete重活失败(
                    attachment_id.as_str(),
                    attachment_kind,
                    attachment_byte_size,
                    complete_heavy_work_started_at,
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "system_error",
                    "写入图片完整图对象失败",
                    "put_image_full_failed",
                    format!("写入图片完整图对象失败: {err}"),
                );
            }
            let 协作分发共享载荷 = 选择协作分发共享载荷(
                &prepared.种类,
                parsed.mime_type.as_str(),
                original_bytes.as_ref(),
                None,
            )
            .expect("图片协作分发应直接复用 canonical 原图字节");
            let distribution_request = media_distribution::构造协作分发元数据写入请求(
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
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        message.clone(),
                        "generate_torrent_failed",
                        message,
                    );
                }
            };
            let ready_request = usecase::媒体附件写入请求 {
                附件标识: attachment_id.clone(),
                种类: prepared.种类.clone(),
                mime_type: parsed.mime_type,
                字节大小: original_bytes.len() as i64,
                宽: parsed.宽,
                高: parsed.高,
                原始内容存储键: prepared.原始内容存储键.clone(),
                缩略图存储键: Some(thumbnail_storage_key),
                资产原图存储键: Some(asset_original_storage_key),
                完整图存储键: Some(full_storage_key),
                原始冷源到期时间戳秒: Some(原始冷源到期时间戳秒),
                回退母本存储键: None,
                回退母本到期时间戳秒: None,
            };
            let torrent_request = usecase::协作分发torrent元信息写入请求 {
                附件标识: attachment_id.clone(),
                torrent_bytes: torrent.torrent_bytes,
                torrent_info_hash: torrent.torrent_info_hash,
                piece_length字节: torrent.piece_length_bytes,
            };
            (ready_request, distribution_request, torrent_request)
        }
        usecase::媒体附件类型::视频 => {
            let 视频解析开始 = Instant::now();
            let parsed =
                match 媒体内容解析::解析视频文件内容(temp_file_path.as_path()) {
                    Ok(parsed) => parsed,
                    Err(媒体内容解析::媒体内容解析错误::类型不允许(message)) => {
                        return 记录并返回complete重活失败(
                            attachment_id.as_str(),
                            attachment_kind,
                            attachment_byte_size,
                            complete_heavy_work_started_at,
                            StatusCode::BAD_REQUEST,
                            "attachment_type_not_allowed",
                            message,
                            "parse_video_kind_not_allowed",
                            message,
                        )
                    }
                    Err(媒体内容解析::媒体内容解析错误::系统错误(message)) => {
                        return 记录并返回complete重活失败(
                            attachment_id.as_str(),
                            attachment_kind,
                            attachment_byte_size,
                            complete_heavy_work_started_at,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message,
                            "parse_video_system_error",
                            message,
                        )
                    }
                };
            记录complete阶段耗时("parse_video", 视频解析开始);
            let 流媒体打包开始 = Instant::now();
            let 打包结果 = match task::spawn_blocking({
                let ffmpeg_bin = state.ffmpeg_bin.clone();
                let ffprobe_bin = state.ffprobe_bin.clone();
                let shaka_packager_bin = state.shaka_packager_bin.clone();
                let attachment_id = attachment_id.clone();
                let temp_file_path = temp_file_path.clone();
                move || {
                    流媒体打包::生成流媒体打包产物(
                        ffmpeg_bin.as_str(),
                        ffprobe_bin.as_str(),
                        shaka_packager_bin.as_str(),
                        attachment_id.as_str(),
                        temp_file_path.as_path(),
                    )
                }
            })
            .await
            {
                Ok(Ok(result)) => result,
                Ok(Err((status, code, message))) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        status,
                        code,
                        message.clone(),
                        "stream_packaging_failed",
                        message,
                    )
                }
                Err(err) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        format!("流媒体打包任务执行失败: {err}"),
                        "stream_packaging_task_failed",
                        format!("流媒体打包任务执行失败: {err}"),
                    )
                }
            };
            记录complete阶段耗时("package_streaming_assets", 流媒体打包开始);
            let 分发元数据构造开始 = Instant::now();
            let 回退母本映射 = match 映射只读完成媒体临时文件(
                打包结果.高质量回退母本本地路径.as_path(),
            ) {
                Ok(mapped) => mapped,
                Err(err) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "映射视频 mezzanine 回退母本失败",
                        "map_mezzanine_video_failed",
                        format!("映射视频 canonical mezzanine 失败: {err}"),
                    );
                }
            };
            let 协作分发共享载荷 = match 选择协作分发共享载荷(
                &prepared.种类,
                parsed.mime_type.as_str(),
                &[],
                Some(回退母本映射.as_ref()),
            ) {
                Ok(payload) => payload,
                Err(message) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        message,
                        "select_swarm_payload_failed",
                        message,
                    );
                }
            };
            let distribution_request = media_distribution::构造协作分发元数据写入请求(
                &attachment_id,
                协作分发共享载荷.字节,
                ready_epoch秒,
            );
            记录complete阶段耗时("build_distribution_request", 分发元数据构造开始);
            let torrent生成开始 = Instant::now();
            let torrent = match media_distribution::生成附件torrent元信息(
                distribution_request.content_hash.as_str(),
                协作分发共享载荷.稳定扩展名,
                协作分发共享载荷.字节,
            ) {
                Ok(torrent) => torrent,
                Err(message) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        message.clone(),
                        "generate_torrent_failed",
                        message,
                    );
                }
            };
            记录complete阶段耗时("generate_torrent", torrent生成开始);
            drop(回退母本映射);
            let 流媒体产物上传开始 = Instant::now();
            let uploaded = match 流媒体打包::上传流媒体打包产物(
                &state,
                &attachment_id,
                原始冷源到期时间戳秒,
                打包结果,
            )
            .await
            {
                Ok(uploaded) => uploaded,
                Err((status, code, message)) => {
                    return 记录并返回complete重活失败(
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        status,
                        code,
                        message.clone(),
                        "upload_streaming_assets_failed",
                        message,
                    )
                }
            };
            记录complete阶段耗时("upload_streaming_assets", 流媒体产物上传开始);
            let 流媒体打包::流媒体打包上传结果 {
                清单写入请求,
                静态封面存储键,
                回退母本存储键,
            } = uploaded;
            streaming_manifest_request = Some(清单写入请求);
            let ready_request = usecase::媒体附件写入请求 {
                附件标识: attachment_id.clone(),
                种类: prepared.种类.clone(),
                mime_type: parsed.mime_type,
                字节大小: attachment_byte_size,
                宽: parsed.宽,
                高: parsed.高,
                // 视频 ready 后的 original 变体不再指向用户原片，而是指向 24h 的高质量 mezzanine。
                // 这样 original_url / web_seed / range 读取链都继续走同一个稳定入口，不必再为“原片已删”额外分叉。
                原始内容存储键: 回退母本存储键.clone(),
                缩略图存储键: Some(静态封面存储键),
                资产原图存储键: None,
                完整图存储键: None,
                原始冷源到期时间戳秒: None,
                回退母本存储键: Some(回退母本存储键),
                回退母本到期时间戳秒: Some(原始冷源到期时间戳秒),
            };
            let torrent_request = usecase::协作分发torrent元信息写入请求 {
                附件标识: attachment_id.clone(),
                torrent_bytes: torrent.torrent_bytes,
                torrent_info_hash: torrent.torrent_info_hash,
                piece_length字节: torrent.piece_length_bytes,
            };
            (ready_request, distribution_request, torrent_request)
        }
    };
    let state_for_usecase = state.clone();
    let session_id_for_usecase = session_id.clone();
    let distribution_request_for_write = distribution_request.clone();
    let torrent_request_for_write = torrent_request.clone();
    let streaming_manifest_request_for_write = streaming_manifest_request.clone();
    let 写入权威真相开始 = Instant::now();
    let complete_result = task::spawn_blocking(move || {
        let mut repo = 构建共享仓储(&state_for_usecase);
        let snapshot =
            usecase::完成媒体附件上传(&mut repo, &session_id_for_usecase, &ready_request)
                .map_err(map_domain_err_tuple)?;
        usecase::写入协作分发元数据(&mut repo, &distribution_request_for_write)
            .map_err(map_domain_err_tuple)?;
        usecase::写入协作分发torrent元信息(&mut repo, &torrent_request_for_write)
            .map_err(map_domain_err_tuple)?;
        if let Some(request) = streaming_manifest_request_for_write.as_ref() {
            usecase::写入流媒体清单元数据(&mut repo, request).map_err(map_domain_err_tuple)?;
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
                        attachment_id.as_str(),
                        attachment_kind,
                        attachment_byte_size,
                        complete_heavy_work_started_at,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "删除上传临时文件失败",
                        "delete_upload_temp_file_failed",
                        format!("删除 Tus 上传临时文件失败: {err}"),
                    )
                }
            }
            记录complete阶段耗时("delete_upload_temp_file", 上传临时文件退场开始);
            let (_原片删除时间戳秒, 冷备层到期时间戳秒, 冷备层删除时间戳秒) =
                if matches!(prepared.种类, usecase::媒体附件类型::视频) {
                    let 原始冷源退场开始 = Instant::now();
                    // 视频原片删除记录的是“用户上传母本已退场”，
                    // 但对外暴露的 original 冷备入口此时已经切成 mezzanine，不能把这两个事实混成一个删除位。
                    let 原片删除时间戳秒 = ready_epoch秒;
                    let state_for_mark = state.clone();
                    let attachment_id_for_mark = attachment_id.clone();
                    let 原始冷源退场结果 = match task::spawn_blocking(move || {
                        let mut repo = 构建共享仓储(&state_for_mark);
                        usecase::标记媒体冷源已删除(
                            &mut repo,
                            &attachment_id_for_mark,
                            原片删除时间戳秒,
                        )
                        .map_err(map_domain_err_tuple)
                    })
                    .await
                    {
                        Ok(Ok(())) => (Some(原片删除时间戳秒), Some(原始冷源到期时间戳秒), None),
                        Ok(Err((status, code, message))) => {
                            return 记录并返回complete重活失败(
                                attachment_id.as_str(),
                                attachment_kind,
                                attachment_byte_size,
                                complete_heavy_work_started_at,
                                status,
                                code,
                                message.clone(),
                                "mark_original_cold_source_deleted_failed",
                                message,
                            )
                        }
                        Err(err) => {
                            return 记录并返回complete重活失败(
                                attachment_id.as_str(),
                                attachment_kind,
                                attachment_byte_size,
                                complete_heavy_work_started_at,
                                StatusCode::INTERNAL_SERVER_ERROR,
                                "system_error",
                                format!("标记原始上传冷源已删除任务失败: {err}"),
                                "mark_original_cold_source_deleted_task_failed",
                                format!("标记原始上传冷源已删除任务失败: {err}"),
                            )
                        }
                    };
                    记录complete阶段耗时("retire_original_upload_source", 原始冷源退场开始);
                    原始冷源退场结果
                } else {
                    (None, Some(原始冷源到期时间戳秒), None)
                };
            let distribution_snapshot = usecase::协作分发元数据快照 {
                附件标识: attachment_id.clone(),
                content_id: distribution_request.content_id.clone(),
                content_hash: distribution_request.content_hash.clone(),
                swarm_id: distribution_request.swarm_id.clone(),
                web_seed_until秒: distribution_request.web_seed_until秒,
                最近peer存活时间戳秒: None,
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
            let 冷源仍可用 = usecase::冷源当前可用(
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
                    now_epoch秒,
                    stale_seconds: state.swarm_peer_presence_stale_seconds,
                },
            );
            let streaming_manifest_snapshot =
                streaming_manifest_request
                    .as_ref()
                    .map(|request| usecase::流媒体清单快照 {
                        附件标识: request.附件标识.clone(),
                        hls主清单存储键: request.hls主清单存储键.clone(),
                        dash主清单存储键: request.dash主清单存储键.clone(),
                        streaming到期时间戳秒: Some(request.streaming到期时间戳秒),
                        streaming删除时间戳秒: request.streaming删除时间戳秒,
                    });
            let media_asset = super::媒体资产外壳::构造媒体资产响应体(
                &snapshot,
                super::媒体资产外壳::媒体资产响应上下文 {
                    运行态分发: Some(&runtime_distribution),
                    分发快照: Some(&distribution_snapshot),
                    流媒体清单: streaming_manifest_snapshot.as_ref(),
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
                snapshot.允许缩略图,
            );
            tracing::info!(
                usecase = "完成媒体上传",
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
            attachment_id.as_str(),
            attachment_kind,
            attachment_byte_size,
            complete_heavy_work_started_at,
            status,
            code,
            message.clone(),
            "write_ready_snapshot_failed",
            message,
        ),
        Err(err) => 记录并返回complete重活失败(
            attachment_id.as_str(),
            attachment_kind,
            attachment_byte_size,
            complete_heavy_work_started_at,
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
        usecase::放弃媒体上传(
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
            )
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
                usecase = "放弃媒体上传",
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
        if let Err(err) = super::执行一次媒体上传残留清理_按会话(
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
            )
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
            )
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
        response_builder = response_builder.header(name, value);
    }
    let body = match upstream_response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            return err_resp(
                StatusCode::BAD_GATEWAY,
                "media_tus_upstream_invalid_response",
                format!("读取 Tus sidecar 响应失败: {err}"),
            )
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
) -> Result<usecase::媒体附件类型, (StatusCode, &'static str, &'static str)> {
    match raw_kind {
        "image" => Ok(usecase::媒体附件类型::图片),
        "video" => Ok(usecase::媒体附件类型::视频),
        _ => Err((
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "只允许上传图片或视频",
        )),
    }
}

fn 推导原始内容扩展名(
    kind: &usecase::媒体附件类型, mime_type: &str
) -> &'static str {
    match kind {
        usecase::媒体附件类型::图片 => match mime_type {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".bin",
        },
        usecase::媒体附件类型::视频 => match mime_type {
            "video/mp4" => ".mp4",
            "video/webm" => ".webm",
            "video/quicktime" => ".mov",
            "video/3gpp" => ".3gp",
            _ => ".bin",
        },
    }
}

struct 协作分发共享载荷<'a> {
    字节: &'a [u8],
    稳定扩展名: &'static str,
}

fn 选择协作分发共享载荷<'a>(
    kind: &usecase::媒体附件类型,
    原始mime_type: &str,
    原始字节: &'a [u8],
    视频回退母本字节: Option<&'a [u8]>,
) -> Result<协作分发共享载荷<'a>, &'static str> {
    match kind {
        usecase::媒体附件类型::图片 => Ok(协作分发共享载荷 {
            字节: 原始字节,
            稳定扩展名: 推导原始内容扩展名(kind, 原始mime_type),
        }),
        // 视频对外长期可播放的 canonical 冷备已经收口到 mezzanine.mp4；
        // swarm 也必须复用同一份字节与扩展，不能继续认上传原片的容器类型。
        usecase::媒体附件类型::视频 => {
            let Some(视频回退母本字节) = 视频回退母本字节 else {
                return Err("视频协作分发缺少 canonical mezzanine 载荷");
            };
            Ok(协作分发共享载荷 {
                字节: 视频回退母本字节,
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

/// `MEDIA_TUS_PUBLIC_ENDPOINT` 没显式配置时，这里按当前 HTTP 请求 Host 推导一个 LAN 可达的地址。
///
/// 边界约束：
/// 1. 显式配置永远优先，生产反向代理场景仍应直接给出权威 public endpoint；
/// 2. 这里只作为本机/局域网开发兜底，避免 prepare 默认把 `127.0.0.1` 塞给异机浏览器；
/// 3. 推导结果仍然只描述“Tus sidecar 暴露在哪”，不改变业务真相归属。
fn 推导媒体tus对外入口(
    headers: &HeaderMap,
    tus_server_port: u16,
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

    // 端口推导要区分“公网 authority”与“内部 Tus sidecar 监听端口”：
    // 1. 开发/LAN 直连时，Host 通常只是应用入口端口（例如 8080），Tus 仍应落到单独的 sidecar 端口；
    // 2. 反向代理场景若已经通过 forwarded 头给出公网端口/authority，就应该优先沿用公网信息，
    //    不能再把内部 1081 一类监听端口泄漏给浏览器。
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
        .or_else(|| {
            should_trust_authority_port
                .then(|| authority.port_u16())
                .flatten()
        })
        .or(inferred_proxy_default_port)
        .unwrap_or(tus_server_port);
    let should_omit_port =
        (scheme == "http" && public_port == 80) || (scheme == "https" && public_port == 443);
    let authority_for_url = if should_omit_port {
        host_for_url
    } else {
        format!("{host_for_url}:{public_port}")
    };
    Some(format!("{scheme}://{authority_for_url}{tus_base_path}"))
}

fn 读取媒体_tus对外地址(state: &应用状态, headers: &HeaderMap) -> String {
    let normalized_tus_base_path = 标准化媒体_tus基础路径(state.tus_base_path.as_str());
    state
        .tus_public_endpoint
        .clone()
        .or_else(|| {
            推导媒体tus对外入口(
                headers,
                state.tus_server_port,
                normalized_tus_base_path.as_str(),
            )
        })
        .unwrap_or_else(|| {
            format!(
                "http://127.0.0.1:{}{}",
                state.tus_server_port, normalized_tus_base_path
            )
        })
}

fn 校验媒体准备请求(
    kind: &usecase::媒体附件类型,
    mime_type: &str,
    byte_size: i64,
) -> Result<(), (StatusCode, &'static str, &'static str)> {
    const 图片附件上传上限字节数: i64 = 10 * 1024 * 1024;
    const 视频附件上传上限字节数: i64 = 200 * 1024 * 1024;

    if byte_size <= 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "媒体大小非法"));
    }
    match kind {
        usecase::媒体附件类型::图片 => {
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
        usecase::媒体附件类型::视频 => {
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
                ))
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

fn 记录并返回complete重活失败(
    attachment_id: &str,
    attachment_kind: &str,
    byte_size: i64,
    started_at: Instant,
    status: StatusCode,
    code: &'static str,
    response_message: impl Into<String>,
    failure_reason: &'static str,
    log_detail: impl Into<String>,
) -> Response {
    let response_message = response_message.into();
    let log_detail = log_detail.into();
    let duration_ms = started_at.elapsed().as_millis() as u64;
    if status.is_server_error() {
        tracing::error!(
            usecase = "完成媒体上传",
            phase = "complete_heavy_work_failed",
            attachment_id,
            kind = attachment_kind,
            byte_size,
            duration_ms,
            failure_reason,
            error_code = code,
            detail = %log_detail,
            "媒体上传 complete 重活失败"
        );
    } else {
        tracing::warn!(
            usecase = "完成媒体上传",
            phase = "complete_heavy_work_failed",
            attachment_id,
            kind = attachment_kind,
            byte_size,
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
    fn 视频协作分发共享载荷会收口到mezzanine_mp4而不是继续沿用原片mime() {
        let 共享载荷 = 选择协作分发共享载荷(
            &usecase::媒体附件类型::视频,
            "video/quicktime",
            b"original-mov",
            Some(b"mezzanine-mp4"),
        )
        .expect("视频协作分发应能拿到 canonical mezzanine 载荷");

        assert_eq!(
            共享载荷.稳定扩展名,
            ".mp4",
            "视频协作分发 torrent 内文件名必须跟随长期可播放的 mezzanine，而不是继续沿用上传原片后缀"
        );
        assert_eq!(
            共享载荷.字节,
            b"mezzanine-mp4",
            "视频协作分发的 content_hash / swarm payload 必须认 canonical mezzanine 字节，而不是认已退场原片"
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
