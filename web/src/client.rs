use gloo_net::http::Request;
#[cfg(target_arch = "wasm32")]
use gloo_storage::{LocalStorage, Storage};
#[cfg(target_arch = "wasm32")]
use js_sys::Function;
#[cfg(test)]
use koko_contract::ClientRealtimeQuery;
use koko_contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, ClientRealtimeCommand,
    GovernanceActorRequest, JoinOrCreateRoomRequest, JoinOrCreateRoomResponse, MessageResponse,
    PromoteAdminRequest, RoomMemberResponse, RoomMembersResponse, RoomMessagesResponse,
    SESSION_HEADER_NAME, SendMessageRequest, ServerRealtimeEvent,
};
#[cfg(target_arch = "wasm32")]
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue, closure::Closure, prelude::*};

use crate::state::ActiveRoomSnapshot;

#[cfg(target_arch = "wasm32")]
const DEVICE_TOKEN_STORAGE_KEY: &str = "koko.device_token";
const MESSAGE_PAGE_LIMIT: u16 = 40;
#[cfg(test)]
const SOCKET_IO_COMMAND_EVENT_NAME: &str = "command";
#[cfg(test)]
const SOCKET_IO_QUERY_EVENT_NAME: &str = "query";

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

#[cfg(target_arch = "wasm32")]
#[derive(serde::Serialize)]
struct SocketIoConnectAuth {
    session_id: String,
    room_id: String,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SocketIoStatusEvent {
    Connected,
    Disconnected { message: Option<String> },
    Error { message: String },
}

#[cfg(target_arch = "wasm32")]
#[derive(Default)]
struct SocketIoConnectionState {
    connected: Cell<bool>,
    last_error: RefCell<Option<String>>,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(module = "/socketio-bridge.mjs")]
extern "C" {
    type SocketIoBridge;

    #[wasm_bindgen(catch, js_name = connectRoomSocket)]
    fn js_connect_room_socket(
        base_url: &str,
        auth: JsValue,
        on_event: &Function,
        on_status: &Function,
    ) -> Result<SocketIoBridge, JsValue>;

    #[wasm_bindgen(method, catch, js_name = emitCommand)]
    fn js_emit_command(this: &SocketIoBridge, payload: JsValue) -> Result<(), JsValue>;

    #[wasm_bindgen(method, catch, js_name = disconnect)]
    fn js_disconnect(this: &SocketIoBridge) -> Result<(), JsValue>;
}

#[cfg(target_arch = "wasm32")]
struct SocketIoRoomConnection {
    bridge: SocketIoBridge,
    state: Rc<SocketIoConnectionState>,
    _event_callback: Closure<dyn FnMut(JsValue)>,
    _status_callback: Closure<dyn FnMut(JsValue)>,
}

#[cfg(target_arch = "wasm32")]
impl SocketIoRoomConnection {
    fn is_connected(&self) -> bool {
        self.state.connected.get()
    }

    fn last_error(&self) -> Option<String> {
        self.state.last_error.borrow().clone()
    }

    fn send_command(&self, command: &ClientRealtimeCommand) -> Result<(), String> {
        if !self.is_connected() {
            return Err(self
                .last_error()
                .unwrap_or_else(|| "Socket.IO 实时连接尚未建立".to_string()));
        }

        let payload = serde_wasm_bindgen::to_value(command).map_err(|error| error.to_string())?;
        self.bridge
            .js_emit_command(payload)
            .map_err(js_error_to_string)
    }
}

#[cfg(target_arch = "wasm32")]
impl Drop for SocketIoRoomConnection {
    fn drop(&mut self) {
        let _ = self.bridge.js_disconnect();
    }
}

#[derive(Clone)]
pub struct RoomConnection {
    #[cfg(target_arch = "wasm32")]
    inner: Rc<SocketIoRoomConnection>,
}

impl RoomConnection {
    pub fn send_message(&self, content: &str) -> Result<(), String> {
        #[cfg(target_arch = "wasm32")]
        {
            self.inner
                .send_command(&ClientRealtimeCommand::SendMessage {
                    content: content.to_string(),
                })
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = content;
            Err(socket_io_runtime_unavailable_message().to_string())
        }
    }
}

pub fn api_base() -> &'static str {
    option_env!("KOKO_API_BASE").unwrap_or("http://127.0.0.1:3000")
}

pub fn build_socket_io_url(api_base: &str) -> String {
    api_base.trim_end_matches('/').to_string()
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
    #[allow(unused_mut)] mut on_message: F,
) -> Result<RoomConnection, String>
where
    F: FnMut(MessageResponse) + 'static,
{
    #[cfg(target_arch = "wasm32")]
    {
        let auth = serde_wasm_bindgen::to_value(&SocketIoConnectAuth {
            session_id,
            room_id,
        })
        .map_err(|error| error.to_string())?;
        let connection_state = Rc::new(SocketIoConnectionState::default());
        let event_state = connection_state.clone();
        let on_event = Closure::wrap(Box::new(move |payload: JsValue| {
            if let Ok(event) = serde_wasm_bindgen::from_value::<ServerRealtimeEvent>(payload) {
                match event {
                    ServerRealtimeEvent::MessageCreated {
                        message_id,
                        room_id,
                        sender_id,
                        content,
                        created_at,
                    } => on_message(MessageResponse {
                        message_id,
                        room_id,
                        sender_id,
                        content,
                        created_at,
                    }),
                    ServerRealtimeEvent::RoomSnapshot { .. }
                    | ServerRealtimeEvent::MemberChanged { .. }
                    | ServerRealtimeEvent::GovernanceResult { .. } => {}
                }
            } else {
                event_state
                    .last_error
                    .replace(Some("Socket.IO 客户端收到无法识别的实时事件".to_string()));
            }
        }) as Box<dyn FnMut(JsValue)>);
        let status_state = connection_state.clone();
        let on_status = Closure::wrap(Box::new(move |payload: JsValue| {
            match serde_wasm_bindgen::from_value::<SocketIoStatusEvent>(payload) {
                Ok(SocketIoStatusEvent::Connected) => {
                    status_state.connected.set(true);
                    status_state.last_error.replace(None);
                }
                Ok(SocketIoStatusEvent::Disconnected { message }) => {
                    status_state.connected.set(false);
                    status_state.last_error.replace(Some(
                        message.unwrap_or_else(|| "Socket.IO 连接已断开".to_string()),
                    ));
                }
                Ok(SocketIoStatusEvent::Error { message }) => {
                    status_state.connected.set(false);
                    status_state.last_error.replace(Some(message));
                }
                Err(_) => {
                    status_state.connected.set(false);
                    status_state
                        .last_error
                        .replace(Some("Socket.IO 客户端状态事件解析失败".to_string()));
                }
            }
        }) as Box<dyn FnMut(JsValue)>);

        let bridge = js_connect_room_socket(
            &build_socket_io_url(api_base()),
            auth,
            on_event.as_ref().unchecked_ref::<Function>(),
            on_status.as_ref().unchecked_ref::<Function>(),
        )
        .map_err(js_error_to_string)?;

        Ok(RoomConnection {
            inner: Rc::new(SocketIoRoomConnection {
                bridge,
                state: connection_state,
                _event_callback: on_event,
                _status_callback: on_status,
            }),
        })
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (room_id, session_id, on_message);
        Err(socket_io_runtime_unavailable_message().to_string())
    }
}

#[cfg(test)]
fn build_realtime_command_payload(
    command: &ClientRealtimeCommand,
) -> Result<(&'static str, String), String> {
    serde_json::to_string(command)
        .map(|payload| (SOCKET_IO_COMMAND_EVENT_NAME, payload))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
fn build_realtime_query_payload(
    query: &ClientRealtimeQuery,
) -> Result<(&'static str, String), String> {
    serde_json::to_string(query)
        .map(|payload| (SOCKET_IO_QUERY_EVENT_NAME, payload))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
fn decode_room_snapshot_event(
    text: &str,
    session: BootstrapSessionResponse,
) -> Option<ActiveRoomSnapshot> {
    let event = serde_json::from_str::<ServerRealtimeEvent>(text).ok()?;

    let ServerRealtimeEvent::RoomSnapshot {
        room_id,
        code,
        role,
        messages,
        has_more_messages,
        members,
    } = event
    else {
        return None;
    };

    Some(ActiveRoomSnapshot {
        session,
        joined: JoinOrCreateRoomResponse {
            room_id,
            code,
            role,
        },
        messages,
        has_more_messages,
        members,
    })
}

#[cfg(test)]
fn decode_message_created_event(text: &str) -> Option<MessageResponse> {
    let event = serde_json::from_str::<ServerRealtimeEvent>(text).ok()?;
    decode_message_created_realtime_event(event)
}

#[cfg(test)]
fn decode_message_created_realtime_event(event: ServerRealtimeEvent) -> Option<MessageResponse> {
    let ServerRealtimeEvent::MessageCreated {
        message_id,
        room_id,
        sender_id,
        content,
        created_at,
    } = event
    else {
        return None;
    };

    Some(MessageResponse {
        message_id,
        room_id,
        sender_id,
        content,
        created_at,
    })
}

#[cfg(any(test, not(target_arch = "wasm32")))]
fn socket_io_runtime_unavailable_message() -> &'static str {
    "Socket.IO 客户端仅支持 wasm32 浏览器运行时"
}

#[cfg(target_arch = "wasm32")]
fn js_error_to_string(error: JsValue) -> String {
    error
        .as_string()
        .or_else(|| {
            js_sys::JSON::stringify(&error)
                .ok()
                .and_then(|value| value.as_string())
        })
        .unwrap_or_else(|| "Socket.IO 客户端桥接失败".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use koko_contract::{
        BootstrapSessionResponse, ClientRealtimeCommand, ClientRealtimeQuery,
        GovernanceActorRequest, PromoteAdminRequest, ServerRealtimeEvent,
    };

    #[test]
    fn api_base_should_fall_back_to_local_server() {
        assert_eq!(api_base(), "http://127.0.0.1:3000");
    }

    #[test]
    fn socket_io_url_should_keep_http_origin() {
        let url = build_socket_io_url("http://127.0.0.1:3000/");
        assert_eq!(url, "http://127.0.0.1:3000");
    }

    #[test]
    fn socket_io_url_should_keep_https_origin() {
        let url = build_socket_io_url("https://example.com");
        assert_eq!(url, "https://example.com");
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
    fn send_message_event_should_encode_canonical_command_payload() {
        let (_, payload) = build_realtime_command_payload(&ClientRealtimeCommand::SendMessage {
            content: "hello".into(),
        })
        .unwrap();

        assert_eq!(
            payload,
            serde_json::to_string(&ClientRealtimeCommand::SendMessage {
                content: "hello".into(),
            })
            .unwrap()
        );
    }

    #[test]
    fn realtime_command_should_encode_to_socketio_command_event() {
        let (event_name, payload) =
            build_realtime_command_payload(&ClientRealtimeCommand::SendMessage {
                content: "hello".into(),
            })
            .unwrap();

        assert_eq!(event_name, SOCKET_IO_COMMAND_EVENT_NAME);
        assert_eq!(
            payload,
            serde_json::to_string(&ClientRealtimeCommand::SendMessage {
                content: "hello".into(),
            })
            .unwrap()
        );
    }

    #[test]
    fn realtime_query_should_encode_to_socketio_query_event() {
        let (event_name, payload) =
            build_realtime_query_payload(&ClientRealtimeQuery::LoadOlderMessages {
                before_message_id: Some("msg-9".into()),
                limit: Some(20),
            })
            .unwrap();

        assert_eq!(event_name, SOCKET_IO_QUERY_EVENT_NAME);
        assert_eq!(
            payload,
            serde_json::to_string(&ClientRealtimeQuery::LoadOlderMessages {
                before_message_id: Some("msg-9".into()),
                limit: Some(20),
            })
            .unwrap()
        );
    }

    #[test]
    fn socketio_runtime_unavailable_message_should_be_explicit() {
        assert_eq!(
            socket_io_runtime_unavailable_message(),
            "Socket.IO 客户端仅支持 wasm32 浏览器运行时"
        );
    }

    #[test]
    fn room_snapshot_event_should_decode_to_active_room_snapshot() {
        let payload = serde_json::to_string(&ServerRealtimeEvent::RoomSnapshot {
            room_id: "room-1".into(),
            code: "1A234".into(),
            role: "owner".into(),
            messages: vec![MessageResponse {
                message_id: "msg-1".into(),
                room_id: "room-1".into(),
                sender_id: "profile-1".into(),
                content: "hello".into(),
                created_at: "2026-03-28T10:00:00Z".into(),
            }],
            has_more_messages: true,
            members: vec![RoomMemberResponse {
                profile_id: "profile-1".into(),
                display_name: "user-1".into(),
                role: "owner".into(),
            }],
        })
        .unwrap();

        let snapshot = decode_room_snapshot_event(
            &payload,
            BootstrapSessionResponse {
                session_id: "session-1".into(),
                profile_id: "profile-1".into(),
                display_name: "user-1".into(),
                device_token: "device-1".into(),
            },
        )
        .unwrap();

        assert_eq!(snapshot.session.session_id, "session-1");
        assert_eq!(snapshot.joined.room_id, "room-1");
        assert_eq!(snapshot.joined.code, "1A234");
        assert_eq!(snapshot.joined.role, "owner");
        assert_eq!(snapshot.messages.len(), 1);
        assert!(snapshot.has_more_messages);
        assert_eq!(snapshot.members.len(), 1);
    }

    #[test]
    fn message_created_event_should_decode_to_message_response() {
        let payload = serde_json::to_string(&ServerRealtimeEvent::MessageCreated {
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
