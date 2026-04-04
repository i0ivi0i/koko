use super::领域错误;

/// 房间短码规则保持稳定，避免不同入口各自解释造成真相漂移。
pub fn 校验房间短码(短码: &str) -> Result<(), 领域错误> {
    let ok_len = (4..=12).contains(&短码.len());
    let ok_charset = 短码.chars().all(|c| c.is_ascii_alphanumeric());
    if ok_len && ok_charset {
        Ok(())
    } else {
        Err(领域错误::房间短码非法)
    }
}
