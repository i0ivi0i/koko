use dioxus::prelude::*;

use crate::ui::{Avatar, RoleBadge};

#[component]
pub fn MemberSheet(open: bool, on_close: EventHandler<()>) -> Element {
    if !open {
        return rsx! {};
    }

    rsx! {
        div {
            div { class: "scrim", onclick: move |_| on_close.call(()) }
            aside { class: "member-sheet",
                div { class: "member-header",
                    div {
                        div { style: "font-size: 18px; font-weight: 700;", "房间成员" }
                        div { class: "message-meta", "群主 / 管理员 / 成员" }
                    }
                    button { class: "icon-button", onclick: move |_| on_close.call(()), "×" }
                }

                div { class: "member-list",
                    MemberRow { name: "Milo".to_string(), role: "群主".to_string() }
                    MemberRow { name: "Anya".to_string(), role: "管理员".to_string() }
                    MemberRow { name: "Kai".to_string(), role: "成员".to_string() }
                }
            }
        }
    }
}

#[component]
fn MemberRow(name: String, role: String) -> Element {
    rsx! {
        div { class: "member-row",
            Avatar { label: name.clone() }
            div { class: "member-meta",
                div { class: "member-name", "{name}" }
                div { class: "member-role", "匿名设备身份" }
            }
            RoleBadge { label: role }
        }
    }
}
