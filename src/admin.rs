use dioxus::prelude::*;

use crate::contract::AdminOverview;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminRoomSummary {
    pub room_code: String,
    pub member_count: i64,
    pub message_count: i64,
    pub latest_preview: String,
}

impl AdminRoomSummary {
    pub fn new(
        room_code: &str,
        member_count: i64,
        message_count: i64,
        latest_preview: &str,
    ) -> Self {
        Self {
            room_code: room_code.to_string(),
            member_count,
            message_count,
            latest_preview: latest_preview.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminPanelState {
    pub overview: AdminOverview,
    pub rooms: Vec<AdminRoomSummary>,
}

impl AdminPanelState {
    pub fn new(overview: AdminOverview, rooms: Vec<AdminRoomSummary>) -> Self {
        Self { overview, rooms }
    }
}

pub fn render_admin_panel(state: &AdminPanelState) -> String {
    let mut lines = vec![
        "Rooms".to_string(),
        format!("{} rooms", state.overview.room_count),
        format!("{} members", state.overview.member_count),
        format!("{} messages", state.overview.message_count),
    ];

    for room in &state.rooms {
        lines.push(format!(
            "{} | {} members | {} messages | {}",
            room.room_code, room.member_count, room.message_count, room.latest_preview
        ));
    }

    lines.join("\n")
}

pub fn app() -> Element {
    rsx! {
        Title { "koko admin" }
        Stylesheet { href: asset!("/assets/theme.css") }
        div { class: "admin-shell",
            header { class: "admin-shell__hero",
                div { class: "admin-shell__eyebrow", "Koko admin" }
                h1 { class: "admin-shell__title", "Read-only operations" }
                p {
                    class: "admin-shell__summary",
                    "Admin read model wiring is pending. Render real data here instead of preview fixtures."
                }
            }
        }
    }
}
