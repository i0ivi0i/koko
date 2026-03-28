use serde::{Deserialize, Serialize};

pub const SESSION_HEADER_NAME: &str = "x-koko-session-id";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BootstrapSessionRequest {
    pub device_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BootstrapSessionResponse {
    pub session_id: String,
    pub profile_id: String,
    pub display_name: String,
    pub device_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinOrCreateRoomRequest {
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
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromoteAdminRequest {
    pub target_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DemoteAdminRequest {
    pub target_profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GovernanceActorRequest {}

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
pub struct AdminOverviewResponse {
    pub total_rooms: u64,
    pub total_memberships: u64,
    pub active_rooms_24h: u64,
    pub messages_24h: u64,
    pub online_connections: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AdminRoomListQuery {
    pub code: Option<String>,
    pub limit: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminRoomListItem {
    pub room_id: String,
    pub code: String,
    pub member_count: u64,
    pub last_message_at: Option<String>,
    pub banned_until: Option<String>,
    pub ban_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminRoomListResponse {
    pub items: Vec<AdminRoomListItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminRoomDetailResponse {
    pub room_id: String,
    pub code: String,
    pub member_count: u64,
    pub last_message_at: Option<String>,
    pub banned_until: Option<String>,
    pub ban_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientRealtimeCommand {
    JoinRoom { code: String },
    SendMessage { content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientWsEvent {
    SendMessage { content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientRealtimeQuery {
    LoadRecentMessages { limit: Option<u16> },
    LoadOlderMessages {
        before_message_id: Option<String>,
        limit: Option<u16>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerRealtimeEvent {
    RoomSnapshot {
        room_id: String,
        code: String,
        role: String,
        messages: Vec<MessageResponse>,
        has_more_messages: bool,
        members: Vec<RoomMemberResponse>,
    },
    MessageCreated {
        message_id: String,
        room_id: String,
        sender_id: String,
        content: String,
        created_at: String,
    },
    MemberChanged {
        room_id: String,
        member: RoomMemberResponse,
    },
    GovernanceResult {
        room_id: String,
        action: String,
        success: bool,
        reason: Option<String>,
    },
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
            device_token: "anon-device-1".into(),
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
    fn legacy_client_ws_event_should_keep_send_message_wire_format() {
        let value = ClientWsEvent::SendMessage {
            content: "hello".into(),
        };

        let json = serde_json::to_string(&value).unwrap();

        assert_eq!(json, r#"{"type":"send_message","content":"hello"}"#);
        assert_eq!(serde_json::from_str::<ClientWsEvent>(&json).unwrap(), value);
    }

    #[test]
    fn legacy_client_ws_event_should_reject_join_room_payload() {
        let json = r#"{"type":"join_room","code":"1A234"}"#;

        assert!(serde_json::from_str::<ClientWsEvent>(json).is_err());
    }

    #[test]
    fn legacy_server_ws_event_should_keep_message_created_wire_format() {
        let value = ServerWsEvent::MessageCreated {
            message_id: "msg-1".into(),
            room_id: "room-1".into(),
            sender_id: "profile-1".into(),
            content: "hello".into(),
            created_at: "2026-03-27T12:34:56Z".into(),
        };

        let json = serde_json::to_string(&value).unwrap();

        assert_eq!(
            json,
            r#"{"type":"message_created","message_id":"msg-1","room_id":"room-1","sender_id":"profile-1","content":"hello","created_at":"2026-03-27T12:34:56Z"}"#
        );
        assert_eq!(serde_json::from_str::<ServerWsEvent>(&json).unwrap(), value);
    }

    #[test]
    fn legacy_server_ws_event_should_reject_room_snapshot_payload() {
        let json = r#"{"type":"room_snapshot","room_id":"room-1","code":"1A234","role":"owner","messages":[],"has_more_messages":false,"members":[]}"#;

        assert!(serde_json::from_str::<ServerWsEvent>(json).is_err());
    }

    #[test]
    fn legacy_server_ws_event_should_reject_governance_result_payload() {
        let json = r#"{"type":"governance_result","room_id":"room-1","action":"promote_admin","success":true,"reason":null}"#;

        assert!(serde_json::from_str::<ServerWsEvent>(json).is_err());
    }

    #[test]
    fn client_realtime_command_join_room_should_roundtrip() {
        let value = ClientRealtimeCommand::JoinRoom {
            code: "1A234".into(),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ClientRealtimeCommand = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn client_realtime_command_send_message_should_roundtrip() {
        let value = ClientRealtimeCommand::SendMessage {
            content: "hello".into(),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ClientRealtimeCommand = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn client_realtime_query_load_recent_messages_should_roundtrip() {
        let value = ClientRealtimeQuery::LoadRecentMessages { limit: Some(20) };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ClientRealtimeQuery = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn client_realtime_query_load_older_messages_should_roundtrip() {
        let value = ClientRealtimeQuery::LoadOlderMessages {
            before_message_id: Some("msg-9".into()),
            limit: Some(40),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ClientRealtimeQuery = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn server_realtime_event_room_snapshot_should_roundtrip() {
        let value = ServerRealtimeEvent::RoomSnapshot {
            room_id: "room-1".into(),
            code: "1A234".into(),
            role: "owner".into(),
            messages: vec![MessageResponse {
                message_id: "msg-1".into(),
                room_id: "room-1".into(),
                sender_id: "profile-1".into(),
                content: "hello".into(),
                created_at: "2026-03-27T12:34:56Z".into(),
            }],
            has_more_messages: true,
            members: vec![RoomMemberResponse {
                profile_id: "profile-1".into(),
                display_name: "user-1".into(),
                role: "owner".into(),
            }],
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ServerRealtimeEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn server_realtime_event_message_created_should_roundtrip() {
        let value = ServerRealtimeEvent::MessageCreated {
            message_id: "msg-1".into(),
            room_id: "room-1".into(),
            sender_id: "profile-1".into(),
            content: "hello".into(),
            created_at: "2026-03-27T12:34:56Z".into(),
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ServerRealtimeEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn server_realtime_event_member_changed_should_roundtrip() {
        let value = ServerRealtimeEvent::MemberChanged {
            room_id: "room-1".into(),
            member: RoomMemberResponse {
                profile_id: "profile-1".into(),
                display_name: "user-1".into(),
                role: "admin".into(),
            },
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ServerRealtimeEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }

    #[test]
    fn server_realtime_event_governance_result_should_roundtrip() {
        let value = ServerRealtimeEvent::GovernanceResult {
            room_id: "room-1".into(),
            action: "promote_admin".into(),
            success: true,
            reason: None,
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: ServerRealtimeEvent = serde_json::from_str(&json).unwrap();

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

    #[test]
    fn admin_overview_response_should_roundtrip() {
        let value = AdminOverviewResponse {
            total_rooms: 3,
            total_memberships: 8,
            active_rooms_24h: 2,
            messages_24h: 12,
            online_connections: 4,
        };

        let json = serde_json::to_string(&value).unwrap();
        let decoded: AdminOverviewResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded, value);
    }
}
