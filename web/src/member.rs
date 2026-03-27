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
                div { class: "member-sheet-card",
                    div { class: "member-sheet-handle" }
                    div { class: "member-header",
                        div {
                            div { class: "member-sheet-title", "房间成员" }
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

            if !is_self && (can_promote || can_manage_member) {
                div { class: "member-sheet-actions",
                    if can_promote {
                        button {
                            class: "ghost-button member-action-button",
                            onclick: move |_| on_promote.call(promote_target.clone()),
                            "升管"
                        }
                    }
                    if can_manage_member {
                        button {
                            class: "ghost-button member-action-button",
                            onclick: move |_| on_mute.call(mute_target.clone()),
                            "禁言"
                        }
                        button {
                            class: "ghost-button member-action-button danger",
                            onclick: move |_| on_remove.call(remove_target.clone()),
                            "移除"
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dioxus::prelude::{Element, VirtualDom, rsx};

    #[test]
    fn member_sheet_should_render_sheet_style_structure() {
        #[component]
        fn TestMemberSheet() -> Element {
            rsx! {
                MemberSheet {
                    open: true,
                    current_role: "owner".to_string(),
                    current_profile_id: "self".to_string(),
                    members: vec![RoomMemberResponse {
                        profile_id: "member-1".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                    }],
                    on_promote: move |_| {},
                    on_mute: move |_| {},
                    on_remove: move |_| {},
                    on_close: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestMemberSheet);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("member-sheet-card"));
        assert!(html.contains("member-sheet-actions"));
    }

    #[test]
    fn owner_view_should_keep_member_actions_visible_for_other_member() {
        #[component]
        fn TestOwnerActions() -> Element {
            rsx! {
                MemberSheet {
                    open: true,
                    current_role: "owner".to_string(),
                    current_profile_id: "self".to_string(),
                    members: vec![RoomMemberResponse {
                        profile_id: "member-1".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                    }],
                    on_promote: move |_| {},
                    on_mute: move |_| {},
                    on_remove: move |_| {},
                    on_close: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestOwnerActions);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("升管"));
        assert!(html.contains("禁言"));
        assert!(html.contains("移除"));
    }

    #[test]
    fn self_row_should_not_render_management_actions() {
        #[component]
        fn TestSelfRow() -> Element {
            rsx! {
                MemberSheet {
                    open: true,
                    current_role: "owner".to_string(),
                    current_profile_id: "self".to_string(),
                    members: vec![RoomMemberResponse {
                        profile_id: "self".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                    }],
                    on_promote: move |_| {},
                    on_mute: move |_| {},
                    on_remove: move |_| {},
                    on_close: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestSelfRow);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(!html.contains("member-sheet-actions"));
        assert!(!html.contains("升管"));
        assert!(!html.contains("禁言"));
        assert!(!html.contains("移除"));
    }
}
