use koko_contract::{
    BootstrapSessionResponse, JoinOrCreateRoomResponse, MessageResponse, RoomMemberResponse,
};

#[derive(Clone, Debug, PartialEq)]
pub struct ActiveRoom {
    pub session_id: String,
    pub profile_id: String,
    pub display_name: String,
    pub room_id: String,
    pub room_code: String,
    pub role: String,
    pub messages: Vec<MessageResponse>,
    pub has_more_messages: bool,
    pub members: Vec<RoomMemberResponse>,
}

pub struct ActiveRoomSnapshot {
    pub session: BootstrapSessionResponse,
    pub joined: JoinOrCreateRoomResponse,
    pub messages: Vec<MessageResponse>,
    pub has_more_messages: bool,
    pub members: Vec<RoomMemberResponse>,
}

pub fn apply_joined_room(snapshot: ActiveRoomSnapshot) -> ActiveRoom {
    ActiveRoom {
        session_id: snapshot.session.session_id,
        profile_id: snapshot.session.profile_id,
        display_name: snapshot.session.display_name,
        room_id: snapshot.joined.room_id,
        room_code: snapshot.joined.code,
        role: snapshot.joined.role,
        messages: snapshot.messages,
        has_more_messages: snapshot.has_more_messages,
        members: snapshot.members,
    }
}

pub fn append_message_if_missing(room: &mut ActiveRoom, message: MessageResponse) -> bool {
    if room
        .messages
        .iter()
        .any(|item| item.message_id == message.message_id)
    {
        return false;
    }

    room.messages.push(message);
    true
}

pub fn prepend_messages(
    room: &mut ActiveRoom,
    messages: Vec<MessageResponse>,
    has_more: bool,
) -> usize {
    let mut older_messages: Vec<MessageResponse> = messages
        .into_iter()
        .filter(|message| {
            !room
                .messages
                .iter()
                .any(|existing| existing.message_id == message.message_id)
        })
        .collect();
    let inserted = older_messages.len();

    if inserted > 0 {
        older_messages.append(&mut room.messages);
        room.messages = older_messages;
    }

    room.has_more_messages = has_more;
    inserted
}

pub fn prepend_messages_if_room_matches(
    state: &mut Option<ActiveRoom>,
    room_id: &str,
    messages: Vec<MessageResponse>,
    has_more: bool,
) -> usize {
    let Some(room) = state.as_mut() else {
        return 0;
    };

    if room.room_id != room_id {
        return 0;
    }

    prepend_messages(room, messages, has_more)
}

pub fn earliest_message_id(room: &ActiveRoom) -> Option<String> {
    room.messages
        .first()
        .map(|message| message.message_id.clone())
}

pub fn replace_members(room: &mut ActiveRoom, members: Vec<RoomMemberResponse>) {
    room.members = members;
}

pub fn leave_room(state: &mut Option<ActiveRoom>) {
    *state = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(id: &str) -> MessageResponse {
        MessageResponse {
            message_id: id.to_string(),
            room_id: "room-1".into(),
            sender_id: "profile-1".into(),
            content: "hello".into(),
            created_at: "2026-03-27T12:34:56Z".into(),
        }
    }

    fn member(id: &str) -> RoomMemberResponse {
        RoomMemberResponse {
            profile_id: id.to_string(),
            display_name: format!("user-{id}"),
            role: "member".into(),
        }
    }

    #[test]
    fn joined_room_snapshot_should_build_active_room() {
        let room = apply_joined_room(ActiveRoomSnapshot {
            session: BootstrapSessionResponse {
                session_id: "session-1".into(),
                profile_id: "profile-1".into(),
                display_name: "user-1".into(),
                device_token: "anon-token-1".into(),
            },
            joined: JoinOrCreateRoomResponse {
                room_id: "room-1".into(),
                code: "1A234".into(),
                role: "owner".into(),
            },
            messages: vec![message("msg-1")],
            has_more_messages: true,
            members: vec![member("profile-1")],
        });

        assert_eq!(room.room_code, "1A234");
        assert_eq!(room.role, "owner");
        assert_eq!(room.messages.len(), 1);
        assert!(room.has_more_messages);
        assert_eq!(room.members.len(), 1);
    }

    #[test]
    fn duplicate_message_should_not_be_appended_twice() {
        let mut room = ActiveRoom {
            session_id: "session-1".into(),
            profile_id: "profile-1".into(),
            display_name: "user-1".into(),
            room_id: "room-1".into(),
            room_code: "1A234".into(),
            role: "owner".into(),
            messages: vec![message("msg-1")],
            has_more_messages: false,
            members: vec![member("profile-1")],
        };

        assert!(!append_message_if_missing(&mut room, message("msg-1")));
        assert_eq!(room.messages.len(), 1);
    }

    #[test]
    fn replace_members_should_swap_member_list() {
        let mut room = ActiveRoom {
            session_id: "session-1".into(),
            profile_id: "profile-1".into(),
            display_name: "user-1".into(),
            room_id: "room-1".into(),
            room_code: "1A234".into(),
            role: "owner".into(),
            messages: vec![message("msg-1")],
            has_more_messages: false,
            members: vec![member("profile-1")],
        };

        replace_members(&mut room, vec![member("profile-2"), member("profile-3")]);

        assert_eq!(room.members.len(), 2);
        assert_eq!(room.members[0].profile_id, "profile-2");
    }

    #[test]
    fn leave_room_should_clear_current_room() {
        let mut state = Some(ActiveRoom {
            session_id: "session-1".into(),
            profile_id: "profile-1".into(),
            display_name: "user-1".into(),
            room_id: "room-1".into(),
            room_code: "1A234".into(),
            role: "owner".into(),
            messages: vec![message("msg-1")],
            has_more_messages: false,
            members: vec![member("profile-1")],
        });

        leave_room(&mut state);

        assert!(state.is_none());
    }

    #[test]
    fn prepend_messages_should_insert_older_messages_once_and_update_has_more() {
        let mut room = ActiveRoom {
            session_id: "session-1".into(),
            profile_id: "profile-1".into(),
            display_name: "user-1".into(),
            room_id: "room-1".into(),
            room_code: "1A234".into(),
            role: "owner".into(),
            messages: vec![message("msg-3"), message("msg-4")],
            has_more_messages: true,
            members: vec![member("profile-1")],
        };

        let inserted = prepend_messages(
            &mut room,
            vec![message("msg-1"), message("msg-2"), message("msg-3")],
            false,
        );

        assert_eq!(inserted, 2);
        assert_eq!(
            room.messages
                .iter()
                .map(|item| item.message_id.as_str())
                .collect::<Vec<_>>(),
            vec!["msg-1", "msg-2", "msg-3", "msg-4"]
        );
        assert!(!room.has_more_messages);
        assert_eq!(earliest_message_id(&room).as_deref(), Some("msg-1"));
    }

    #[test]
    fn prepend_messages_if_room_matches_should_ignore_stale_room_response() {
        let mut state = Some(ActiveRoom {
            session_id: "session-1".into(),
            profile_id: "profile-1".into(),
            display_name: "user-1".into(),
            room_id: "room-b".into(),
            room_code: "1A234".into(),
            role: "owner".into(),
            messages: vec![message("msg-9")],
            has_more_messages: true,
            members: vec![member("profile-1")],
        });

        let inserted =
            prepend_messages_if_room_matches(&mut state, "room-a", vec![message("msg-1")], false);

        assert_eq!(inserted, 0);
        let room = state.as_ref().unwrap();
        assert_eq!(
            room.messages
                .iter()
                .map(|item| item.message_id.as_str())
                .collect::<Vec<_>>(),
            vec!["msg-9"]
        );
        assert!(room.has_more_messages);
    }
}
