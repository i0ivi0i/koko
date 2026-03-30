use dioxus::prelude::*;

use crate::{contract::AdminOverview, view};

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

    pub fn preview() -> Self {
        Self::new(
            AdminOverview {
                room_count: 3,
                member_count: 18,
                message_count: 42,
            },
            vec![
                AdminRoomSummary::new("A1234", 12, 21, "hello admin"),
                AdminRoomSummary::new("B1234", 4, 12, "moderation view"),
                AdminRoomSummary::new("C1234", 2, 9, "room detail preview"),
            ],
        )
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
    let state = AdminPanelState::preview();

    rsx! {
        Title { "koko admin" }
        Stylesheet { href: asset!("/assets/theme.css") }
        view::AdminPanel { state: state }
    }
}
