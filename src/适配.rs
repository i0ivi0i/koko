use std::{collections::HashMap, future::Future, io};

use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use uuid::Uuid;

use crate::{
    contract, domain,
    usecase::{self, 仓储端口},
};

/// PostgreSQL 适配层只做持久化翻译与事务提交，不承载业务规则。
///
/// 维护者边界提醒：
/// 1. 这里可以做 SQL、事务、索引命中相关优化。
/// 2. 这里不可以改“谁能发/谁是成员/消息是否成立”等业务真相。
/// 3. 业务真相必须在领域+用例决定，适配层只负责把结果准确落库/读库。
pub struct Pg仓储 {
    handle: tokio::runtime::Handle,
    owned_runtime: Option<tokio::runtime::Runtime>,
    pool: PgPool,
}

/// 运输授权写入请求只描述 Tus sidecar 所需的最小事实：
/// - 业务锚点仍然是 attachment_id；
/// - upload_token 只是一段短期运输凭证，不升级成领域主键；
/// - 有效期继续用秒数表达，避免把时间库类型扩散到壳层。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 媒体上传运输授权写入请求 {
    pub 附件标识: String,
    pub 运输方式: String,
    pub 上传令牌: String,
    pub 令牌有效期秒数: i64,
    pub 字节大小: i64,
}

/// 运输记录读取结果服务于 shell 对 sidecar 状态的受控判断。
/// 它不是附件业务真相，因此仍然停留在 adapter 边界。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct 媒体上传运输记录 {
    pub 附件标识: String,
    pub 运输方式: String,
    pub 上传令牌: String,
    pub 令牌仍有效: bool,
    pub transport_upload_id: Option<String>,
    pub storage_locator: Option<String>,
    pub 字节大小: Option<i64>,
    pub 完成时间戳秒: Option<i64>,
}

/// 生成稳定格式的匿名内部身份标识。
/// 约束：这里只负责标识格式，不把展示语义塞进主键。
fn 生成匿名身份标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("a-{}", &raw[..12])
}

/// 生成稳定格式的会话标识。
/// 约束：会话是运行锚点，不承载展示语义。
fn 生成会话标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("s-{}", &raw[..12])
}

/// 当前 MVP 的花名生成器。
/// 设计取舍：
/// 1. 这不是通用基础设施，而是产品展示语义，放在这里足够薄；
/// 2. 花名首次创建后会持久化，因此这里无需做复杂可重放算法；
/// 3. 花名只是展示面，未来允许独立修改。
fn 生成展示花名() -> String {
    const 前缀: [&str; 8] = [
        "暴躁的",
        "爱玩枪的",
        "火锅味",
        "潜水的",
        "早起的",
        "叛逆的",
        "失眠的",
        "开黑的",
    ];
    const 后缀: [&str; 8] = [
        "企鹅", "小鸡", "海豹", "柴犬", "狸猫", "河马", "海鸥", "松鼠",
    ];

    let seed = Uuid::new_v4();
    let bytes = seed.as_bytes();
    let left = 前缀[(bytes[0] as usize) % 前缀.len()];
    let right = 后缀[(bytes[1] as usize) % 后缀.len()];
    format!("{left}{right}")
}

impl Pg仓储 {
    /// 把数据库行翻成共享领域事件。
    /// 这里统一收口消息读取的字段映射，避免快照基线和增量补洞各写一套。
    fn 行转消息事件(
        row: sqlx::postgres::PgRow,
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

    /// 领域层已经校验通过的附件引用，落到共享契约时只保留稳定渲染事实。
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

    /// 批量拉取消息附件快照，避免快照/历史/增量各自长出一套 N+1 查询。
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

    /// 把消息行和附件映射合成为共享领域事件列表。
    async fn 组装消息事件列表_异步(
        pool: &PgPool,
        房间标识: &str,
        rows: Vec<sqlx::postgres::PgRow>,
    ) -> Result<Vec<contract::领域事件>, contract::错误码> {
        let message_ids = rows
            .iter()
            .filter_map(|row| row.get::<Option<String>, _>("message_id"))
            .collect::<Vec<_>>();
        let mut attachment_map = Self::查询消息附件映射_异步(pool, &message_ids).await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let message_id = row
                    .get::<Option<String>, _>("message_id")
                    .unwrap_or_default();
                let attachments = attachment_map.remove(&message_id).unwrap_or_default();
                Self::行转消息事件(row, 房间标识, attachments)
            })
            .collect())
    }

    /// 查询上传链已形成的附件快照，供统一消息用例在进入领域前校验。
    fn 解析附件状态(
        raw_status: &str,
    ) -> Result<usecase::附件状态读取结果, contract::错误码> {
        match raw_status {
            "prepared" => Ok(usecase::附件状态读取结果::已准备),
            "uploading" => Ok(usecase::附件状态读取结果::上传中),
            "processing" => Ok(usecase::附件状态读取结果::处理中),
            "ready" => Ok(usecase::附件状态读取结果::就绪),
            "failed" => Ok(usecase::附件状态读取结果::失败),
            "expired" | "canceled" => Ok(usecase::附件状态读取结果::已过期),
            _ => Err(contract::错误码::系统错误),
        }
    }

    async fn 查询匿名身份数据库主键_异步(
        pool: &PgPool,
        所属匿名身份标识: &str,
    ) -> Result<i64, contract::错误码> {
        sqlx::query_scalar::<_, i64>(
            "SELECT id FROM anonymous_identities WHERE anonymous_identity_id = $1",
        )
        .bind(所属匿名身份标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?
        .ok_or(contract::错误码::会话无效)
    }

    /// 查询上传链已形成的附件快照，供统一消息用例在进入领域前校验。
    async fn 查询附件快照_异步(
        pool: &PgPool,
        附件标识: &str,
    ) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
        let row = sqlx::query(
            "SELECT a.attachment_id, ai.anonymous_identity_id, a.kind, a.status, a.width, a.height \
             FROM attachments a \
             JOIN anonymous_identities ai ON ai.id = a.owner_anonymous_identity_id \
             WHERE a.attachment_id = $1",
        )
        .bind(附件标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        row.map(|row| {
            let kind = match row.get::<String, _>("kind").as_str() {
                "image" => usecase::附件种类读取结果::图片,
                "video" => usecase::附件种类读取结果::视频,
                "audio" => usecase::附件种类读取结果::语音,
                "gif" => usecase::附件种类读取结果::GIF,
                "file" => usecase::附件种类读取结果::文件,
                _ => return Err(contract::错误码::系统错误),
            };
            let status = Self::解析附件状态(row.get::<String, _>("status").as_str())?;
            Ok(usecase::附件读取结果 {
                附件标识: row.get("attachment_id"),
                所属匿名身份标识: row.get("anonymous_identity_id"),
                种类: kind,
                状态: status,
                宽: row.get("width"),
                高: row.get("height"),
            })
        })
        .transpose()
    }

    /// 查询某个 prepared 媒体附件占位，供本地回环上传与 complete 共同复用。
    async fn 查询待完成媒体附件_异步(
        pool: &PgPool,
        附件标识: &str,
    ) -> Result<Option<usecase::待完成媒体附件读取结果>, contract::错误码> {
        let row = sqlx::query(
            "SELECT a.attachment_id, ai.anonymous_identity_id, a.kind, a.mime_type, a.byte_size, a.storage_key, a.status \
             FROM attachments a \
             JOIN anonymous_identities ai ON ai.id = a.owner_anonymous_identity_id \
             WHERE a.attachment_id = $1",
        )
        .bind(附件标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        row.map(|row| {
            let kind = match row.get::<String, _>("kind").as_str() {
                "image" => usecase::媒体附件类型::图片,
                "video" => usecase::媒体附件类型::视频,
                _ => return Err(contract::错误码::系统错误),
            };
            Ok(usecase::待完成媒体附件读取结果 {
                附件标识: row.get("attachment_id"),
                所属匿名身份标识: row.get("anonymous_identity_id"),
                种类: kind,
                mime_type: row.get("mime_type"),
                字节大小: row.get("byte_size"),
                原始内容存储键: row.get("storage_key"),
                状态: Self::解析附件状态(row.get::<String, _>("status").as_str())?,
            })
        })
        .transpose()
    }

    /// 写入 prepared 媒体附件占位。
    async fn 创建预备媒体附件记录_异步(
        pool: &PgPool,
        所属匿名身份标识: &str,
        附件: &usecase::媒体附件准备请求,
    ) -> Result<usecase::媒体附件准备快照, contract::错误码> {
        let owner_db_id = Self::查询匿名身份数据库主键_异步(pool, 所属匿名身份标识).await?;
        let kind = match 附件.种类 {
            usecase::媒体附件类型::图片 => "image",
            usecase::媒体附件类型::视频 => "video",
        };

        sqlx::query(
            "INSERT INTO attachments (attachment_id, owner_anonymous_identity_id, kind, mime_type, byte_size, width, height, storage_key, thumbnail_storage_key, status) \
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, NULL, 'prepared')",
        )
        .bind(&附件.附件标识)
        .bind(owner_db_id)
        .bind(kind)
        .bind(&附件.mime_type)
        .bind(附件.字节大小)
        .bind(&附件.原始内容存储键)
        .execute(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(usecase::媒体附件准备快照 {
            附件标识: 附件.附件标识.clone(),
            种类: 附件.种类.clone(),
            mime_type: 附件.mime_type.clone(),
            字节大小: 附件.字节大小,
            原始内容存储键: 附件.原始内容存储键.clone(),
            状态: usecase::附件状态读取结果::已准备,
        })
    }

    /// 写入 ready 媒体附件真相。
    async fn 创建媒体附件记录_异步(
        pool: &PgPool,
        所属匿名身份标识: &str,
        附件: &usecase::媒体附件写入请求,
    ) -> Result<usecase::媒体附件快照, contract::错误码> {
        let owner_db_id = Self::查询匿名身份数据库主键_异步(pool, 所属匿名身份标识).await?;
        let kind = match 附件.种类 {
            usecase::媒体附件类型::图片 => "image",
            usecase::媒体附件类型::视频 => "video",
        };

        sqlx::query(
            "INSERT INTO attachments (attachment_id, owner_anonymous_identity_id, kind, mime_type, byte_size, width, height, storage_key, thumbnail_storage_key, status) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready') \
             ON CONFLICT (attachment_id) DO UPDATE SET \
                 kind = EXCLUDED.kind, \
                 mime_type = EXCLUDED.mime_type, \
                 byte_size = EXCLUDED.byte_size, \
                 width = EXCLUDED.width, \
                 height = EXCLUDED.height, \
                 storage_key = EXCLUDED.storage_key, \
                 thumbnail_storage_key = EXCLUDED.thumbnail_storage_key, \
                 status = 'ready' \
             WHERE attachments.owner_anonymous_identity_id = EXCLUDED.owner_anonymous_identity_id",
        )
        .bind(&附件.附件标识)
        .bind(owner_db_id)
        .bind(kind)
        .bind(&附件.mime_type)
        .bind(附件.字节大小)
        .bind(附件.宽)
        .bind(附件.高)
        .bind(&附件.原始内容存储键)
        .bind(&附件.缩略图存储键)
        .execute(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(usecase::媒体附件快照 {
            附件标识: 附件.附件标识.clone(),
            种类: 附件.种类.clone(),
            mime_type: 附件.mime_type.clone(),
            字节大小: 附件.字节大小,
            宽: 附件.宽,
            高: 附件.高,
            状态: usecase::附件状态读取结果::就绪,
        })
    }

    /// prepare 阶段只登记一条运输授权记录，不把 transport token 塞进附件真相表。
    async fn 写入媒体上传运输授权_异步(
        pool: &PgPool,
        授权: &媒体上传运输授权写入请求,
    ) -> Result<(), contract::错误码> {
        sqlx::query(
            "INSERT INTO attachment_upload_transports \
                (attachment_id, transport_kind, upload_token, token_expires_at, transport_upload_id, storage_locator, byte_size, finished_at) \
             VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'), NULL, NULL, $5, NULL) \
             ON CONFLICT (attachment_id) DO UPDATE SET \
                transport_kind = EXCLUDED.transport_kind, \
                upload_token = EXCLUDED.upload_token, \
                token_expires_at = EXCLUDED.token_expires_at, \
                transport_upload_id = NULL, \
                storage_locator = NULL, \
                byte_size = EXCLUDED.byte_size, \
                finished_at = NULL",
        )
        .bind(&授权.附件标识)
        .bind(&授权.运输方式)
        .bind(&授权.上传令牌)
        .bind(授权.令牌有效期秒数)
        .bind(授权.字节大小)
        .execute(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(())
    }

    /// 读取 sidecar 当前登记的运输状态，供 complete/hook 做受控 gate。
    async fn 查询媒体上传运输记录_异步(
        pool: &PgPool,
        附件标识: &str,
    ) -> Result<Option<媒体上传运输记录>, contract::错误码> {
        let row = sqlx::query(
            "SELECT \
                attachment_id, \
                transport_kind, \
                upload_token, \
                token_expires_at > NOW() AS token_is_active, \
                transport_upload_id, \
                storage_locator, \
                byte_size, \
                EXTRACT(EPOCH FROM finished_at)::BIGINT AS finished_at_epoch \
             FROM attachment_upload_transports \
             WHERE attachment_id = $1",
        )
        .bind(附件标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(row.map(|row| 媒体上传运输记录 {
            附件标识: row.get("attachment_id"),
            运输方式: row.get("transport_kind"),
            上传令牌: row.get("upload_token"),
            令牌仍有效: row.get("token_is_active"),
            transport_upload_id: row.get("transport_upload_id"),
            storage_locator: row.get("storage_locator"),
            字节大小: row.get("byte_size"),
            完成时间戳秒: row.get("finished_at_epoch"),
        }))
    }

    /// hook 侧通过 upload_token 反查运输授权，避免把 transport id 冒充成业务锚点。
    async fn 根据上传令牌查询媒体上传运输记录_异步(
        pool: &PgPool,
        上传令牌: &str,
    ) -> Result<Option<媒体上传运输记录>, contract::错误码> {
        let row = sqlx::query(
            "SELECT \
                attachment_id, \
                transport_kind, \
                upload_token, \
                token_expires_at > NOW() AS token_is_active, \
                transport_upload_id, \
                storage_locator, \
                byte_size, \
                EXTRACT(EPOCH FROM finished_at)::BIGINT AS finished_at_epoch \
             FROM attachment_upload_transports \
             WHERE upload_token = $1",
        )
        .bind(上传令牌)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(row.map(|row| 媒体上传运输记录 {
            附件标识: row.get("attachment_id"),
            运输方式: row.get("transport_kind"),
            上传令牌: row.get("upload_token"),
            令牌仍有效: row.get("token_is_active"),
            transport_upload_id: row.get("transport_upload_id"),
            storage_locator: row.get("storage_locator"),
            字节大小: row.get("byte_size"),
            完成时间戳秒: row.get("finished_at_epoch"),
        }))
    }

    /// post-finish 只登记“运输完成事实”，不越权升级附件 ready。
    async fn 更新媒体上传运输回执_异步(
        pool: &PgPool,
        附件标识: &str,
        transport_upload_id: &str,
        storage_locator: &str,
        byte_size: i64,
    ) -> Result<(), contract::错误码> {
        sqlx::query(
            "UPDATE attachment_upload_transports \
             SET transport_upload_id = $2, storage_locator = $3, byte_size = $4, finished_at = NOW() \
             WHERE attachment_id = $1",
        )
        .bind(附件标识)
        .bind(transport_upload_id)
        .bind(storage_locator)
        .bind(byte_size)
        .execute(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(())
    }

    /// 按消息可见性反查附件内容目标。
    /// 只要当前会话仍然是某个引用该附件消息所在房间的成员，就允许读取。
    async fn 查询附件可读内容_异步(
        pool: &PgPool,
        附件标识: &str,
        会话标识: &str,
        变体: usecase::附件内容变体,
    ) -> Result<Option<usecase::附件内容读取结果>, contract::错误码> {
        let wants_thumbnail = matches!(变体, usecase::附件内容变体::缩略图);
        let row = sqlx::query(
            "SELECT \
                CASE \
                    WHEN $3 AND a.thumbnail_storage_key IS NOT NULL THEN a.thumbnail_storage_key \
                    ELSE a.storage_key \
                END AS storage_key, \
                CASE \
                    WHEN $3 AND a.thumbnail_storage_key IS NOT NULL THEN 'image/png' \
                    ELSE a.mime_type \
                END AS mime_type \
             FROM attachments a \
             JOIN message_attachment_refs mar ON mar.attachment_id = a.id \
             JOIN messages m ON m.message_id = mar.message_id \
             JOIN room_members rm ON rm.room_id = m.room_id AND rm.left_at IS NULL \
             JOIN sessions s ON s.id = rm.session_id \
             WHERE a.attachment_id = $1 AND s.session_id = $2 \
             ORDER BY m.created_at DESC \
             LIMIT 1",
        )
        .bind(附件标识)
        .bind(会话标识)
        .bind(wants_thumbnail)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        Ok(row.map(|row| usecase::附件内容读取结果 {
            mime_type: row.get("mime_type"),
            存储键: row.get("storage_key"),
        }))
    }

    /// 读取当前会话对应的稳定匿名内部身份标识。
    async fn 查询会话所属匿名身份_异步(
        pool: &PgPool,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        sqlx::query_scalar(
            "SELECT ai.anonymous_identity_id \
             FROM sessions s \
             JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
             WHERE s.session_id = $1",
        )
        .bind(会话标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)
    }

    async fn 检查会话存在_异步(
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

    async fn 检查房间存在_异步(
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

    async fn 检查成员资格_异步(
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

    /// 查询房间消息页。
    ///
    /// 关键约束：
    /// 1. 数据库里先按 DESC + LIMIT 取一页，避免把整房历史全拉上来；
    /// 2. 返回给壳层前再 reverse 成 ASC，保证“老的在前、新的在后”；
    /// 3. `截止位置之前` 为 `Some(x)` 时，只返回严格早于该位置的消息；
    /// 4. `截止位置之前` 为 `None` 时，返回当前最近一页消息基线。
    async fn 查询消息页(
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

        let mut events = Self::组装消息事件列表_异步(pool, 房间标识, rows).await?;
        // DESC LIMIT 更省，但普通阅读顺序必须恢复成 ASC。
        events.reverse();
        Ok(events)
    }

    /// 查询“某个事件位置及其之后”的消息页。
    /// 这个 helper 专门给“围绕第一条未读恢复首屏”使用，避免把未读窗口硬塞回历史分页语义。
    async fn 查询从位置开始的消息页(
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

        Self::组装消息事件列表_异步(pool, 房间标识, rows).await
    }

    /// 统一拼装房间恢复快照。
    /// 这样 join / snapshot 两条入口就不会各自长出一套“围绕未读恢复首屏”的异形逻辑。
    async fn 构建房间恢复快照(
        pool: &PgPool,
        房间数据库标识: i64,
        房间标识: &str,
        最新事件位置: i64,
        上次已读事件位置: Option<i64>,
        首条未读事件位置: Option<i64>,
    ) -> Result<contract::快照, contract::错误码> {
        let (snapshot_messages, has_more_before) =
            if let Some(first_unread_event_position) = 首条未读事件位置 {
                let before_messages = Self::查询消息页(
                    pool,
                    房间数据库标识,
                    房间标识,
                    Some(first_unread_event_position),
                    8,
                )
                .await?;
                let unread_messages = Self::查询从位置开始的消息页(
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
                    Self::查询消息页(pool, 房间数据库标识, 房间标识, None, 55).await?;
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

    /// 查询当前会话在某个房间里的阅读锚点。
    /// 这里做成 async helper，避免 adapter 内部在 async 上下文里再次 `block_on` 自己。
    async fn 查询房间阅读位置_异步(
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

    /// 发送热路径需要的最小发送者投影。
    /// 这里只解析数据库内部主键与展示花名，避免事务内再查一次 session。
    async fn 查询发送者投影_异步(
        pool: &PgPool,
        会话标识: &str,
    ) -> Result<(i64, String), contract::错误码> {
        let row = sqlx::query(
            "SELECT id, display_name AS display_alias FROM sessions WHERE session_id = $1",
        )
        .bind(会话标识)
        .fetch_optional(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?
        .ok_or(contract::错误码::会话无效)?;
        Ok((row.get("id"), row.get("display_alias")))
    }

    /// 幂等重试回查：当 `(room_id, sender_session_id, client_message_id)` 命中唯一约束时，
    /// 说明这条用户意图已经成功落成过权威消息，此时应回到既有事件，而不是把重试冒充成系统错误。
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
        let mut events = Self::组装消息事件列表_异步(pool, 房间标识, vec![row]).await?;
        Ok(events.pop())
    }

    /// 统一消息事务提交：
    /// 1. 推进房间顺序锚点
    /// 2. 写入 room_events / messages
    /// 3. 按 sort_order 写入 message_attachment_refs
    /// 4. 首次引用时把附件标记为 committed
    async fn 提交统一消息事件_异步(
        pool: &PgPool,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        // 会话投影提前查：它不依赖房间顺序热点，外移后能缩短事务持锁窗口。
        let (session_db_id, sender_display_alias) =
            Self::查询发送者投影_异步(pool, 会话标识).await?;

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
            // `client_message_id` 冲突表示同一条用户发送意图已成功落库过。
            // 这里必须回到既有权威事件，而不是把重试冒充成系统错误。
            if Self::是消息幂等冲突(&err) {
                tx.rollback()
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
                return Self::查询既有消息事件_异步(
                    pool,
                    房间标识,
                    会话标识,
                    客户端消息标识,
                )
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
            附件: 附件.iter().map(Self::已校验附件转契约快照).collect(),
            事件位置: next_position,
        })
    }

    /// 只把“同房间、同发送者、同 client_message_id”的冲突识别为幂等重试。
    /// 这样既能顺手修掉 IM 重发炸系统错的问题，也不会把别的唯一约束误吞成成功。
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

    fn 在运行时执行<T>(&self, future: impl Future<Output = T>) -> T {
        if let Some(rt) = &self.owned_runtime {
            rt.block_on(future)
        } else {
            self.handle.block_on(future)
        }
    }

    /// 共享连接池仓储也要暴露运输授权写入口，避免 shell 重新手搓 SQL。
    pub(crate) fn 写入媒体上传运输授权(
        &mut self,
        授权: &媒体上传运输授权写入请求,
    ) -> Result<(), contract::错误码> {
        self.在运行时执行(Self::写入媒体上传运输授权_异步(
            &self.pool, 授权,
        ))
    }

    /// shell 用它判断 transport 是否已经真正 finished，避免把 prepare 成功误判成 ready。
    pub(crate) fn 查询媒体上传运输记录(
        &self,
        附件标识: &str,
    ) -> Result<Option<媒体上传运输记录>, contract::错误码> {
        self.在运行时执行(Self::查询媒体上传运输记录_异步(
            &self.pool,
            附件标识,
        ))
    }

    /// hook 只靠上传令牌做 sidecar 鉴权，不把会话/成员判断塞进 transport 层。
    pub(crate) fn 根据上传令牌查询媒体上传运输记录(
        &self,
        上传令牌: &str,
    ) -> Result<Option<媒体上传运输记录>, contract::错误码> {
        self.在运行时执行(Self::根据上传令牌查询媒体上传运输记录_异步(&self.pool, 上传令牌))
    }

    /// transport finished 只登记回执；prepared -> ready 仍由 complete 主链完成。
    pub(crate) fn 更新媒体上传运输回执(
        &mut self,
        附件标识: &str,
        transport_upload_id: &str,
        storage_locator: &str,
        byte_size: i64,
    ) -> Result<(), contract::错误码> {
        self.在运行时执行(Self::更新媒体上传运输回执_异步(
            &self.pool,
            附件标识,
            transport_upload_id,
            storage_locator,
            byte_size,
        ))
    }

    /// 连接数据库并追平迁移。
    ///
    /// 设计原因：
    /// - 保证任何入口拿到仓储时，库结构已可用。
    /// - 避免“代码已更新但库未迁移”导致的运行期随机报错。
    pub fn 连接并迁移(database_url: &str) -> io::Result<Self> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|err| io::Error::other(format!("创建运行时失败: {err}")))?;
        let pool = rt
            .block_on(async {
                PgPoolOptions::new()
                    .max_connections(5)
                    .connect(database_url)
                    .await
            })
            .map_err(|err| io::Error::other(format!("连接数据库失败: {err}")))?;
        rt.block_on(async {
            sqlx::migrate!("./migrations")
                .run(&pool)
                .await
                .map_err(|err| io::Error::other(format!("执行迁移失败: {err}")))
        })?;
        let handle = rt.handle().clone();
        Ok(Self {
            handle,
            owned_runtime: Some(rt),
            pool,
        })
    }

    /// 用共享连接池构造仓储，避免热路径重复创建 `PgPool`。
    pub fn 从连接池构建(pool: PgPool, handle: tokio::runtime::Handle) -> Self {
        Self {
            handle,
            owned_runtime: None,
            pool,
        }
    }

    /// 仅用于测试事务不变量：验证房间锚点、事件条数、消息条数是否同步推进。
    pub fn 查询房间持久化计数(
        &self,
        房间标识: &str,
    ) -> Result<(i64, i64, i64), contract::错误码> {
        self.在运行时执行(async {
            let room =
                sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
                    .bind(房间标识)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            let Some(room_row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = room_row.get("id");
            let latest: i64 = room_row.get("latest_event_position");

            let event_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM room_events WHERE room_id = $1")
                    .bind(room_db_id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            let msg_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE room_id = $1")
                    .bind(room_db_id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            Ok((latest, event_count, msg_count))
        })
    }

    /// 按事件位置拉房间增量事件（冷路径补洞接口）。
    ///
    /// 约束：
    /// - 返回顺序必须按 event_position 升序，便于前端做幂等合并。
    /// - 这里只做数据拼装，不在这里判断成员资格或权限。
    async fn 拉取房间增量事件_异步(
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
            "SELECT re.event_position, re.message_id, m.client_message_id, s.session_id, s.display_name AS display_alias, m.body \
             FROM room_events re \
             LEFT JOIN messages m ON m.room_id = re.room_id AND m.event_position = re.event_position \
             LEFT JOIN sessions s ON s.id = m.sender_session_id \
             WHERE re.room_id = $1 AND re.event_position > $2 \
             ORDER BY re.event_position ASC",
        )
        .bind(room_db_id)
        .bind(从位置开始)
        .fetch_all(pool)
        .await
        .map_err(|_| contract::错误码::系统错误)?;

        let events = Self::组装消息事件列表_异步(pool, 房间标识, rows).await?;

        Ok(contract::快照::房间增量事件 {
            房间标识: 房间标识.to_string(),
            事件: events,
            最新事件位置: latest_event_position,
        })
    }

    pub fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(Self::拉取房间增量事件_异步(
            &self.pool,
            房间标识,
            从位置开始,
        ))
    }

    /// 后台概览查询（只读）。
    pub fn 后台概览(&self) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let room_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
                .fetch_one(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            Ok(contract::快照::后台概览 {
                房间总数: room_count as u64,
                消息总数: msg_count as u64,
            })
        })
    }

    /// 后台房间列表查询（只读）。
    pub fn 后台房间列表(&self) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let rows = sqlx::query("SELECT room_id FROM rooms ORDER BY created_at DESC LIMIT 100")
                .fetch_all(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let room_ids = rows
                .into_iter()
                .map(|r| r.get::<String, _>("room_id"))
                .collect::<Vec<_>>();
            Ok(contract::快照::后台房间列表 {
                房间标识列表: room_ids,
            })
        })
    }

    /// 后台房间详情查询（只读）。
    pub fn 后台房间详情(
        &self,
        房间标识: &str,
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let room =
                sqlx::query("SELECT id, latest_event_position FROM rooms WHERE room_id = $1")
                    .bind(房间标识)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            let Some(room_row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = room_row.get("id");
            let latest: i64 = room_row.get("latest_event_position");
            let msg_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE room_id = $1")
                    .bind(room_db_id)
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?;
            Ok(contract::快照::后台房间详情 {
                房间标识: 房间标识.to_string(),
                最新事件位置: latest,
                消息总数: msg_count as u64,
            })
        })
    }
}

impl 仓储端口 for Pg仓储 {
    /// 设备级匿名身份引导：
    /// - 同一设备入口凭证恢复同一个匿名内部身份
    /// - 同一设备入口凭证恢复同一个稳定会话
    /// - 花名首次生成后持久化，后续直接恢复
    fn 引导匿名身份(
        &mut self,
        设备匿名凭证: &str,
    ) -> Result<contract::匿名身份引导结果, contract::错误码> {
        self.在运行时执行(async {
            let existing = sqlx::query(
                "SELECT ai.anonymous_identity_id, ai.display_alias, s.session_id \
                 FROM sessions s \
                 JOIN anonymous_identities ai ON ai.id = s.anonymous_identity_id \
                 WHERE s.device_anonymous_token = $1",
            )
            .bind(设备匿名凭证)
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            if let Some(row) = existing {
                return Ok(contract::匿名身份引导结果 {
                    匿名身份标识: row.get("anonymous_identity_id"),
                    展示花名: row.get("display_alias"),
                    会话标识: row.get("session_id"),
                });
            }

            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let anonymous_identity_id = 生成匿名身份标识();
            let display_alias = 生成展示花名();
            let session_id = 生成会话标识();

            let identity_row = sqlx::query(
                "INSERT INTO anonymous_identities (anonymous_identity_id, display_alias) \
                 VALUES ($1, $2) \
                 RETURNING id",
            )
            .bind(&anonymous_identity_id)
            .bind(&display_alias)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            let identity_db_id: i64 = identity_row.get("id");

            sqlx::query(
                // `sessions.display_name` 是历史表字段名；当前语义上它承载的是展示花名投影。
                "INSERT INTO sessions (session_id, display_name, anonymous_identity_id, device_anonymous_token) \
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(&session_id)
            .bind(&display_alias)
            .bind(identity_db_id)
            .bind(设备匿名凭证)
            .execute(&mut *tx)
            .await
            .map_err(|_| contract::错误码::系统错误)?;

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            Ok(contract::匿名身份引导结果 {
                匿名身份标识: anonymous_identity_id,
                展示花名: display_alias,
                会话标识: session_id,
            })
        })
    }

    /// 进房/建房持久化实现：
    /// 在同一事务内完成会话校验、房间存在性判定与成员关系幂等写入。
    fn 按短码进房或建房(
        &mut self,
        会话标识: &str,
        房间短码: &str,
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            // 事务边界：会话校验、房间存在性、成员关系写入需要同一提交语义。
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let session_db_id: i64 =
                sqlx::query_scalar("SELECT id FROM sessions WHERE session_id = $1")
                    .bind(会话标识)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|_| contract::错误码::系统错误)?
                    .ok_or(contract::错误码::会话无效)?;

            let room_row = sqlx::query(
                "SELECT id, room_id, latest_event_position FROM rooms WHERE room_code = $1",
            )
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

            // 成员关系幂等写入：已是当前成员则不重复插入。
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

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

            let last_read_event_position =
                Self::查询房间阅读位置_异步(&self.pool, &room_id, 会话标识).await?;
            let first_unread_event_position = match last_read_event_position {
                Some(last_read_event_position) if last_read_event_position < latest_event_position => {
                    Some(last_read_event_position + 1)
                }
                _ => None,
            };
            Self::构建房间恢复快照(
                &self.pool,
                room_db_id,
                &room_id,
                latest_event_position,
                last_read_event_position,
                first_unread_event_position,
            )
            .await
        })
    }

    /// 成员资格检查是“只读事实查询”，不是业务规则裁决。
    /// 规则本身在用例层决定“何时调用、失败如何映射”。
    fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码> {
        self.在运行时执行(Self::检查会话存在_异步(&self.pool, 会话标识))
    }

    /// 会话 -> 匿名内部身份的解析留在 adapter 查询，不把数据库主键暴露给应用层。
    fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        self.在运行时执行(Self::查询会话所属匿名身份_异步(
            &self.pool,
            会话标识,
        ))
    }

    /// 房间存在性检查只回答“有没有这个 room_id”。
    /// 这样应用层可以先区分 `room_not_found`，再决定成员资格分支。
    fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码> {
        self.在运行时执行(Self::检查房间存在_异步(&self.pool, 房间标识))
    }

    /// 房间最新事件位置是顺序真相的一部分。
    /// 这里仅读取，不把它和恢复窗口或阅读推进策略混在一起。
    fn 查询房间最新事件位置(
        &self,
        房间标识: &str,
    ) -> Result<Option<i64>, contract::错误码> {
        self.在运行时执行(async {
            sqlx::query_scalar("SELECT latest_event_position FROM rooms WHERE room_id = $1")
                .bind(房间标识)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)
        })
    }

    /// 成员资格检查是“只读事实查询”，不是业务规则裁决。
    /// 规则本身在用例层决定“何时调用、失败如何映射”。
    fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        self.在运行时执行(Self::检查成员资格_异步(
            &self.pool,
            房间标识,
            会话标识,
        ))
    }

    /// 统一消息用例通过这个只读端口拿附件事实，不直连数据库字段名。
    fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
        self.在运行时执行(Self::查询附件快照_异步(&self.pool, 附件标识))
    }

    /// prepared 附件读取只暴露给上传链，不下放到其它业务入口。
    fn 查询待完成媒体附件(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::待完成媒体附件读取结果>, contract::错误码> {
        self.在运行时执行(Self::查询待完成媒体附件_异步(
            &self.pool,
            附件标识,
        ))
    }

    /// prepare 阶段先只落占位记录，不提前伪造 ready 元数据。
    fn 创建预备媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &usecase::媒体附件准备请求,
    ) -> Result<usecase::媒体附件准备快照, contract::错误码> {
        self.在运行时执行(Self::创建预备媒体附件记录_异步(
            &self.pool,
            所属匿名身份标识,
            附件,
        ))
    }

    /// 媒体上传链的元数据落库入口。
    fn 创建媒体附件记录(
        &mut self,
        所属匿名身份标识: &str,
        附件: &usecase::媒体附件写入请求,
    ) -> Result<usecase::媒体附件快照, contract::错误码> {
        self.在运行时执行(Self::创建媒体附件记录_异步(
            &self.pool,
            所属匿名身份标识,
            附件,
        ))
    }

    /// 附件内容读取仍然走成员可见性，不单独再长一套 ACL。
    fn 查询附件可读内容(
        &self,
        附件标识: &str,
        会话标识: &str,
        变体: usecase::附件内容变体,
    ) -> Result<Option<usecase::附件内容读取结果>, contract::错误码> {
        self.在运行时执行(Self::查询附件可读内容_异步(
            &self.pool,
            附件标识,
            会话标识,
            变体,
        ))
    }

    /// 拉取当前身份在房间里的阅读锚点。
    /// 这里返回的是身份级事实，不是页面态或 socket 连接态。
    fn 查询房间阅读位置(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<Option<i64>, contract::错误码> {
        self.在运行时执行(Self::查询房间阅读位置_异步(
            &self.pool,
            房间标识,
            会话标识,
        ))
    }

    /// 拉取房间恢复快照：当前由应用层先裁决已读/未读语义，再交给适配层按锚点拼装首屏。
    fn 拉取房间快照(
        &self,
        房间标识: &str,
        上次已读事件位置: Option<i64>,
        首条未读事件位置: Option<i64>,
    ) -> Result<contract::快照, contract::错误码> {
        self.在运行时执行(async {
            let room = sqlx::query(
                "SELECT id, room_id, latest_event_position FROM rooms WHERE room_id = $1",
            )
            .bind(房间标识)
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| contract::错误码::系统错误)?;
            let Some(row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = row.get("id");
            let latest_event_position: i64 = row.get("latest_event_position");
            Self::构建房间恢复快照(
                &self.pool,
                room_db_id,
                房间标识,
                latest_event_position,
                上次已读事件位置,
                首条未读事件位置,
            )
            .await
        })
    }

    /// 拉取更早历史页：用于“当前最老消息之前再看一页”。
    /// 这里仍只做数据读取，不把成员资格规则塞进仓储层。
    fn 拉取房间历史页(
        &self,
        房间标识: &str,
        截止位置之前: i64,
        限制条数: i64,
    ) -> Result<contract::快照, contract::错误码> {
        if 截止位置之前 <= 0 || 限制条数 <= 0 {
            return Err(contract::错误码::参数非法);
        }
        self.在运行时执行(async {
            let room = sqlx::query("SELECT id FROM rooms WHERE room_id = $1")
                .bind(房间标识)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            let Some(row) = room else {
                return Err(contract::错误码::房间不存在);
            };
            let room_db_id: i64 = row.get("id");
            let messages = Self::查询消息页(
                &self.pool,
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
        })
    }

    /// 拉取房间增量事件：用于冷路径补洞与 realtime 订阅首帧补齐。
    /// 成员资格不在这里裁决，只保证位置语义和事件顺序稳定。
    fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        Pg仓储::拉取房间增量事件(self, 房间标识, 从位置开始)
    }

    /// 提交“消息已创建”事务链：
    /// 锁房间 -> 写事件 -> 写消息 -> 推进房间事件锚点，四步缺一不可。
    fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码> {
        self.在运行时执行(Self::提交统一消息事件_异步(
            &self.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            &[],
        ))
    }

    /// 统一消息主链把纯文本和附件消息都收口到同一个事务提交入口。
    fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        self.在运行时执行(Self::提交统一消息事件_异步(
            &self.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        ))
    }

    /// 身份级阅读锚点写入：
    /// 1. 会话只用来解析出匿名内部身份；
    /// 2. 真正持久化主键是 `(anonymous_identity_id, room_id)`；
    /// 3. 写入只能单调前进，较早位置不会覆盖更靠后的已读事实。
    fn 推进房间阅读位置(
        &mut self,
        房间标识: &str,
        会话标识: &str,
        已读到事件位置: i64,
    ) -> Result<(), contract::错误码> {
        self.在运行时执行(async {
            let mut tx = self
                .pool
                .begin()
                .await
                .map_err(|_| contract::错误码::系统错误)?;

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
                // 当前系统约束里，匿名会话必须能回到稳定匿名内部身份。
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

            tx.commit()
                .await
                .map_err(|_| contract::错误码::系统错误)?;
            Ok(())
        })
    }
}

impl usecase::Realtime仓储端口 for Pg仓储 {
    async fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码> {
        Self::检查会话存在_异步(&self.pool, 会话标识).await
    }

    async fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        Self::查询会话所属匿名身份_异步(&self.pool, 会话标识).await
    }

    async fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码> {
        Self::检查房间存在_异步(&self.pool, 房间标识).await
    }

    async fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        Self::检查成员资格_异步(&self.pool, 房间标识, 会话标识).await
    }

    async fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        Self::拉取房间增量事件_异步(&self.pool, 房间标识, 从位置开始).await
    }

    async fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<usecase::附件读取结果>, contract::错误码> {
        Self::查询附件快照_异步(&self.pool, 附件标识).await
    }

    async fn 创建消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
    ) -> Result<contract::领域事件, contract::错误码> {
        Self::提交统一消息事件_异步(
            &self.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            &[],
        )
        .await
    }

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        Self::提交统一消息事件_异步(
            &self.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        )
        .await
    }
}
