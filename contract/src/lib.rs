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
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub can_promote: bool,
    #[serde(default)]
    pub can_mute: bool,
    #[serde(default)]
    pub can_remove: bool,
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
    /// 当前主 web 流程已稳定使用的实时入房命令。
    JoinRoom { code: String },
    /// 当前主 web 流程已稳定使用的发消息命令。
    SendMessage { content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientRealtimeQuery {
    /// 预留给后续 realtime 历史同步；当前主 web 流程仍主要通过 HTTP 加载历史。
    LoadRecentMessages { limit: Option<u16> },
    /// 预留给后续 realtime 历史分页；当前主 web 流程仍主要通过 HTTP 加载更早消息。
    LoadOlderMessages {
        before_message_id: Option<String>,
        limit: Option<u16>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerRealtimeEvent {
    /// 当前主 web 流程的首屏房间同步入口。
    RoomSnapshot {
        room_id: String,
        code: String,
        role: String,
        messages: Vec<MessageResponse>,
        has_more_messages: bool,
        members: Vec<RoomMemberResponse>,
    },
    /// 当前主 web 流程稳定消费的新增消息事件。
    MessageCreated {
        message_id: String,
        room_id: String,
        sender_id: String,
        content: String,
        created_at: String,
    },
    /// 预留给后续成员增量同步；当前主 web 流程仍以快照与 HTTP 刷新为主。
    MemberChanged {
        room_id: String,
        member: RoomMemberResponse,
    },
    /// 预留给后续治理结果事件化；当前主 web 流程仍主要依赖 HTTP 治理回执。
    GovernanceResult {
        room_id: String,
        action: String,
        success: bool,
        reason: Option<String>,
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
    fn server_realtime_message_created_event_should_roundtrip_canonical_wire_format() {
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
    fn client_realtime_send_message_should_keep_canonical_wire_format() {
        let value = ClientRealtimeCommand::SendMessage {
            content: "hello".into(),
        };

        let json = serde_json::to_string(&value).unwrap();

        assert_eq!(json, r#"{"type":"send_message","content":"hello"}"#);
        assert_eq!(
            serde_json::from_str::<ClientRealtimeCommand>(&json).unwrap(),
            value
        );
    }

    #[test]
    fn client_realtime_command_join_room_should_keep_wire_format() {
        let json = r#"{"type":"join_room","code":"1A234"}"#;

        assert_eq!(
            serde_json::from_str::<ClientRealtimeCommand>(json).unwrap(),
            ClientRealtimeCommand::JoinRoom {
                code: "1A234".into(),
            }
        );
    }

    #[test]
    fn server_realtime_message_created_event_should_keep_canonical_wire_format() {
        let value = ServerRealtimeEvent::MessageCreated {
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
        assert_eq!(
            serde_json::from_str::<ServerRealtimeEvent>(&json).unwrap(),
            value
        );
    }

    #[test]
    fn server_realtime_event_should_accept_room_snapshot_payload() {
        let json = r#"{"type":"room_snapshot","room_id":"room-1","code":"1A234","role":"owner","messages":[],"has_more_messages":false,"members":[]}"#;

        assert!(matches!(
            serde_json::from_str::<ServerRealtimeEvent>(json).unwrap(),
            ServerRealtimeEvent::RoomSnapshot { .. }
        ));
    }

    #[test]
    fn server_realtime_event_should_accept_governance_result_payload() {
        let json = r#"{"type":"governance_result","room_id":"room-1","action":"promote_admin","success":true,"reason":null}"#;

        assert!(matches!(
            serde_json::from_str::<ServerRealtimeEvent>(json).unwrap(),
            ServerRealtimeEvent::GovernanceResult { .. }
        ));
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
                is_muted: false,
                can_promote: false,
                can_mute: false,
                can_remove: false,
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
                is_muted: true,
                can_promote: false,
                can_mute: true,
                can_remove: true,
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
