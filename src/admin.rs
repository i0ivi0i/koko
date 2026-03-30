use dioxus::prelude::*;

use crate::{contract::AdminOverview, view};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

pub const ADMIN_OVERVIEW_PATH: &str = "/api/admin/overview";

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

pub fn admin_panel_state(overview: AdminOverview) -> AdminPanelState {
    AdminPanelState::new(overview, Vec::new())
}

async fn load_admin_overview(admin_token: String) -> Result<AdminOverview, String> {
    let admin_token = admin_token.trim().to_string();
    if admin_token.is_empty() {
        return Err("Admin token required".to_string());
    }

    reqwest::Client::new()
        .get(ADMIN_OVERVIEW_PATH)
        .header("x-admin-token", admin_token)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<AdminOverview>()
        .await
        .map_err(|error| error.to_string())
}

pub fn app() -> Element {
    let mut admin_token = use_signal(String::new);
    let mut requested_token = use_signal(String::new);
    let overview = use_resource(move || {
        let requested_token = requested_token();
        async move {
            if requested_token.trim().is_empty() {
                None
            } else {
                Some(load_admin_overview(requested_token).await)
            }
        }
    });
    let overview_error = match &*overview.read_unchecked() {
        Some(Some(Err(error))) => Some(error.clone()),
        _ => None,
    };
    let panel = match &*overview.read_unchecked() {
        Some(Some(Ok(overview))) => Some(admin_panel_state(overview.clone())),
        _ => None,
    };

    rsx! {
        Title { "koko admin" }
        Stylesheet { href: asset!("/assets/theme.css") }
        div { class: "admin-shell",
            header { class: "admin-shell__hero",
                div { class: "admin-shell__eyebrow", "Koko admin" }
                h1 { class: "admin-shell__title", "Read-only operations" }
                p { class: "admin-shell__summary", "Load live overview data through the backend read model." }
            }
            form {
                class: "admin-shell__stats",
                onsubmit: move |event| {
                    event.prevent_default();
                    requested_token.set(admin_token());
                },
                input {
                    r#type: "password",
                    placeholder: "Admin token",
                    value: "{admin_token}",
                    oninput: move |event| admin_token.set(event.value()),
                }
                button { r#type: "submit", "Load overview" }
            }
            if let Some(error) = overview_error {
                p { class: "admin-shell__summary", "Admin overview failed: {error}" }
            }
            if let Some(state) = panel {
                view::AdminPanel { state: state }
            } else if requested_token().trim().is_empty() {
                p {
                    class: "admin-shell__summary",
                    "Enter an admin token to fetch live overview data."
                }
            }
        }
    }
}
