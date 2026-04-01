use dioxus::prelude::*;
use reqwest::Url;
#[cfg(target_arch = "wasm32")]
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    chat::{ChatState, ConnectionState, ConversationItem, ShellScreen},
    contract::{BootstrapSession, JoinedRoomSummary, RoomSearchResult, RoomSnapshot},
    view,
};
#[cfg(any(target_arch = "wasm32", test))]
use crate::contract::{AppErrorCode, RejectedCommandKind};
#[cfg(any(target_arch = "wasm32", test))]
use crate::contract::CommandRejected;
#[cfg(target_arch = "wasm32")]
use crate::contract::{MessageCreated, RoomStreamSubscribed};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const BOOTSTRAP_PATH: &str = "/api/session/bootstrap";
pub const JOINED_ROOMS_PATH: &str = "/api/rooms";
pub const ROOM_SEARCH_PATH: &str = "/api/rooms/search";
pub const JOIN_ROOM_PATH: &str = "/api/rooms/join";
pub const ROOM_SNAPSHOT_PATH_PREFIX: &str = "/api/rooms";
#[cfg(target_arch = "wasm32")]
const LAST_OPEN_ROOM_STORAGE_KEY: &str = "koko.last_open_room_id";
#[cfg(target_arch = "wasm32")]
const REALTIME_BRIDGE_SCRIPT: &str = r#"
const { io } = await import("/assets/socket.io.esm.min.js");
let socket = null;
let activeRoomId = null;

function sendEvent(event) {
  dioxus.send(event);
}

function teardownSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  activeRoomId = null;
}

while (true) {
  const command = await dioxus.recv();
  if (command.type === "connect") {
    if (socket && activeRoomId === command.room_id) {
      continue;
    }

    teardownSocket();
    activeRoomId = command.room_id;
    socket = io({ path: "/socket.io" });
    socket.on("connect", () => {
      sendEvent({ type: "connected", room_id: activeRoomId });
      socket.emit("subscribe_room_stream", { room_id: activeRoomId });
    });
    socket.on("disconnect", (reason) => {
      sendEvent({ type: "disconnected", reason: reason ?? null });
    });
    socket.on("connect_error", (error) => {
      sendEvent({ type: "error", message: error?.message ?? String(error) });
    });
    socket.on("room_stream_subscribed", (payload) => {
      sendEvent({ type: "room_stream_subscribed", payload });
    });
    socket.on("message_accepted", (payload) => {
      sendEvent({ type: "message_accepted", payload });
    });
    socket.on("message_created", (payload) => {
      sendEvent({ type: "message_created", payload });
    });
    socket.on("command_rejected", (payload) => {
      sendEvent({ type: "command_rejected", payload });
    });
    continue;
  }

  if (command.type === "send_text_message") {
    if (!socket) {
      sendEvent({ type: "error", message: "实时连接不可用" });
      continue;
    }

    socket.emit("send_text_message", {
      room_id: command.room_id,
      body: command.body,
      client_message_id: command.client_message_id,
    });
    continue;
  }

  if (command.type === "disconnect") {
    teardownSocket();
    sendEvent({ type: "disconnected", reason: "manual_disconnect" });
  }
}
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
enum RoomAction {
    Idle,
    Open(Uuid),
    Join(String),
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RealtimeCommand {
    Connect {
        room_id: Uuid,
    },
    SendTextMessage {
        room_id: Uuid,
        body: String,
        client_message_id: Uuid,
    },
    Disconnect,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RealtimeEvent {
    Connected {
        room_id: Uuid,
    },
    Disconnected {
        reason: Option<String>,
    },
    RoomStreamSubscribed {
        payload: RoomStreamSubscribed,
    },
    MessageAccepted {
        payload: MessageCreated,
    },
    MessageCreated {
        payload: MessageCreated,
    },
    CommandRejected {
        payload: CommandRejected,
    },
    Error {
        message: String,
    },
}

pub fn bootstrap_state(session: BootstrapSession) -> ChatState {
    let mut state = ChatState::awaiting_bootstrap();
    state.apply_bootstrap_session(session);
    state
}

pub fn resolve_last_open_room_id(
    joined_rooms: &[ConversationItem],
    stored_room_id: Option<Uuid>,
) -> Option<Uuid> {
    let stored_room_id = stored_room_id?;
    joined_rooms
        .iter()
        .any(|room| room.room_id == stored_room_id)
        .then_some(stored_room_id)
}

pub fn should_enter_join_flow(joined_rooms: &[ConversationItem]) -> bool {
    joined_rooms.is_empty()
}

pub fn select_initial_screen(
    joined_rooms: &[ConversationItem],
    last_open_room_id: Option<Uuid>,
) -> ShellScreen {
    if should_enter_join_flow(joined_rooms) {
        return ShellScreen::JoinByCode;
    }

    if resolve_last_open_room_id(joined_rooms, last_open_room_id).is_some() {
        return ShellScreen::Chat;
    }

    ShellScreen::ConversationList
}

pub fn normalize_room_code_query(query: &str) -> String {
    query.trim().to_ascii_uppercase()
}

pub fn should_trigger_room_search(query: &str) -> bool {
    !normalize_room_code_query(query).is_empty()
}

pub fn resolve_room_snapshot_path(room_id: Uuid) -> String {
    format!("{ROOM_SNAPSHOT_PATH_PREFIX}/{room_id}/snapshot")
}

pub fn resolve_join_room_path() -> &'static str {
    JOIN_ROOM_PATH
}

pub fn resolve_joined_rooms_path() -> &'static str {
    JOINED_ROOMS_PATH
}

pub fn resolve_room_search_path() -> &'static str {
    ROOM_SEARCH_PATH
}

fn joined_room_summaries_to_conversation_items(
    rooms: &[JoinedRoomSummary],
) -> Vec<ConversationItem> {
    rooms
        .iter()
        .map(|room| ConversationItem {
            room_id: room.room_id,
            room_code: room.room_code.clone(),
            display_title: room.display_title.clone(),
            latest_preview: room.latest_preview.clone(),
            latest_message_at: room.latest_message_at,
            show_unread_placeholder: true,
        })
        .collect()
}

pub(crate) fn resolve_shell_api_url(
    browser_location: &str,
    contract_path: &str,
) -> Result<String, String> {
    let browser_location = browser_location.trim();
    if browser_location.is_empty() {
        return Err("浏览器地址不能为空".to_string());
    }

    let contract_path = contract_path.trim();
    if contract_path.is_empty() {
        return Err("接口路径不能为空".to_string());
    }

    let base = Url::parse(browser_location).map_err(|error| error.to_string())?;
    let resolved = base
        .join(contract_path)
        .map_err(|error| error.to_string())?;

    Ok(resolved.to_string())
}

pub(crate) fn resolve_shell_api_url_with_query(
    browser_location: &str,
    contract_path: &str,
    query_key: &str,
    query_value: &str,
) -> Result<String, String> {
    let resolved = resolve_shell_api_url(browser_location, contract_path)?;
    let mut url = Url::parse(&resolved).map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair(query_key, query_value);
    Ok(url.to_string())
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn browser_location() -> Result<String, String> {
    web_sys::window()
        .ok_or_else(|| "Browser window unavailable".to_string())?
        .location()
        .href()
        .map_err(|error| format!("{error:?}"))
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn browser_location() -> Result<String, String> {
    Err("Browser location unavailable on native target".to_string())
}

async fn load_bootstrap_session() -> Result<BootstrapSession, String> {
    let url = resolve_shell_api_url(&browser_location()?, BOOTSTRAP_PATH)?;

    reqwest::Client::new()
        .post(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<BootstrapSession>()
        .await
        .map_err(|error| error.to_string())
}

async fn load_joined_rooms() -> Result<Vec<JoinedRoomSummary>, String> {
    let url = resolve_shell_api_url(&browser_location()?, JOINED_ROOMS_PATH)?;

    reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Vec<JoinedRoomSummary>>()
        .await
        .map_err(|error| error.to_string())
}

async fn load_room_search_results(query: &str) -> Result<Vec<RoomSearchResult>, String> {
    let normalized_query = normalize_room_code_query(query);
    if normalized_query.is_empty() {
        return Ok(Vec::new());
    }

    let url = resolve_shell_api_url_with_query(
        &browser_location()?,
        ROOM_SEARCH_PATH,
        "query",
        &normalized_query,
    )?;

    reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Vec<RoomSearchResult>>()
        .await
        .map_err(|error| error.to_string())
}

async fn load_room_snapshot(room_id: Uuid) -> Result<RoomSnapshot, String> {
    let url = resolve_shell_api_url(&browser_location()?, &resolve_room_snapshot_path(room_id))?;

    reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<RoomSnapshot>()
        .await
        .map_err(|error| error.to_string())
}

async fn join_room_by_code(room_code: &str) -> Result<RoomSnapshot, String> {
    let room_code = normalize_room_code_query(room_code);
    if room_code.is_empty() {
        return Err("Room code required".to_string());
    }

    let url = resolve_shell_api_url(&browser_location()?, JOIN_ROOM_PATH)?;
    let body = serde_json::json!({ "room_code": room_code });

    reqwest::Client::new()
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<RoomSnapshot>()
        .await
        .map_err(|error| error.to_string())
}

pub fn parse_stored_room_id(raw: Option<&str>) -> Option<Uuid> {
    let raw = raw?.trim();
    (!raw.is_empty())
        .then(|| Uuid::parse_str(raw).ok())
        .flatten()
}

#[cfg(target_arch = "wasm32")]
fn local_storage() -> Result<web_sys::Storage, String> {
    web_sys::window()
        .ok_or_else(|| "Browser window unavailable".to_string())?
        .local_storage()
        .map_err(|error| format!("{error:?}"))?
        .ok_or_else(|| "Browser localStorage unavailable".to_string())
}

pub fn read_last_open_room_id() -> Option<Uuid> {
    #[cfg(target_arch = "wasm32")]
    {
        let raw = local_storage()
            .ok()?
            .get_item(LAST_OPEN_ROOM_STORAGE_KEY)
            .ok()
            .flatten();
        parse_stored_room_id(raw.as_deref())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        None
    }
}

pub fn write_last_open_room_id(room_id: Option<Uuid>) {
    #[cfg(target_arch = "wasm32")]
    if let Ok(storage) = local_storage() {
        match room_id {
            Some(room_id) => {
                let _ = storage.set_item(LAST_OPEN_ROOM_STORAGE_KEY, &room_id.to_string());
            }
            None => {
                let _ = storage.remove_item(LAST_OPEN_ROOM_STORAGE_KEY);
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = room_id;
    }
}

fn set_shell_error(mut shell_error: Signal<Option<String>>, message: Option<String>) {
    if shell_error() != message {
        shell_error.set(message);
    }
}

#[cfg(target_arch = "wasm32")]
fn bump_refresh(mut joined_rooms_refresh: Signal<u64>) {
    joined_rooms_refresh.set(joined_rooms_refresh() + 1);
}

fn remove_pending_send(
    mut pending_send_ids: Signal<Vec<Uuid>>,
    client_message_id: Uuid,
) -> Option<Uuid> {
    let mut next_pending_send_ids = pending_send_ids();
    let position = next_pending_send_ids
        .iter()
        .position(|pending_id| *pending_id == client_message_id)?;
    let removed = next_pending_send_ids.remove(position);
    pending_send_ids.set(next_pending_send_ids);
    Some(removed)
}

#[cfg(any(target_arch = "wasm32", test))]
fn rejection_message(code: AppErrorCode) -> String {
    match code {
        AppErrorCode::InvalidSession => "实时会话已失效".to_string(),
        AppErrorCode::MembershipRequired => "你已不在该房间中".to_string(),
        AppErrorCode::InvalidRoomCode => "房间码不合法".to_string(),
        AppErrorCode::InvalidMessageBody => "消息内容不合法".to_string(),
        AppErrorCode::InvalidAdminToken => "管理员令牌无效".to_string(),
        AppErrorCode::AdminSessionRequired => "管理员会话不存在".to_string(),
        AppErrorCode::AdminSessionExpired => "管理员会话已过期".to_string(),
        AppErrorCode::AdminSessionReplaced => "管理员会话已被替换".to_string(),
        AppErrorCode::Internal => "实时指令执行失败".to_string(),
    }
}

#[cfg(any(target_arch = "wasm32", test))]
fn rejected_pending_message_id(payload: &CommandRejected) -> Option<Uuid> {
    (payload.command == RejectedCommandKind::SendTextMessage)
        .then_some(payload.client_message_id)
        .flatten()
}

#[cfg(any(target_arch = "wasm32", test))]
fn rejection_resets_subscription(payload: &CommandRejected) -> bool {
    payload.command == RejectedCommandKind::SubscribeRoomStream
}

fn resolve_shell_banner_message(
    bootstrap_error: Option<String>,
    shell_error: Option<String>,
) -> Option<String> {
    bootstrap_error.or(shell_error)
}

#[cfg(target_arch = "wasm32")]
fn spawn_realtime_bridge(
    mut state: Signal<ChatState>,
    shell_error: Signal<Option<String>>,
    mut realtime_target_room: Signal<Option<Uuid>>,
    mut realtime_active_room: Signal<Option<Uuid>>,
    pending_send_ids: Signal<Vec<Uuid>>,
    joined_rooms_refresh: Signal<u64>,
) -> document::Eval {
    let bridge = document::eval(REALTIME_BRIDGE_SCRIPT);
    let mut bridge_events = bridge;

    spawn(async move {
        loop {
            let event = match bridge_events.recv::<RealtimeEvent>().await {
                Ok(event) => event,
                Err(error) => {
                    realtime_active_room.set(None);
                    if state().room_id().is_some() {
                        let mut next_state = state();
                        next_state.set_connection(ConnectionState::Offline);
                        state.set(next_state);
                    }
                    set_shell_error(
                        shell_error,
                        Some(format!("实时连接桥已结束：{error}")),
                    );
                    break;
                }
            };

            match event {
                RealtimeEvent::Connected { room_id } => {
                    if state().room_id() == Some(room_id) {
                        let mut next_state = state();
                        next_state.set_connection(ConnectionState::Connecting);
                        state.set(next_state);
                    }
                    set_shell_error(shell_error, None);
                }
                RealtimeEvent::Disconnected { reason } => {
                    realtime_active_room.set(None);
                    if state().room_id().is_some() {
                        let mut next_state = state();
                        next_state.set_connection(ConnectionState::Offline);
                        state.set(next_state);
                    }
                    if !matches!(reason.as_deref(), Some("manual_disconnect" | "switch_room")) {
                        set_shell_error(
                            shell_error,
                            reason.map(|reason| format!("实时连接已断开：{reason}")),
                        );
                    }
                }
                RealtimeEvent::RoomStreamSubscribed { payload } => {
                    if state().room_id() != Some(payload.room_id) {
                        continue;
                    }

                    let mut next_state = state();
                    next_state.start_room_subscription(payload.room_id);
                    state.set(next_state);
                    set_shell_error(shell_error, None);

                    let mut refill_state = state;
                    let refill_shell_error = shell_error;
                    spawn(async move {
                        match load_room_snapshot(payload.room_id).await {
                            Ok(snapshot) => {
                                let mut next_state = refill_state();
                                next_state.apply_subscription_refill_snapshot(snapshot);
                                refill_state.set(next_state);
                            }
                            Err(error) => set_shell_error(
                                refill_shell_error,
                                Some(format!("补拉房间快照失败：{error}")),
                            ),
                        }
                    });
                }
                RealtimeEvent::MessageAccepted { payload } => {
                    if let Some(client_message_id) = payload.client_message_id {
                        let _ = remove_pending_send(pending_send_ids, client_message_id);
                    }
                    let mut next_state = state();
                    next_state.confirm_message(payload);
                    state.set(next_state);
                    bump_refresh(joined_rooms_refresh);
                    set_shell_error(shell_error, None);
                }
                RealtimeEvent::MessageCreated { payload } => {
                    let mut next_state = state();
                    next_state.confirm_message(payload);
                    state.set(next_state);
                    bump_refresh(joined_rooms_refresh);
                    set_shell_error(shell_error, None);
                }
                RealtimeEvent::CommandRejected { payload } => {
                    if let Some(client_message_id) = rejected_pending_message_id(&payload) {
                        let _ = remove_pending_send(pending_send_ids, client_message_id);
                        let mut next_state = state();
                        next_state.reject_pending(client_message_id);
                        state.set(next_state);
                    }
                    if rejection_resets_subscription(&payload) {
                        realtime_target_room.set(None);
                        realtime_active_room.set(None);
                        if state().room_id() == payload.room_id {
                            let mut next_state = state();
                            next_state.set_connection(ConnectionState::Offline);
                            state.set(next_state);
                        }
                    }
                    set_shell_error(shell_error, Some(rejection_message(payload.code)));
                }
                RealtimeEvent::Error { message } => {
                    realtime_active_room.set(None);
                    if state().room_id().is_some() {
                        let mut next_state = state();
                        next_state.set_connection(ConnectionState::Offline);
                        state.set(next_state);
                    }
                    set_shell_error(shell_error, Some(format!("实时连接出错：{message}")));
                }
            }
        }
    });

    bridge
}

#[component]
pub fn App() -> Element {
    let mut state = use_signal(ChatState::awaiting_bootstrap);
    let mut session_id = use_signal(Uuid::nil);
    let mut room_search_query = use_signal(String::new);
    let mut room_action = use_signal(|| RoomAction::Idle);
    let mut joined_rooms_refresh = use_signal(|| 0_u64);
    let mut initial_rooms_applied = use_signal(|| false);
    let shell_error = use_signal(|| None::<String>);
    let mut pending_send_ids = use_signal(Vec::<Uuid>::new);
    let mut realtime_target_room = use_signal(|| None::<Uuid>);
    let mut realtime_active_room = use_signal(|| None::<Uuid>);
    #[allow(unused_variables, unused_mut)]
    let mut realtime_bridge = use_signal(|| None::<document::Eval>);
    let bootstrap_session = use_resource(|| async move { load_bootstrap_session().await });

    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        {
            if realtime_bridge().is_none() {
                realtime_bridge.set(Some(spawn_realtime_bridge(
                    state,
                    shell_error,
                    realtime_target_room,
                    realtime_active_room,
                    pending_send_ids,
                    joined_rooms_refresh,
                )));
            }
        }
    });

    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        {
            let Some(bridge) = realtime_bridge() else {
                return;
            };
            let target_room = realtime_target_room();
            if realtime_active_room() == target_room {
                return;
            }

            let command = match target_room {
                Some(room_id) => RealtimeCommand::Connect { room_id },
                None => RealtimeCommand::Disconnect,
            };

            match bridge.send(command) {
                Ok(()) => realtime_active_room.set(target_room),
                Err(error) => set_shell_error(
                    shell_error,
                    Some(format!("发送实时指令失败：{error}")),
                ),
            }
        }
    });

    if let Some(Ok(session)) = &*bootstrap_session.read_unchecked() {
        let session = session.clone();
        if session_id() != session.session_id {
            session_id.set(session.session_id);
            initial_rooms_applied.set(false);
            room_action.set(RoomAction::Idle);
            room_search_query.set(String::new());
            pending_send_ids.set(Vec::new());
            realtime_target_room.set(None);
            realtime_active_room.set(None);
            set_shell_error(shell_error, None);
        }

        if state().session_id() != session.session_id {
            state.set(bootstrap_state(session));
        }
    }

    let joined_rooms = use_resource(move || async move {
        let session_id = session_id();
        let _ = joined_rooms_refresh();
        if session_id.is_nil() {
            Ok(Vec::<JoinedRoomSummary>::new())
        } else {
            load_joined_rooms().await
        }
    });

    if let Some(Ok(rooms)) = &*joined_rooms.read_unchecked() {
        let mut next_state = state();
        let next_joined_rooms = joined_room_summaries_to_conversation_items(rooms);
        let mut changed = false;

        if next_state.joined_rooms() != next_joined_rooms.as_slice() {
            next_state.apply_joined_rooms(rooms.clone());
            changed = true;
        }

        if !initial_rooms_applied() {
            if let Some(room_id) =
                resolve_last_open_room_id(next_state.joined_rooms(), read_last_open_room_id())
            {
                room_action.set(RoomAction::Open(room_id));
                next_state.restore_last_open_room(Some(room_id));
                next_state.set_connection(ConnectionState::Connecting);
                changed = true;
            }
            initial_rooms_applied.set(true);
        }

        if changed {
            state.set(next_state);
        }
        set_shell_error(shell_error, None);
    } else if let Some(Err(error)) = &*joined_rooms.read_unchecked() {
        set_shell_error(
            shell_error,
            Some(format!("加载已加入房间失败：{error}")),
        );
    }

    let search_results = use_resource(move || async move {
        let session_id = session_id();
        let query = room_search_query();

        if session_id.is_nil() || !should_trigger_room_search(&query) {
            Ok(Vec::<RoomSearchResult>::new())
        } else {
            load_room_search_results(&query).await
        }
    });

    if let Some(Ok(results)) = &*search_results.read_unchecked() {
        let mut next_state = state();
        let mut changed = false;

        if next_state.search_query() != room_search_query() {
            next_state.set_search_query(&room_search_query());
            changed = true;
        }
        if next_state.search_results() != results.as_slice() {
            next_state.apply_search_results(results.clone());
            changed = true;
        }
        if changed {
            state.set(next_state);
        }
    } else if let Some(Err(error)) = &*search_results.read_unchecked() {
        set_shell_error(
            shell_error,
            Some(format!("搜索房间失败：{error}")),
        );
    }

    let room_resolution = use_resource(move || async move {
        let session_id = session_id();
        let action = room_action();

        if session_id.is_nil() {
            return Ok(None);
        }

        match action {
            RoomAction::Idle => Ok(None),
            RoomAction::Open(room_id) => load_room_snapshot(room_id).await.map(Some),
            RoomAction::Join(room_code) => join_room_by_code(&room_code).await.map(Some),
        }
    });

    if let Some(Ok(Some(snapshot))) = &*room_resolution.read_unchecked() {
        let action = room_action();
        if action != RoomAction::Idle {
            let mut next_state = state();
            if matches!(action, RoomAction::Join(_)) {
                joined_rooms_refresh += 1;
                room_search_query.set(String::new());
                next_state.set_search_query("");
                next_state.apply_search_results(Vec::new());
            }
            next_state.open_room_from_snapshot(snapshot.clone());
            next_state.set_connection(ConnectionState::Connecting);
            state.set(next_state);
            pending_send_ids.set(Vec::new());
            realtime_target_room.set(Some(snapshot.room_id));
            write_last_open_room_id(Some(snapshot.room_id));
            room_action.set(RoomAction::Idle);
            set_shell_error(shell_error, None);
        }
    } else if let Some(Err(error)) = &*room_resolution.read_unchecked() {
        if room_action() != RoomAction::Idle {
            let mut next_state = state();
            next_state.set_connection(ConnectionState::Offline);
            state.set(next_state);
            room_action.set(RoomAction::Idle);
            realtime_target_room.set(None);
            set_shell_error(shell_error, Some(format!("打开房间失败：{error}")));
        }
    }

    let chat_state = state();
    let chat_draft = chat_state.draft().to_string();
    let bootstrap_error = match &*bootstrap_session.read_unchecked() {
        Some(Err(error)) => Some(format!("初始化失败：{error}")),
        _ => None,
    };
    let current_shell_error = shell_error();
    let error_message = resolve_shell_banner_message(bootstrap_error, current_shell_error);

    rsx! {
        Title { "Koko 聊天" }
        Stylesheet { href: asset!("/assets/theme.css") }
        div { class: "koko-web-shell",
            if let Some(error) = error_message {
                div { class: "koko-web-shell__error",
                    "{error}"
                }
            }
            view::ChatPage {
                state: chat_state,
                on_back_to_list: move |_| {
                    room_action.set(RoomAction::Idle);
                    realtime_target_room.set(None);
                    pending_send_ids.set(Vec::new());
                    let mut next_state = state();
                    next_state.restore_last_open_room(None);
                    next_state.set_search_query("");
                    next_state.apply_search_results(Vec::new());
                    room_search_query.set(String::new());
                    set_shell_error(shell_error, None);
                    state.set(next_state);
                },
                on_room_selected: move |room_id: Uuid| {
                    room_action.set(RoomAction::Open(room_id));
                    realtime_target_room.set(None);
                    pending_send_ids.set(Vec::new());
                    let mut next_state = state();
                    next_state.restore_last_open_room(Some(room_id));
                    next_state.set_connection(ConnectionState::Connecting);
                    set_shell_error(shell_error, None);
                    state.set(next_state);
                },
                on_search_input: move |query: String| {
                    room_search_query.set(query.clone());
                    let mut next_state = state();
                    next_state.show_join_by_code();
                    next_state.set_search_query(&query);
                    if !should_trigger_room_search(&query) {
                        next_state.apply_search_results(Vec::new());
                    }
                    set_shell_error(shell_error, None);
                    state.set(next_state);
                },
                on_search_result_selected: move |result: RoomSearchResult| {
                    set_shell_error(shell_error, None);
                    pending_send_ids.set(Vec::new());
                    realtime_target_room.set(None);
                    if result.is_joined {
                        room_action.set(RoomAction::Open(result.room_id));
                        let mut next_state = state();
                        next_state.restore_last_open_room(Some(result.room_id));
                        next_state.set_connection(ConnectionState::Connecting);
                        state.set(next_state);
                    } else {
                        room_action.set(RoomAction::Join(result.room_code.clone()));
                    }
                },
                draft: chat_draft,
                on_draft_input: move |draft: String| {
                    let mut next_state = state();
                    next_state.set_draft(&draft);
                    state.set(next_state);
                },
                on_send_message: move |_| {
                    let room_id = state().room_id();
                    let Some(room_id) = room_id else {
                        return;
                    };

                    let draft = state().draft().to_string();
                    if draft.trim().is_empty() {
                        return;
                    }

                    let session_id = state().session_id();
                    let mut next_state = state();
                    let client_message_id =
                        next_state.enqueue_pending(room_id, session_id, &draft);
                    next_state.clear_draft();
                    state.set(next_state);

                    let mut next_pending_send_ids = pending_send_ids();
                    next_pending_send_ids.push(client_message_id);
                    pending_send_ids.set(next_pending_send_ids);
                    set_shell_error(shell_error, None);

                    #[cfg(target_arch = "wasm32")]
                    {
                        let Some(bridge) = realtime_bridge() else {
                            let mut next_state = state();
                            next_state.reject_pending(client_message_id);
                            state.set(next_state);
                            set_shell_error(
                                shell_error,
                                Some("实时连接桥不可用".to_string()),
                            );
                            let _ = remove_pending_send(pending_send_ids, client_message_id);
                            return;
                        };

                        if let Err(error) = bridge.send(RealtimeCommand::SendTextMessage {
                            room_id,
                            body: draft.trim().to_string(),
                            client_message_id,
                        }) {
                            let mut next_state = state();
                            next_state.reject_pending(client_message_id);
                            state.set(next_state);
                            set_shell_error(
                                shell_error,
                                Some(format!("发送实时消息失败：{error}")),
                            );
                            let _ = remove_pending_send(pending_send_ids, client_message_id);
                        }
                    }

                    #[cfg(not(target_arch = "wasm32"))]
                    {
                        let mut next_state = state();
                        next_state.reject_pending(client_message_id);
                        state.set(next_state);
                        set_shell_error(
                            shell_error,
                            Some("实时消息发送仅在 wasm 环境可用".to_string()),
                        );
                        let _ = remove_pending_send(pending_send_ids, client_message_id);
                    }
                },
            }
        }
    }
}

pub fn app() -> Element {
    rsx! { App {} }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_room_code_query, parse_stored_room_id, resolve_join_room_path,
        rejected_pending_message_id, rejection_message, rejection_resets_subscription,
        resolve_shell_banner_message,
        resolve_joined_rooms_path, resolve_room_search_path, resolve_room_snapshot_path,
        resolve_shell_api_url, resolve_shell_api_url_with_query, should_trigger_room_search,
    };
    use crate::contract::{AppErrorCode, CommandRejected, RejectedCommandKind};
    use uuid::Uuid;

    #[test]
    fn resolve_shell_api_url_joins_same_origin_contract_path() {
        let url = resolve_shell_api_url("https://example.com/app", "/api/session/bootstrap")
            .expect("same-origin api path should resolve into an absolute URL");

        assert_eq!(url, "https://example.com/api/session/bootstrap");
    }

    #[test]
    fn resolve_shell_api_url_keeps_room_queries_on_same_origin() {
        let rooms_url = resolve_shell_api_url("https://example.com/rooms/a1234", "/api/rooms")
            .expect("rooms contract should stay on the same origin");
        let search_url = resolve_shell_api_url(
            "https://example.com/rooms/a1234",
            "/api/rooms/search?query=a12",
        )
        .expect("search contract should stay on the same origin");

        assert_eq!(rooms_url, "https://example.com/api/rooms");
        assert_eq!(search_url, "https://example.com/api/rooms/search?query=a12");
    }

    #[test]
    fn resolve_shell_api_url_with_query_appends_query_pairs() {
        let url = resolve_shell_api_url_with_query(
            "https://example.com/rooms/a1234",
            "/api/rooms/search",
            "query",
            "A12",
        )
        .expect("query url should stay on the same origin");

        assert_eq!(url, "https://example.com/api/rooms/search?query=A12");
    }

    #[test]
    fn normalize_room_code_query_trims_and_uppercases() {
        assert_eq!(normalize_room_code_query("  a12b4  "), "A12B4");
    }

    #[test]
    fn normalize_room_code_query_keeps_empty_queries_empty() {
        assert_eq!(normalize_room_code_query("   "), "");
    }

    #[test]
    fn should_trigger_room_search_rejects_blank_queries() {
        assert!(!should_trigger_room_search("   "));
    }

    #[test]
    fn should_trigger_room_search_accepts_non_blank_queries() {
        assert!(should_trigger_room_search("a12"));
    }

    #[test]
    fn parse_stored_room_id_accepts_valid_uuid() {
        let room_id = Uuid::from_u128(77);

        assert_eq!(
            parse_stored_room_id(Some(&room_id.to_string())),
            Some(room_id)
        );
    }

    #[test]
    fn parse_stored_room_id_rejects_blank_and_invalid_values() {
        assert_eq!(parse_stored_room_id(Some("  ")), None);
        assert_eq!(parse_stored_room_id(Some("not-a-uuid")), None);
        assert_eq!(parse_stored_room_id(None), None);
    }

    #[test]
    fn resolve_room_snapshot_path_keeps_snapshot_url_stable() {
        let room_id = Uuid::from_u128(42);

        assert_eq!(
            resolve_room_snapshot_path(room_id),
            "/api/rooms/00000000-0000-0000-0000-00000000002a/snapshot"
        );
    }

    #[test]
    fn resolve_join_and_search_paths_stay_stable() {
        assert_eq!(resolve_join_room_path(), "/api/rooms/join");
        assert_eq!(resolve_joined_rooms_path(), "/api/rooms");
        assert_eq!(resolve_room_search_path(), "/api/rooms/search");
    }

    #[test]
    fn resolve_shell_api_url_validation_copy_is_localized() {
        assert_eq!(
            resolve_shell_api_url("", "/api/session/bootstrap").unwrap_err(),
            "浏览器地址不能为空"
        );
        assert_eq!(
            resolve_shell_api_url("https://example.com/app", "").unwrap_err(),
            "接口路径不能为空"
        );
    }

    #[test]
    fn rejection_message_keeps_realtime_copy_stable() {
        assert_eq!(
            rejection_message(AppErrorCode::MembershipRequired),
            "你已不在该房间中"
        );
        assert_eq!(
            rejection_message(AppErrorCode::InvalidMessageBody),
            "消息内容不合法"
        );
    }

    #[test]
    fn send_rejection_preserves_pending_message_identity() {
        let client_message_id = Uuid::from_u128(1);
        let payload = CommandRejected {
            code: AppErrorCode::InvalidMessageBody,
            command: RejectedCommandKind::SendTextMessage,
            room_id: Some(Uuid::from_u128(2)),
            client_message_id: Some(client_message_id),
        };

        assert_eq!(rejected_pending_message_id(&payload), Some(client_message_id));
        assert!(!rejection_resets_subscription(&payload));
    }

    #[test]
    fn subscribe_rejection_resets_subscription_without_touching_pending_queue() {
        let payload = CommandRejected {
            code: AppErrorCode::MembershipRequired,
            command: RejectedCommandKind::SubscribeRoomStream,
            room_id: Some(Uuid::from_u128(3)),
            client_message_id: None,
        };

        assert_eq!(rejected_pending_message_id(&payload), None);
        assert!(rejection_resets_subscription(&payload));
    }

    #[test]
    fn shell_banner_prefers_bootstrap_failure_over_shell_error() {
        let banner = resolve_shell_banner_message(
            Some("初始化失败：nope".to_string()),
            Some("实时连接失败".to_string()),
        );

        assert_eq!(banner, Some("初始化失败：nope".to_string()));
    }

    #[test]
    fn shell_banner_uses_shell_error_when_bootstrap_is_clean() {
        let banner = resolve_shell_banner_message(None, Some("实时连接失败".to_string()));

        assert_eq!(banner, Some("实时连接失败".to_string()));
        assert_eq!(resolve_shell_banner_message(None, None), None);
    }
}
