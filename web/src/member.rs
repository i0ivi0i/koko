use dioxus::prelude::*;
use koko_contract::RoomMemberResponse;

use crate::ui::{Avatar, RoleBadge};

#[component]
pub fn MemberSheet(
    open: bool,
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
                                is_muted: member.is_muted,
                                can_promote: member.can_promote,
                                can_mute: member.can_mute,
                                can_remove: member.can_remove,
                                on_promote,
                                on_mute,
                                on_remove,
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
    is_muted: bool,
    can_promote: bool,
    can_mute: bool,
    can_remove: bool,
    on_promote: EventHandler<String>,
    on_mute: EventHandler<String>,
    on_remove: EventHandler<String>,
) -> Element {
    let promote_target = profile_id.clone();
    let mute_target = profile_id.clone();
    let remove_target = profile_id.clone();

    rsx! {
        div { class: "member-row",
            Avatar { label: name.clone() }
            div { class: "member-meta",
                div { class: "member-name", "{name}" }
                div { class: "member-role", "匿名设备身份" }
                if is_muted {
                    div { class: "message-meta", "已禁言" }
                }
            }
            RoleBadge { label: role }

            if can_promote || can_mute || can_remove {
                div { class: "member-sheet-actions",
                    if can_promote {
                        button {
                            class: "ghost-button member-action-button",
                            onclick: move |_| on_promote.call(promote_target.clone()),
                            "升管"
                        }
                    }
                    if can_mute {
                        button {
                            class: "ghost-button member-action-button",
                            onclick: move |_| on_mute.call(mute_target.clone()),
                            "禁言"
                        }
                    }
                    if can_remove {
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
                    members: vec![RoomMemberResponse {
                        profile_id: "member-1".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                        is_muted: false,
                        can_promote: true,
                        can_mute: true,
                        can_remove: true,
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
                    members: vec![RoomMemberResponse {
                        profile_id: "member-1".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                        is_muted: false,
                        can_promote: true,
                        can_mute: true,
                        can_remove: true,
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
    fn 没有能力位时不应渲染管理按钮() {
        #[component]
        fn TestSelfRow() -> Element {
            rsx! {
                MemberSheet {
                    open: true,
                    members: vec![RoomMemberResponse {
                        profile_id: "self".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                        is_muted: false,
                        can_promote: false,
                        can_mute: false,
                        can_remove: false,
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

    #[test]
    fn 禁言成员应展示后端快照给出的禁言标记() {
        #[component]
        fn TestMutedMember() -> Element {
            rsx! {
                MemberSheet {
                    open: true,
                    members: vec![RoomMemberResponse {
                        profile_id: "member-1".to_string(),
                        display_name: "Alice".to_string(),
                        role: "member".to_string(),
                        is_muted: true,
                        can_promote: false,
                        can_mute: true,
                        can_remove: true,
                    }],
                    on_promote: move |_| {},
                    on_mute: move |_| {},
                    on_remove: move |_| {},
                    on_close: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestMutedMember);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("已禁言"));
    }
}
