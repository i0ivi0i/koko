use futures_util::StreamExt;
use gloo_net::{
    http::Request,
    websocket::{Message, futures::WebSocket},
};
use koko_contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, JoinOrCreateRoomRequest,
    JoinOrCreateRoomResponse, MessageResponse, ResolveRoomRequest, ResolveRoomResponse,
    RoomMemberResponse, RoomMembersResponse, RoomMessagesResponse, SendMessageRequest,
    ServerWsEvent,
};

use crate::state::ActiveRoomSnapshot;

const MESSAGE_PAGE_LIMIT: u16 = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemberAction {
    Promote,
    Mute,
    Remove,
}

#[derive(Debug, PartialEq)]
struct MemberActionRequest {
    path: String,
    body: serde_json::Value,
}

pub fn api_base() -> &'static str {
    option_env!("KOKO_API_BASE").unwrap_or("http://127.0.0.1:3000")
}

pub fn build_room_ws_url(api_base: &str, room_id: &str, profile_id: &str) -> String {
    let ws_base = if let Some(rest) = api_base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = api_base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        api_base.to_string()
    };

    format!("{ws_base}/ws/rooms/{room_id}?profile_id={profile_id}")
}

fn build_room_messages_path(room_id: &str, before_message_id: Option<&str>) -> String {
    match before_message_id {
        Some(anchor) => format!(
            "/rooms/{room_id}/messages?before_message_id={anchor}&limit={MESSAGE_PAGE_LIMIT}"
        ),
        None => format!("/rooms/{room_id}/messages?limit={MESSAGE_PAGE_LIMIT}"),
    }
}

pub async fn join_room(code: &str) -> Result<ActiveRoomSnapshot, String> {
    let session: BootstrapSessionResponse =
        Request::post(&format!("{}/session/bootstrap", api_base()))
            .json(&BootstrapSessionRequest {
                device_key: format!("web-{}", code.to_ascii_lowercase()),
            })
            .map_err(|error| error.to_string())?
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;

    let _: ResolveRoomResponse = Request::post(&format!("{}/rooms/resolve", api_base()))
        .json(&ResolveRoomRequest {
            code: code.to_ascii_uppercase(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let joined: JoinOrCreateRoomResponse =
        Request::post(&format!("{}/rooms/join-or-create", api_base()))
            .json(&JoinOrCreateRoomRequest {
                profile_id: session.profile_id.clone(),
                code: code.to_ascii_uppercase(),
            })
            .map_err(|error| error.to_string())?
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;

    let messages: RoomMessagesResponse = Request::get(&format!(
        "{}{}",
        api_base(),
        build_room_messages_path(&joined.room_id, None)
    ))
    .send()
    .await
    .map_err(|error| error.to_string())?
    .json()
    .await
    .map_err(|error| error.to_string())?;

    let members: RoomMembersResponse =
        Request::get(&format!("{}/rooms/{}/members", api_base(), joined.room_id))
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;

    Ok(ActiveRoomSnapshot {
        session,
        joined,
        messages: messages.items,
        has_more_messages: messages.has_more,
        members: members.items,
    })
}

pub async fn fetch_room_messages(
    room_id: &str,
    before_message_id: Option<&str>,
) -> Result<RoomMessagesResponse, String> {
    Request::get(&format!(
        "{}{}",
        api_base(),
        build_room_messages_path(room_id, before_message_id)
    ))
    .send()
    .await
    .map_err(|error| error.to_string())?
    .json()
    .await
    .map_err(|error| error.to_string())
}

pub async fn fetch_room_members(room_id: &str) -> Result<Vec<RoomMemberResponse>, String> {
    let members: RoomMembersResponse =
        Request::get(&format!("{}/rooms/{room_id}/members", api_base()))
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;

    Ok(members.items)
}

fn build_member_action_request(
    action: MemberAction,
    room_id: &str,
    actor_profile_id: &str,
    target_profile_id: &str,
) -> MemberActionRequest {
    match action {
        MemberAction::Promote => MemberActionRequest {
            path: format!("/rooms/{room_id}/roles/promote"),
            body: serde_json::json!({
                "actor_profile_id": actor_profile_id,
                "target_profile_id": target_profile_id,
            }),
        },
        MemberAction::Mute => MemberActionRequest {
            path: format!("/rooms/{room_id}/members/{target_profile_id}/mute"),
            body: serde_json::json!({
                "actor_profile_id": actor_profile_id,
            }),
        },
        MemberAction::Remove => MemberActionRequest {
            path: format!("/rooms/{room_id}/members/{target_profile_id}/remove"),
            body: serde_json::json!({
                "actor_profile_id": actor_profile_id,
            }),
        },
    }
}

pub async fn send_message(
    room_id: &str,
    sender_id: &str,
    content: &str,
) -> Result<MessageResponse, String> {
    Request::post(&format!("{}/rooms/{room_id}/messages", api_base()))
        .json(&SendMessageRequest {
            sender_id: sender_id.to_string(),
            content: content.to_string(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())
}

pub async fn run_member_action(
    action: MemberAction,
    room_id: &str,
    actor_profile_id: &str,
    target_profile_id: &str,
) -> Result<(), String> {
    let request = build_member_action_request(action, room_id, actor_profile_id, target_profile_id);

    Request::post(&format!("{}{}", api_base(), request.path))
        .json(&request.body)
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub async fn listen_room_events<F>(room_id: String, profile_id: String, mut on_message: F)
where
    F: FnMut(MessageResponse) + 'static,
{
    let ws_url = build_room_ws_url(api_base(), &room_id, &profile_id);

    let Ok(socket) = WebSocket::open(&ws_url) else {
        return;
    };
    let (_, mut stream) = socket.split();

    while let Some(next) = stream.next().await {
        let Ok(Message::Text(text)) = next else {
            continue;
        };

        let Ok(ServerWsEvent::MessageCreated {
            message_id,
            room_id,
            sender_id,
            content,
        }) = serde_json::from_str::<ServerWsEvent>(&text)
        else {
            continue;
        };

        on_message(MessageResponse {
            message_id,
            room_id,
            sender_id,
            content,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn api_base_should_fall_back_to_local_server() {
        assert_eq!(api_base(), "http://127.0.0.1:3000");
    }

    #[test]
    fn ws_url_should_convert_http_to_ws() {
        let url = build_room_ws_url("http://127.0.0.1:3000", "room-1", "profile-1");
        assert_eq!(
            url,
            "ws://127.0.0.1:3000/ws/rooms/room-1?profile_id=profile-1"
        );
    }

    #[test]
    fn ws_url_should_convert_https_to_wss() {
        let url = build_room_ws_url("https://example.com", "room-1", "profile-1");
        assert_eq!(
            url,
            "wss://example.com/ws/rooms/room-1?profile_id=profile-1"
        );
    }

    #[test]
    fn promote_action_should_build_role_endpoint_and_full_body() {
        let request =
            build_member_action_request(MemberAction::Promote, "room-1", "owner-1", "member-1");

        assert_eq!(request.path, "/rooms/room-1/roles/promote");
        assert_eq!(
            request.body,
            json!({
                "actor_profile_id": "owner-1",
                "target_profile_id": "member-1"
            })
        );
    }

    #[test]
    fn mute_action_should_build_member_endpoint_and_actor_body() {
        let request =
            build_member_action_request(MemberAction::Mute, "room-1", "admin-1", "member-1");

        assert_eq!(request.path, "/rooms/room-1/members/member-1/mute");
        assert_eq!(
            request.body,
            json!({
                "actor_profile_id": "admin-1"
            })
        );
    }

    #[test]
    fn room_messages_path_should_include_default_limit() {
        assert_eq!(
            build_room_messages_path("room-1", None),
            "/rooms/room-1/messages?limit=40"
        );
    }

    #[test]
    fn room_messages_path_should_include_anchor_and_limit() {
        assert_eq!(
            build_room_messages_path("room-1", Some("msg-9")),
            "/rooms/room-1/messages?before_message_id=msg-9&limit=40"
        );
    }
}
