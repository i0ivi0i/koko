use std::collections::HashMap;

use sqlx::{postgres::PgRow, PgPool, Row};

use crate::{contract, domain};

use super::Pg仓储;

// 消息事件适配 owner 统一持有：
// 1. 消息行到共享事件的翻译；
// 2. 消息页与附件引用批量组装；
// 3. 幂等回查与统一消息事务提交。
// 房间 owner 现在只借用这里的“消息页/增量事件组装 seam”，
// 下一轮如果还需要继续瘦身，就只在这一个 owner 上演进消息事实。

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
            附件标识, 宽, 高
        } => contract::附件快照::图片(contract::图片附件快照 {
            附件标识: 附件标识.clone(),
            宽: *宽,
            高: *高,
        }),
        domain::message::已校验附件引用::视频 {
            附件标识, 宽, 高
        } => contract::附件快照::视频(contract::视频附件快照 {
            附件标识: 附件标识.clone(),
            宽: *宽,
            高: *高,
        }),
    }
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

    let rows = sqlx::query(
        "SELECT mar.message_id, mar.sort_order, a.attachment_id, a.kind, a.width, a.height \
         FROM message_attachment_refs mar \
         JOIN attachments a ON a.id = mar.attachment_id \
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
        let attachment = match kind.as_str() {
            "image" => contract::附件快照::图片(contract::图片附件快照 {
                附件标识: row.get("attachment_id"),
                宽: row
                    .get::<Option<i32>, _>("width")
                    .ok_or(contract::错误码::系统错误)?,
                高: row
                    .get::<Option<i32>, _>("height")
                    .ok_or(contract::错误码::系统错误)?,
            }),
            "video" => contract::附件快照::视频(contract::视频附件快照 {
                附件标识: row.get("attachment_id"),
                宽: row
                    .get::<Option<i32>, _>("width")
                    .ok_or(contract::错误码::系统错误)?,
                高: row
                    .get::<Option<i32>, _>("height")
                    .ok_or(contract::错误码::系统错误)?,
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

/// 冷路径分页也属于消息 owner，因为它决定“哪些消息事件如何投影成共享事件”。
pub(super) async fn 查询消息页(
    pool: &PgPool,
    房间数据库标识: i64,
    房间标识: &str,
    截止位置之前: Option<i64>,
    limit: i64,
) -> Result<Vec<contract::领域事件>, contract::错误码> {
    let rows = if let Some(before) = 截止位置之前 {
        sqlx::query(
            "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, s.display_name AS display_alias, m.body \
             FROM room_events re \
             LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
             LEFT JOIN sessions s ON s.id = m.sender_session_id \
             WHERE re.room_id = $1 AND re.event_position < $2 \
             ORDER BY re.event_position DESC \
             LIMIT $3",
        )
        .bind(房间数据库标识)
        .bind(before)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?
    } else {
        sqlx::query(
            "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, s.display_name AS display_alias, m.body \
             FROM room_events re \
             LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
             LEFT JOIN sessions s ON s.id = m.sender_session_id \
             WHERE re.room_id = $1 \
             ORDER BY re.event_position DESC \
             LIMIT $2",
        )
        .bind(房间数据库标识)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?
    };

    let mut events = 组装消息事件列表_异步(pool, 房间标识, rows).await?;
    events.reverse();
    Ok(events)
}

/// 这条 helper 专门服务“围绕第一条未读恢复首屏”，
/// 避免房间 owner 再重新定义消息窗口语义。
pub(super) async fn 查询从位置开始的消息页(
    pool: &PgPool,
    房间数据库标识: i64,
    房间标识: &str,
    起始位置: i64,
    limit: i64,
) -> Result<Vec<contract::领域事件>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, s.display_name AS display_alias, m.body \
         FROM room_events re \
         LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
         LEFT JOIN sessions s ON s.id = m.sender_session_id \
         WHERE re.room_id = $1 AND re.event_position >= $2 \
         ORDER BY re.event_position ASC \
         LIMIT $3",
    )
    .bind(房间数据库标识)
    .bind(起始位置)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    组装消息事件列表_异步(pool, 房间标识, rows).await
}

async fn 查询发送者投影_异步(
    pool: &PgPool,
    会话标识: &str,
) -> Result<(i64, String), contract::错误码> {
    let row =
        sqlx::query("SELECT id, display_name AS display_alias FROM sessions WHERE session_id = $1")
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
        "SELECT m.event_position, m.message_id, m.client_message_id, s.session_id, s.display_name AS display_alias, m.body \
         FROM messages m \
         JOIN rooms r ON r.id = m.room_id \
         JOIN sessions s ON s.id = m.sender_session_id \
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

    Ok(contract::领域事件::消息已创建 {
        房间标识: 房间标识.to_string(),
        消息标识: message_id,
        客户端消息标识: 客户端消息标识.to_string(),
        发送者会话标识: 会话标识.to_string(),
        发送者花名: sender_display_alias,
        文本: 文本.to_string(),
        附件: 附件.iter().map(已校验附件转契约快照).collect(),
        事件位置: next_position,
    })
}

pub(super) fn 创建消息事件(
    repo: &mut Pg仓储,
    房间标识: &str,
    客户端消息标识: &str,
    会话标识: &str,
    文本: &str,
) -> Result<contract::领域事件, contract::错误码> {
    repo.在运行时执行(提交统一消息事件_异步(
        &repo.pool,
        房间标识,
        客户端消息标识,
        会话标识,
        文本,
        &[],
    ))
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
