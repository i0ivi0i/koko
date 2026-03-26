use dioxus::prelude::*;

#[component]
pub fn Avatar(label: String) -> Element {
    let text = label.chars().take(1).collect::<String>().to_uppercase();

    rsx! {
        span { class: "avatar", "{text}" }
    }
}

#[component]
pub fn RoleBadge(label: String) -> Element {
    rsx! {
        span { class: "role-badge", "{label}" }
    }
}
