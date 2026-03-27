/// 核心领域错误。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    InvalidRoomCode,
    EmptyDeviceKey,
    EmptyMessageContent,
    InvalidMaxMessageLength,
    MessageTooLong,
    RoomTemporarilyBanned,
    SenderIsNotRoomMember,
    SenderIsMuted,
    InsufficientRoomPermission,
    TargetIsNotRoomMember,
    CannotModerateRoomOwner,
}
