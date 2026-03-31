use dioxus::prelude::*;
use reqwest::Url;
use uuid::Uuid;

use crate::{
    chat::{ChatState, ConversationItem, ShellScreen},
    contract::BootstrapSession,
    view,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const BOOTSTRAP_PATH: &str = "/api/session/bootstrap";

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

#[component]
pub fn App() -> Element {
    let mut state = use_signal(ChatState::awaiting_bootstrap);
    let bootstrap_session = use_resource(|| async move { load_bootstrap_session().await });
    let bootstrap_error = match &*bootstrap_session.read_unchecked() {
        Some(Err(error)) => Some(error.clone()),
        _ => None,
    };

    if let Some(Ok(session)) = &*bootstrap_session.read_unchecked() {
        let session = session.clone();
        if state().session_id() != session.session_id {
            state.set(bootstrap_state(session));
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
    use super::resolve_shell_api_url;

    #[test]
    fn resolve_shell_api_url_joins_same_origin_contract_path() {
        let url = resolve_shell_api_url("https://example.com/app", "/api/session/bootstrap")
            .expect("same-origin api path should resolve into an absolute URL");

        assert_eq!(url, "https://example.com/api/session/bootstrap");
    }
}
