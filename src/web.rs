use dioxus::prelude::*;

use crate::{chat::ChatState, contract::BootstrapSession, view};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const THEME_PATH: &str = "/assets/theme.css";
pub const BOOTSTRAP_PATH: &str = "/api/session/bootstrap";

pub fn bootstrap_state(session: BootstrapSession) -> ChatState {
    let mut state = ChatState::awaiting_bootstrap();
    state.apply_bootstrap_session(session);
    state
}

async fn load_bootstrap_session() -> Result<BootstrapSession, String> {
    reqwest::Client::new()
        .post(BOOTSTRAP_PATH)
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
            view::ChatPage { state: chat_state }
        }
    }
}

pub fn app() -> Element {
    rsx! { App {} }
}
