use dioxus::prelude::*;

#[component]
pub fn RoomEntryScreen(
    loading: bool,
    error_message: Option<String>,
    on_enter: EventHandler<String>,
) -> Element {
    let mut code = use_signal(|| "1A234".to_string());

    rsx! {
        div { class: "telegram-frame entry-layout",
            aside { class: "entry-aside",
                p { class: "eyebrow", "Koko / Anonymous Group" }
                h1 { class: "headline", "像 Telegram 一样进入房间。" }
                p { class: "subhead",
                    "输入 4 个数字加 1 个字母的房间短码。不存在就创建，存在就进入。"
                }
                div { class: "stat-row",
                    span { class: "pill", "匿名直达" }
                    span { class: "pill", "短码建房" }
                    span { class: "pill", "群主自动占位" }
                }
            }

            section { class: "entry-stage",
                div { class: "entry-card",
                    p { class: "eyebrow", "Join or Create" }
                    h2 { style: "margin: 0; font-size: 28px;", "输入房间短码" }
                    p { class: "subhead", "第一版默认深色主题，视觉基准贴近 Telegram iOS。" }
                    if let Some(message) = error_message {
                        p { style: "margin: 0; color: #ff8d8d;", "{message}" }
                    }
                    input {
                        class: "room-input",
                        maxlength: 5,
                        value: "{code()}",
                        placeholder: "1A234",
                        oninput: move |event| code.set(event.value().to_ascii_uppercase()),
                    }
                    div { class: "entry-actions",
                        button {
                            class: "ghost-button",
                            onclick: move |_| code.set("2B345".to_string()),
                            "换一个示例"
                        }
                        button {
                            class: "telegram-button",
                            onclick: move |_| on_enter.call(code()),
                            if loading { "进入中..." } else { "进入房间" }
                        }
                    }
                }
            }
        }
    }
}
