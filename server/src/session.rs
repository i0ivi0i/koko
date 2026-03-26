use koko_core::{
    error::DomainError,
    model::{ProfileId, SessionId},
    session::bootstrap_anonymous_profile,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::http::ApiError;

pub struct BootstrapSession {
    pub session_id: Uuid,
    pub profile_id: Uuid,
    pub display_name: String,
}

pub async fn bootstrap_session(
    pool: &PgPool,
    device_key: &str,
) -> Result<BootstrapSession, ApiError> {
    if device_key.trim().is_empty() {
        return Err(ApiError::bad_request("device_key 不能为空"));
    }

    let profile_id = find_or_create_profile(pool, device_key).await?;
    let session_id = SessionId(Uuid::new_v4());

    sqlx::query!(
        "INSERT INTO sessions (id, profile_id) VALUES ($1, $2)",
        session_id.0,
        profile_id.0
    )
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("会话写入失败"))?;

    Ok(BootstrapSession {
        session_id: session_id.0,
        profile_id: profile_id.0,
        display_name: build_display_name(device_key),
    })
}

async fn find_or_create_profile(pool: &PgPool, device_key: &str) -> Result<ProfileId, ApiError> {
    let existing = sqlx::query_scalar!("SELECT id FROM profiles WHERE device_key = $1", device_key)
        .fetch_optional(pool)
        .await
        .map_err(|_| ApiError::internal("资料查询失败"))?;

    if let Some(profile_id) = existing {
        return Ok(ProfileId(profile_id));
    }

    let profile = bootstrap_anonymous_profile(device_key).map_err(map_domain_error)?;
    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        profile.id.0,
        profile.device_key()
    )
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("资料写入失败"))?;

    Ok(profile.id)
}

pub(crate) fn build_display_name(device_key: &str) -> String {
    format!("访客-{}", device_key.trim().to_ascii_uppercase())
}

fn map_domain_error(error: DomainError) -> ApiError {
    match error {
        DomainError::EmptyDeviceKey => ApiError::bad_request("device_key 不能为空"),
        _ => ApiError::internal("领域规则失败"),
    }
}
