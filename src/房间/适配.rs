use std::collections::HashMap;

use sqlx::{postgres::PgRow, PgPool, Row};

use crate::shared::contract;

use super::Pg仓储;

// 房间阅读适配 owner 统一收口：
// 1. 会话/房间/成员资格这类只读事实查询；
// 2. 房间恢复快照、历史页、增量页、阅读锚点推进；
// 3. 后台房间冷读接口。
// 这层只做 PostgreSQL 事实翻译，不替用例层做成员裁决，也不自己定义消息语义。
// 额外约束：
// 1. 房间首屏、历史页、增量页都属于房间 owner 的冷路径读模型；
// 2. 因此这里必须自有消息窗口查询和事件投影，不能跨到消息适配借道；
// 3. 消息 owner 继续只负责“消息如何成立与提交”，房间 owner 负责“房间如何读取这些已成立事件”。

pub(super) async fn 查询会话所属匿名身份_异步(
    pool: &PgPool,
    会话标识: &str,
) -> Result<Option<String>, contract::错误码> {
    // 这条查询同时被媒体 owner 用来判定 prepared 附件 preview 可见性，
    // 因此暂时继续复用 `Pg仓储` 的共享基座，避免现在就制造第二份会话解析 SQL。
    Pg仓储::查询会话所属匿名身份_异步(pool, 会话标识).await
}

pub(super) fn 查询会话所属匿名身份(
    repo: &Pg仓储,
    会话标识: &str,
) -> Result<Option<String>, contract::错误码> {
    repo.在运行时执行(查询会话所属匿名身份_异步(&repo.pool, 会话标识))
}

pub(super) async fn 检查会话存在_异步(
    pool: &PgPool,
    会话标识: &str,
) -> Result<bool, contract::错误码> {
    let exists =
        sqlx::query_scalar::<_, i32>("SELECT 1 FROM sessions WHERE session_id = $1 LIMIT 1")
            .bind(会话标识)
            .fetch_optional(pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
    Ok(exists.is_some())
}

pub(super) fn 检查会话存在(
    repo: &Pg仓储,
    会话标识: &str,
) -> Result<bool, contract::错误码> {
    repo.在运行时执行(检查会话存在_异步(&repo.pool, 会话标识))
}

pub(super) async fn 检查房间存在_异步(
    pool: &PgPool,
    房间标识: &str,
) -> Result<bool, contract::错误码> {
    let exists = sqlx::query_scalar::<_, i32>("SELECT 1 FROM rooms WHERE room_id = $1 LIMIT 1")
        .bind(房间标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    Ok(exists.is_some())
}

pub(super) fn 检查房间存在(
    repo: &Pg仓储,
    房间标识: &str,
) -> Result<bool, contract::错误码> {
    repo.在运行时执行(检查房间存在_异步(&repo.pool, 房间标识))
}

pub(super) async fn 检查成员资格_异步(
    pool: &PgPool,
    房间标识: &str,
    会话标识: &str,
) -> Result<bool, contract::错误码> {
    let exists = sqlx::query_scalar::<_, i32>(
        "SELECT 1 \
         FROM room_members rm \
         JOIN rooms r ON r.id = rm.room_id \
         JOIN sessions s ON s.id = rm.session_id \
         WHERE r.room_id = $1 AND s.session_id = $2 AND rm.left_at IS NULL \
         LIMIT 1",
    )
    .bind(房间标识)
    .bind(会话标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;
    Ok(exists.is_some())
}

pub(super) fn 检查成员资格(
    repo: &Pg仓储,
    房间标识: &str,
    会话标识: &str,
) -> Result<bool, contract::错误码> {
    repo.在运行时执行(检查成员资格_异步(&repo.pool, 房间标识, 会话标识))
}

async fn 查询房间最新事件位置_异步(
    pool: &PgPool,
    房间标识: &str,
) -> Result<Option<i64>, contract::错误码> {
    sqlx::query_scalar("SELECT latest_event_position FROM rooms WHERE room_id = $1")
        .bind(房间标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)
}

pub(super) fn 查询房间最新事件位置(
    repo: &Pg仓储,
    房间标识: &str,
) -> Result<Option<i64>, contract::错误码> {
    repo.在运行时执行(查询房间最新事件位置_异步(&repo.pool, 房间标识))
}

/// 把数据库房间事件行翻成房间快照、历史页、增量页统一消费的共享事件。
/// 这里故意留在房间适配层，因为“房间冷读窗口如何看到消息”属于房间 owner，
/// 不是消息写入 owner 的职责。
fn 房间事件行转消息事件(
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

/// 房间快照、历史页、增量页都要把附件引用一并读全。
/// 这里按消息批量聚合，避免三个冷路径入口各自长出 N+1 查询。
async fn 查询房间消息附件映射_异步(
    pool: &PgPool,
    消息标识列表: &[String],
) -> Result<HashMap<String, Vec<contract::附件快照>>, contract::错误码> {
    if 消息标识列表.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query(
        "SELECT mar.message_id,
                mar.sort_order,
                a.attachment_id,
                a.kind,
                a.width,
                a.height,
                a.thumbnail_storage_key IS NOT NULL AS has_preview_asset \
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
                有预览图: false,
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
            }),
            _ => return Err(contract::错误码::系统错误),
        };
        grouped.entry(message_id).or_default().push(attachment);
    }
    Ok(grouped)
}

/// 把冷路径查询回来的事件行组装成房间 owner 直接消费的共享事件列表。
async fn 组装房间消息事件列表_异步(
    pool: &PgPool,
    房间标识: &str,
    rows: Vec<PgRow>,
) -> Result<Vec<contract::领域事件>, contract::错误码> {
    let message_ids = rows
        .iter()
        .filter_map(|row| row.get::<Option<String>, _>("message_id"))
        .collect::<Vec<_>>();
    let mut attachment_map = 查询房间消息附件映射_异步(pool, &message_ids).await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let message_id = row
                .get::<Option<String>, _>("message_id")
                .unwrap_or_default();
            let attachments = attachment_map.remove(&message_id).unwrap_or_default();
            房间事件行转消息事件(row, 房间标识, attachments)
        })
        .collect())
}

/// 读取“某个顺序锚点之前”的房间消息窗口。
/// 房间快照和历史分页都直接依赖这条稳定冷路径，不再跨到消息适配借道。
async fn 查询房间消息页_异步(
    pool: &PgPool,
    房间数据库标识: i64,
    房间标识: &str,
    截止位置之前: Option<i64>,
    limit: i64,
) -> Result<Vec<contract::领域事件>, contract::错误码> {
    let rows = if let Some(before) = 截止位置之前 {
        sqlx::query(
            "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, ai.display_alias, m.body \
             FROM room_events re \
             LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
             LEFT JOIN sessions s ON s.id = m.sender_session_id \
             LEFT JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
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
            "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, ai.display_alias, m.body \
             FROM room_events re \
             LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
             LEFT JOIN sessions s ON s.id = m.sender_session_id \
             LEFT JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
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

    let mut events = 组装房间消息事件列表_异步(pool, 房间标识, rows).await?;
    events.reverse();
    Ok(events)
}

/// 围绕第一条未读消息读取首屏窗口。
/// 这条规则属于房间恢复语义，所以也必须留在房间适配层。
async fn 查询从位置开始的房间消息页_异步(
    pool: &PgPool,
    房间数据库标识: i64,
    房间标识: &str,
    起始位置: i64,
    limit: i64,
) -> Result<Vec<contract::领域事件>, contract::错误码> {
    let rows = sqlx::query(
        "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, ai.display_alias, m.body \
         FROM room_events re \
         LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
         LEFT JOIN sessions s ON s.id = m.sender_session_id \
         LEFT JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
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

    组装房间消息事件列表_异步(pool, 房间标识, rows).await
}

/// 房间恢复快照是房间 owner 的职责。
/// 这里直接用房间自有消息窗口查询来拼首屏，避免再从消息适配借道。
async fn 构建房间恢复快照(
    pool: &PgPool,
    房间数据库标识: i64,
    房间标识: &str,
    最新事件位置: i64,
    上次已读事件位置: Option<i64>,
    首条未读事件位置: Option<i64>,
) -> Result<contract::快照, contract::错误码> {
    let (snapshot_messages, has_more_before) = if let Some(first_unread_event_position) =
        首条未读事件位置
    {
        let before_messages = 查询房间消息页_异步(
            pool,
            房间数据库标识,
            房间标识,
            Some(first_unread_event_position),
            8,
        )
        .await?;
        let unread_messages = 查询从位置开始的房间消息页_异步(
            pool,
            房间数据库标识,
            房间标识,
            first_unread_event_position,
            47,
        )
        .await?;
        let has_more_before = before_messages
            .first()
            .map(|message| {
                matches!(
                    message,
                    contract::领域事件::消息已创建 { 事件位置, .. } if *事件位置 > 1
                )
            })
            .unwrap_or(false);
        ([before_messages, unread_messages].concat(), has_more_before)
    } else {
        let snapshot_messages =
            查询房间消息页_异步(pool, 房间数据库标识, 房间标识, None, 55).await?;
        let has_more_before = snapshot_messages
            .first()
            .map(|message| {
                matches!(
                    message,
                    contract::领域事件::消息已创建 { 事件位置, .. } if *事件位置 > 1
                )
            })
            .unwrap_or(false);
        (snapshot_messages, has_more_before)
    };

    Ok(contract::快照::房间 {
        房间标识: 房间标识.to_string(),
        最新事件位置,
        上次已读事件位置,
        首条未读事件位置,
        首屏消息: snapshot_messages,
        首屏前仍有更早历史: has_more_before,
    })
}

pub(super) async fn 查询房间阅读位置_异步(
    pool: &PgPool,
    房间标识: &str,
    会话标识: &str,
) -> Result<Option<i64>, contract::错误码> {
    let fetched = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT rra.last_read_event_position \
         FROM sessions s \
         JOIN rooms r ON r.room_id = $1 \
         LEFT JOIN room_read_anchors rra \
           ON rra.anonymous_identity_id = s.anonymous_identity_id AND rra.room_id = r.id \
         WHERE s.session_id = $2",
    )
    .bind(房间标识)
    .bind(会话标识)
    .fetch_optional(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    Ok(fetched.flatten())
}

pub(super) fn 查询房间阅读位置(
    repo: &Pg仓储,
    房间标识: &str,
    会话标识: &str,
) -> Result<Option<i64>, contract::错误码> {
    repo.在运行时执行(查询房间阅读位置_异步(
        &repo.pool,
        房间标识,
        会话标识,
    ))
}

async fn 按短码进房或建房_异步(
    pool: &PgPool,
    会话标识: &str,
    房间短码: &str,
) -> Result<contract::快照, contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;

    let session_db_id: i64 = sqlx::query_scalar("SELECT id FROM sessions WHERE session_id = $1")
        .bind(会话标识)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| contract::错误码::系统错误)?
        .ok_or(contract::错误码::会话无效)?;

    let room_row =
        sqlx::query("SELECT id, room_id, latest_event_position FROM rooms WHERE room_code = $1")
            .bind(房间短码)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

    let (room_db_id, room_id, latest_event_position): (i64, String, i64) =
        if let Some(row) = room_row {
            (
                row.get("id"),
                row.get("room_id"),
                row.get("latest_event_position"),
            )
        } else {
            let created = sqlx::query(
                "INSERT INTO rooms (room_id, room_code, title, created_by_session_id) \
             VALUES (concat('r-', substring(md5(random()::text) from 1 for 12)), $1, $2, $3) \
             RETURNING id, room_id, latest_event_position",
            )
            .bind(房间短码)
            .bind(format!("房间-{房间短码}"))
            .bind(session_db_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            (
                created.get("id"),
                created.get("room_id"),
                created.get("latest_event_position"),
            )
        };

    sqlx::query(
        "INSERT INTO room_members (room_id, session_id, left_at) \
         VALUES ($1, $2, NULL) \
         ON CONFLICT (room_id, session_id) WHERE left_at IS NULL DO NOTHING",
    )
    .bind(room_db_id)
    .bind(session_db_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;

    let last_read_event_position = 查询房间阅读位置_异步(pool, &room_id, 会话标识).await?;
    let first_unread_event_position = match last_read_event_position {
        Some(last_read_event_position) if last_read_event_position < latest_event_position => {
            Some(last_read_event_position + 1)
        }
        _ => None,
    };
    构建房间恢复快照(
        pool,
        room_db_id,
        &room_id,
        latest_event_position,
        last_read_event_position,
        first_unread_event_position,
    )
    .await
}

pub(super) fn 按短码进房或建房(
    repo: &mut Pg仓储,
    会话标识: &str,
    房间短码: &str,
) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(按短码进房或建房_异步(
        &repo.pool,
        会话标识,
        房间短码,
    ))
}

async fn 拉取房间快照_异步(
    pool: &PgPool,
    房间标识: &str,
    上次已读事件位置: Option<i64>,
    首条未读事件位置: Option<i64>,
) -> Result<contract::快照, contract::错误码> {
    let room =
        sqlx::query("SELECT id, room_id, latest_event_position FROM rooms WHERE room_id = $1")
            .bind(房间标识)
            .fetch_optional(pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
    let Some(row) = room else {
        return Err(contract::错误码::房间不存在);
    };
    let room_db_id: i64 = row.get("id");
    let latest_event_position: i64 = row.get("latest_event_position");
    构建房间恢复快照(
        pool,
        room_db_id,
        房间标识,
        latest_event_position,
        上次已读事件位置,
        首条未读事件位置,
    )
    .await
}

pub(super) fn 拉取房间快照(
    repo: &Pg仓储,
    房间标识: &str,
    上次已读事件位置: Option<i64>,
    首条未读事件位置: Option<i64>,
) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(拉取房间快照_异步(
        &repo.pool,
        房间标识,
        上次已读事件位置,
        首条未读事件位置,
    ))
}

async fn 拉取房间历史页_异步(
    pool: &PgPool,
    房间标识: &str,
    截止位置之前: i64,
    限制条数: i64,
) -> Result<contract::快照, contract::错误码> {
    if 截止位置之前 <= 0 || 限制条数 <= 0 {
        return Err(contract::错误码::参数非法);
    }
    let room = sqlx::query("SELECT id FROM rooms WHERE room_id = $1")
        .bind(房间标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    let Some(row) = room else {
        return Err(contract::错误码::房间不存在);
    };
    let room_db_id: i64 = row.get("id");
    let messages = 查询房间消息页_异步(
        pool,
        room_db_id,
        房间标识,
        Some(截止位置之前),
        限制条数,
    )
    .await?;
    Ok(contract::快照::房间历史页 {
        房间标识: 房间标识.to_string(),
        消息: messages,
    })
}

pub(super) fn 拉取房间历史页(
    repo: &Pg仓储,
    房间标识: &str,
    截止位置之前: i64,
    限制条数: i64,
) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(拉取房间历史页_异步(
        &repo.pool,
        房间标识,
        截止位置之前,
        限制条数,
    ))
}

/// 增量页属于房间 owner，因为它表达的是“某房间从哪个位置开始补洞”。
/// 事件如何从数据库行翻成共享事件，也必须留在房间 owner 的冷路径里。
pub(super) async fn 拉取房间增量事件_异步(
    pool: &PgPool,
    房间标识: &str,
    从位置开始: i64,
) -> Result<contract::快照, contract::错误码> {
    if 从位置开始 < 0 {
        return Err(contract::错误码::参数非法);
    }
    let room = sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
        .bind(房间标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    let Some(room_row) = room else {
        return Err(contract::错误码::房间不存在);
    };
    let room_db_id: i64 = room_row.get("id");
    let latest_event_position: i64 = room_row.get("latest_event_position");

    let rows = sqlx::query(
        "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, ai.display_alias, m.body \
         FROM room_events re \
         LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
         LEFT JOIN sessions s ON s.id = m.sender_session_id \
         LEFT JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
         WHERE re.room_id = $1 AND re.event_position > $2 \
         ORDER BY re.event_position ASC",
    )
    .bind(room_db_id)
    .bind(从位置开始)
    .fetch_all(pool)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    let events = 组装房间消息事件列表_异步(pool, 房间标识, rows).await?;

    Ok(contract::快照::房间增量事件 {
        房间标识: 房间标识.to_string(),
        事件: events,
        最新事件位置: latest_event_position,
    })
}

pub(super) fn 拉取房间增量事件(
    repo: &Pg仓储,
    房间标识: &str,
    从位置开始: i64,
) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(拉取房间增量事件_异步(
        &repo.pool,
        房间标识,
        从位置开始,
    ))
}

async fn 推进房间阅读位置_异步(
    pool: &PgPool,
    房间标识: &str,
    会话标识: &str,
    已读到事件位置: i64,
) -> Result<(), contract::错误码> {
    let mut tx = pool.begin().await.map_err(|_| contract::错误码::系统错误)?;

    let identity_row = sqlx::query(
        "SELECT anonymous_identity_id \
         FROM sessions \
         WHERE session_id = $1",
    )
    .bind(会话标识)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?
    .ok_or(contract::错误码::会话无效)?;
    let anonymous_identity_db_id: Option<i64> = identity_row.get("anonymous_identity_id");
    let Some(anonymous_identity_db_id) = anonymous_identity_db_id else {
        return Err(contract::错误码::系统错误);
    };

    let room_db_id: i64 = sqlx::query_scalar("SELECT id FROM rooms WHERE room_id = $1")
        .bind(房间标识)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| contract::错误码::系统错误)?
        .ok_or(contract::错误码::房间不存在)?;

    sqlx::query(
        "INSERT INTO room_read_anchors (anonymous_identity_id, room_id, last_read_event_position) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (anonymous_identity_id, room_id) DO UPDATE \
         SET last_read_event_position = EXCLUDED.last_read_event_position, \
             updated_at = NOW() \
         WHERE EXCLUDED.last_read_event_position > room_read_anchors.last_read_event_position",
    )
    .bind(anonymous_identity_db_id)
    .bind(room_db_id)
    .bind(已读到事件位置)
    .execute(&mut *tx)
    .await
    .map_err(|_| contract::错误码::系统错误)?;

    tx.commit().await.map_err(|_| contract::错误码::系统错误)?;
    Ok(())
}

pub(super) fn 推进房间阅读位置(
    repo: &mut Pg仓储,
    房间标识: &str,
    会话标识: &str,
    已读到事件位置: i64,
) -> Result<(), contract::错误码> {
    repo.在运行时执行(推进房间阅读位置_异步(
        &repo.pool,
        房间标识,
        会话标识,
        已读到事件位置,
    ))
}

async fn 后台概览_异步(pool: &PgPool) -> Result<contract::快照, contract::错误码> {
    let room_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    Ok(contract::快照::后台概览 {
        房间总数: room_count as u64,
        消息总数: msg_count as u64,
    })
}

pub(super) fn 后台概览(repo: &Pg仓储) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(后台概览_异步(&repo.pool))
}

async fn 后台房间列表_异步(pool: &PgPool) -> Result<contract::快照, contract::错误码> {
    let rows = sqlx::query("SELECT room_id FROM rooms ORDER BY created_at DESC LIMIT 100")
        .fetch_all(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    let room_ids = rows
        .into_iter()
        .map(|r| r.get::<String, _>("room_id"))
        .collect::<Vec<_>>();
    Ok(contract::快照::后台房间列表 {
        房间标识列表: room_ids,
    })
}

pub(super) fn 后台房间列表(repo: &Pg仓储) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(后台房间列表_异步(&repo.pool))
}

async fn 后台房间详情_异步(
    pool: &PgPool,
    房间标识: &str,
) -> Result<contract::快照, contract::错误码> {
    let room = sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
        .bind(房间标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    let Some(room_row) = room else {
        return Err(contract::错误码::房间不存在);
    };
    let room_db_id: i64 = room_row.get("id");
    let latest: i64 = room_row.get("latest_event_position");
    let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE room_id = $1")
        .bind(room_db_id)
        .fetch_one(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;
    Ok(contract::快照::后台房间详情 {
        房间标识: 房间标识.to_string(),
        最新事件位置: latest,
        消息总数: msg_count as u64,
    })
}

pub(super) fn 后台房间详情(
    repo: &Pg仓储,
    房间标识: &str,
) -> Result<contract::快照, contract::错误码> {
    repo.在运行时执行(后台房间详情_异步(&repo.pool, 房间标识))
}
