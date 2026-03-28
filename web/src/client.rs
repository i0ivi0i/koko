use dioxus::prelude::spawn;
use futures_channel::mpsc::{UnboundedSender, unbounded};
use futures_util::{
    FutureExt,
    SinkExt, StreamExt,
    future::{Either, select},
};
use gloo_net::{
    http::Request,
    websocket::{Message, futures::WebSocket},
};
#[cfg(target_arch = "wasm32")]
use gloo_timers::future::TimeoutFuture;
#[cfg(target_arch = "wasm32")]
use gloo_storage::{LocalStorage, Storage};
use koko_contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, ClientRealtimeCommand,
    GovernanceActorRequest, JoinOrCreateRoomRequest, JoinOrCreateRoomResponse, MessageResponse,
    PromoteAdminRequest, RoomMemberResponse, RoomMembersResponse, RoomMessagesResponse,
    SESSION_HEADER_NAME, SendMessageRequest, ServerRealtimeEvent,
};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use crate::state::ActiveRoomSnapshot;

#[cfg(target_arch = "wasm32")]
const DEVICE_TOKEN_STORAGE_KEY: &str = "koko.device_token";
const MESSAGE_PAGE_LIMIT: u16 = 40;
const RECONNECT_DELAY_MS: u32 = 1_500;

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
    outbound: UnboundedSender<RealtimeCommand>,
    state: Arc<Mutex<RealtimeState>>,
    room_id: String,
    session_id: String,
    on_message: MessageObserver,
}

#[derive(Clone)]
pub struct JoinedRoomClient {
    room_id: String,
    session_id: String,
    on_message: MessageObserver,
    realtime: Option<RoomRealtimeClient>,
}

impl RoomRealtimeClient {
    pub fn send_message(&self, content: &str) -> Result<(), String> {
        if should_fallback_to_http(self.state()) {
            self.spawn_http_fallback(content.to_string());
            return Ok(());
        }

        let command = build_send_command(content)?;
        if self.outbound.unbounded_send(command).is_err() {
            self.spawn_http_fallback(content.to_string());
        }

        Ok(())
    }

    pub fn close(&self) {
        store_realtime_state(&self.state, RealtimeState::Closed);
        let _ = self.outbound.unbounded_send(RealtimeCommand::Close);
    }

    fn state(&self) -> RealtimeState {
        *self.state.lock().unwrap()
    }

    fn spawn_http_fallback(&self, content: String) {
        spawn_http_message_delivery(
            self.room_id.clone(),
            self.session_id.clone(),
            content,
            self.on_message.clone(),
        );
    }
}

impl JoinedRoomClient {
    pub fn send_message(&self, content: &str) -> Result<(), String> {
        if let Some(realtime) = &self.realtime {
            return realtime.send_message(content);
        }

        let content = content.trim();
        if content.is_empty() {
            return Err("消息不能为空".into());
        }

        spawn_http_message_delivery(
            self.room_id.clone(),
            self.session_id.clone(),
            content.to_owned(),
            self.on_message.clone(),
        );
        Ok(())
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
        matches!(self, Self::Connected)
    }
}

fn should_fallback_to_http(state: RealtimeState) -> bool {
    !state.allows_send()
}

#[derive(Debug, PartialEq, Eq)]
enum RealtimeCommand {
    SendMessage { wire_payload: String, content: String },
    Close,
}

type MessageObserver = Arc<Mutex<Box<dyn FnMut(MessageResponse)>>>;

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

pub fn connect_joined_room<F>(room_id: String, session_id: String, on_message: F) -> JoinedRoomClient
where
    F: FnMut(MessageResponse) + 'static,
{
    let observer = into_message_observer(on_message);
    let realtime =
        connect_room_events_with_observer(room_id.clone(), session_id.clone(), observer.clone())
            .ok();

    JoinedRoomClient {
        room_id,
        session_id,
        on_message: observer,
        realtime,
    }
}

fn connect_room_events_with_observer(
    room_id: String,
    session_id: String,
    on_message: MessageObserver,
) -> Result<RoomRealtimeClient, String> {
    let ws_url = build_room_ws_url(api_base(), &room_id, &session_id);
    let (outbound, mut outbound_messages) = unbounded::<RealtimeCommand>();
    let state = Arc::new(Mutex::new(RealtimeState::Connecting));
    let state_handle = state.clone();
    let actor_message_handler = on_message.clone();
    let actor_room_id = room_id.clone();
    let actor_session_id = session_id.clone();

    spawn(async move {
        let mut next_state = RealtimeState::Connecting;

        loop {
            store_realtime_state(&state_handle, next_state);

            let socket = match WebSocket::open(&ws_url) {
                Ok(socket) => socket,
                Err(_) => {
                    if wait_before_reconnect(
                        &mut outbound_messages,
                        &state_handle,
                        &actor_room_id,
                        &actor_session_id,
                        actor_message_handler.clone(),
                    )
                    .await
                    {
                        break;
                    }
                    next_state = RealtimeState::Reconnecting;
                    continue;
                }
            };

            store_realtime_state(&state_handle, RealtimeState::Connected);
            let (mut sender, mut receiver) = socket.split();
            synchronize_recent_messages(
                &actor_room_id,
                &actor_session_id,
                actor_message_handler.clone(),
            );
            let should_stop = drive_connected_socket(
                &mut sender,
                &mut receiver,
                &mut outbound_messages,
                &state_handle,
                &actor_room_id,
                &actor_session_id,
                actor_message_handler.clone(),
            )
            .await;

            if should_stop {
                break;
            }

            next_state = transition_after_disconnect(state_handle.clone());
            if !matches!(next_state, RealtimeState::Closed)
                && wait_before_reconnect(
                    &mut outbound_messages,
                    &state_handle,
                    &actor_room_id,
                    &actor_session_id,
                    actor_message_handler.clone(),
                )
                    .await
            {
                break;
            }
        }

        if !matches!(read_realtime_state(&state_handle), RealtimeState::Closed) {
            store_realtime_state(&state_handle, RealtimeState::Disconnected);
        }
    });

    Ok(RoomRealtimeClient {
        outbound,
        state,
        room_id,
        session_id,
        on_message,
    })
}

async fn drive_connected_socket(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    outbound_messages: &mut futures_channel::mpsc::UnboundedReceiver<RealtimeCommand>,
    state: &Arc<Mutex<RealtimeState>>,
    room_id: &str,
    session_id: &str,
    on_message: MessageObserver,
) -> bool {
    loop {
        match select(outbound_messages.next(), receiver.next()).await {
            Either::Left((Some(RealtimeCommand::SendMessage { wire_payload, content }), _)) => {
                if sender.send(Message::Text(wire_payload)).await.is_err() {
                    store_realtime_state(state, RealtimeState::Reconnecting);
                    spawn_http_message_delivery(
                        room_id.to_owned(),
                        session_id.to_owned(),
                        content,
                        on_message.clone(),
                    );
                    return false;
                }
            }
            Either::Left((Some(RealtimeCommand::Close), _)) => {
                store_realtime_state(state, RealtimeState::Closed);
                let _ = sender.close().await;
                return true;
            }
            Either::Left((None, _)) => {
                store_realtime_state(state, RealtimeState::Closed);
                let _ = sender.close().await;
                return true;
            }
            Either::Right((Some(Ok(Message::Text(text))), _)) => {
                if let Some(message) = decode_message_created_event(&text) {
                    notify_message(&on_message, message);
                }
            }
            Either::Right((Some(Ok(_)), _)) => {}
            Either::Right((Some(Err(_)), _)) | Either::Right((None, _)) => {
                store_realtime_state(state, RealtimeState::Reconnecting);
                return false;
            }
        }
    }
}

async fn wait_before_reconnect(
    outbound_messages: &mut futures_channel::mpsc::UnboundedReceiver<RealtimeCommand>,
    state: &Arc<Mutex<RealtimeState>>,
    room_id: &str,
    session_id: &str,
    on_message: MessageObserver,
) -> bool {
    let delay = reconnect_delay().fuse();
    futures_util::pin_mut!(delay);

    loop {
        match select(delay, outbound_messages.next()).await {
            Either::Left(((), _)) => return false,
            Either::Right((Some(RealtimeCommand::SendMessage { content, .. }), next_delay)) => {
                spawn_http_message_delivery(
                    room_id.to_owned(),
                    session_id.to_owned(),
                    content,
                    on_message.clone(),
                );
                delay = next_delay;
            }
            Either::Right((Some(RealtimeCommand::Close), _)) | Either::Right((None, _)) => {
                store_realtime_state(state, RealtimeState::Closed);
                return true;
            }
        }
    }
}

fn synchronize_recent_messages(room_id: &str, session_id: &str, on_message: MessageObserver) {
    let room_id = room_id.to_owned();
    let session_id = session_id.to_owned();

    spawn(async move {
        if let Ok(response) = fetch_room_messages(&room_id, &session_id, None).await {
            for message in response.items {
                notify_message(&on_message, message);
            }
        }
    });
}

fn spawn_http_message_delivery(
    room_id: String,
    session_id: String,
    content: String,
    on_message: MessageObserver,
) {
    spawn(async move {
        if let Ok(message) = send_message(&room_id, &session_id, &content).await {
            notify_message(&on_message, message);
        }
    });
}

fn notify_message(on_message: &MessageObserver, message: MessageResponse) {
    let mut callback = on_message.lock().unwrap();
    (*callback)(message);
}

fn transition_after_disconnect(state: Arc<Mutex<RealtimeState>>) -> RealtimeState {
    match read_realtime_state(&state) {
        RealtimeState::Closed => RealtimeState::Closed,
        _ => RealtimeState::Reconnecting,
    }
}

fn store_realtime_state(state: &Arc<Mutex<RealtimeState>>, next: RealtimeState) {
    *state.lock().unwrap() = next;
}

fn read_realtime_state(state: &Arc<Mutex<RealtimeState>>) -> RealtimeState {
    *state.lock().unwrap()
}

fn reconnect_delay() -> Pin<Box<dyn Future<Output = ()> + 'static>> {
    #[cfg(target_arch = "wasm32")]
    {
        Box::pin(TimeoutFuture::new(RECONNECT_DELAY_MS))
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = RECONNECT_DELAY_MS;
        Box::pin(async {})
    }
}

fn build_send_command(content: &str) -> Result<RealtimeCommand, String> {
    let content = content.to_string();
    let wire_payload = serde_json::to_string(&ClientRealtimeCommand::SendMessage {
        content: content.clone(),
    })
    .map_err(|error| error.to_string())?;

    Ok(RealtimeCommand::SendMessage {
        wire_payload,
        content,
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
    } = event else {
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

#[cfg(test)]
mod tests {
    use super::*;
    use koko_contract::{
        ClientRealtimeCommand, GovernanceActorRequest, PromoteAdminRequest, ServerRealtimeEvent,
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
        let payload = match build_send_command("hello").unwrap() {
            RealtimeCommand::SendMessage { wire_payload, .. } => wire_payload,
            RealtimeCommand::Close => unreachable!("发送消息测试不应生成关闭命令"),
        };

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
    fn realtime_state_should_only_allow_send_when_connected() {
        assert!(!RealtimeState::Disconnected.allows_send());
        assert!(!RealtimeState::Connecting.allows_send());
        assert!(RealtimeState::Connected.allows_send());
        assert!(!RealtimeState::Reconnecting.allows_send());
        assert!(!RealtimeState::Closed.allows_send());
    }

    #[test]
    fn disconnect_transition_should_preserve_closed_state() {
        let closed = Arc::new(Mutex::new(RealtimeState::Closed));
        let connected = Arc::new(Mutex::new(RealtimeState::Connected));

        assert_eq!(transition_after_disconnect(closed), RealtimeState::Closed);
        assert_eq!(
            transition_after_disconnect(connected),
            RealtimeState::Reconnecting
        );
    }

    #[test]
    fn reconnecting_state_should_use_http_fallback() {
        assert!(should_fallback_to_http(RealtimeState::Reconnecting));
        assert!(should_fallback_to_http(RealtimeState::Connecting));
        assert!(should_fallback_to_http(RealtimeState::Disconnected));
        assert!(!should_fallback_to_http(RealtimeState::Connected));
    }

    #[test]
    fn close_should_move_client_to_closed_state() {
        let (outbound, _) = unbounded::<RealtimeCommand>();
        let client = RoomRealtimeClient {
            outbound,
            state: Arc::new(Mutex::new(RealtimeState::Connected)),
            room_id: "room-1".into(),
            session_id: "session-1".into(),
            on_message: Arc::new(Mutex::new(Box::new(|_| {}))),
        };

        client.close();

        assert_eq!(client.state(), RealtimeState::Closed);
    }

    #[test]
    fn send_command_should_keep_wire_payload_and_original_content() {
        let command = build_send_command("hello").unwrap();

        assert_eq!(
            command,
            RealtimeCommand::SendMessage {
                wire_payload: serde_json::to_string(&ClientRealtimeCommand::SendMessage {
                    content: "hello".into(),
                })
                .unwrap(),
                content: "hello".into(),
            }
        );
    }

    #[test]
    fn joined_room_client_send_message_should_delegate_to_realtime_client() {
        let (outbound, mut outbound_messages) = unbounded::<RealtimeCommand>();
        let realtime = RoomRealtimeClient {
            outbound,
            state: Arc::new(Mutex::new(RealtimeState::Connected)),
            room_id: "room-1".into(),
            session_id: "session-1".into(),
            on_message: Arc::new(Mutex::new(Box::new(|_| {}))),
        };
        let client = JoinedRoomClient {
            room_id: "room-1".into(),
            session_id: "session-1".into(),
            on_message: Arc::new(Mutex::new(Box::new(|_| {}))),
            realtime: Some(realtime),
        };

        client.send_message("hello").unwrap();

        assert_eq!(
            outbound_messages.next().now_or_never().flatten(),
            Some(RealtimeCommand::SendMessage {
                wire_payload: serde_json::to_string(&ClientRealtimeCommand::SendMessage {
                    content: "hello".into(),
                })
                .unwrap(),
                content: "hello".into(),
            })
        );
    }

    #[test]
    fn joined_room_client_close_should_be_safe_without_realtime() {
        let client = JoinedRoomClient {
            room_id: "room-1".into(),
            session_id: "session-1".into(),
            on_message: Arc::new(Mutex::new(Box::new(|_| {}))),
            realtime: None,
        };

        client.close();
    }

    #[test]
    fn joined_room_client_close_should_close_underlying_realtime_client() {
        let (outbound, _) = unbounded::<RealtimeCommand>();
        let realtime = RoomRealtimeClient {
            outbound,
            state: Arc::new(Mutex::new(RealtimeState::Connected)),
            room_id: "room-1".into(),
            session_id: "session-1".into(),
            on_message: Arc::new(Mutex::new(Box::new(|_| {}))),
        };
        let client = JoinedRoomClient {
            room_id: "room-1".into(),
            session_id: "session-1".into(),
            on_message: Arc::new(Mutex::new(Box::new(|_| {}))),
            realtime: Some(realtime.clone()),
        };

        client.close();

        assert_eq!(realtime.state(), RealtimeState::Closed);
    }
}
