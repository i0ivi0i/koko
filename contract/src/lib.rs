use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BootstrapSessionRequest {
    pub device_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BootstrapSessionResponse {
    pub session_id: String,
    pub profile_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolveRoomRequest {
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolveRoomResponse {
    pub exists: bool,
    pub room_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinOrCreateRoomRequest {
    pub profile_id: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinOrCreateRoomResponse {
    pub room_id: String,
    pub code: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomResponse {
    pub room_id: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageResponse {
    pub message_id: String,
    pub room_id: String,
    pub sender_id: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RoomMessagesQuery {
    pub before_message_id: Option<String>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomMessagesResponse {
    pub items: Vec<MessageResponse>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomMemberResponse {
    pub profile_id: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomMembersResponse {
    pub items: Vec<RoomMemberResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SendMessageRequest {
    pub sender_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromoteAdminRequest {
    pub actor_profile_id: String,
    pub target_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DemoteAdminRequest {
    pub actor_profile_id: String,
    pub target_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GovernanceActorRequest {
    pub actor_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GlobalChatPolicyResponse {
    pub max_message_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateGlobalChatPolicyRequest {
    pub max_message_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BanRoomRequest {
    pub banned_until: String,
    pub ban_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomGovernanceStateResponse {
    pub room_id: String,
    pub banned_until: Option<String>,
    pub ban_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientWsEvent {
    SendMessage { content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerWsEvent {
    MessageCreated {
        message_id: String,
        room_id: String,
        sender_id: String,
        content: String,
        created_at: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_session_response_should_roundtrip() {
        let value = BootstrapSessionResponse {
            session_id: "session-1".into(),
            profile_id: "profile-1".into(),
            display_name: "user-1".into(),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: BootstrapSessionResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn join_room_response_should_roundtrip() {
        let value = JoinOrCreateRoomResponse {
            room_id: "room-1".into(),
            code: "1A234".into(),
            role: "owner".into(),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: JoinOrCreateRoomResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn server_ws_event_should_roundtrip() {
        let value = ServerWsEvent::MessageCreated {
            message_id: "msg-1".into(),
            room_id: "room-1".into(),
            sender_id: "profile-1".into(),
            content: "hello".into(),
            created_at: "2026-03-27T12:34:56Z".into(),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ServerWsEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn room_messages_query_should_roundtrip_with_anchor_and_limit() {
        let value = RoomMessagesQuery {
            before_message_id: Some("msg-9".into()),
            limit: Some(40),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: RoomMessagesQuery = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn room_messages_response_should_roundtrip_has_more_flag() {
        let value = RoomMessagesResponse {
            items: vec![MessageResponse {
                message_id: "msg-1".into(),
                room_id: "room-1".into(),
                sender_id: "profile-1".into(),
                content: "hello".into(),
                created_at: "2026-03-27T12:34:56Z".into(),
            }],
            has_more: true,
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: RoomMessagesResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn global_chat_policy_response_should_roundtrip() {
        let value = GlobalChatPolicyResponse {
            max_message_length: 2000,
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: GlobalChatPolicyResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }
}
