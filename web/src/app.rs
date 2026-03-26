use dioxus::prelude::*;

use crate::{
    chat::ChatScreen,
    member::MemberSheet,
    room::RoomEntryScreen,
    theme::APP_STYLE,
};

#[component]
pub fn App() -> Element {
    let mut active_room = use_signal(|| None::<String>);
    let mut members_open = use_signal(|| false);

    rsx! {
        document::Title { "Koko" }
        document::Style { "{APP_STYLE}" }

        div { class: "app-shell",
            if let Some(room_code) = active_room() {
                ChatScreen {
                    room_code,
                    on_back: move |_| {
                        active_room.set(None);
                        members_open.set(false);
                    },
                    on_open_members: move |_| members_open.set(true),
                }
                MemberSheet {
                    open: members_open(),
                    on_close: move |_| members_open.set(false),
                }
            } else {
                RoomEntryScreen {
                    on_enter: move |code| active_room.set(Some(code)),
                }
            }
        }
    }
}
