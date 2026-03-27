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
    pub members: Vec<RoomMemberResponse>,
}

pub struct ActiveRoomSnapshot {
    pub session: BootstrapSessionResponse,
    pub joined: JoinOrCreateRoomResponse,
    pub messages: Vec<MessageResponse>,
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
            },
            joined: JoinOrCreateRoomResponse {
                room_id: "room-1".into(),
                code: "1A234".into(),
                role: "owner".into(),
            },
            messages: vec![message("msg-1")],
            members: vec![member("profile-1")],
        });

        assert_eq!(room.room_code, "1A234");
        assert_eq!(room.role, "owner");
        assert_eq!(room.messages.len(), 1);
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
            members: vec![member("profile-1")],
        });

        leave_room(&mut state);

        assert!(state.is_none());
    }
}
