use dioxus::prelude::*;
use reqwest::Url;
use uuid::Uuid;

use crate::{
    chat::{ChatState, ConversationItem, ShellScreen},
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

async fn load_joined_rooms(session_id: Uuid) -> Result<Vec<JoinedRoomSummary>, String> {
    let url = resolve_shell_api_url(&browser_location()?, JOINED_ROOMS_PATH)?;

    reqwest::Client::new()
        .get(url)
        .header("x-session-id", session_id.to_string())
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Vec<JoinedRoomSummary>>()
        .await
        .map_err(|error| error.to_string())
}

async fn load_room_search_results(
    session_id: Uuid,
    query: &str,
) -> Result<Vec<RoomSearchResult>, String> {
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
        .header("x-session-id", session_id.to_string())
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Vec<RoomSearchResult>>()
        .await
        .map_err(|error| error.to_string())
}

async fn load_room_snapshot(session_id: Uuid, room_id: Uuid) -> Result<RoomSnapshot, String> {
    let url = resolve_shell_api_url(&browser_location()?, &resolve_room_snapshot_path(room_id))?;

    reqwest::Client::new()
        .get(url)
        .header("x-session-id", session_id.to_string())
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<RoomSnapshot>()
        .await
        .map_err(|error| error.to_string())
}

pub fn read_last_open_room_id() -> Option<Uuid> {
    None
}

pub fn write_last_open_room_id(_room_id: Option<Uuid>) {}

#[component]
pub fn App() -> Element {
    let mut state = use_signal(ChatState::awaiting_bootstrap);
    let mut session_id = use_signal(Uuid::nil);
    let mut active_room_id = use_signal(|| None::<Uuid>);
    let search_query = use_signal(String::new);
    let bootstrap_session = use_resource(|| async move { load_bootstrap_session().await });
    let bootstrap_error = match &*bootstrap_session.read_unchecked() {
        Some(Err(error)) => Some(error.clone()),
        _ => None,
    };

    if let Some(Ok(session)) = &*bootstrap_session.read_unchecked() {
        let session = session.clone();
        if session_id() != session.session_id {
            session_id.set(session.session_id);
        }

        if state().session_id() != session.session_id {
            state.set(bootstrap_state(session));
        }
    }

    let joined_rooms = use_resource(move || async move {
        let session_id = session_id();
        if session_id.is_nil() {
            Ok(Vec::<JoinedRoomSummary>::new())
        } else {
            load_joined_rooms(session_id).await
        }
    });

    if let Some(Ok(rooms)) = &*joined_rooms.read_unchecked() {
        let restored_room_id = resolve_last_open_room_id(
            state().joined_rooms(),
            read_last_open_room_id(),
        );
        let mut next_state = state();
        let next_joined_rooms = joined_room_summaries_to_conversation_items(rooms);

        if next_state.joined_rooms() != next_joined_rooms.as_slice() {
            next_state.apply_joined_rooms(rooms.clone());
        }

        if let Some(room_id) = restored_room_id {
            if active_room_id() != Some(room_id) {
                active_room_id.set(Some(room_id));
            }

            next_state.restore_last_open_room(Some(room_id));
        }

        if next_state != state() {
            state.set(next_state);
        }
    }

    let search_results = use_resource(move || async move {
        let session_id = session_id();
        let query = search_query();

        if session_id.is_nil() || !should_trigger_room_search(&query) {
            Ok(Vec::<RoomSearchResult>::new())
        } else {
            load_room_search_results(session_id, &query).await
        }
    });

    if let Some(Ok(results)) = &*search_results.read_unchecked() {
        let mut next_state = state();
        if next_state.search_query() != search_query() {
            next_state.set_search_query(&search_query());
        }
        if next_state.search_results() != results.as_slice() {
            next_state.apply_search_results(results.clone());
        }
        if next_state != state() {
            state.set(next_state);
        }
    }

    let room_snapshot = use_resource(move || async move {
        let session_id = session_id();
        let room_id = active_room_id();

        match (session_id.is_nil(), room_id) {
            (true, _) | (_, None) => Ok(None),
            (false, Some(room_id)) => load_room_snapshot(session_id, room_id).await.map(Some),
        }
    });

    if let Some(Ok(Some(snapshot))) = &*room_snapshot.read_unchecked() {
        if state().room_id() != Some(snapshot.room_id) {
            let mut next_state = state();
            next_state.enter_room(snapshot.clone());
            state.set(next_state);
        }
    }

    let chat_state = state();

    rsx! {
        Title { "koko" }
        Stylesheet { href: asset!("/assets/theme.css") }
        div { class: "koko-web-shell",
            if let Some(error) = bootstrap_error {
                div { class: "koko-web-shell__error",
                    "Bootstrap failed: {error}"
                }
            }
            view::ChatPage { state: chat_state }
        }
    }
}

pub fn app() -> Element {
    rsx! { App {} }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_room_code_query, resolve_join_room_path, resolve_joined_rooms_path,
        resolve_room_search_path, resolve_room_snapshot_path, resolve_shell_api_url,
        resolve_shell_api_url_with_query, should_trigger_room_search,
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
