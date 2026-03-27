use dioxus::prelude::*;
use koko_contract::RoomMemberResponse;

use crate::ui::{Avatar, RoleBadge};

#[component]
pub fn MemberSheet(
    open: bool,
    current_role: String,
    current_profile_id: String,
    members: Vec<RoomMemberResponse>,
    on_promote: EventHandler<String>,
    on_mute: EventHandler<String>,
    on_remove: EventHandler<String>,
    on_close: EventHandler<()>,
) -> Element {
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
                            profile_id: member.profile_id,
                            name: member.display_name,
                            role: member.role,
                            current_role: current_role.clone(),
                            current_profile_id: current_profile_id.clone(),
                            on_promote: on_promote.clone(),
                            on_mute: on_mute.clone(),
                            on_remove: on_remove.clone(),
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn MemberRow(
    profile_id: String,
    name: String,
    role: String,
    current_role: String,
    current_profile_id: String,
    on_promote: EventHandler<String>,
    on_mute: EventHandler<String>,
    on_remove: EventHandler<String>,
) -> Element {
    let can_manage_member =
        current_role == "owner" || (current_role == "admin" && role == "member");
    let can_promote = current_role == "owner" && role == "member";
    let is_self = profile_id == current_profile_id;
    let promote_target = profile_id.clone();
    let mute_target = profile_id.clone();
    let remove_target = profile_id.clone();

    rsx! {
        div { class: "member-row",
            Avatar { label: name.clone() }
            div { class: "member-meta",
                div { class: "member-name", "{name}" }
                div { class: "member-role", "匿名设备身份" }
            }
            RoleBadge { label: role }
            if !is_self && can_promote {
                button {
                    class: "ghost-button",
                    onclick: move |_| on_promote.call(promote_target.clone()),
                    "升管"
                }
            }
            if !is_self && can_manage_member {
                button {
                    class: "ghost-button",
                    onclick: move |_| on_mute.call(mute_target.clone()),
                    "禁言"
                }
                button {
                    class: "ghost-button",
                    onclick: move |_| on_remove.call(remove_target.clone()),
                    "移除"
                }
            }
        }
    }
}
