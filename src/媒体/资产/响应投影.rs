use crate::shared::contract;

/// “附件 ready 快照 -> 媒体资产响应体” 需要的协议投影上下文。
/// 这里集中表达所有非业务真相输入，避免位置参数越传越胖。
pub(crate) struct 媒体资产响应上下文<'a> {
    pub 运行态分发: Option<&'a serde_json::Value>,
    pub 分发快照: Option<&'a crate::media::模型::协作分发元数据快照>,
    pub 原始地址: String,
    pub 原始冷源到期时间戳秒: Option<i64>,
    pub 原始冷源删除时间戳秒: Option<i64>,
    pub 会话标识: &'a str,
    pub 当前时间戳秒: i64,
}

/// 定位接口已经拿到 locator 真相，只需要补一层响应投影环境。
pub(crate) struct 定位媒体资产响应上下文<'a> {
    pub 运行态分发: Option<&'a serde_json::Value>,
    pub 原始地址: String,
    pub 会话标识: &'a str,
    pub 当前时间戳秒: i64,
}

/// 单文件视频资产的协议拼装参数。
struct 单文件视频资产响应参数<'a> {
    附件标识: &'a str,
    运行态分发: &'a serde_json::Value,
    分发快照: &'a crate::media::模型::协作分发元数据快照,
    canonical地址: String,
    mime_type: &'a str,
    宽: Option<i32>,
    高: Option<i32>,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
}

/// 图片 blob 资产的协议拼装参数。
struct Blob媒体资产响应参数<'a> {
    附件标识: &'a str,
    会话标识: &'a str,
    运行态分发: Option<&'a serde_json::Value>,
    分发快照: Option<&'a crate::media::模型::协作分发元数据快照>,
    旧原始地址: String,
    mime_type: &'a str,
    宽: Option<i32>,
    高: Option<i32>,
    原始冷源到期时间戳秒: Option<i64>,
    原始冷源删除时间戳秒: Option<i64>,
    当前时间戳秒: i64,
}

/// 下面这组资产投影函数表达的是媒体资产 HTTP 协议面，而不是房间查询协议面。
/// 单独收在响应投影模块后，HTTP handler 主文件只保留路由、鉴权、IO 和任务编排。
pub(crate) fn 媒体类型转标签(
    kind: &crate::media::模型::媒体附件类型
) -> &'static str {
    match kind {
        crate::media::模型::媒体附件类型::图片 => "image",
        crate::media::模型::媒体附件类型::视频 => "video",
    }
}

pub(crate) fn 附件状态转标签(
    status: &crate::media::模型::附件状态读取结果
) -> &'static str {
    match status {
        crate::media::模型::附件状态读取结果::已准备 => "prepared",
        crate::media::模型::附件状态读取结果::上传中 => "uploading",
        crate::media::模型::附件状态读取结果::处理中 => "processing",
        crate::media::模型::附件状态读取结果::就绪 => "ready",
        crate::media::模型::附件状态读取结果::失败 => "failed",
        crate::media::模型::附件状态读取结果::已过期 => "deleted",
    }
}

fn 媒体资产种类转标签(kind: &contract::媒体资产种类) -> &'static str {
    match kind {
        contract::媒体资产种类::图片Blob => "blob_image",
        contract::媒体资产种类::单文件视频 => "file_video",
    }
}

fn 媒体冷源角色转标签(role: &contract::媒体冷源角色) -> &'static str {
    match role {
        contract::媒体冷源角色::冷备引导 => "cold_backup_only",
    }
}

fn 媒体分发生存模式转标签(mode: &contract::媒体分发生存模式) -> &'static str {
    match mode {
        contract::媒体分发生存模式::服务端冷备窗口 => "server_assisted",
        contract::媒体分发生存模式::到期后仅peer存活 => "peer_only_after_expiry",
    }
}

fn 变体描述转响应体(variant: &contract::变体描述) -> serde_json::Value {
    serde_json::json!({
        "id": variant.标识,
        "mime_type": variant.mime_type,
        "url": variant.地址,
        "width": variant.宽,
        "height": variant.高,
    })
}

fn 媒体冷源描述转响应体(origin: &contract::媒体冷源描述) -> serde_json::Value {
    serde_json::json!({
        "original_url": origin.原始地址,
        "expires_at_epoch_seconds": origin.到期时间戳秒,
        "available": origin.是否可用,
        "role": 媒体冷源角色转标签(&origin.角色),
    })
}

fn 从运行态协作分发响应提取共享分发表面(
    snapshot: &crate::media::模型::协作分发元数据快照,
    runtime_distribution: &serde_json::Value,
) -> contract::媒体分发描述 {
    let announce_urls = runtime_distribution["announce_urls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    contract::媒体分发描述 {
        swarm_id: snapshot.swarm_id.clone(),
        announce_urls,
        web_seed_url: runtime_distribution["web_seed_url"]
            .as_str()
            .map(str::to_string),
        join_ticket: runtime_distribution["join_ticket"]
            .as_str()
            .map(str::to_string),
        ticket_expires_at: runtime_distribution["ticket_expires_at"]
            .as_str()
            .map(str::to_string),
        生存模式: match runtime_distribution["survival_mode"].as_str() {
            Some("server_assisted") => contract::媒体分发生存模式::服务端冷备窗口,
            _ => contract::媒体分发生存模式::到期后仅peer存活,
        },
    }
}

fn 媒体分发描述转响应体(
    distribution: &contract::媒体分发描述
) -> serde_json::Value {
    serde_json::json!({
        "swarm_id": distribution.swarm_id,
        "announce_urls": distribution.announce_urls,
        "web_seed_url": distribution.web_seed_url,
        "join_ticket": distribution.join_ticket,
        "ticket_expires_at": distribution.ticket_expires_at,
        "survival_mode": 媒体分发生存模式转标签(&distribution.生存模式),
    })
}

/// 受控附件内容路由是冷源读取的 canonical 入口。
/// 它不承担图片 blob 主链身份，只负责冷备读取与权限承接。
pub(crate) fn 构造附件受控地址(
    attachment_id: &str,
    session_id: &str,
    variant: &str,
) -> String {
    format!("/api/attachments/{attachment_id}/content?session_id={session_id}&variant={variant}")
}

/// preview_asset 只有在“附件真相确认有静态封面”且“当前请求带会话上下文”时才能被安全投影。
/// 这样 complete / locator / 房间快照都会复用同一条 still_url 生成规则，而不是各自手搓。
pub(crate) fn 构造预览资源响应体(
    attachment_id: &str,
    session_id: Option<&str>,
    有预览图: bool,
) -> Option<serde_json::Value> {
    if !有预览图 {
        return None;
    }
    let session_id = session_id?;
    Some(serde_json::json!({
        "still_url": 构造附件受控地址(attachment_id, session_id, "thumbnail")
    }))
}

pub(crate) fn 媒体允许投影静态预览(
    kind: &crate::media::模型::媒体附件类型,
    有预览图: bool,
) -> bool {
    matches!(kind, crate::media::模型::媒体附件类型::视频) && 有预览图
}

/// 图片 blob 主链统一收口到 `/api/media/{id}/blob/*`，
/// 避免前端继续把旧附件内容地址误认成正式资产地址。
fn 构造blob受控地址(attachment_id: &str, session_id: &str, variant: &str) -> String {
    format!("/api/media/{attachment_id}/blob/{variant}?session_id={session_id}")
}

fn blob媒体资产描述转响应体(
    asset: &contract::Blob媒体资产描述
) -> serde_json::Value {
    serde_json::json!({
        "asset_id": asset.资产标识,
        "content_hash": asset.内容哈希,
        "kind": 媒体资产种类转标签(&asset.种类),
        "variants": {
            "canonical": asset.canonical.as_ref().map(变体描述转响应体),
        },
        "distribution": asset.分发.as_ref().map(媒体分发描述转响应体),
        "origin": 媒体冷源描述转响应体(&asset.冷源),
    })
}

fn 构造单文件视频资产响应体(
    参数: 单文件视频资产响应参数<'_>
) -> serde_json::Value {
    let canonical = contract::变体描述 {
        标识: "canonical".to_string(),
        // 单文件视频的 canonical 地址就是同一个受控 Range 读取入口；
        // 分发、查看器、自动播和 web seed 都围绕这一份内容哈希协作，不能再分裂成 HLS/DASH 入口。
        mime_type: 参数.mime_type.to_string(),
        地址: 参数.canonical地址.clone(),
        宽: 参数.宽,
        高: 参数.高,
    };
    let distribution =
        从运行态协作分发响应提取共享分发表面(参数.分发快照, 参数.运行态分发);
    serde_json::json!({
        "asset_id": 参数.附件标识,
        "content_hash": 参数.分发快照.content_hash.clone(),
        "kind": 媒体资产种类转标签(&contract::媒体资产种类::单文件视频),
        "variants": {
            "canonical": 变体描述转响应体(&canonical),
        },
        "distribution": 媒体分发描述转响应体(&distribution),
        "origin": 媒体冷源描述转响应体(&crate::media::模型::构造媒体冷源描述(
            Some(参数.canonical地址.clone()),
            参数.原始冷源到期时间戳秒,
            参数.原始冷源删除时间戳秒,
            参数.当前时间戳秒,
        )),
    })
}

fn 构造blob媒体资产响应体(参数: Blob媒体资产响应参数<'_>) -> serde_json::Value {
    let canonical_url = 构造blob受控地址(参数.附件标识, 参数.会话标识, "canonical");
    let asset = contract::Blob媒体资产描述 {
        资产标识: 参数.附件标识.to_string(),
        内容哈希: 参数
            .分发快照
            .map(|snapshot| snapshot.content_hash.clone())
            .unwrap_or_else(|| 参数.附件标识.to_string()),
        种类: contract::媒体资产种类::图片Blob,
        canonical: Some(contract::变体描述 {
            标识: "canonical".to_string(),
            // canonical 是客户端预制后的唯一图片对象，后端只负责校验与受控分发。
            // MIME 继续来自附件 ready 真相，避免响应层重新猜测文件内容。
            mime_type: 参数.mime_type.to_string(),
            地址: canonical_url,
            宽: 参数.宽,
            高: 参数.高,
        }),
        分发: 参数.分发快照.and_then(|snapshot| {
            参数.运行态分发.map(|runtime| {
                从运行态协作分发响应提取共享分发表面(snapshot, runtime)
            })
        }),
        冷源: crate::media::模型::构造媒体冷源描述(
            Some(参数.旧原始地址),
            参数.原始冷源到期时间戳秒,
            参数.原始冷源删除时间戳秒,
            参数.当前时间戳秒,
        ),
    };
    blob媒体资产描述转响应体(&asset)
}

/// 统一把 ready 附件快照翻译成媒体资产协议面。
/// 这个拼装阶段只负责协议投影，不在这里发明新的媒体业务真相。
pub(crate) fn 构造媒体资产响应体(
    snapshot: &crate::media::模型::媒体附件快照,
    上下文: 媒体资产响应上下文<'_>,
) -> Option<serde_json::Value> {
    match &snapshot.种类 {
        crate::media::模型::媒体附件类型::视频 => Some(
            构造单文件视频资产响应体(单文件视频资产响应参数 {
                附件标识: snapshot.附件标识.as_str(),
                运行态分发: 上下文.运行态分发?,
                分发快照: 上下文.分发快照?,
                canonical地址: 上下文.原始地址,
                mime_type: snapshot.mime_type.as_str(),
                宽: Some(snapshot.宽),
                高: Some(snapshot.高),
                原始冷源到期时间戳秒: 上下文.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: 上下文.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }),
        ),
        crate::media::模型::媒体附件类型::图片 => {
            Some(构造blob媒体资产响应体(Blob媒体资产响应参数 {
                附件标识: snapshot.附件标识.as_str(),
                会话标识: 上下文.会话标识,
                运行态分发: 上下文.运行态分发,
                分发快照: 上下文.分发快照,
                旧原始地址: 上下文.原始地址,
                mime_type: snapshot.mime_type.as_str(),
                宽: Some(snapshot.宽),
                高: Some(snapshot.高),
                原始冷源到期时间戳秒: 上下文.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: 上下文.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }))
        }
    }
}

pub(crate) fn 构造定位媒体资产响应体(
    locator: &crate::media::模型::媒体定位结果,
    上下文: 定位媒体资产响应上下文<'_>,
) -> Option<(&'static str, serde_json::Value)> {
    match &locator.种类 {
        crate::media::模型::媒体附件类型::视频 => Some((
            "file_asset",
            构造单文件视频资产响应体(单文件视频资产响应参数 {
                附件标识: locator.附件标识.as_str(),
                运行态分发: 上下文.运行态分发?,
                分发快照: locator.协作分发.as_ref()?,
                canonical地址: 上下文.原始地址,
                mime_type: locator.mime_type.as_str(),
                宽: locator.宽,
                高: locator.高,
                原始冷源到期时间戳秒: locator.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: locator.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }),
        )),
        crate::media::模型::媒体附件类型::图片 => Some((
            "blob_asset",
            构造blob媒体资产响应体(Blob媒体资产响应参数 {
                附件标识: locator.附件标识.as_str(),
                会话标识: 上下文.会话标识,
                运行态分发: 上下文.运行态分发,
                分发快照: locator.协作分发.as_ref(),
                旧原始地址: 上下文.原始地址,
                mime_type: locator.mime_type.as_str(),
                宽: locator.宽,
                高: locator.高,
                原始冷源到期时间戳秒: locator.原始冷源到期时间戳秒,
                原始冷源删除时间戳秒: locator.原始冷源删除时间戳秒,
                当前时间戳秒: 上下文.当前时间戳秒,
            }),
        )),
    }
}

pub(crate) fn 媒体附件快照转响应体(
    snapshot: &crate::media::模型::媒体附件快照,
    media_asset: Option<serde_json::Value>,
    preview_asset: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut response = serde_json::json!({
        "attachment_id": snapshot.附件标识,
        "kind": 媒体类型转标签(&snapshot.种类),
        "mime_type": snapshot.mime_type,
        "byte_size": snapshot.字节大小,
        "width": snapshot.宽,
        "height": snapshot.高,
        "status": 附件状态转标签(&snapshot.状态),
    });
    if let Some(media_asset) = media_asset {
        response["media_asset"] = media_asset;
    }
    if let Some(preview_asset) = preview_asset {
        response["preview_asset"] = preview_asset;
    }
    response
}
