use super::{
    tus_hook外壳, 删除对象前缀下所有文件, 应用状态, 推导对象父前缀, 构建共享仓储
};
use object_store::{path::Path as ObjectPath, Error as ObjectStoreError, ObjectStoreExt};
use std::{
    collections::HashMap,
    io,
    time::{SystemTime, UNIX_EPOCH},
};

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
        let media_repo = repo.媒体仓储();
        crate::media::application::列出待清理媒体冷源(&media_repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理媒体冷源失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("冷源清理查询任务失败: {err}")))??;

    for 冷源 in 待清理冷源 {
        let object_path = ObjectPath::from(冷源.原始内容存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(ObjectStoreError::NotFound { .. }) => {}
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
            let repo = 构建共享仓储(&state_for_mark);
            let mut media_repo = repo.媒体仓储();
            crate::media::application::标记媒体冷源已删除(
                &mut media_repo,
                &attachment_id,
                当前时间戳秒,
            )
            .map_err(|err| io::Error::other(format!("标记媒体冷源已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("冷源清理写回任务失败: {err}")))??;
    }

    let state_for_query = state.clone();
    let 待清理canonical资产 = tokio::task::spawn_blocking(move || {
        let repo = 构建共享仓储(&state_for_query);
        let media_repo = repo.媒体仓储();
        crate::media::application::列出待清理canonical媒体资产(
            &media_repo,
            当前时间戳秒,
            128,
        )
        .map_err(|err| io::Error::other(format!("查询待清理 canonical 媒体资产失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("canonical 媒体资产清理查询任务失败: {err}")))??;

    for 资产 in 待清理canonical资产 {
        let object_path = ObjectPath::from(资产.存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(ObjectStoreError::NotFound { .. }) => {}
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
            let repo = 构建共享仓储(&state_for_mark);
            let mut media_repo = repo.媒体仓储();
            crate::media::application::标记canonical媒体资产已删除(
                &mut media_repo,
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
        let media_repo = repo.媒体仓储();
        crate::media::application::列出待清理媒体回退母本(&media_repo, 当前时间戳秒, 128)
            .map_err(|err| io::Error::other(format!("查询待清理媒体回退母本失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("回退母本清理查询任务失败: {err}")))??;

    for 回退母本 in 待清理回退母本 {
        let object_path = ObjectPath::from(回退母本.回退母本存储键.as_str());
        match state.attachment_store.delete(&object_path).await {
            Ok(_) | Err(ObjectStoreError::NotFound { .. }) => {}
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
            let repo = 构建共享仓储(&state_for_mark);
            let mut media_repo = repo.媒体仓储();
            crate::media::application::标记媒体回退母本已删除(
                &mut media_repo,
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
        let media_repo = repo.媒体仓储();
        crate::media::application::列出待清理流媒体清单(&media_repo, 当前时间戳秒, 128)
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
            let repo = 构建共享仓储(&state_for_mark);
            let mut media_repo = repo.媒体仓储();
            crate::media::application::标记流媒体清单已删除(
                &mut media_repo,
                &attachment_id,
                当前时间戳秒,
            )
            .map_err(|err| io::Error::other(format!("标记流媒体清单已删除失败: {err:?}")))
        })
        .await
        .map_err(|err| io::Error::other(format!("流媒体清理写回任务失败: {err}")))??;
    }

    Ok(())
}

fn 上传残留清理原因标签(
    原因: crate::media::模型::上传残留清理原因
) -> &'static str {
    match 原因 {
        crate::media::模型::上传残留清理原因::已放弃会话 => "abandoned_session",
        crate::media::模型::上传残留清理原因::最终合并后的分片残留 => {
            "finalized_partial"
        }
        crate::media::模型::上传残留清理原因::已过期未完成上传 => {
            "expired_unfinished"
        }
    }
}

pub(super) async fn 执行一次媒体上传残留清理_按会话(
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
        let media_repo = repo.媒体仓储();
        crate::media::application::列出待清理上传残留(&media_repo, 当前时间戳秒, 256)
            .map_err(|err| io::Error::other(format!("查询待清理上传残留失败: {err:?}")))
    })
    .await
    .map_err(|err| io::Error::other(format!("上传残留清理查询任务失败: {err}")))??;

    let mut 分组结果: HashMap<
        (String, crate::media::模型::上传残留清理原因),
        Vec<crate::media::模型::待清理上传残留>,
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
                        outcome = "skipped_external_locator",
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
            let repo = 构建共享仓储(&state_for_mark);
            let mut media_repo = repo.媒体仓储();
            crate::media::application::标记上传残留已清理(
                &mut media_repo,
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
