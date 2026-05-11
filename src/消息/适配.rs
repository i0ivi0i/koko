use std::collections::HashMap;

use sqlx::{postgres::PgRow, PgPool, Row};

use crate::{domain, message, shared::contract};

use super::{Pg媒体仓储, Pg仓储};

// 消息事件适配 owner 统一持有：
// 1. 消息行到共享事件的翻译；
// 2. 消息提交后的幂等回查；
// 3. 统一消息事务提交。
// 房间冷路径自己的分页、恢复、增量窗口已经回到房间适配 owner，
// 这里不再承担跨 owner 的读模型 seam。

/// 把数据库消息行翻成跨入口稳定共享的领域事件。
/// 这里不做业务校验，只负责把已经成立的事实完整表达出来。
fn 行转消息事件(
    row: PgRow,
    房间标识: &str,
    附件: Vec<contract::附件快照>,
) -> contract::领域事件 {
    let msg_id: Option<String> = row.get("message_id");
    let client_id: Option<String> = row.get("client_message_id");
    let sender_session_id: Option<String> = row.get("session_id");
    let sender_display_alias: Option<String> = row.get("display_alias");
    let body: Option<String> = row.get("body");
    contract::领域事件::消息已创建 {
        房间标识: 房间标识.to_string(),
        消息标识: msg_id.unwrap_or_default(),
        客户端消息标识: client_id.unwrap_or_default(),
        发送者会话标识: sender_session_id.unwrap_or_default(),
        发送者花名: sender_display_alias.unwrap_or_default(),
        文本: body.unwrap_or_default(),
        附件,
        事件位置: row.get("event_position"),
    }
}

/// 领域层已经校验通过的附件引用，在共享契约里只保留渲染所需的稳定事实。
fn 已校验附件转契约快照(
    附件: &domain::message::已校验附件引用,
) -> contract::附件快照 {
    match 附件 {
        domain::message::已校验附件引用::图片 {
            附件标识,
            宽,
            高,
            有预览图,
        } => contract::附件快照::图片(contract::图片附件快照 {
            附件标识: 附件标识.clone(),
            宽: *宽,
            高: *高,
            有预览图: *有预览图,
            分发线索: None,
        }),
        domain::message::已校验附件引用::视频 {
            附件标识,
            宽,
            高,
            有预览图,
        } => contract::附件快照::视频(contract::视频附件快照 {
            附件标识: 附件标识.clone(),
            宽: *宽,
            高: *高,
            有预览图: *有预览图,
            分发线索: None,
        }),
    }
}

/// 为 realtime 广播路径批量丰富分发线索。
/// 仅在 `提交统一消息事件_异步` 的 tx.commit 之后调用，不参与 domain 消息成立校验。
/// 查询失败时静默降级为空映射，不影响消息投递。
async fn 查询附件分发线索批量_异步(
    pool: &PgPool,
    附件标识列表: &[&str],
) -> Result<HashMap<String, contract::附件分发线索>, contract::错误码> {
    if 附件标识列表.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = sqlx::query(
        "SELECT attachment_id, content_hash, swarm_id, torrent_info_hash, \
                EXTRACT(EPOCH FROM web_seed_until)::BIGINT AS web_seed_until_epoch \
         FROM attachment_distribution_metadata \
         WHERE attachment_id = ANY($1)",
    )
    .bind(附件标识列表.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let mut map = HashMap::new();
    for row in rows {
        let attachment_id: String = row.get("attachment_id");
        let content_hash: Option<String> = row.get("content_hash");
        let swarm_id: Option<String> = row.get("swarm_id");
        let torrent_info_hash: Option<String> = row.get("torrent_info_hash");
        let web_seed_until: Option<i64> = row.get("web_seed_until_epoch");
        // 四个字段全部到齐且 info_hash 非空时才填充分发线索
        if let (Some(ch), Some(si), Some(ih), Some(ws)) =
            (content_hash, swarm_id, torrent_info_hash, web_seed_until)
        {
            if !ih.is_empty() {
                map.insert(
                    attachment_id,
                    contract::附件分发线索 {
                        content_hash: ch,
                        swarm_id: si,
                        torrent_info_hash: ih,
                        web_seed_until秒: ws,
                    },
                );
            }
        }
    }
    Ok(map)
}

/// 房间快照、历史页、增量页都会读消息附件引用。
/// 这里一次批量拉齐，避免三个入口各自长 N+1 查询。
async fn 查询消息附件映射_异步(
    pool: &PgPool,
    消息标识列表: &[String],
) -> Result<HashMap<String, Vec<contract::附件快照>>, contract::错误码> {
    if 消息标识列表.is_empty() {
        return Ok(HashMap::new());
    }

    // LEFT JOIN 分发元数据：幂等重试路径也携带 distribution_hint，
    // 与房间冷路径保持一致，让所有读路径的接收端都能预热 swarm。
    let rows = sqlx::query(
        "SELECT mar.message_id,
                mar.sort_order,
                a.attachment_id,
                a.kind,
                a.width,
                a.height,
                a.thumbnail_storage_key IS NOT NULL AS has_preview_asset,
                adm.content_hash  AS dist_content_hash,
                adm.swarm_id      AS dist_swarm_id,
                adm.torrent_info_hash AS dist_torrent_info_hash,
                EXTRACT(EPOCH FROM adm.web_seed_until)::BIGINT AS dist_web_seed_until_epoch \
         FROM message_attachment_refs mar \
         JOIN attachments a ON a.id = mar.attachment_id \
         LEFT JOIN attachment_distribution_metadata adm ON adm.attachment_id = a.attachment_id \
         WHERE mar.message_id = ANY($1) \
         ORDER BY mar.message_id ASC, mar.sort_order ASC",
    )
    .bind(消息标识列表.to_vec())
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let mut grouped = HashMap::<String, Vec<contract::附件快照>>::new();
    for row in rows {
        let message_id: String = row.get("message_id");
        let kind: String = row.get("kind");
        // 从 LEFT JOIN 结果提取分发线索：四字段全到齐且 info_hash 非空才有效
        let 分发线索 = {
            let ch: Option<String> = row.get("dist_content_hash");
            let si: Option<String> = row.get("dist_swarm_id");
            let ih: Option<String> = row.get("dist_torrent_info_hash");
            let ws: Option<i64> = row.get("dist_web_seed_until_epoch");
            match (ch, si, ih, ws) {
                (Some(ch), Some(si), Some(ih), Some(ws)) if !ih.is_empty() => {
                    Some(contract::附件分发线索 {
                        content_hash: ch,
                        swarm_id: si,
                        torrent_info_hash: ih,
                        web_seed_until秒: ws,
                    })
                }
                _ => None,
            }
        };
        let attachment = match kind.as_str() {
            "image" => contract::附件快照::图片(contract::图片附件快照 {
                附件标识: row.get("attachment_id"),
                宽: row
                    .get::<Option<i32>, _>("width")
                    .ok_or(contract::错误码::系统错误)?,
                高: row
                    .get::<Option<i32>, _>("height")
                    .ok_or(contract::错误码::系统错误)?,
                有预览图: false,
                分发线索,
            }),
            "video" => contract::附件快照::视频(contract::视频附件快照 {
                附件标识: row.get("attachment_id"),
                宽: row
                    .get::<Option<i32>, _>("width")
                    .ok_or(contract::错误码::系统错误)?,
                高: row
                    .get::<Option<i32>, _>("height")
                    .ok_or(contract::错误码::系统错误)?,
                有预览图: row.get("has_preview_asset"),
                分发线索,
            }),
            _ => return Err(contract::错误码::系统错误),
        };
        grouped.entry(message_id).or_default().push(attachment);
    }
    Ok(grouped)
}

/// 把消息行和批量附件映射装配成共享事件列表。
pub(super) async fn 组装消息事件列表_异步(
    pool: &PgPool,
    房间标识: &str,
    rows: Vec<PgRow>,
) -> Result<Vec<contract::领域事件>, contract::错误码> {
    let message_ids = rows
        .iter()
        .filter_map(|row| row.get::<Option<String>, _>("message_id"))
        .collect::<Vec<_>>();
    let mut attachment_map = 查询消息附件映射_异步(pool, &message_ids).await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let message_id = row
                .get::<Option<String>, _>("message_id")
                .unwrap_or_default();
            let attachments = attachment_map.remove(&message_id).unwrap_or_default();
            行转消息事件(row, 房间标识, attachments)
        })
        .collect())
}

async fn 查询发送者投影_异步(
    pool: &PgPool,
    会话标识: &str,
) -> Result<(i64, String), contract::错误码> {
    let row = sqlx::query(
        "SELECT s.id, ai.display_alias \
         FROM sessions s \
         JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
         WHERE s.session_id = $1",
    )
    .bind(会话标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?
    .ok_or(contract::错误码::会话无效)?;
    Ok((row.get("id"), row.get("display_alias")))
}

async fn 查询既有消息事件_异步(
    pool: &PgPool,
    房间标识: &str,
    会话标识: &str,
    客户端消息标识: &str,
) -> Result<Option<contract::领域事件>, contract::错误码> {
    let row = sqlx::query(
        "SELECT m.event_position, m.message_id, m.client_message_id, s.session_id, ai.display_alias, m.body \
         FROM messages m \
         JOIN rooms r ON r.id = m.room_id \
         JOIN sessions s ON s.id = m.sender_session_id \
         JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
         WHERE r.room_id = $1 AND s.session_id = $2 AND m.client_message_id = $3",
    )
    .bind(房间标识)
    .bind(会话标识)
    .bind(客户端消息标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let Some(row) = row else {
        return Ok(None);
    };
    let mut events = 组装消息事件列表_异步(pool, 房间标识, vec![row]).await?;
    Ok(events.pop())
}

/// 只把“同房间、同发送者、同 client_message_id”的唯一约束冲突视为幂等重试。
/// 其他唯一约束和数据库错误必须继续冒泡成系统错误，不能在这里假装成功。
fn 是消息幂等冲突(err: &sqlx::Error) -> bool {
    matches!(
        err,
        sqlx::Error::Database(db_err)
            if db_err.code().as_deref() == Some("23505")
                && db_err
                    .constraint()
                    .is_some_and(|name| name.contains("client_message_id"))
    )
}

/// 统一消息事务提交是消息 owner 的核心真相：
/// 1. 推进房间顺序锚点；
/// 2. 写入 room_events / messages；
/// 3. 写入附件引用并首次标记 committed_at；
/// 4. 遇到幂等重试时回到既有权威事件。
pub(super) async fn 提交统一消息事件_异步(
    pool: &PgPool,
    房间标识: &str,
    客户端消息标识: &str,
    会话标识: &str,
    文本: &str,
    附件: &[domain::message::已校验附件引用],
) -> Result<contract::领域事件, contract::错误码> {
    let (session_db_id, sender_display_alias) = 查询发送者投影_异步(pool, 会话标识).await?;

    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;

    let room_row = sqlx::query(
        "UPDATE rooms \
         SET latest_event_position = latest_event_position + 1 \
         WHERE room_id = $1 \
         RETURNING id, latest_event_position",
    )
    .bind(房间标识)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    let Some(room) = room_row else {
        return Err(contract::错误码::房间不存在);
    };
    let room_db_id: i64 = room.get("id");
    let next_position: i64 = room.get("latest_event_position");
    let message_id = format!("{房间标识}-{next_position}");

    sqlx::query(
        "INSERT INTO room_events (room_id, event_position, event_kind, actor_session_id, message_id) \
         VALUES ($1, $2, 'message_created', $3, $4)",
    )
    .bind(room_db_id)
    .bind(next_position)
    .bind(session_db_id)
    .bind(&message_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let insert_message = sqlx::query(
        "INSERT INTO messages (message_id, room_id, sender_session_id, client_message_id, event_position, body) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&message_id)
    .bind(room_db_id)
    .bind(session_db_id)
    .bind(客户端消息标识)
    .bind(next_position)
    .bind(文本)
    .execute(&mut *tx)
    .await;
    if let Err(err) = insert_message {
        if 是消息幂等冲突(&err) {
            tx.rollback()
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            return 查询既有消息事件_异步(pool, 房间标识, 会话标识, 客户端消息标识)
                .await?
                .ok_or(contract::错误码::系统错误);
        }
        return Err(contract::错误码::系统错误);
    }

    for (sort_order, attachment) in 附件.iter().enumerate() {
        let attachment_id = match attachment {
            domain::message::已校验附件引用::图片 { 附件标识, .. } => 附件标识,
            domain::message::已校验附件引用::视频 { 附件标识, .. } => 附件标识,
        };
        let inserted_ref = sqlx::query(
            "INSERT INTO message_attachment_refs (message_id, attachment_id, sort_order, display_role) \
             SELECT $1, a.id, $2, 'inline' \
             FROM attachments a \
             WHERE a.attachment_id = $3",
        )
        .bind(&message_id)
        .bind(sort_order as i32)
        .bind(attachment_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
        if inserted_ref.rows_affected() != 1 {
            return Err(contract::错误码::附件不存在);
        }

        sqlx::query(
            "UPDATE attachments \
             SET committed_at = COALESCE(committed_at, NOW()) \
             WHERE attachment_id = $1",
        )
        .bind(attachment_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    }

    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;

    // realtime 广播路径丰富分发线索：tx 已提交，此处失败仅降级为无线索，不影响消息投递。
    let 附件标识列表: Vec<&str> = 附件
        .iter()
        .map(|a| match a {
            domain::message::已校验附件引用::图片 { 附件标识, .. }
            | domain::message::已校验附件引用::视频 { 附件标识, .. } => 附件标识.as_str(),
        })
        .collect();
    let 分发线索映射 = 查询附件分发线索批量_异步(pool, &附件标识列表)
        .await
        .unwrap_or_default();

    Ok(contract::领域事件::消息已创建 {
        房间标识: 房间标识.to_string(),
        消息标识: message_id,
        客户端消息标识: 客户端消息标识.to_string(),
        发送者会话标识: 会话标识.to_string(),
        发送者花名: sender_display_alias,
        文本: 文本.to_string(),
        附件: 附件
            .iter()
            .map(|a| {
                let mut snapshot = 已校验附件转契约快照(a);
                let aid = match a {
                    domain::message::已校验附件引用::图片 { 附件标识, .. }
                    | domain::message::已校验附件引用::视频 { 附件标识, .. } => 附件标识.as_str(),
                };
                if let Some(hint) = 分发线索映射.get(aid) {
                    match &mut snapshot {
                        contract::附件快照::图片(img) => img.分发线索 = Some(hint.clone()),
                        contract::附件快照::视频(vid) => vid.分发线索 = Some(hint.clone()),
                    }
                }
                snapshot
            })
            .collect(),
        事件位置: next_position,
    })
}

pub(super) fn 创建统一消息事件(
    repo: &mut Pg仓储,
    房间标识: &str,
    客户端消息标识: &str,
    会话标识: &str,
    文本: &str,
    附件: &[domain::message::已校验附件引用],
) -> Result<contract::领域事件, contract::错误码> {
    repo.在运行时执行(提交统一消息事件_异步(
        &repo.pool,
        房间标识,
        客户端消息标识,
        会话标识,
        文本,
        附件,
    ))
}

/// 消息 owner 统一托管同步消息端口。
/// 共享基座只保留连接池和运行时，消息成立真相对应的落库入口收回消息上下文文件。
impl message::application::消息仓储端口 for Pg仓储 {
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<crate::media::模型::附件读取结果>, contract::错误码> {
        super::媒体附件适配::查询附件快照(self, 附件标识)
    }

    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        创建统一消息事件(self, 房间标识, 客户端消息标识, 会话标识, 文本, 附件)
    }
}

/// 媒体子域复用消息主链时，只借稳定的消息端口，不再在 `src/适配/mod.rs` 转发。
impl message::application::消息仓储端口 for Pg媒体仓储 {
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<crate::media::模型::附件读取结果>, contract::错误码> {
        super::媒体附件适配::查询附件快照(&self.repo, 附件标识)
    }

    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        创建统一消息事件(
            &mut self.repo,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        )
    }
}
