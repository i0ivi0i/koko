use dioxus::prelude::*;

use crate::{chat::ChatState, view};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const THEME_PATH: &str = "/assets/theme.css";

#[component]
pub fn App() -> Element {
    let state = use_signal(ChatState::default);

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
