use crate::{error::DomainError, model::Profile};

/// 根据客户端本地设备键引导匿名资料。
pub fn bootstrap_anonymous_profile(device_key: &str) -> Result<Profile, DomainError> {
    Profile::new(device_key)
}
