use dioxus::prelude::*;
use serde::{Deserialize, de::DeserializeOwned};

use crate::{
    contract::{AdminLoginRequest, AdminOverview, AdminRoomSummary, AdminSessionStatus, AppErrorCode},
    view, web,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module;

const ADMIN_OVERVIEW_PATH: &str = "/api/admin/overview";
const ADMIN_ROOMS_PATH: &str = "/api/admin/rooms";
const ADMIN_SESSION_PATH: &str = "/api/admin/session";
const ADMIN_SESSION_LOGIN_PATH: &str = "/api/admin/session/login";
const ADMIN_SESSION_LOGOUT_PATH: &str = "/api/admin/session/logout";

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

#[derive(Debug, Clone, PartialEq, Eq)]
enum AdminShellAction {
    Probe,
    Login(String),
    Logout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AdminShellView {
    Login { session_notice: Option<String> },
    Panel {
        state: Option<AdminPanelState>,
        load_error: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ErrorPayload {
    code: AppErrorCode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AdminRequestError {
    code: Option<AppErrorCode>,
    detail: String,
}

impl AdminRequestError {
    fn message(&self) -> String {
        if let Some(code) = self.code {
            if let Some(message) = admin_error_message(code) {
                return message.to_string();
            }
        }
        self.detail.clone()
    }
}

#[cfg(target_arch = "wasm32")]
fn request_with_browser_credentials(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    builder.fetch_credentials_same_origin()
}

#[cfg(not(target_arch = "wasm32"))]
fn request_with_browser_credentials(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    builder
}

async fn send_admin_request(
    builder: reqwest::RequestBuilder,
) -> Result<reqwest::Response, AdminRequestError> {
    let response = request_with_browser_credentials(builder)
        .send()
        .await
        .map_err(|error| AdminRequestError {
            code: None,
            detail: error.to_string(),
        })?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let code = response
        .json::<ErrorPayload>()
        .await
        .ok()
        .map(|payload| payload.code);
    Err(AdminRequestError {
        code,
        detail: format!("HTTP {}", status.as_u16()),
    })
}

async fn load_admin_json<T>(builder: reqwest::RequestBuilder) -> Result<T, AdminRequestError>
where
    T: DeserializeOwned,
{
    send_admin_request(builder)
        .await?
        .json::<T>()
        .await
        .map_err(|error| AdminRequestError {
            code: None,
            detail: error.to_string(),
        })
}

fn admin_error_message(code: AppErrorCode) -> Option<&'static str> {
    match code {
        AppErrorCode::InvalidAdminToken => Some("管理员口令不正确"),
        // 后台壳只消费稳定 error code，不自己猜“为什么失效”，避免把会话真相搬回前端。
        AppErrorCode::AdminSessionReplaced => Some("已在其他设备重新登录"),
        AppErrorCode::AdminSessionExpired => Some("3 天未操作已过期"),
        AppErrorCode::AdminSessionRequired => Some("请先登录后台"),
        _ => None,
    }
}

fn admin_session_notice(error: &AdminRequestError) -> Option<String> {
    error.code.and_then(admin_error_message).map(str::to_string)
}

async fn load_admin_session_status() -> Result<AdminSessionStatus, AdminRequestError> {
    let client = reqwest::Client::new();
    let browser_location = web::browser_location().map_err(|detail| AdminRequestError {
        code: None,
        detail,
    })?;
    let url = web::resolve_shell_api_url(&browser_location, ADMIN_SESSION_PATH)
        .map_err(|detail| AdminRequestError { code: None, detail })?;
    // probe 只确认后台会话是否仍有效，不续命，避免轮询把 3 天空闲期悄悄刷新。
    load_admin_json(client.get(url)).await
}

async fn login_admin(token: String) -> Result<(), AdminRequestError> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(AdminRequestError {
            code: None,
            detail: "管理员口令不能为空".to_string(),
        });
    }

    let client = reqwest::Client::new();
    let browser_location = web::browser_location().map_err(|detail| AdminRequestError {
        code: None,
        detail,
    })?;
    let url = web::resolve_shell_api_url(&browser_location, ADMIN_SESSION_LOGIN_PATH)
        .map_err(|detail| AdminRequestError { code: None, detail })?;
    send_admin_request(client.post(url).json(&AdminLoginRequest { token })).await?;
    Ok(())
}

async fn logout_admin() -> Result<(), AdminRequestError> {
    let client = reqwest::Client::new();
    let browser_location = web::browser_location().map_err(|detail| AdminRequestError {
        code: None,
        detail,
    })?;
    let url = web::resolve_shell_api_url(&browser_location, ADMIN_SESSION_LOGOUT_PATH)
        .map_err(|detail| AdminRequestError { code: None, detail })?;
    send_admin_request(client.post(url)).await?;
    Ok(())
}

async fn load_admin_overview() -> Result<AdminOverview, AdminRequestError> {
    let client = reqwest::Client::new();
    let browser_location = web::browser_location().map_err(|detail| AdminRequestError {
        code: None,
        detail,
    })?;
    let url = web::resolve_shell_api_url(&browser_location, ADMIN_OVERVIEW_PATH)
        .map_err(|detail| AdminRequestError { code: None, detail })?;
    load_admin_json(client.get(url)).await
}

async fn load_admin_rooms() -> Result<Vec<AdminRoomSummary>, AdminRequestError> {
    let client = reqwest::Client::new();
    let browser_location = web::browser_location().map_err(|detail| AdminRequestError {
        code: None,
        detail,
    })?;
    let url = web::resolve_shell_api_url(&browser_location, ADMIN_ROOMS_PATH)
        .map_err(|detail| AdminRequestError { code: None, detail })?;
    load_admin_json(client.get(url)).await
}

async fn load_admin_state() -> Result<AdminPanelState, AdminRequestError> {
    let overview = load_admin_overview().await?;
    let rooms = load_admin_rooms().await?;
    Ok(admin_panel_state(overview, rooms))
}

fn resolve_admin_panel_view(
    load_state: Result<AdminPanelState, AdminRequestError>,
) -> Result<AdminShellView, String> {
    match load_state {
        Ok(state) => Ok(AdminShellView::Panel {
            state: Some(state),
            load_error: None,
        }),
        Err(error) => {
            if let Some(session_notice) = admin_session_notice(&error) {
                Ok(AdminShellView::Login {
                    session_notice: Some(session_notice),
                })
            } else {
                Ok(AdminShellView::Panel {
                    state: None,
                    load_error: Some(format!("加载后台概览失败：{}", error.message())),
                })
            }
        }
    }
}

async fn resolve_admin_shell(action: AdminShellAction) -> Result<AdminShellView, String> {
    match action {
        AdminShellAction::Probe => {
            let status = match load_admin_session_status().await {
                Ok(status) => status,
                Err(error) => {
                    return if let Some(session_notice) = admin_session_notice(&error) {
                        Ok(AdminShellView::Login {
                            session_notice: Some(session_notice),
                        })
                    } else {
                        Err(format!("确认后台会话失败：{}", error.message()))
                    };
                }
            };

            if !status.authenticated {
                return Ok(AdminShellView::Login {
                    session_notice: None,
                });
            }

            resolve_admin_panel_view(load_admin_state().await)
        }
        AdminShellAction::Login(token) => {
            login_admin(token)
                .await
                .map_err(|error| format!("登录后台失败：{}", error.message()))?;
            resolve_admin_panel_view(load_admin_state().await)
        }
        AdminShellAction::Logout => {
            logout_admin()
                .await
                .map_err(|error| format!("退出后台失败：{}", error.message()))?;
            Ok(AdminShellView::Login {
                session_notice: None,
            })
        }
    }
}

pub fn is_admin_shell_path(browser_location: &str) -> bool {
    reqwest::Url::parse(browser_location)
        .ok()
        .map(|url| url.path() == "/admin")
        .unwrap_or(false)
}

#[component]
fn RootShellOutlet(browser_location: String) -> Element {
    if is_admin_shell_path(&browser_location) {
        rsx! { AdminApp {} }
    } else {
        rsx! { web::App {} }
    }
}

pub fn root_shell() -> Element {
    let browser_location = web::browser_location().unwrap_or_default();
    rsx! { RootShellOutlet { browser_location } }
}

#[component]
fn AdminApp() -> Element {
    let mut admin_token = use_signal(String::new);
    let mut action_version = use_signal(|| 0_u64);
    let mut shell_action = use_signal(|| AdminShellAction::Probe);
    let shell = use_resource(move || {
        let _ = action_version();
        let action = shell_action();
        async move { resolve_admin_shell(action).await }
    });

    let request_error = match &*shell.read_unchecked() {
        Some(Err(error)) => Some(error.clone()),
        _ => None,
    };
    let shell_view = match &*shell.read_unchecked() {
        Some(Ok(view)) => view.clone(),
        _ => AdminShellView::Login {
            session_notice: None,
        },
    };

    rsx! {
        Title { "Koko 管理后台" }
        Stylesheet { href: asset!("/public/assets/theme.css") }
        match shell_view {
            AdminShellView::Login { session_notice } => rsx! {
                div { class: "admin-shell",
                    header { class: "admin-shell__hero",
                        div { class: "admin-shell__eyebrow", "Koko 管理后台" }
                        h1 { class: "admin-shell__title", "后台会话入口" }
                        p { class: "admin-shell__summary", "通过服务端后台会话加载概览与房间数据。" }
                    }
                    form {
                        class: "admin-shell__stats",
                        onsubmit: move |event| {
                            event.prevent_default();
                            shell_action.set(AdminShellAction::Login(admin_token()));
                            action_version += 1;
                        },
                        // 这里只保留输入框临时值，不把原始管理员口令写进 localStorage 或其他持久状态。
                        input {
                            r#type: "password",
                            placeholder: "管理员口令",
                            value: "{admin_token}",
                            oninput: move |event| admin_token.set(event.value()),
                        }
                        button { r#type: "submit", "登录后台" }
                    }
                    if let Some(session_notice) = session_notice {
                        p { class: "admin-shell__summary", "{session_notice}" }
                    } else {
                        p {
                            class: "admin-shell__summary",
                            "输入管理员口令后，后台会话会由服务端 cookie 承接。"
                        }
                    }
                    if let Some(error) = request_error {
                        p { class: "admin-shell__summary", "{error}" }
                    }
                }
            },
            AdminShellView::Panel { state, load_error } => rsx! {
                div { class: "admin-shell",
                    div { class: "admin-shell__stats",
                        button {
                            r#type: "button",
                            onclick: move |_| {
                                shell_action.set(AdminShellAction::Logout);
                                action_version += 1;
                            },
                            "退出后台"
                        }
                    }
                    if let Some(error) = load_error {
                        p { class: "admin-shell__summary", "{error}" }
                    }
                    if let Some(error) = request_error {
                        p { class: "admin-shell__summary", "{error}" }
                    }
                    if let Some(state) = state {
                        view::AdminPanel { state: state }
                    } else {
                        p {
                            class: "admin-shell__summary",
                            "后台会话仍有效，但后台数据暂时不可用。"
                        }
                    }
                }
            },
        }
    }
}

pub fn app() -> Element {
    rsx! { AdminApp {} }
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

        assert!(html.contains("Koko 管理后台"));
        assert!(html.contains("管理员口令"));
        assert!(html.contains("登录后台"));
    }

    #[test]
    fn admin_shell_path_detection_accepts_only_exact_admin_entry() {
        assert!(is_admin_shell_path("https://example.com/admin"));
        assert!(!is_admin_shell_path("https://example.com/admin/panel"));
        assert!(!is_admin_shell_path("https://example.com/rooms/a1234"));
    }

    #[test]
    fn root_shell_routes_admin_path_into_admin_component_branch() {
        let mut vdom = VirtualDom::new_with_props(
            RootShellOutlet,
            RootShellOutletProps {
                browser_location: "https://example.com/admin".to_string(),
            },
        );
        vdom.rebuild_in_place();
        let html = dioxus_ssr::render(&vdom);

        assert!(html.contains("Koko 管理后台"));
        assert!(!html.contains("placeholder=\"按房间码搜索\""));
    }

    #[test]
    fn non_auth_admin_load_error_keeps_backend_shell() {
        let view = resolve_admin_panel_view(Err(AdminRequestError {
            code: Some(AppErrorCode::Internal),
            detail: "HTTP 500".to_string(),
        }))
        .unwrap();

        assert_eq!(
            view,
            AdminShellView::Panel {
                state: None,
                load_error: Some("加载后台概览失败：HTTP 500".to_string()),
            }
        );
    }
}
