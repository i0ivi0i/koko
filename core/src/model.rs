use crate::error::DomainError;
use uuid::Uuid;

/// 房间短码，固定为四个数字加一个英文字母。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RoomCode(String);

impl RoomCode {
    pub fn parse(input: &str) -> Result<Self, DomainError> {
        if input.len() != 5 {
            return Err(DomainError::InvalidRoomCode);
        }

        let digit_count = input.chars().filter(|c| c.is_ascii_digit()).count();
        let letter_count = input.chars().filter(|c| c.is_ascii_alphabetic()).count();

        if digit_count != 4 || letter_count != 1 {
            return Err(DomainError::InvalidRoomCode);
        }

        Ok(Self(input.to_ascii_uppercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ProfileId(pub Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RoomId(pub Uuid);

/// 匿名资料，绑定本地设备键。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub id: ProfileId,
    device_key: String,
}

impl Profile {
    pub fn new(device_key: impl Into<String>) -> Result<Self, DomainError> {
        let device_key = device_key.into();
        if device_key.trim().is_empty() {
            return Err(DomainError::EmptyDeviceKey);
        }

        Ok(Self {
            id: ProfileId(Uuid::new_v4()),
            device_key,
        })
    }

    pub fn device_key(&self) -> &str {
        &self.device_key
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Owner,
    Admin,
    Member,
}

/// 房间最小领域对象。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Room {
    pub id: RoomId,
    pub code: RoomCode,
}

impl Room {
    pub fn new(id: RoomId, code: RoomCode) -> Self {
        Self { id, code }
    }
}
