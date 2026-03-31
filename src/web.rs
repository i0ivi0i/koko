use dioxus::prelude::*;
use reqwest::Url;
use uuid::Uuid;

use crate::{
    chat::{ChatState, ConnectionState, ConversationItem, ShellScreen},
    contract::{BootstrapSession, JoinedRoomSummary, RoomSearchResult, RoomSnapshot},
    view,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const BOOTSTRAP_PATH: &str = "/api/session/bootstrap";
pub const JOINED_ROOMS_PATH: &str = "/api/rooms";
pub const ROOM_SEARCH_PATH: &str = "/api/rooms/search";
pub const JOIN_ROOM_PATH: &str = "/api/rooms/join";
pub const ROOM_SNAPSHOT_PATH_PREFIX: &str = "/api/rooms";
#[cfg(target_arch = "wasm32")]
const LAST_OPEN_ROOM_STORAGE_KEY: &str = "koko.last_open_room_id";

#[derive(Debug, Clone, PartialEq, Eq)]
enum RoomAction {
    Idle,
    Open(Uuid),
    Join(String),
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
        return Err("Browser location required".to_string());
    }

    let contract_path = contract_path.trim();
    if contract_path.is_empty() {
        return Err("Contract path required".to_string());
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

#[component]
pub fn App() -> Element {
    let mut state = use_signal(ChatState::awaiting_bootstrap);
    let mut session_id = use_signal(Uuid::nil);
    let mut room_search_query = use_signal(String::new);
    let mut room_action = use_signal(|| RoomAction::Idle);
    let mut joined_rooms_refresh = use_signal(|| 0_u64);
    let mut initial_rooms_applied = use_signal(|| false);
    let shell_error = use_signal(|| None::<String>);
    let bootstrap_session = use_resource(|| async move { load_bootstrap_session().await });

    if let Some(Ok(session)) = &*bootstrap_session.read_unchecked() {
        let session = session.clone();
        if session_id() != session.session_id {
            session_id.set(session.session_id);
            initial_rooms_applied.set(false);
            room_action.set(RoomAction::Idle);
            room_search_query.set(String::new());
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
            Some(format!("Failed to load joined rooms: {error}")),
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
            Some(format!("Failed to search rooms: {error}")),
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
            state.set(next_state);
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
            set_shell_error(shell_error, Some(format!("Failed to open room: {error}")));
        }
    }

    let chat_state = state();
    let bootstrap_error = match &*bootstrap_session.read_unchecked() {
        Some(Err(error)) => Some(format!("Bootstrap failed: {error}")),
        _ => None,
    };
    let current_shell_error = shell_error();
    let error_message = bootstrap_error.or(current_shell_error);

    rsx! {
        Title { "koko" }
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
        resolve_joined_rooms_path, resolve_room_search_path, resolve_room_snapshot_path,
        resolve_shell_api_url, resolve_shell_api_url_with_query, should_trigger_room_search,
    };
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
}
