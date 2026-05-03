use sqlx::{PgPool, Row};

use crate::{media::模型, shared::contract};

use super::Pg仓储;

/// 冷源清理是媒体 owner 的“尾处理”，只回答谁到了 TTL、谁已经删掉。
/// 真正删对象仍由外壳层控制，避免 adapter 突然拥有对象存储副作用。
async fn 列出待清理媒体冷源_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<模型::待清理媒体冷源>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT attachment_id, storage_key
         FROM attachments
         WHERE status = 'ready'
           AND storage_key IS NOT NULL
           AND origin_expires_at IS NOT NULL
           AND origin_expires_at <= TO_TIMESTAMP($1)
           AND origin_deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1
               FROM attachment_canonical_asset_refs refs
               WHERE refs.attachment_id = attachments.attachment_id
           )
         ORDER BY origin_expires_at ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| 模型::待清理媒体冷源 {
            附件标识: row.get("attachment_id"),
            原始内容存储键: row.get("storage_key"),
        })
        .collect())
}

pub(crate) fn 列出待清理媒体冷源(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<模型::待清理媒体冷源>, contract::错误码> {
    repo.在运行时执行(列出待清理媒体冷源_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记媒体冷源已删除_异步(
    pool: &PgPool,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let result = sqlx::query(
        "UPDATE attachments
         SET origin_deleted_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND origin_deleted_at IS NULL",
    )
    .bind(附件标识)
    .bind(删除时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        return Err(contract::错误码::附件不存在);
    }
    Ok(())
}

pub(crate) fn 标记媒体冷源已删除(
    repo: &mut Pg仓储,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记媒体冷源已删除_异步(
        &repo.pool,
        附件标识,
        删除时间戳秒,
    ))
}

async fn 列出待清理canonical媒体资产_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<模型::待清理Canonical媒体资产>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT content_hash, storage_key
         FROM canonical_media_assets
         WHERE origin_expires_at <= TO_TIMESTAMP($1)
           AND origin_deleted_at IS NULL
         ORDER BY origin_expires_at ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| 模型::待清理Canonical媒体资产 {
            content_hash: row.get("content_hash"),
            存储键: row.get("storage_key"),
        })
        .collect())
}

pub(crate) fn 列出待清理canonical媒体资产(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<模型::待清理Canonical媒体资产>, contract::错误码> {
    repo.在运行时执行(列出待清理canonical媒体资产_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记canonical媒体资产已删除_异步(
    pool: &PgPool,
    content_hash: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;
    let result = sqlx::query(
        "UPDATE canonical_media_assets
         SET origin_deleted_at = TO_TIMESTAMP($2),
             updated_at = NOW()
         WHERE content_hash = $1
           AND origin_deleted_at IS NULL",
    )
    .bind(content_hash)
    .bind(删除时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        tx.rollback()
            .await
            .map_err(|_| contract::错误码::系统错误)?;
        return Err(contract::错误码::附件不存在);
    }

    sqlx::query(
        "UPDATE attachments a
         SET origin_deleted_at = TO_TIMESTAMP($2)
         FROM attachment_canonical_asset_refs refs
         WHERE refs.attachment_id = a.attachment_id
           AND refs.content_hash = $1
           AND a.origin_deleted_at IS NULL",
    )
    .bind(content_hash)
    .bind(删除时间戳秒)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(crate) fn 标记canonical媒体资产已删除(
    repo: &mut Pg仓储,
    content_hash: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记canonical媒体资产已删除_异步(
        &repo.pool,
        content_hash,
        删除时间戳秒,
    ))
}

/// 视频 mezzanine 只是一层 24h 回退母本，因此清理查询必须单独挑 video + mezzanine_*。
async fn 列出待清理媒体回退母本_异步(
    pool: &PgPool,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<模型::待清理媒体回退母本>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT attachment_id, mezzanine_storage_key
         FROM attachments
         WHERE kind = 'video'
           AND status = 'ready'
           AND mezzanine_storage_key IS NOT NULL
           AND mezzanine_expires_at IS NOT NULL
           AND mezzanine_expires_at <= TO_TIMESTAMP($1)
           AND mezzanine_deleted_at IS NULL
         ORDER BY mezzanine_expires_at ASC
         LIMIT $2",
    )
    .bind(当前时间戳秒)
    .bind(限制条数)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(rows
        .into_iter()
        .map(|row| 模型::待清理媒体回退母本 {
            附件标识: row.get("attachment_id"),
            回退母本存储键: row.get("mezzanine_storage_key"),
        })
        .collect())
}

pub(crate) fn 列出待清理媒体回退母本(
    repo: &Pg仓储,
    当前时间戳秒: i64,
    限制条数: i64,
) -> Result<Vec<模型::待清理媒体回退母本>, contract::错误码> {
    repo.在运行时执行(列出待清理媒体回退母本_异步(
        &repo.pool,
        当前时间戳秒,
        限制条数,
    ))
}

async fn 标记媒体回退母本已删除_异步(
    pool: &PgPool,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    let result = sqlx::query(
        "UPDATE attachments
         SET mezzanine_deleted_at = TO_TIMESTAMP($2)
         WHERE attachment_id = $1
           AND mezzanine_deleted_at IS NULL",
    )
    .bind(附件标识)
    .bind(删除时间戳秒)
    .execute(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    if result.rows_affected() == 0 {
        return Err(contract::错误码::附件不存在);
    }
    Ok(())
}

pub(crate) fn 标记媒体回退母本已删除(
    repo: &mut Pg仓储,
    附件标识: &str,
    删除时间戳秒: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(标记媒体回退母本已删除_异步(
        &repo.pool,
        附件标识,
        删除时间戳秒,
    ))
}
