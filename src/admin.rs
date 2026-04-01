use dioxus::prelude::*;

use crate::{
    contract::{AdminOverview, AdminRoomSummary},
    view, web,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

const ADMIN_OVERVIEW_PATH: &str = "/api/admin/overview";
const ADMIN_ROOMS_PATH: &str = "/api/admin/rooms";

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

pub fn admin_panel_state(overview: AdminOverview, rooms: Vec<AdminRoomSummary>) -> AdminPanelState {
    AdminPanelState::new(overview, rooms)
}

async fn load_admin_overview(admin_token: String) -> Result<AdminOverview, String> {
    let admin_token = admin_token.trim().to_string();
    if admin_token.is_empty() {
        return Err("管理员令牌不能为空".to_string());
    }

    let client = reqwest::Client::new();
    let url = web::resolve_shell_api_url(&web::browser_location()?, ADMIN_OVERVIEW_PATH)?;
    client
        .get(url)
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

async fn load_admin_rooms(admin_token: String) -> Result<Vec<AdminRoomSummary>, String> {
    let admin_token = admin_token.trim().to_string();
    if admin_token.is_empty() {
        return Err("管理员令牌不能为空".to_string());
    }

    let client = reqwest::Client::new();
    let url = web::resolve_shell_api_url(&web::browser_location()?, ADMIN_ROOMS_PATH)?;
    client
        .get(url)
        .header("x-admin-token", admin_token)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Vec<AdminRoomSummary>>()
        .await
        .map_err(|error| error.to_string())
}

async fn load_admin_state(admin_token: String) -> Result<AdminPanelState, String> {
    let overview = load_admin_overview(admin_token.clone()).await?;
    let rooms = load_admin_rooms(admin_token).await?;
    Ok(admin_panel_state(overview, rooms))
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
                Some(load_admin_state(requested_token).await)
            }
        }
    });
    let overview_error = match &*overview.read_unchecked() {
        Some(Some(Err(error))) => Some(error.clone()),
        _ => None,
    };
    let panel = match &*overview.read_unchecked() {
        Some(Some(Ok(state))) => Some(state.clone()),
        _ => None,
    };

    rsx! {
        Title { "Koko 管理台" }
        Stylesheet { href: asset!("/assets/theme.css") }
        div { class: "admin-shell",
            header { class: "admin-shell__hero",
                div { class: "admin-shell__eyebrow", "Koko 管理台" }
                h1 { class: "admin-shell__title", "只读运维视图" }
                p { class: "admin-shell__summary", "通过后端只读模型加载实时概览数据。" }
            }
            form {
                class: "admin-shell__stats",
                onsubmit: move |event| {
                    event.prevent_default();
                    requested_token.set(admin_token());
                },
                input {
                    r#type: "password",
                    placeholder: "管理员令牌",
                    value: "{admin_token}",
                    oninput: move |event| admin_token.set(event.value()),
                }
                button { r#type: "submit", "加载概览" }
            }
            if let Some(error) = overview_error {
                p { class: "admin-shell__summary", "加载管理概览失败：{error}" }
            }
            if let Some(state) = panel {
                view::AdminPanel { state: state }
            } else if requested_token().trim().is_empty() {
                p {
                    class: "admin-shell__summary",
                    "输入管理员令牌后，再拉取实时概览数据。"
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dioxus::prelude::VirtualDom;

    #[test]
    fn admin_landing_copy_is_localized_for_chinese_users() {
        let mut vdom = VirtualDom::new(app);
        vdom.rebuild_in_place();
        let html = dioxus_ssr::render(&vdom);

        assert!(html.contains("Koko 管理台"));
        assert!(html.contains("只读运维视图"));
        assert!(html.contains("通过后端只读模型加载实时概览数据。"));
        assert!(html.contains("placeholder=\"管理员令牌\""));
        assert!(html.contains(">加载概览<"));
        assert!(html.contains("输入管理员令牌后，再拉取实时概览数据。"));
    }

    #[tokio::test]
    async fn admin_token_validation_copy_is_localized() {
        assert_eq!(
            load_admin_overview("   ".to_string()).await.unwrap_err(),
            "管理员令牌不能为空"
        );
        assert_eq!(
            load_admin_rooms("".to_string()).await.unwrap_err(),
            "管理员令牌不能为空"
        );
    }
}
