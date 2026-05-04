use sqlx::Row;

use crate::{identity, shared::contract};

use super::{Pg媒体仓储, Pg仓储};

async fn 查询引导结果_异步(
    pool: &sqlx::PgPool,
    设备匿名凭证: &str,
) -> Result<Option<contract::匿名身份引导结果>, contract::错误码> {
    let existing = sqlx::query(
        "SELECT ai.display_alias, s.session_id \
         FROM sessions s \
         JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
         WHERE s.device_anonymous_token = $1",
    )
    .bind(设备匿名凭证)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let Some(row) = existing else {
        return Ok(None);
    };

    Ok(Some(contract::匿名身份引导结果 {
        展示花名: row.get("display_alias"),
        会话标识: row.get("session_id"),
    }))
}

/// 设备匿名凭证唯一约束只表达“同一设备 bootstrap 幂等重试”。
/// 这里必须把数据库冲突准确翻译回身份应用层，而不是在适配层自作主张补真相。
fn 是设备匿名凭证幂等冲突(err: &sqlx::Error) -> bool {
    matches!(
        err,
        sqlx::Error::Database(db_err)
            if db_err.code().as_deref() == Some("23505")
                && db_err
                    .constraint()
                    .is_some_and(|name| name.contains("device_anonymous_token"))
    )
}

impl identity::application::会话身份读取端口 for Pg仓储 {
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        super::房间阅读适配::查询会话所属匿名身份(self, 会话标识)
    }
}

impl identity::application::身份引导仓储端口 for Pg仓储 {
    fn 查询既有匿名身份引导结果(
        &self,
        设备匿名凭证: &str,
    ) -> Result<Option<contract::匿名身份引导结果>, contract::错误码> {
        self.在运行时执行(查询引导结果_异步(&self.pool, 设备匿名凭证))
    }

    /// 身份 bootstrap 的业务裁决已经回到身份上下文。
    /// 这里剩下的职责只有：
    /// 1. 落库 application 已经决定好的匿名身份草案；
    /// 2. 把唯一约束冲突翻译成明确的幂等信号交回应用层。
    fn 写入匿名身份引导草案(
        &mut self,
        设备匿名凭证: &str,
        草案: &identity::application::匿名身份引导草案,
    ) -> Result<identity::application::匿名身份引导写入结果, contract::错误码> {
        self.在运行时执行(async {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let identity_row = sqlx::query(
                "INSERT INTO anonymous_identities (anonymous_identity_id, identity_uuid, theme_key, display_alias) \
                 VALUES ($1, $2::uuid, $3, $4) \
                 RETURNING id",
            )
            .bind(&草案.匿名身份标识)
            .bind(草案.内部身份标识.to_string())
            .bind(&草案.主题键)
            .bind(&草案.展示花名)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            let identity_db_id: i64 = identity_row.get("id");

            let session_insert = sqlx::query(
                "INSERT INTO sessions (session_id, display_name, anonymous_identity_id, device_anonymous_token) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(&草案.会话标识)
            .bind(&草案.展示花名)
            .bind(identity_db_id)
            .bind(设备匿名凭证)
            .execute(&mut *tx)
            .await;
            if let Err(err) = session_insert {
                if 是设备匿名凭证幂等冲突(&err) {
                    tx.rollback()
                        .await
                        .map_err(|_| contract::错误码::系统错误)?;
                    return Ok(identity::application::匿名身份引导写入结果::设备匿名凭证已存在);
                }
                return Err(contract::错误码::系统错误);
            }

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            Ok(identity::application::匿名身份引导写入结果::已写入(
                草案.导出引导结果(),
            ))
        })
    }
}

/// 媒体子域只借身份 owner 的最小只读事实。
impl identity::application::会话身份读取端口 for Pg媒体仓储 {
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        super::房间阅读适配::查询会话所属匿名身份(&self.repo, 会话标识)
    }
}
