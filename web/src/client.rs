use gloo_net::http::Request;
#[cfg(target_arch = "wasm32")]
use gloo_storage::{LocalStorage, Storage};
#[cfg(target_arch = "wasm32")]
use js_sys::Function;
use koko_contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, ClientRealtimeCommand,
    GovernanceActorRequest, JoinOrCreateRoomRequest, JoinOrCreateRoomResponse, MessageResponse,
    PromoteAdminRequest, RoomMessagesResponse, SESSION_HEADER_NAME, ServerRealtimeEvent,
};
#[cfg(target_arch = "wasm32")]
use std::cell::RefCell;
#[cfg(target_arch = "wasm32")]
use std::rc::Rc;
use std::sync::{Arc, Mutex};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::{JsCast, JsValue, closure::Closure, prelude::wasm_bindgen};

use crate::state::{ActiveRoomSnapshot, RoomRealtimeSnapshot};

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
pub struct RoomRealtimeClient {
    state: Arc<Mutex<RealtimeState>>,
    ready: Arc<Mutex<bool>>,
    pending_commands: Arc<Mutex<Vec<String>>>,
    transport: RealtimeTransport,
}

#[derive(Clone)]
pub struct JoinedRoomClient {
    realtime: Option<RoomRealtimeClient>,
}

impl RoomRealtimeClient {
    pub fn send_message(&self, content: &str) -> Result<(), String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("消息不能为空".into());
        }

        if !self.state().allows_send() {
            return Err("实时连接不可用".into());
        }

        let command_json = build_send_command_json(content)?;
        dispatch_or_queue_command(
            self.state(),
            *self.ready.lock().unwrap(),
            &self.pending_commands,
            command_json,
            |command| self.transport.emit_command(command),
        )
    }

    pub fn close(&self) {
        store_realtime_state(&self.state, RealtimeState::Closed);
        *self.ready.lock().unwrap() = false;
        self.pending_commands.lock().unwrap().clear();
        self.transport.close();
    }

    fn state(&self) -> RealtimeState {
        *self.state.lock().unwrap()
    }
}

impl JoinedRoomClient {
    pub fn send_message(&self, content: &str) -> Result<(), String> {
        if let Some(realtime) = &self.realtime {
            return realtime.send_message(content);
        }

        Err("实时连接不可用".into())
    }

    pub fn close(&self) {
        if let Some(realtime) = &self.realtime {
            realtime.close();
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RealtimeState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Closed,
}

impl RealtimeState {
    pub fn allows_send(self) -> bool {
        matches!(
            self,
            Self::Connecting | Self::Connected | Self::Reconnecting
        )
    }
}

type MessageObserver = Arc<Mutex<Box<dyn FnMut(MessageResponse)>>>;
type SnapshotObserver = Arc<Mutex<Box<dyn FnMut(RoomRealtimeSnapshot)>>>;
type ErrorObserver = Arc<Mutex<Box<dyn FnMut(String)>>>;

#[derive(Clone)]
enum RealtimeTransport {
    #[cfg(target_arch = "wasm32")]
    SocketIo(Rc<SocketIoBridge>),
    #[cfg_attr(target_arch = "wasm32", allow(dead_code))]
    Unavailable,
}

impl RealtimeTransport {
    fn emit_command(&self, command_json: &str) -> Result<(), String> {
        match self {
            #[cfg(target_arch = "wasm32")]
            Self::SocketIo(bridge) => bridge.emit_command(command_json),
            Self::Unavailable => {
                let _ = command_json;
                Err("实时连接不可用".into())
            }
        }
    }

    fn close(&self) {
        #[cfg(target_arch = "wasm32")]
        if let Self::SocketIo(bridge) = self {
            bridge.close();
        }
    }
}

#[cfg(target_arch = "wasm32")]
struct SocketIoBridge {
    socket: JsValue,
    _on_event: Closure<dyn FnMut(String)>,
    _on_status: Closure<dyn FnMut(String)>,
    _on_error: Closure<dyn FnMut(String)>,
}

#[cfg(target_arch = "wasm32")]
impl SocketIoBridge {
    fn emit_command(&self, command_json: &str) -> Result<(), String> {
        js_emit_command(&self.socket, command_json).map_err(js_error_to_string)
    }

    fn close(&self) {
        js_close_socket(&self.socket);
    }
}

pub fn api_base() -> &'static str {
    option_env!("KOKO_API_BASE").unwrap_or("http://127.0.0.1:3000")
}

pub fn build_socket_io_base_url(api_base: &str) -> String {
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

    Ok(build_joined_room_snapshot(session, joined))
}

fn build_joined_room_snapshot(
    session: BootstrapSessionResponse,
    joined: JoinOrCreateRoomResponse,
) -> ActiveRoomSnapshot {
    ActiveRoomSnapshot {
        session,
        joined,
        messages: Vec::new(),
        has_more_messages: false,
        members: Vec::new(),
    }
}

fn into_message_observer<F>(on_message: F) -> MessageObserver
where
    F: FnMut(MessageResponse) + 'static,
{
    Arc::new(Mutex::new(Box::new(on_message)))
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

pub fn connect_joined_room<F, E>(
    room_id: String,
    session_id: String,
    on_message: F,
    on_snapshot: impl FnMut(RoomRealtimeSnapshot) + 'static,
    on_error: E,
) -> Result<JoinedRoomClient, String>
where
    F: FnMut(MessageResponse) + 'static,
    E: FnMut(String) + 'static,
{
    let observer = into_message_observer(on_message);
    let snapshot_observer: SnapshotObserver = Arc::new(Mutex::new(Box::new(on_snapshot)));
    let error_observer: ErrorObserver = Arc::new(Mutex::new(Box::new(on_error)));
    let realtime = connect_room_events_with_observer(
        room_id.clone(),
        session_id.clone(),
        observer.clone(),
        snapshot_observer,
        error_observer,
    )?;

    Ok(JoinedRoomClient {
        realtime: Some(realtime),
    })
}

fn connect_room_events_with_observer(
    room_id: String,
    session_id: String,
    on_message: MessageObserver,
    on_snapshot: SnapshotObserver,
    on_error: ErrorObserver,
) -> Result<RoomRealtimeClient, String> {
    let state = Arc::new(Mutex::new(RealtimeState::Connecting));
    let ready = Arc::new(Mutex::new(false));
    let pending_commands = Arc::new(Mutex::new(Vec::new()));
    let transport = create_realtime_transport(
        state.clone(),
        ready.clone(),
        pending_commands.clone(),
        room_id.clone(),
        session_id.clone(),
        on_message.clone(),
        on_snapshot,
        on_error,
    )?;

    Ok(RoomRealtimeClient {
        state,
        ready,
        pending_commands,
        transport,
    })
}

#[cfg(target_arch = "wasm32")]
fn notify_message(on_message: &MessageObserver, message: MessageResponse) {
    let mut callback = on_message.lock().unwrap();
    (*callback)(message);
}

#[cfg(target_arch = "wasm32")]
fn notify_snapshot(on_snapshot: &SnapshotObserver, snapshot: RoomRealtimeSnapshot) {
    let mut callback = on_snapshot.lock().unwrap();
    (*callback)(snapshot);
}

fn store_realtime_state(state: &Arc<Mutex<RealtimeState>>, next: RealtimeState) {
    *state.lock().unwrap() = next;
}

fn create_realtime_transport(
    state: Arc<Mutex<RealtimeState>>,
    ready: Arc<Mutex<bool>>,
    pending_commands: Arc<Mutex<Vec<String>>>,
    room_id: String,
    session_id: String,
    on_message: MessageObserver,
    on_snapshot: SnapshotObserver,
    on_error: ErrorObserver,
) -> Result<RealtimeTransport, String> {
    #[cfg(target_arch = "wasm32")]
    {
        let state_for_status = state.clone();
        let ready_for_status = ready.clone();
        let on_status = Closure::wrap(Box::new(move |status: String| {
            let next_state = match status.as_str() {
                "connected" => RealtimeState::Connected,
                "reconnecting" => RealtimeState::Reconnecting,
                "disconnected" => RealtimeState::Disconnected,
                "closed" => RealtimeState::Closed,
                _ => RealtimeState::Connecting,
            };

            store_realtime_state(&state_for_status, next_state);
            if !matches!(next_state, RealtimeState::Connected) {
                *ready_for_status.lock().unwrap() = false;
            }
        }) as Box<dyn FnMut(String)>);

        let observer_for_events = on_message.clone();
        let snapshot_for_events = on_snapshot.clone();
        let ready_for_events = ready.clone();
        let pending_for_events = pending_commands.clone();
        let socket_handle = Rc::new(RefCell::new(None::<JsValue>));
        let socket_handle_for_events = socket_handle.clone();
        let on_event = Closure::wrap(Box::new(move |payload: String| {
            if let Some(snapshot) = decode_room_snapshot_event(&payload) {
                *ready_for_events.lock().unwrap() = true;
                notify_snapshot(&snapshot_for_events, snapshot);
                if let Some(socket) = socket_handle_for_events.borrow().clone() {
                    let _ = flush_pending_commands(&pending_for_events, |command| {
                        js_emit_command(&socket, command).map_err(js_error_to_string)
                    });
                }
            }
            if let Some(message) = decode_message_created_event(&payload) {
                notify_message(&observer_for_events, message);
            }
        }) as Box<dyn FnMut(String)>);

        let observer_for_error = on_error.clone();
        let on_error = Closure::wrap(Box::new(move |error: String| {
            let mut callback = observer_for_error.lock().unwrap();
            (*callback)(error);
        }) as Box<dyn FnMut(String)>);

        let socket = js_create_room_socket(
            &build_socket_io_base_url(api_base()),
            &session_id,
            &room_id,
            on_event.as_ref().unchecked_ref(),
            on_status.as_ref().unchecked_ref(),
            on_error.as_ref().unchecked_ref(),
        )
        .map_err(js_error_to_string)?;
        *socket_handle.borrow_mut() = Some(socket.clone());

        return Ok(RealtimeTransport::SocketIo(Rc::new(SocketIoBridge {
            socket,
            _on_event: on_event,
            _on_status: on_status,
            _on_error: on_error,
        })));
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (
            state,
            ready,
            pending_commands,
            room_id,
            session_id,
            on_message,
            on_snapshot,
            on_error,
        );
        Err("官方 Socket.IO 浏览器客户端仅在 wasm 环境可用".into())
    }
}

#[cfg(target_arch = "wasm32")]
fn js_error_to_string(error: JsValue) -> String {
    error
        .as_string()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{error:?}"))
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(module = "/public/assets/socketio-bridge.js")]
extern "C" {
    #[wasm_bindgen(catch, js_name = createRoomSocket)]
    fn js_create_room_socket(
        api_base: &str,
        session_id: &str,
        room_id: &str,
        on_event: &Function,
        on_status: &Function,
        on_error: &Function,
    ) -> Result<JsValue, JsValue>;

    #[wasm_bindgen(catch, js_name = emitCommand)]
    fn js_emit_command(socket: &JsValue, command_json: &str) -> Result<(), JsValue>;

    #[wasm_bindgen(js_name = closeSocket)]
    fn js_close_socket(socket: &JsValue);
}

fn build_send_command_json(content: &str) -> Result<String, String> {
    serde_json::to_string(&ClientRealtimeCommand::SendMessage {
        content: content.to_string(),
    })
    .map_err(|error| error.to_string())
}

fn decode_room_snapshot_event(text: &str) -> Option<RoomRealtimeSnapshot> {
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

    Some(RoomRealtimeSnapshot {
        room_id,
        room_code: code,
        role,
        messages,
        has_more_messages,
        members,
    })
}

fn decode_message_created_event(text: &str) -> Option<MessageResponse> {
    let event = serde_json::from_str::<ServerRealtimeEvent>(text).ok()?;

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

fn dispatch_or_queue_command<F>(
    state: RealtimeState,
    ready: bool,
    pending_commands: &Arc<Mutex<Vec<String>>>,
    command_json: String,
    emit_now: F,
) -> Result<(), String>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    if matches!(state, RealtimeState::Disconnected | RealtimeState::Closed) {
        return Err("实时连接不可用".into());
    }

    if matches!(state, RealtimeState::Connected) && ready {
        return emit_now(&command_json);
    }

    pending_commands.lock().unwrap().push(command_json);
    Ok(())
}

fn flush_pending_commands<F>(
    pending_commands: &Arc<Mutex<Vec<String>>>,
    mut emit: F,
) -> Result<(), String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let mut queued = {
        let mut guard = pending_commands.lock().unwrap();
        std::mem::take(&mut *guard)
    };

    let mut emitted = 0usize;
    while emitted < queued.len() {
        if let Err(error) = emit(&queued[emitted]) {
            let mut guard = pending_commands.lock().unwrap();
            guard.extend(queued.drain(emitted..));
            return Err(error);
        }
        emitted += 1;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use koko_contract::{
        ClientRealtimeCommand, GovernanceActorRequest, PromoteAdminRequest, RoomMemberResponse,
        ServerRealtimeEvent,
    };
    use std::sync::{Arc, Mutex};

    #[test]
    fn api_base_should_fall_back_to_local_server() {
        assert_eq!(api_base(), "http://127.0.0.1:3000");
    }

    #[test]
    fn socket_io_base_should_keep_http_origin() {
        let url = build_socket_io_base_url("http://127.0.0.1:3000/");
        assert_eq!(url, "http://127.0.0.1:3000");
    }

    #[test]
    fn socket_io_base_should_keep_https_origin() {
        let url = build_socket_io_base_url("https://example.com");
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
    fn joined_room_snapshot_should_start_empty_until_realtime_snapshot_arrives() {
        let snapshot = build_joined_room_snapshot(
            BootstrapSessionResponse {
                session_id: "session-1".into(),
                profile_id: "profile-1".into(),
                display_name: "user-1".into(),
                device_token: "anon-token-1".into(),
            },
            JoinOrCreateRoomResponse {
                room_id: "room-1".into(),
                code: "1A234".into(),
                role: "owner".into(),
            },
        );

        assert!(snapshot.messages.is_empty());
        assert!(!snapshot.has_more_messages);
        assert!(snapshot.members.is_empty());
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
    fn send_message_event_should_encode_socketio_command_payload() {
        let payload = build_send_command_json("hello").unwrap();

        assert_eq!(
            payload,
            serde_json::to_string(&ClientRealtimeCommand::SendMessage {
                content: "hello".into(),
            })
            .unwrap()
        );
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

    #[test]
    fn room_snapshot_event_should_decode_when_snapshot_arrives() {
        let payload = serde_json::to_string(&ServerRealtimeEvent::RoomSnapshot {
            room_id: "room-1".into(),
            code: "1A234".into(),
            role: "member".into(),
            messages: vec![],
            has_more_messages: false,
            members: vec![],
        })
        .unwrap();

        assert!(decode_room_snapshot_event(&payload).is_some());
    }

    #[test]
    fn room_snapshot_event_should_decode_to_realtime_snapshot() {
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
                is_muted: false,
                can_promote: false,
                can_mute: false,
                can_remove: false,
            }],
        })
        .unwrap();

        let snapshot = decode_room_snapshot_event(&payload).unwrap();

        assert_eq!(snapshot.room_id, "room-1");
        assert_eq!(snapshot.room_code, "1A234");
        assert_eq!(snapshot.role, "owner");
        assert_eq!(snapshot.messages.len(), 1);
        assert!(snapshot.has_more_messages);
        assert_eq!(snapshot.members.len(), 1);
    }

    #[test]
    fn realtime_state_should_allow_send_while_socketio_can_buffer() {
        assert!(!RealtimeState::Disconnected.allows_send());
        assert!(RealtimeState::Connecting.allows_send());
        assert!(RealtimeState::Connected.allows_send());
        assert!(RealtimeState::Reconnecting.allows_send());
        assert!(!RealtimeState::Closed.allows_send());
    }

    #[test]
    fn dispatch_or_queue_command_should_queue_while_connected_but_not_ready() {
        let pending = Arc::new(Mutex::new(Vec::new()));
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_closure = emitted.clone();

        let result = dispatch_or_queue_command(
            RealtimeState::Connected,
            false,
            &pending,
            "queued-command".into(),
            move |command| {
                emitted_for_closure
                    .lock()
                    .unwrap()
                    .push(command.to_string());
                Ok(())
            },
        );

        assert_eq!(result, Ok(()));
        assert_eq!(pending.lock().unwrap().as_slice(), ["queued-command"]);
        assert!(emitted.lock().unwrap().is_empty());
    }

    #[test]
    fn flush_pending_commands_should_emit_in_order_and_clear_queue() {
        let pending = Arc::new(Mutex::new(vec![
            "first-command".to_string(),
            "second-command".to_string(),
        ]));
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_closure = emitted.clone();

        let result = flush_pending_commands(&pending, move |command| {
            emitted_for_closure
                .lock()
                .unwrap()
                .push(command.to_string());
            Ok(())
        });

        assert_eq!(result, Ok(()));
        assert!(pending.lock().unwrap().is_empty());
        assert_eq!(
            emitted.lock().unwrap().as_slice(),
            ["first-command", "second-command"]
        );
    }

    #[test]
    fn flush_pending_commands_should_requeue_remaining_commands_after_failure() {
        let pending = Arc::new(Mutex::new(vec![
            "first-command".to_string(),
            "second-command".to_string(),
        ]));
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_for_closure = emitted.clone();

        let result = flush_pending_commands(&pending, move |command| {
            emitted_for_closure
                .lock()
                .unwrap()
                .push(command.to_string());
            if command == "first-command" {
                return Err("emit failed".into());
            }
            Ok(())
        });

        assert_eq!(result, Err("emit failed".into()));
        assert_eq!(
            pending.lock().unwrap().as_slice(),
            ["first-command", "second-command"]
        );
        assert_eq!(emitted.lock().unwrap().as_slice(), ["first-command"]);
    }

    #[test]
    fn joined_room_client_should_reject_send_without_realtime() {
        let client = JoinedRoomClient { realtime: None };

        assert_eq!(client.send_message("hello").unwrap_err(), "实时连接不可用");
    }

    #[test]
    fn close_should_move_client_to_closed_state() {
        let client = RoomRealtimeClient {
            state: Arc::new(Mutex::new(RealtimeState::Connected)),
            ready: Arc::new(Mutex::new(true)),
            pending_commands: Arc::new(Mutex::new(Vec::new())),
            transport: RealtimeTransport::Unavailable,
        };

        client.close();

        assert_eq!(client.state(), RealtimeState::Closed);
    }

    #[test]
    fn send_command_should_keep_canonical_wire_payload() {
        assert_eq!(
            build_send_command_json("hello").unwrap(),
            serde_json::to_string(&ClientRealtimeCommand::SendMessage {
                content: "hello".into(),
            })
            .unwrap()
        );
    }

    #[test]
    fn room_realtime_client_should_fail_when_transport_is_unavailable() {
        let realtime = RoomRealtimeClient {
            state: Arc::new(Mutex::new(RealtimeState::Connected)),
            ready: Arc::new(Mutex::new(true)),
            pending_commands: Arc::new(Mutex::new(Vec::new())),
            transport: RealtimeTransport::Unavailable,
        };
        let client = JoinedRoomClient {
            realtime: Some(realtime),
        };

        assert_eq!(client.send_message("hello").unwrap_err(), "实时连接不可用");
    }

    #[test]
    fn joined_room_client_close_should_be_safe_without_realtime() {
        let client = JoinedRoomClient { realtime: None };

        client.close();
    }

    #[test]
    fn joined_room_client_close_should_close_underlying_realtime_client() {
        let realtime = RoomRealtimeClient {
            state: Arc::new(Mutex::new(RealtimeState::Connected)),
            ready: Arc::new(Mutex::new(true)),
            pending_commands: Arc::new(Mutex::new(Vec::new())),
            transport: RealtimeTransport::Unavailable,
        };
        let client = JoinedRoomClient {
            realtime: Some(realtime.clone()),
        };

        client.close();

        assert_eq!(realtime.state(), RealtimeState::Closed);
    }
}
