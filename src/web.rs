use dioxus::prelude::*;

use crate::{
    chat::{ChatState, ConnectionState},
    view,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const THEME_PATH: &str = "/assets/theme.css";
pub const SOCKET_BRIDGE_PATH: &str = "/assets/socketio.js";

#[component]
pub fn App() -> Element {
    let state = use_signal(|| {
        let mut state = ChatState::default();
        state.set_connection(ConnectionState::Joined);
        state
    });

    rsx! {
        div { class: "koko-web-shell",
            view::ChatPage { state: state() }
        }
    }
}

pub fn app() -> Element {
    rsx! { App {} }
}
