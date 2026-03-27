use dioxus::prelude::*;
use koko_contract::MessageResponse;

use crate::ui::Avatar;

#[component]
pub fn ChatScreen(
    room_code: String,
    profile_id: String,
    display_name: String,
    messages: Vec<MessageResponse>,
    member_count: usize,
    on_back: EventHandler<()>,
    on_open_members: EventHandler<()>,
    on_send: EventHandler<String>,
) -> Element {
    let mut draft = use_signal(String::new);
    let draft_value = draft();
    let send_disabled = draft_value.trim().is_empty();
    let composer_rows = draft_value.lines().count().max(1).min(4);
    let send_button_class = if send_disabled {
        "composer-send-button is-idle"
    } else {
        "composer-send-button is-ready"
    };

    rsx! {
        div { class: "telegram-frame chat-main-view",
            header { class: "chat-topbar",
                div { class: "chat-topbar-leading",
                    button {
                        class: "icon-button chat-back-button",
                        onclick: move |_| on_back.call(()),
                        "←"
                    }
                    Avatar { label: room_code.clone() }
                    div { class: "chat-topbar-meta",
                        div { class: "chat-topbar-title", "房间 {room_code.clone()}" }
                        div { class: "chat-topbar-subtitle", "{member_count} 位成员 · {display_name}" }
                    }
                }
                button {
                    class: "ghost-button chat-topbar-action",
                    onclick: move |_| on_open_members.call(()),
                    "成员"
                }
            }

            section { class: "chat-wall",
                div { class: "chat-date-chip", "今天" }
                for message in messages {
                    MessageBubble {
                        incoming: message.sender_id != profile_id,
                        sender: message.sender_id.clone(),
                        text: message.content.clone(),
                        time: "刚刚".to_string(),
                    }
                }
            }

            footer { class: "chat-bottom-bar",
                div { class: "chat-composer-pill",
                    button {
                        class: "icon-button composer-attach",
                        "aria-label": "更多操作",
                        "+"
                    }
                    textarea {
                        class: "composer-input chat-composer-input",
                        value: "{draft_value}",
                        rows: "{composer_rows}",
                        "enterkeyhint": "send",
                        placeholder: "消息",
                        oninput: move |event| draft.set(event.value()),
                    }
                    button {
                        class: "{send_button_class}",
                        "aria-label": "发送消息",
                        disabled: send_disabled,
                        onclick: move |_| {
                            let content = draft().trim().to_string();
                            if !content.is_empty() {
                                on_send.call(content);
                                draft.set(String::new());
                            }
                        },
                        span { class: "composer-send-icon", "↑" }
                    }
                }
            }
        }
    }
}

#[component]
fn MessageBubble(incoming: bool, sender: String, text: String, time: String) -> Element {
    let row_class = if incoming {
        "message-row incoming"
    } else {
        "message-row outgoing"
    };
    let bubble_class = if incoming {
        "message-card incoming"
    } else {
        "message-card outgoing"
    };

    rsx! {
        div { class: "{row_class}",
            div { class: "{bubble_class}",
                if incoming {
                    div { class: "message-sender", "{sender}" }
                }
                div { class: "message-text", "{text}" }
                div { class: "message-meta", "{time}" }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dioxus::prelude::{Element, VirtualDom, rsx};

    #[test]
    fn chat_screen_should_render_single_column_telegram_shell() {
        #[component]
        fn TestChatShell() -> Element {
            rsx! {
                ChatScreen {
                    room_code: "1A234".to_string(),
                    profile_id: "self".to_string(),
                    display_name: "匿名用户".to_string(),
                    messages: vec![],
                    member_count: 3,
                    on_back: move |_| {},
                    on_open_members: move |_| {},
                    on_send: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestChatShell);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("chat-main-view"));
        assert!(html.contains("chat-topbar"));
        assert!(html.contains("chat-composer-pill"));
        assert!(!html.contains("chat-sidebar"));
    }

    #[test]
    fn chat_screen_should_render_idle_send_button_state() {
        #[component]
        fn TestChatShell() -> Element {
            rsx! {
                ChatScreen {
                    room_code: "1A234".to_string(),
                    profile_id: "self".to_string(),
                    display_name: "匿名用户".to_string(),
                    messages: vec![],
                    member_count: 3,
                    on_back: move |_| {},
                    on_open_members: move |_| {},
                    on_send: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestChatShell);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("composer-send-button is-idle"));
        assert!(html.contains("aria-label=\"发送消息\""));
        assert!(html.contains("disabled"));
    }
}
