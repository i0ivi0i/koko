use axum::http::StatusCode;
use uuid::Uuid;

// 媒体上传共享协议只放跨端点复用的纯解析/命名函数。
// 它不承载 HTTP 路由，也不替任一端点 owner 做一跳转发。
pub(super) fn 生成附件标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("att-{}", &raw[..12])
}

pub(super) fn 生成媒体上传会话标识() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("upl-{}", raw)
}

pub(super) fn 生成媒体上传令牌() -> String {
    let raw = Uuid::new_v4().simple().to_string();
    format!("tus-{}", raw)
}

pub(super) const 媒体上传授权有效期秒数: u64 = 15 * 60;
pub(super) fn 解析媒体类型(
    raw_kind: &str,
) -> Result<crate::media::模型::媒体附件类型, (StatusCode, &'static str, &'static str)> {
    match raw_kind {
        "image" => Ok(crate::media::模型::媒体附件类型::图片),
        "video" => Ok(crate::media::模型::媒体附件类型::视频),
        _ => Err((
            StatusCode::BAD_REQUEST,
            "attachment_type_not_allowed",
            "只允许上传图片或视频",
        )),
    }
}

pub(super) fn 推导原始内容扩展名(
    kind: &crate::media::模型::媒体附件类型,
    mime_type: &str,
) -> &'static str {
    match kind {
        crate::media::模型::媒体附件类型::图片 => match mime_type {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".bin",
        },
        crate::media::模型::媒体附件类型::视频 => match mime_type {
            "video/mp4" => ".mp4",
            "video/webm" => ".webm",
            "video/quicktime" => ".mov",
            "video/3gpp" => ".3gp",
            _ => ".bin",
        },
    }
}
pub(super) fn 校验媒体准备请求(
    kind: &crate::media::模型::媒体附件类型,
    mime_type: &str,
    byte_size: i64,
) -> Result<(), (StatusCode, &'static str, &'static str)> {
    const 图片附件上传上限字节数: i64 = 10 * 1024 * 1024;
    const 视频附件上传上限字节数: i64 = 200 * 1024 * 1024;

    if byte_size <= 0 {
        return Err((StatusCode::BAD_REQUEST, "invalid_argument", "媒体大小非法"));
    }
    match kind {
        crate::media::模型::媒体附件类型::图片 => {
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
        crate::media::模型::媒体附件类型::视频 => {
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
