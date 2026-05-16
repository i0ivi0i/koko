use super::媒体上传共享外壳::推导原始内容扩展名;
use super::{tus_hook外壳, 媒体内容解析, 应用状态, 构建共享仓储};
use crate::adapter::媒体上传运输记录;
use crate::media::distribution::application as 协作分发应用;
use crate::media::upload::application as 上传应用;
use crate::media_distribution;
use crate::shell::协议响应::{err_resp, map_domain_err_tuple};
use axum::{
    extract::{Path, State},
    http::StatusCode,
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

/// complete 会短暂等待 sidecar 的 post-finish 回执，以吸收正常网络竞态。
const 完成媒体上传等待回执最大轮询次数: usize = 20;
const 完成媒体上传等待回执轮询间隔: Duration = Duration::from_millis(50);
/// 媒体 complete 请求体。
#[derive(Deserialize)]
pub(super) struct CompleteMediaUploadBody {
    session_id: Option<String>,
}

/// 冷路径：完成媒体附件上传。
/// 这里消费 Tus sidecar finished 回执指向的 shared file，写回 canonical store 后，再把 prepared 升级成 ready。
pub(super) async fn complete_media_upload(
    State(state): State<应用状态>,
    Path(attachment_id): Path<String>,
    Json(body): Json<CompleteMediaUploadBody>,
) -> impl IntoResponse {
    let session_id = match super::读取非空会话标识(body.session_id) {
        Ok(session_id) => session_id,
        Err((status, code, message)) => return err_resp(status, code, message),
    };
    let tracker_public_url = media_distribution::读取协作分发tracker对外地址(
        state.swarm_tracker_public_url.as_str(),
    );
    let state_for_usecase = state.clone();
    let attachment_id_for_usecase = attachment_id.clone();
    let session_id_for_usecase = session_id.clone();
    let prepared_and_transport = match task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let media_repo = repo.媒体仓储();
        let prepared = 上传应用::读取待完成媒体附件(
            &media_repo,
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
    let 原始冷源到期时间戳秒 = ready_epoch秒 + crate::media::模型::媒体原始冷源保留秒数;
    let (ready_request, distribution_request, torrent_request, canonical_asset_request) =
        match &prepared.种类 {
            crate::media::模型::媒体附件类型::图片 => {
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
                let torrent_bytes_for_blocking = 协作分发共享载荷.字节.to_vec();
                let torrent_hash_for_blocking = distribution_request.content_hash.clone();
                let torrent_ext_for_blocking = 协作分发共享载荷.稳定扩展名.to_string();
                let canonical_storage_key = 构造canonical内容寻址存储键(
                    distribution_request.content_hash.as_str(),
                    协作分发共享载荷.稳定扩展名,
                );
                let canonical_path = ObjectPath::from(canonical_storage_key.clone());
                drop(协作分发共享载荷);
                let image_byte_size = original_bytes.len() as i64;
                let (put_result, torrent_result) = tokio::join!(
                    state
                        .attachment_store
                        .put(&canonical_path, original_bytes.into()),
                    task::spawn_blocking(move || {
                        media_distribution::生成附件torrent元信息(
                            &torrent_hash_for_blocking,
                            &torrent_ext_for_blocking,
                            &torrent_bytes_for_blocking,
                        )
                    })
                );
                if let Err(err) = put_result {
                    return 记录并返回complete重活失败(
                        &complete失败上下文,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "写入 canonical 图片对象失败",
                        "put_image_canonical_failed",
                        format!("写入 canonical 图片对象失败: {err}"),
                    );
                }
                let torrent = match torrent_result {
                    Ok(Ok(t)) => t,
                    Ok(Err(message)) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message.clone(),
                            "generate_torrent_failed",
                            message,
                        );
                    }
                    Err(join_err) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            "torrent 生成任务执行失败",
                            "generate_torrent_join_failed",
                            format!("spawn_blocking join 失败: {join_err}"),
                        );
                    }
                };
                let ready_request = crate::media::模型::媒体附件写入请求 {
                    附件标识: attachment_id.clone(),
                    种类: prepared.种类.clone(),
                    mime_type: parsed.mime_type,
                    字节大小: image_byte_size,
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
                let torrent_request =
                    crate::media::模型::协作分发torrent元信息写入请求 {
                        附件标识: attachment_id.clone(),
                        torrent_bytes: torrent.torrent_bytes,
                        torrent_info_hash: torrent.torrent_info_hash,
                        piece_length字节: torrent.piece_length_bytes,
                    };
                let canonical_asset_request =
                    crate::media::模型::Canonical媒体资产写入请求 {
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
            crate::media::模型::媒体附件类型::视频 => {
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
                let canonical_torrent并行开始 = Instant::now();
                let torrent_bytes_for_blocking = 协作分发共享载荷.字节.to_vec();
                let torrent_hash_for_blocking = distribution_request.content_hash.clone();
                let torrent_ext_for_blocking = 协作分发共享载荷.稳定扩展名.to_string();
                let (canonical_result, torrent_result) = tokio::join!(
                    流式写入对象存储(
                        &state.attachment_store,
                        &canonical_video_path,
                        canonical_video_mapping.as_ref(),
                    ),
                    task::spawn_blocking(move || {
                        media_distribution::生成附件torrent元信息(
                            &torrent_hash_for_blocking,
                            &torrent_ext_for_blocking,
                            &torrent_bytes_for_blocking,
                        )
                    })
                );
                if let Err(err) = canonical_result {
                    return 记录并返回complete重活失败(
                        &complete失败上下文,
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "system_error",
                        "写入 canonical 视频对象失败",
                        "put_video_canonical_failed",
                        format!("流式写入 canonical 视频对象失败: {err}"),
                    );
                }
                let torrent = match torrent_result {
                    Ok(Ok(t)) => t,
                    Ok(Err(message)) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            message.clone(),
                            "generate_torrent_failed",
                            message,
                        );
                    }
                    Err(join_err) => {
                        return 记录并返回complete重活失败(
                            &complete失败上下文,
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "system_error",
                            "torrent 生成任务执行失败",
                            "generate_torrent_join_failed",
                            format!("spawn_blocking join 失败: {join_err}"),
                        );
                    }
                };
                记录complete阶段耗时("canonical_and_torrent_parallel", canonical_torrent并行开始);
                drop(canonical_video_mapping);
                let ready_request = crate::media::模型::媒体附件写入请求 {
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
                let torrent_request =
                    crate::media::模型::协作分发torrent元信息写入请求 {
                        附件标识: attachment_id.clone(),
                        torrent_bytes: torrent.torrent_bytes,
                        torrent_info_hash: torrent.torrent_info_hash,
                        piece_length字节: torrent.piece_length_bytes,
                    };
                let canonical_asset_request =
                    crate::media::模型::Canonical媒体资产写入请求 {
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
    let 写入权威真相开始 = Instant::now();
    let complete_result = task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_usecase);
        let mut media_repo = repo.媒体仓储();
        let snapshot = 上传应用::完成媒体附件上传(
            &mut media_repo,
            &session_id_for_usecase,
            &ready_request,
        )
        .map_err(map_domain_err_tuple)?;
        // canonical 资产是内容身份层事实，先写资产再绑定附件引用；
        // 后续 source_hash 命中才能复用同一资产，而不是复制旧附件或旧消息。
        crate::media::application::媒体仓储端口::写入canonical媒体资产(
            &mut media_repo,
            &canonical_asset_request_for_write,
        )
        .map_err(map_domain_err_tuple)?;
        crate::media::application::媒体仓储端口::绑定附件canonical媒体资产(
            &mut media_repo,
            &snapshot.附件标识,
            canonical_asset_request_for_write.content_hash.as_str(),
        )
        .map_err(map_domain_err_tuple)?;
        协作分发应用::写入协作分发元数据(
            &mut media_repo,
            &distribution_request_for_write,
        )
        .map_err(map_domain_err_tuple)?;
        协作分发应用::写入协作分发torrent元信息(
            &mut media_repo,
            &torrent_request_for_write,
        )
        .map_err(map_domain_err_tuple)?;
        // 2026-05-05 起新附件正式主链只保留 canonical + swarm/torrent 元信息。
        // 旧 attachment_streaming_manifests 已退出当前写入链，避免 complete 再把 HLS/DASH 第二真相续命。
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
            let distribution_snapshot = crate::media::模型::协作分发元数据快照 {
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
            let 冷源仍可用 = crate::media::模型::冷源当前可用(
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
                    ice_servers: state.get_turn_ice_servers().await,
                },
            );
            // complete 成功后 fire-and-forget 触发 sidecar 做种：
            // 1. 不再阻塞 complete 响应（省 ~50-200ms），让前端更早拿到 ready 快照；
            // 2. 命令载荷严格来自同一份 runtime_distribution，不长第二套 transport 真相；
            // 3. 失败只记告警并交给后台对账周期性补偿，不影响 ready 真相。
            if let Some(启动命令) =
                super::协作分发做种::从协作分发响应构造做种启动命令(
                    &runtime_distribution,
                    state.swarm_seeder_tracker_url.as_str(),
                )
            {
                let spawn_state = state.clone();
                let spawn_attachment_id = attachment_id.clone();
                tokio::spawn(async move {
                    if let Err(err) =
                        super::协作分发做种::尝试启动协作分发做种(&spawn_state, &启动命令).await
                    {
                        tracing::warn!(
                            application = "完成媒体上传",
                            phase = "seed_start_failed",
                            attachment_id = spawn_attachment_id.as_str(),
                            info_hash = 启动命令.info_hash.as_str(),
                            error = %err,
                            "complete 成功后触发 sidecar 做种失败，等待后台对账重试"
                        );
                    }
                });
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
                matches!(snapshot.种类, crate::media::模型::媒体附件类型::视频)
                    && snapshot.允许缩略图,
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
            // pending-first：complete 成功后广播 attachment_status_changed ready 到房间。
            // fire-and-forget：广播失败不阻断 HTTP 响应，客户端可通过恢复/增量拉取补偿。
            if let Some(ref io) = state.realtime_io {
                let io = io.clone();
                let pool = state.pool.clone();
                let aid = attachment_id.clone();
                let tracker_url = state.swarm_tracker_public_url.clone();
                let ticket_secret = state.swarm_ticket_secret.clone();
                let ticket_ttl = state.swarm_ticket_ttl_seconds;
                tokio::spawn(async move {
                    广播附件状态升级事件(
                        &io, &pool, &aid, &tracker_url,
                        ticket_secret.as_deref(), ticket_ttl,
                    ).await;
                });
            }
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

fn 构造canonical内容寻址存储键(content_hash: &str, extension: &str) -> String {
    format!("media-assets/{content_hash}/canonical{extension}")
}

struct 协作分发共享载荷<'a> {
    字节: &'a [u8],
    稳定扩展名: &'static str,
}

fn 选择协作分发共享载荷<'a>(
    kind: &crate::media::模型::媒体附件类型,
    原始mime_type: &str,
    原始字节: &'a [u8],
    canonical视频字节: Option<&'a [u8]>,
) -> Result<协作分发共享载荷<'a>, &'static str> {
    match kind {
        crate::media::模型::媒体附件类型::图片 => Ok(协作分发共享载荷 {
            字节: 原始字节,
            稳定扩展名: 推导原始内容扩展名(kind, 原始mime_type),
        }),
        // 视频对外长期可播放的 canonical 已经由客户端预制成 mp4；
        // swarm 也必须复用同一份字节与扩展，不能再等待后端 mezzanine 或分段产物。
        crate::media::模型::媒体附件类型::视频 => {
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

/// 4 MB 分片流式写入，避免视频等大文件一次性 `to_vec()` 的全量堆拷贝。
async fn 流式写入对象存储(
    store: &std::sync::Arc<dyn object_store::ObjectStore>,
    path: &ObjectPath,
    data: &[u8],
) -> Result<(), String> {
    let mut upload = store
        .put_multipart(path)
        .await
        .map_err(|err| format!("创建流式写入失败: {err}"))?;
    for chunk in data.chunks(4 * 1024 * 1024) {
        if let Err(err) = upload.put_part(chunk.to_vec().into()).await {
            let _ = upload.abort().await;
            return Err(format!("写入分片失败: {err}"));
        }
    }
    upload
        .complete()
        .await
        .map(|_| ())
        .map_err(|err| format!("完成流式写入失败: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn 视频协作分发共享载荷会收口到canonical_mp4而不是继续沿用原片mime() {
        let 共享载荷 = 选择协作分发共享载荷(
            &crate::media::模型::媒体附件类型::视频,
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

/// pending-first：complete 成功后查询附件绑定的消息，广播 ready 升级事件到房间。
/// 广播失败只记日志不中断：客户端可通过恢复/增量拉取补偿。
async fn 广播附件状态升级事件(
    io: &socketioxide::SocketIo,
    pool: &sqlx::PgPool,
    attachment_id: &str,
    tracker_public_url: &str,
    ticket_secret: Option<&str>,
    ticket_ttl_seconds: i64,
) {
    // 查询该附件绑定到哪些消息（通常为 1 条，但设计上允许多条）
    let rows = match sqlx::query(
        "SELECT mar.message_id, r.room_id, r.latest_event_position, \
                a.kind, a.status, a.width, a.height, \
                a.thumbnail_storage_key IS NOT NULL AS has_preview, \
                adm.content_hash, adm.swarm_id, adm.torrent_info_hash, \
                EXTRACT(EPOCH FROM adm.web_seed_until)::BIGINT AS web_seed_until_epoch \
         FROM message_attachment_refs mar \
         JOIN attachments a ON a.id = mar.attachment_id \
         JOIN messages m ON m.message_id = mar.message_id \
         JOIN rooms r ON r.id = m.room_id \
         LEFT JOIN attachment_distribution_metadata adm ON adm.attachment_id = a.attachment_id \
         WHERE a.attachment_id = $1",
    )
    .bind(attachment_id)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(
                application = "附件状态升级",
                attachment_id,
                error = %err,
                "查询附件消息绑定失败，跳过广播"
            );
            return;
        }
    };
    if rows.is_empty() {
        // 附件尚未绑定到任何消息（用户可能未点发送），不需要广播
        return;
    }
    for row in &rows {
        use sqlx::Row;
        let room_id: String = row.get("room_id");
        let message_id: String = row.get("message_id");
        let kind: String = row.get("kind");
        let status: String = row.get("status");
        let width: Option<i32> = row.get("width");
        let height: Option<i32> = row.get("height");
        let has_preview: bool = row.get("has_preview");
        // 构造契约附件快照
        let contract_status = match status.as_str() {
            "ready" => "ready",
            "processing" => "processing",
            "uploading" => "uploading",
            "prepared" => "pending",
            _ => "failed",
        };
        let mut attachment_json = serde_json::json!({
            "kind": kind,
            "attachment_id": attachment_id,
            "width": width,
            "height": height,
            "status": contract_status,
            "has_preview_asset": has_preview,
        });
        // ready 时附带分发线索
        if contract_status == "ready" {
            let ch: Option<String> = row.get("content_hash");
            let si: Option<String> = row.get("swarm_id");
            let ih: Option<String> = row.get("torrent_info_hash");
            let ws: Option<i64> = row.get("web_seed_until_epoch");
            if let (Some(ch), Some(si), Some(ih), Some(ws)) = (ch, si, ih, ws) {
                if !ih.is_empty() {
                    let mut hint = serde_json::json!({
                        "content_hash": ch,
                        "swarm_id": si,
                        "torrent_info_hash": ih,
                        "web_seed_until": ws,
                    });
                    // 签发 join_ticket
                    if let Some(secret) = ticket_secret {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        let exp = now + ticket_ttl_seconds;
                        let claims = serde_json::json!({
                            "sub": "__room_broadcast__",
                            "aid": attachment_id,
                            "ih": ih,
                            "iat": now as usize,
                            "exp": exp as usize,
                        });
                        if let Ok(ticket) = jsonwebtoken::encode(
                            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
                            &claims,
                            &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
                        ) {
                            hint["join_ticket"] = serde_json::Value::String(ticket.clone());
                            hint["torrent_url"] = serde_json::Value::String(
                                format!("/api/media/{}/torrent?ticket={}", attachment_id, ticket),
                            );
                        }
                    }
                    hint["announce_urls"] = serde_json::json!([tracker_public_url]);
                    hint["web_seed_url"] = serde_json::Value::Null;
                    attachment_json["distribution_hint"] = hint;
                }
            }
        }
        let event_json = serde_json::json!({
            "type": "attachment_status_changed",
            "room_id": room_id,
            "message_id": message_id,
            "attachment_id": attachment_id,
            "status": contract_status,
            "attachment": attachment_json,
            "event_position": row.get::<i64, _>("latest_event_position"),
        });
        // 广播到房间：socketioxide 按 room_id 寻址
        if let Some(ns) = io.of("/") {
            if let Err(errs) = ns.to(room_id.clone()).emit("room_event", &[event_json.clone()]).await {
                tracing::warn!(
                    application = "附件状态升级",
                    attachment_id,
                    room_id = room_id.as_str(),
                    message_id = message_id.as_str(),
                    error = %errs,
                    "广播附件升级事件部分失败"
                );
            }
        }
    }
    tracing::info!(
        application = "附件状态升级",
        attachment_id,
        broadcast_count = rows.len(),
        "附件状态升级事件已广播"
    );
}
