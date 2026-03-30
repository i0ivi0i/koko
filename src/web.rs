use dioxus::prelude::*;

use crate::{chat::ChatState, contract::BootstrapSession, view};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const THEME_PATH: &str = "/assets/theme.css";
pub const BOOTSTRAP_PATH: &str = "/api/session/bootstrap";

fn bootstrapping_state() -> ChatState {
    ChatState::awaiting_bootstrap()
}

pub fn bootstrap_state(session: BootstrapSession) -> ChatState {
    let mut state = ChatState::awaiting_bootstrap();
    state.apply_bootstrap_session(session);
    state
}

#[component]
pub fn App() -> Element {
    let state = use_signal(bootstrapping_state);

    rsx! {
        Title { "koko" }
        Stylesheet { href: asset!("/assets/theme.css") }
        div { class: "koko-web-shell",
            view::ChatPage { state: state() }
        }
    }
}

pub fn app() -> Element {
    rsx! { App {} }
}
