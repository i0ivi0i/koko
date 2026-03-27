use crate::error::DomainError;
use time::OffsetDateTime;
use uuid::Uuid;

pub const DEFAULT_MAX_MESSAGE_LENGTH: usize = 2000;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MessageId(pub Uuid);

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

/// 文本消息内容。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageContent(String);

impl MessageContent {
    pub fn parse(input: &str) -> Result<Self, DomainError> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(DomainError::EmptyMessageContent);
        }

        Ok(Self(trimmed.to_owned()))
    }

    pub fn parse_with_limit(input: &str, max_length: usize) -> Result<Self, DomainError> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(DomainError::EmptyMessageContent);
        }
        if trimmed.chars().count() > max_length {
            return Err(DomainError::MessageTooLong);
        }

        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// 房间文本消息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub id: MessageId,
    pub room_id: RoomId,
    pub sender_id: ProfileId,
    pub content: MessageContent,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalChatPolicy {
    max_message_length: usize,
}

impl GlobalChatPolicy {
    pub fn new(max_message_length: usize) -> Result<Self, DomainError> {
        if max_message_length == 0 {
            return Err(DomainError::InvalidMaxMessageLength);
        }

        Ok(Self { max_message_length })
    }

    pub fn max_message_length(&self) -> usize {
        self.max_message_length
    }
}

impl Default for GlobalChatPolicy {
    fn default() -> Self {
        Self {
            max_message_length: DEFAULT_MAX_MESSAGE_LENGTH,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomGovernanceState {
    pub banned_until: Option<OffsetDateTime>,
    pub ban_reason: Option<String>,
}

impl RoomGovernanceState {
    pub fn active_ban(banned_until: OffsetDateTime, ban_reason: Option<String>) -> Self {
        Self {
            banned_until: Some(banned_until),
            ban_reason,
        }
    }

    pub fn unbanned() -> Self {
        Self {
            banned_until: None,
            ban_reason: None,
        }
    }

    pub fn is_banned_at(&self, now: OffsetDateTime) -> bool {
        self.banned_until.is_some_and(|until| until > now)
    }
}

impl Default for RoomGovernanceState {
    fn default() -> Self {
        Self::unbanned()
    }
}
