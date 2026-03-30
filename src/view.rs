use dioxus::prelude::*;

use crate::{admin::AdminPanelState, contract::AdminRoomSummary};
use crate::chat::{ChatMessage, ChatState, ConnectionState, DeliveryState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

#[component]
pub fn ChatPage(state: ChatState) -> Element {
    let room_code = if state.room_code().is_empty() {
        "KOKO"
    } else {
        state.room_code()
    };

    rsx! {
        div { class: "tg-shell",
            header { class: "tg-nav",
                div { class: "tg-nav__back", "Chats" }
                div { class: "tg-nav__title",
                    div { class: "tg-nav__name", "{room_code}" }
                    div { class: "tg-nav__meta", "{connection_label(state.connection())}" }
                }
                div { class: "tg-nav__avatar", "{room_code.chars().next().unwrap_or('K')}" }
            }
            section { class: "tg-thread",
                for message in state.messages().iter() {
                    MessageBubble { message: message.clone() }
                }
            }
            footer { class: "tg-compose",
                div { class: "tg-compose__field", "Message" }
                button { class: "tg-compose__send", "Send" }
            }
        }
    }
}

#[component]
fn MessageBubble(message: ChatMessage) -> Element {
    rsx! {
        article { class: "{bubble_class(&message)}",
            div { class: "tg-bubble__body", "{message.body}" }
            div { class: "tg-bubble__meta", "{delivery_label(message.delivery)}" }
        }
    }
}

fn bubble_class(message: &ChatMessage) -> &'static str {
    match message.delivery {
        DeliveryState::Pending => "tg-bubble tg-bubble--pending",
        DeliveryState::Confirmed => "tg-bubble tg-bubble--confirmed",
        DeliveryState::Failed => "tg-bubble tg-bubble--failed",
    }
}

fn connection_label(state: ConnectionState) -> &'static str {
    match state {
        ConnectionState::Offline => "Offline",
        ConnectionState::Connecting => "Connecting",
        ConnectionState::Joined => "Connected",
    }
}

fn delivery_label(state: DeliveryState) -> &'static str {
    match state {
        DeliveryState::Pending => "Sending",
        DeliveryState::Confirmed => "Delivered",
        DeliveryState::Failed => "Retry",
    }
}

#[component]
pub fn AdminPanel(state: AdminPanelState) -> Element {
    rsx! {
        div { class: "admin-shell",
            header { class: "admin-shell__hero",
                div {
                    class: "admin-shell__eyebrow",
                    "Koko admin"
                }
                h1 { class: "admin-shell__title", "Read-only operations" }
                p {
                    class: "admin-shell__summary",
                    "{state.overview.room_count} rooms, {state.overview.member_count} members, {state.overview.message_count} messages"
                }
            }
            section { class: "admin-shell__stats",
                AdminStatCard { label: "Rooms", value: state.overview.room_count.to_string() }
                AdminStatCard { label: "Members", value: state.overview.member_count.to_string() }
                AdminStatCard { label: "Messages", value: state.overview.message_count.to_string() }
            }
            section { class: "admin-shell__list",
                div { class: "admin-shell__list-head",
                    h2 { "Active rooms" }
                    span { "{state.rooms.len()} tracked" }
                }
                for room in state.rooms {
                    AdminRoomCard { room: room.clone() }
                }
            }
        }
    }
}

#[component]
fn AdminStatCard(label: String, value: String) -> Element {
    rsx! {
        article { class: "admin-stat",
            div { class: "admin-stat__label", "{label}" }
            div { class: "admin-stat__value", "{value}" }
        }
    }
}

#[component]
fn AdminRoomCard(room: AdminRoomSummary) -> Element {
    rsx! {
        article { class: "admin-room",
            div { class: "admin-room__code", "{room.room_code}" }
            div { class: "admin-room__meta",
                "{room.member_count} members"
            }
            div { class: "admin-room__meta",
                "{room.message_count} messages"
            }
            div { class: "admin-room__preview", "{room.latest_preview}" }
        }
    }
}
