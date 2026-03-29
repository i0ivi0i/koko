use dioxus::prelude::*;
use koko_contract::MessageResponse;

use crate::ui::Avatar;

#[component]
pub fn ChatScreen(
    room_code: String,
    profile_id: String,
    display_name: String,
    messages: Vec<MessageResponse>,
    has_more_messages: bool,
    loading_more_messages: bool,
    member_count: usize,
    on_back: EventHandler<()>,
    on_open_members: EventHandler<()>,
    on_load_older: EventHandler<()>,
    on_send: EventHandler<String>,
) -> Element {
    let mut draft = use_signal(String::new);
    let draft_value = draft();
    let send_disabled = draft_value.trim().is_empty();
    let composer_rows = draft_value.lines().count().clamp(1, 4);
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
                if has_more_messages {
                    button {
                        class: "history-load-more-button",
                        disabled: loading_more_messages,
                        onclick: move |_| on_load_older.call(()),
                        if loading_more_messages {
                            "正在加载更早消息..."
                        } else {
                            "加载更早消息"
                        }
                    }
                }
                div { class: "chat-date-chip", "今天" }
                for message in messages {
                    MessageBubble {
                        incoming: message.sender_id != profile_id,
                        sender: message.sender_id.clone(),
                        text: message.content.clone(),
                        time: format_message_time(&message.created_at),
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

fn format_message_time(created_at: &str) -> String {
    #[cfg(target_arch = "wasm32")]
    {
        let date = js_sys::Date::new(&created_at.into());
        if !date.get_time().is_nan() {
            return format!("{:02}:{:02}", date.get_hours(), date.get_minutes());
        }
    }

    parse_utc_hh_mm(created_at).unwrap_or_else(|| "刚刚".to_string())
}

fn parse_utc_hh_mm(created_at: &str) -> Option<String> {
    let time = created_at.split('T').nth(1)?;
    let mut parts = time.split(':');
    let hours = parts.next()?;
    let minutes = parts.next()?;
    Some(format!("{hours}:{minutes}"))
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
                    has_more_messages: false,
                    loading_more_messages: false,
                    member_count: 3,
                    on_back: move |_| {},
                    on_open_members: move |_| {},
                    on_load_older: move |_| {},
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
                    has_more_messages: false,
                    loading_more_messages: false,
                    member_count: 3,
                    on_back: move |_| {},
                    on_open_members: move |_| {},
                    on_load_older: move |_| {},
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

    #[test]
    fn chat_screen_should_render_load_older_entry_when_history_remains() {
        #[component]
        fn TestChatShell() -> Element {
            rsx! {
                ChatScreen {
                    room_code: "1A234".to_string(),
                    profile_id: "self".to_string(),
                    display_name: "匿名用户".to_string(),
                    messages: vec![],
                    has_more_messages: true,
                    loading_more_messages: false,
                    member_count: 3,
                    on_back: move |_| {},
                    on_open_members: move |_| {},
                    on_load_older: move |_| {},
                    on_send: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestChatShell);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("history-load-more-button"));
        assert!(html.contains("加载更早消息"));
    }

    #[test]
    fn chat_screen_should_render_message_time_from_response() {
        #[component]
        fn TestChatShell() -> Element {
            rsx! {
                ChatScreen {
                    room_code: "1A234".to_string(),
                    profile_id: "self".to_string(),
                    display_name: "匿名用户".to_string(),
                    messages: vec![MessageResponse {
                        message_id: "msg-1".into(),
                        room_id: "room-1".into(),
                        sender_id: "other".into(),
                        content: "hello".into(),
                        created_at: "2026-03-27T12:34:56Z".into(),
                    }],
                    has_more_messages: false,
                    loading_more_messages: false,
                    member_count: 3,
                    on_back: move |_| {},
                    on_open_members: move |_| {},
                    on_load_older: move |_| {},
                    on_send: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestChatShell);
        dom.rebuild_in_place();
        let html = dioxus_ssr::render(&dom);

        assert!(html.contains("12:34"));
        assert!(!html.contains(">刚刚<"));
    }

    #[test]
    fn format_message_time_should_extract_hh_mm_from_rfc3339() {
        assert_eq!(format_message_time("2026-03-27T08:09:10Z"), "08:09");
    }
}
