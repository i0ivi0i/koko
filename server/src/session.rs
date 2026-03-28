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
    pub device_token: String,
}

pub async fn bootstrap_session(
    pool: &PgPool,
    device_token: Option<&str>,
) -> Result<BootstrapSession, ApiError> {
    let issued_identity = find_or_create_profile(pool, device_token).await?;
    let session_id = SessionId(Uuid::new_v4());

    sqlx::query!(
        "INSERT INTO sessions (id, profile_id) VALUES ($1, $2)",
        session_id.0,
        issued_identity.profile_id.0
    )
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("会话写入失败"))?;

    Ok(BootstrapSession {
        session_id: session_id.0,
        profile_id: issued_identity.profile_id.0,
        display_name: build_display_name(issued_identity.profile_id),
        device_token: issued_identity.device_token,
    })
}

struct IssuedAnonymousIdentity {
    profile_id: ProfileId,
    device_token: String,
}

async fn find_or_create_profile(
    pool: &PgPool,
    device_token: Option<&str>,
) -> Result<IssuedAnonymousIdentity, ApiError> {
    if let Some(existing_token) = normalize_device_token(device_token) {
        let existing = sqlx::query_scalar!(
            "SELECT id FROM profiles WHERE device_key = $1",
            existing_token
        )
        .fetch_optional(pool)
        .await
        .map_err(|_| ApiError::internal("资料查询失败"))?;

        if let Some(profile_id) = existing {
            return Ok(IssuedAnonymousIdentity {
                profile_id: ProfileId(profile_id),
                device_token: existing_token.to_owned(),
            });
        }
    }

    let issued_token = issue_device_token();
    let profile = bootstrap_anonymous_profile(&issued_token).map_err(map_domain_error)?;
    sqlx::query!(
        "INSERT INTO profiles (id, device_key) VALUES ($1, $2)",
        profile.id.0,
        profile.device_key()
    )
    .execute(pool)
    .await
    .map_err(|_| ApiError::internal("资料写入失败"))?;

    Ok(IssuedAnonymousIdentity {
        profile_id: profile.id,
        device_token: issued_token,
    })
}

pub(crate) fn build_display_name(profile_id: ProfileId) -> String {
    let short = profile_id
        .0
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>()
        .to_ascii_uppercase();

    format!("访客-{short}")
}

fn normalize_device_token(device_token: Option<&str>) -> Option<&str> {
    device_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn issue_device_token() -> String {
    format!("anon-{}", Uuid::new_v4().simple())
}

fn map_domain_error(error: DomainError) -> ApiError {
    match error {
        DomainError::EmptyDeviceKey => ApiError::bad_request("device_token 生成失败"),
        _ => ApiError::internal("领域规则失败"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::uuid;

    #[test]
    fn build_display_name_should_hide_private_device_token() {
        let display_name = build_display_name(ProfileId(uuid!(
            "12345678-1234-5678-9abc-def012345678"
        )));

        assert_eq!(display_name, "访客-12345678");
        assert!(!display_name.contains("anon-"));
    }

    #[test]
    fn normalize_device_token_should_ignore_blank_values() {
        assert_eq!(normalize_device_token(Some("   ")), None);
        assert_eq!(normalize_device_token(None), None);
    }

    #[test]
    fn issue_device_token_should_use_server_owned_prefix() {
        let device_token = issue_device_token();

        assert!(device_token.starts_with("anon-"));
        assert!(device_token.len() > "anon-".len());
    }
}
