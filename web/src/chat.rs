use dioxus::prelude::*;

use crate::ui::Avatar;

#[component]
pub fn ChatScreen(
    room_code: String,
    on_back: EventHandler<()>,
    on_open_members: EventHandler<()>,
) -> Element {
    let mut draft = use_signal(String::new);

    rsx! {
        div { class: "telegram-frame chat-layout",
            aside { class: "chat-sidebar",
                p { class: "eyebrow", "群聊" }
                div { class: "thread-list",
                    div { class: "thread-item active",
                        div { class: "thread-title", "房间 {room_code.clone()}" }
                        div { class: "thread-preview", "知道短码就能进来聊天" }
                    }
                    div { class: "thread-item",
                        div { class: "thread-title", "最近访问" }
                        div { class: "thread-preview", "2B345 · 昨天活跃" }
                    }
                }
            }

            main { class: "chat-panel",
                header { class: "chat-toolbar",
                    div { class: "toolbar-meta",
                        button { class: "icon-button", onclick: move |_| on_back.call(()), "←" }
                        Avatar { label: room_code.clone() }
                        div {
                            div { style: "font-size: 16px; font-weight: 670;", "房间 {room_code.clone()}" }
                            div { class: "message-meta", "58 位成员在线 · 匿名群聊" }
                        }
                    }
                    button {
                        class: "ghost-button",
                        onclick: move |_| on_open_members.call(()),
                        "成员"
                    }
                }

                section { class: "chat-scroll",
                    MessageBubble {
                        incoming: true,
                        sender: "M".to_string(),
                        text: "这个房间空着的时候，第一个进来的人就会成为群主。".to_string(),
                        time: "10:21".to_string(),
                    }
                    MessageBubble {
                        incoming: false,
                        sender: "Y".to_string(),
                        text: "这样挺像闯进一个空房间，语义很顺。".to_string(),
                        time: "10:23".to_string(),
                    }
                    MessageBubble {
                        incoming: true,
                        sender: "K".to_string(),
                        text: "前端先按 Telegram iOS 深色壳做，后面再接真实后端契约。".to_string(),
                        time: "10:25".to_string(),
                    }
                }

                footer { class: "composer-shell",
                    div { class: "composer-row",
                        button { class: "icon-button", "+", }
                        textarea {
                            class: "composer-input",
                            value: "{draft()}",
                            placeholder: "输入消息",
                            oninput: move |event| draft.set(event.value()),
                        }
                        button {
                            class: "telegram-button",
                            onclick: move |_| draft.set(String::new()),
                            "发送"
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn MessageBubble(incoming: bool, sender: String, text: String, time: String) -> Element {
    let row_class = if incoming { "message-row incoming" } else { "message-row outgoing" };
    let bubble_class = if incoming {
        "message-bubble incoming"
    } else {
        "message-bubble outgoing"
    };

    rsx! {
        div { class: "{row_class}",
            div { class: "{bubble_class}",
                if incoming {
                    div { class: "message-meta", style: "text-align: left; margin-top: 0; margin-bottom: 6px; color: #6fb3ff;", "{sender}" }
                }
                div { class: "message-text", "{text}" }
                div { class: "message-meta", "{time}" }
            }
        }
    }
}
