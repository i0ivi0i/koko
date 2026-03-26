use dioxus::prelude::*;
use koko_core::contract::RoomMemberResponse;

use crate::ui::{Avatar, RoleBadge};

#[component]
pub fn MemberSheet(open: bool, members: Vec<RoomMemberResponse>, on_close: EventHandler<()>) -> Element {
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
                    for member in members {
                        MemberRow {
                            name: member.display_name,
                            role: member.role,
                        }
                    }
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
