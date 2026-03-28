use dioxus::prelude::spawn;
use futures_channel::mpsc::{UnboundedSender, unbounded};
use futures_util::{
    SinkExt, StreamExt,
    future::{Either, select},
};
use gloo_net::{
    http::Request,
    websocket::{Message, futures::WebSocket},
};
#[cfg(target_arch = "wasm32")]
use gloo_storage::{LocalStorage, Storage};
use koko_contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, ClientWsEvent, GovernanceActorRequest,
    JoinOrCreateRoomRequest, JoinOrCreateRoomResponse, MessageResponse, PromoteAdminRequest,
    RoomMemberResponse, RoomMembersResponse, RoomMessagesResponse, SESSION_HEADER_NAME,
    SendMessageRequest, ServerWsEvent,
};

use crate::state::ActiveRoomSnapshot;

#[cfg(target_arch = "wasm32")]
const DEVICE_TOKEN_STORAGE_KEY: &str = "koko.device_token";
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
    body: String,
}

#[derive(Clone)]
pub struct RoomConnection {
    outbound: UnboundedSender<String>,
}

impl RoomConnection {
    pub fn send_message(&self, content: &str) -> Result<(), String> {
        let payload = build_send_message_event(content)?;
        self.outbound
            .unbounded_send(payload)
            .map_err(|_| "实时连接已关闭".to_string())
    }
}

pub fn api_base() -> &'static str {
    option_env!("KOKO_API_BASE").unwrap_or("http://127.0.0.1:3000")
}

pub fn build_room_ws_url(api_base: &str, room_id: &str, session_id: &str) -> String {
    let ws_base = if let Some(rest) = api_base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = api_base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        api_base.to_string()
    };

    format!("{ws_base}/ws/rooms/{room_id}?session_id={session_id}")
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
    let normalized_code = code.to_ascii_uppercase();
    let session: BootstrapSessionResponse =
        Request::post(&format!("{}/session/bootstrap", api_base()))
            .json(&BootstrapSessionRequest {
                device_token: bootstrap_device_token(),
            })
            .map_err(|error| error.to_string())?
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;
    persist_bootstrap_device_token(&session.device_token);

    let joined: JoinOrCreateRoomResponse =
        Request::post(&format!("{}/rooms/join-or-create", api_base()))
            .header(SESSION_HEADER_NAME, &session.session_id)
            .json(&JoinOrCreateRoomRequest {
                code: normalized_code,
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
    .header(SESSION_HEADER_NAME, &session.session_id)
    .send()
    .await
    .map_err(|error| error.to_string())?
    .json()
    .await
    .map_err(|error| error.to_string())?;

    let members: RoomMembersResponse =
        Request::get(&format!("{}/rooms/{}/members", api_base(), joined.room_id))
            .header(SESSION_HEADER_NAME, &session.session_id)
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

fn bootstrap_device_token() -> Option<String> {
    #[cfg(target_arch = "wasm32")]
    {
        return sanitize_bootstrap_device_token(
            LocalStorage::get::<String>(DEVICE_TOKEN_STORAGE_KEY)
                .ok()
                .as_deref(),
        );
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        None
    }
}

fn persist_bootstrap_device_token(device_token: &str) {
    #[cfg(target_arch = "wasm32")]
    if let Some(device_token) = sanitize_bootstrap_device_token(Some(device_token)) {
        let _ = LocalStorage::set(DEVICE_TOKEN_STORAGE_KEY, device_token);
    }

    #[cfg(not(target_arch = "wasm32"))]
    let _ = device_token;
}

fn sanitize_bootstrap_device_token(stored: Option<&str>) -> Option<String> {
    stored
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub async fn fetch_room_messages(
    room_id: &str,
    session_id: &str,
    before_message_id: Option<&str>,
) -> Result<RoomMessagesResponse, String> {
    Request::get(&format!(
        "{}{}",
        api_base(),
        build_room_messages_path(room_id, before_message_id)
    ))
    .header(SESSION_HEADER_NAME, session_id)
    .send()
    .await
    .map_err(|error| error.to_string())?
    .json()
    .await
    .map_err(|error| error.to_string())
}

pub async fn fetch_room_members(
    room_id: &str,
    session_id: &str,
) -> Result<Vec<RoomMemberResponse>, String> {
    let members: RoomMembersResponse =
        Request::get(&format!("{}/rooms/{room_id}/members", api_base()))
            .header(SESSION_HEADER_NAME, session_id)
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
    target_profile_id: &str,
) -> MemberActionRequest {
    match action {
        MemberAction::Promote => MemberActionRequest {
            path: format!("/rooms/{room_id}/roles/promote"),
            body: serde_json::to_string(&PromoteAdminRequest {
                target_profile_id: target_profile_id.to_owned(),
            })
            .expect("治理请求序列化不应失败"),
        },
        MemberAction::Mute => MemberActionRequest {
            path: format!("/rooms/{room_id}/members/{target_profile_id}/mute"),
            body: serde_json::to_string(&GovernanceActorRequest {})
                .expect("治理请求序列化不应失败"),
        },
        MemberAction::Remove => MemberActionRequest {
            path: format!("/rooms/{room_id}/members/{target_profile_id}/remove"),
            body: serde_json::to_string(&GovernanceActorRequest {})
                .expect("治理请求序列化不应失败"),
        },
    }
}

pub async fn send_message(
    room_id: &str,
    session_id: &str,
    content: &str,
) -> Result<MessageResponse, String> {
    Request::post(&format!("{}/rooms/{room_id}/messages", api_base()))
        .header(SESSION_HEADER_NAME, session_id)
        .json(&SendMessageRequest {
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
    session_id: &str,
    target_profile_id: &str,
) -> Result<(), String> {
    let request = build_member_action_request(action, room_id, target_profile_id);

    Request::post(&format!("{}{}", api_base(), request.path))
        .header(SESSION_HEADER_NAME, session_id)
        .header("content-type", "application/json")
        .body(request.body)
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn connect_room_events<F>(
    room_id: String,
    session_id: String,
    mut on_message: F,
) -> Result<RoomConnection, String>
where
    F: FnMut(MessageResponse) + 'static,
{
    let ws_url = build_room_ws_url(api_base(), &room_id, &session_id);
    let socket = WebSocket::open(&ws_url).map_err(|error| error.to_string())?;
    let (mut sender, mut receiver) = socket.split();
    let (outbound, mut outbound_messages) = unbounded::<String>();

    spawn(async move {
        loop {
            match select(outbound_messages.next(), receiver.next()).await {
                Either::Left((Some(payload), _)) => {
                    if sender.send(Message::Text(payload)).await.is_err() {
                        break;
                    }
                }
                Either::Left((None, _)) => break,
                Either::Right((Some(Ok(Message::Text(text))), _)) => {
                    if let Some(message) = decode_message_created_event(&text) {
                        on_message(message);
                    }
                }
                Either::Right((Some(Ok(_)), _)) => {}
                Either::Right((Some(Err(_)), _)) | Either::Right((None, _)) => break,
            }
        }
    });

    Ok(RoomConnection { outbound })
}

fn build_send_message_event(content: &str) -> Result<String, String> {
    serde_json::to_string(&ClientWsEvent::SendMessage {
        content: content.to_string(),
    })
    .map_err(|error| error.to_string())
}

fn decode_message_created_event(text: &str) -> Option<MessageResponse> {
    let event = serde_json::from_str::<ServerWsEvent>(text).ok()?;

    let ServerWsEvent::MessageCreated {
        message_id,
        room_id,
        sender_id,
        content,
        created_at,
    } = event;

    Some(MessageResponse {
        message_id,
        room_id,
        sender_id,
        content,
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use koko_contract::{
        ClientWsEvent, GovernanceActorRequest, PromoteAdminRequest, ServerWsEvent,
    };

    #[test]
    fn api_base_should_fall_back_to_local_server() {
        assert_eq!(api_base(), "http://127.0.0.1:3000");
    }

    #[test]
    fn ws_url_should_convert_http_to_ws() {
        let url = build_room_ws_url("http://127.0.0.1:3000", "room-1", "session-1");
        assert_eq!(
            url,
            "ws://127.0.0.1:3000/ws/rooms/room-1?session_id=session-1"
        );
    }

    #[test]
    fn ws_url_should_convert_https_to_wss() {
        let url = build_room_ws_url("https://example.com", "room-1", "session-1");
        assert_eq!(
            url,
            "wss://example.com/ws/rooms/room-1?session_id=session-1"
        );
    }

    #[test]
    fn promote_action_should_build_role_endpoint_and_full_body() {
        let request = build_member_action_request(MemberAction::Promote, "room-1", "member-1");

        assert_eq!(request.path, "/rooms/room-1/roles/promote");
        assert_eq!(
            request.body,
            serde_json::to_string(&PromoteAdminRequest {
                target_profile_id: "member-1".into(),
            })
            .unwrap()
        );
    }

    #[test]
    fn mute_action_should_build_member_endpoint_and_actor_body() {
        let request = build_member_action_request(MemberAction::Mute, "room-1", "member-1");

        assert_eq!(request.path, "/rooms/room-1/members/member-1/mute");
        assert_eq!(
            request.body,
            serde_json::to_string(&GovernanceActorRequest {}).unwrap()
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

    #[test]
    fn sanitize_bootstrap_device_token_should_keep_existing_issued_token() {
        let device_token = sanitize_bootstrap_device_token(Some("anon-issued-token"));

        assert_eq!(device_token.as_deref(), Some("anon-issued-token"));
    }

    #[test]
    fn sanitize_bootstrap_device_token_should_ignore_blank_storage() {
        let device_token = sanitize_bootstrap_device_token(Some("   "));

        assert_eq!(device_token, None);
    }

    #[test]
    fn send_message_event_should_encode_ws_payload() {
        let payload = build_send_message_event("hello").unwrap();

        assert_eq!(
            payload,
            serde_json::to_string(&ClientWsEvent::SendMessage {
                content: "hello".into(),
            })
            .unwrap()
        );
    }

    #[test]
    fn message_created_event_should_decode_to_message_response() {
        let payload = serde_json::to_string(&ServerWsEvent::MessageCreated {
            message_id: "msg-1".into(),
            room_id: "room-1".into(),
            sender_id: "profile-1".into(),
            content: "hello".into(),
            created_at: "2026-03-28T10:00:00Z".into(),
        })
        .unwrap();

        let message = decode_message_created_event(&payload).unwrap();

        assert_eq!(message.message_id, "msg-1");
        assert_eq!(message.room_id, "room-1");
        assert_eq!(message.sender_id, "profile-1");
        assert_eq!(message.content, "hello");
        assert_eq!(message.created_at, "2026-03-28T10:00:00Z");
    }
}
