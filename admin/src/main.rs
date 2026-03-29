use base64::{Engine as _, engine::general_purpose::STANDARD};
use dioxus::prelude::*;
use gloo_net::http::{Request, Response};
use koko_contract::{
    AdminOverviewResponse, AdminRoomDetailResponse, AdminRoomListItem, AdminRoomListResponse,
    BanRoomRequest, GlobalChatPolicyResponse, RoomMemberResponse, RoomMembersResponse,
    RoomGovernanceStateResponse, UpdateGlobalChatPolicyRequest,
};
use serde::de::DeserializeOwned;

const ADMIN_STYLE: &str = r#"
:root{color-scheme:dark;--bg:#091019;--panel:rgba(16,24,35,.92);--line:rgba(145,169,206,.12);--text:#f4f8ff;--muted:#8ea4c6;--accent:#4ba0ff;--danger:#ff8484;--radius:22px;--font:"SF Pro Display","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:radial-gradient(circle at top left,rgba(60,124,255,.14),transparent 28%),linear-gradient(180deg,#0b111a 0%,#091019 100%);color:var(--text);font-family:var(--font)}.shell{min-height:100vh;padding:24px}.login,.layout{width:min(1340px,100%);margin:0 auto}.login{min-height:calc(100vh - 48px);display:grid;place-items:center}.card,.panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:0 24px 80px rgba(0,0,0,.35);backdrop-filter:blur(28px)}.card{width:min(420px,100%);padding:32px;display:flex;flex-direction:column;gap:16px}.eyebrow{margin:0;color:var(--accent);text-transform:uppercase;letter-spacing:.18em;font-size:12px}.title{margin:0;font-size:34px;line-height:1.04}.muted{margin:0;color:var(--muted);line-height:1.6;font-size:14px}.error{margin:0;color:#ff9c9c}.input,.search,.number,.datetime{width:100%;padding:14px 16px;border:1px solid rgba(145,169,206,.16);border-radius:16px;background:rgba(10,16,25,.88);color:var(--text);font:inherit;outline:none}.button,.ghost,.danger{border:0;cursor:pointer;font:inherit;padding:13px 18px;border-radius:16px;transition:transform .14s ease}.button:hover,.ghost:hover,.danger:hover{transform:translateY(-1px)}.button{background:linear-gradient(180deg,#4ba0ff 0%,#2b7cff 100%);color:#fff;font-weight:650}.ghost{background:rgba(91,118,161,.12);color:var(--text)}.danger{background:rgba(255,111,111,.16);color:#ffdede}.layout{display:grid;gap:18px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px}.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.stat{padding:18px;border-radius:18px;background:rgba(24,34,48,.86);border:1px solid rgba(145,169,206,.08)}.stat-label{color:var(--muted);font-size:13px}.stat-value{margin-top:8px;font-size:28px;font-weight:700}.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px}.left,.right{display:flex;flex-direction:column;gap:18px}.panel{padding:18px}.section{margin:0 0 14px;font-size:18px}.row,.actions,.detail-meta{display:flex;gap:12px;flex-wrap:wrap}.list{display:flex;flex-direction:column;gap:10px}.room{padding:14px;border-radius:18px;background:rgba(24,35,49,.92);border:1px solid rgba(145,169,206,.08);cursor:pointer}.room.active{border-color:rgba(75,160,255,.36);background:rgba(26,40,58,.96)}.room-title{font-size:16px;font-weight:650}.room-meta,.member-meta{color:var(--muted);font-size:13px}.members{display:flex;flex-direction:column;gap:10px}.member{padding:12px 14px;border-radius:16px;background:rgba(24,35,49,.92);border:1px solid rgba(145,169,206,.08)}.member-name{font-weight:620}@media(max-width:1100px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}@media(max-width:720px){.shell{padding:16px}.stats{grid-template-columns:1fr}}
"#;

fn main() {
    dioxus::launch(App);
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AdminClient {
    auth_header: String,
}

impl AdminClient {
    fn new(password: &str) -> Self {
        Self {
            auth_header: basic_auth_header(password),
        }
    }

    async fn fetch_overview(&self) -> Result<AdminOverviewResponse, String> {
        self.get_json("/admin/overview").await
    }

    async fn fetch_policy(&self) -> Result<GlobalChatPolicyResponse, String> {
        self.get_json("/admin/policy").await
    }

    async fn update_policy(&self, max_message_length: u32) -> Result<GlobalChatPolicyResponse, String> {
        self.post_json("/admin/policy", &UpdateGlobalChatPolicyRequest { max_message_length }).await
    }

    async fn fetch_rooms(&self, code: Option<&str>) -> Result<Vec<AdminRoomListItem>, String> {
        let path = match code.filter(|value| !value.trim().is_empty()) {
            Some(value) => format!("/admin/rooms?code={}", value.to_ascii_uppercase()),
            None => "/admin/rooms".to_owned(),
        };
        let response: AdminRoomListResponse = self.get_json(&path).await?;
        Ok(response.items)
    }

    async fn fetch_room_detail(&self, room_id: &str) -> Result<AdminRoomDetailResponse, String> {
        self.get_json(&format!("/admin/rooms/{room_id}")).await
    }

    async fn fetch_room_members(&self, room_id: &str) -> Result<Vec<RoomMemberResponse>, String> {
        let response: RoomMembersResponse = self.get_json(&format!("/admin/rooms/{room_id}/members")).await?;
        Ok(response.items)
    }

    async fn ban_room(&self, room_id: &str, banned_until: String, ban_reason: Option<String>) -> Result<RoomGovernanceStateResponse, String> {
        self.post_json(&format!("/admin/rooms/{room_id}/ban"), &BanRoomRequest { banned_until, ban_reason }).await
    }

    async fn unban_room(&self, room_id: &str) -> Result<RoomGovernanceStateResponse, String> {
        let response = Request::post(&format!("{}/admin/rooms/{room_id}/unban", api_base()))
            .header("authorization", &self.auth_header)
            .send()
            .await
            .map_err(|error| format!("请求失败: {error}"))?;
        parse_response(response).await
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let response = Request::get(&format!("{}{}", api_base(), path))
            .header("authorization", &self.auth_header)
            .send()
            .await
            .map_err(|error| format!("请求失败: {error}"))?;
        parse_response(response).await
    }

    async fn post_json<T: DeserializeOwned, B: serde::Serialize>(&self, path: &str, body: &B) -> Result<T, String> {
        let response = Request::post(&format!("{}{}", api_base(), path))
            .header("authorization", &self.auth_header)
            .json(body)
            .map_err(|error| format!("请求构建失败: {error}"))?
            .send()
            .await
            .map_err(|error| format!("请求失败: {error}"))?;
        parse_response(response).await
    }
}

#[component]
fn StatCard(label: &'static str, value: String) -> Element {
    rsx! {
        article { class: "stat",
            div { class: "stat-label", "{label}" }
            div { class: "stat-value", "{value}" }
        }
    }
}

#[component]
fn Login(
    password: String,
    loading: bool,
    error_message: Option<String>,
    on_password: EventHandler<String>,
    on_submit: EventHandler<()>,
) -> Element {
    rsx! {
        div { class: "login",
            div { class: "card",
                p { class: "eyebrow", "Koko / Admin Console" }
                h1 { class: "title", "Koko Admin" }
                p { class: "muted", "输入后台密码后，进入房间治理与全局策略控制台。" }
                if let Some(message) = error_message {
                    p { class: "error", "{message}" }
                }
                input {
                    class: "input",
                    r#type: "password",
                    value: "{password}",
                    placeholder: "输入后台密码",
                    oninput: move |event| on_password.call(event.value()),
                }
                button {
                    class: "button",
                    disabled: loading,
                    onclick: move |_| on_submit.call(()),
                    if loading { "进入中..." } else { "进入后台" }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[component]
fn Dashboard(
    loading: bool,
    error_message: Option<String>,
    overview: Option<AdminOverviewResponse>,
    policy: Option<GlobalChatPolicyResponse>,
    policy_input: String,
    room_query: String,
    rooms: Vec<AdminRoomListItem>,
    selected_room_id: Option<String>,
    selected_room: Option<AdminRoomDetailResponse>,
    members: Vec<RoomMemberResponse>,
    ban_until: String,
    ban_reason: String,
    on_policy_input: EventHandler<String>,
    on_policy_save: EventHandler<()>,
    on_room_query: EventHandler<String>,
    on_room_search: EventHandler<()>,
    on_room_select: EventHandler<String>,
    on_ban_until: EventHandler<String>,
    on_ban_reason: EventHandler<String>,
    on_ban: EventHandler<()>,
    on_unban: EventHandler<()>,
    on_logout: EventHandler<()>,
) -> Element {
    rsx! {
        div { class: "layout",
            header { class: "topbar",
                div {
                    p { class: "eyebrow", "Koko / Admin Console" }
                    h1 { class: "title", "房间治理与全局策略" }
                }
                button { class: "ghost", onclick: move |_| on_logout.call(()), "退出后台" }
            }
            if let Some(message) = error_message {
                p { class: "error", "{message}" }
            }
            if let Some(overview) = overview {
                section { class: "panel",
                    h2 { class: "section", "概览" }
                    div { class: "stats",
                        StatCard { label: "房间总数", value: overview.total_rooms.to_string() }
                        StatCard { label: "成员关系总数", value: overview.total_memberships.to_string() }
                        StatCard { label: "24h 活跃房间", value: overview.active_rooms_24h.to_string() }
                        StatCard { label: "24h 消息量", value: overview.messages_24h.to_string() }
                        StatCard { label: "在线连接数", value: overview.online_connections.to_string() }
                    }
                }
            }
            div { class: "grid",
                div { class: "left",
                    section { class: "panel",
                        h2 { class: "section", "全局消息长度" }
                        if let Some(policy) = policy {
                            p { class: "muted", "当前限制：{policy.max_message_length} 字" }
                        }
                        div { class: "row",
                            input {
                                class: "number",
                                r#type: "number",
                                min: "1",
                                value: "{policy_input}",
                                oninput: move |event| on_policy_input.call(event.value()),
                            }
                            button { class: "button", disabled: loading, onclick: move |_| on_policy_save.call(()), "保存" }
                        }
                    }
                    section { class: "panel",
                        h2 { class: "section", "房间管理" }
                        div { class: "row",
                            input {
                                class: "search",
                                value: "{room_query}",
                                placeholder: "输入房间号搜索",
                                oninput: move |event| on_room_query.call(event.value().to_ascii_uppercase()),
                            }
                            button { class: "ghost", disabled: loading, onclick: move |_| on_room_search.call(()), "搜索" }
                        }
                        div { class: "list",
                            for room in rooms {
                                {
                                    let room_id = room.room_id.clone();
                                    let class = if selected_room_id.as_deref() == Some(room.room_id.as_str()) { "room active" } else { "room" };
                                    rsx! {
                                        article {
                                            key: "{room.room_id}",
                                            class: "{class}",
                                            onclick: move |_| on_room_select.call(room_id.clone()),
                                            div { class: "room-title", "房间 {room.code}" }
                                            p { class: "room-meta", "{room.member_count} 人 · 最近消息 {format_optional_text(&room.last_message_at)}" }
                                            if let Some(until) = room.banned_until.as_ref() {
                                                p { class: "room-meta", "封禁至 {until}" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                div { class: "right",
                    section { class: "panel",
                        h2 { class: "section", "房间详情" }
                        if let Some(detail) = selected_room {
                            div { class: "detail-meta",
                                span { class: "muted", "房间号 {detail.code}" }
                                span { class: "muted", "{detail.member_count} 位成员" }
                            }
                            p { class: "muted", "最近消息：{format_optional_text(&detail.last_message_at)}" }
                            p { class: "muted", "封禁状态：{format_optional_text(&detail.banned_until)}" }
                            if let Some(reason) = detail.ban_reason {
                                p { class: "muted", "封禁原因：{reason}" }
                            }
                            div { class: "row",
                                input {
                                    class: "datetime",
                                    r#type: "datetime-local",
                                    value: "{ban_until}",
                                    oninput: move |event| on_ban_until.call(event.value()),
                                }
                                input {
                                    class: "search",
                                    value: "{ban_reason}",
                                    placeholder: "封禁原因（可选）",
                                    oninput: move |event| on_ban_reason.call(event.value()),
                                }
                            }
                            div { class: "actions",
                                button { class: "danger", disabled: loading, onclick: move |_| on_ban.call(()), "封禁房间" }
                                button { class: "ghost", disabled: loading, onclick: move |_| on_unban.call(()), "解除封禁" }
                            }
                        } else {
                            p { class: "muted", "选择一个房间后查看详情与治理动作。" }
                        }
                    }
                    section { class: "panel",
                        h2 { class: "section", "成员列表" }
                        div { class: "members",
                            for member in members {
                                div { key: "{member.profile_id}", class: "member",
                                    div { class: "member-name", "{member.display_name}" }
                                    div { class: "member-meta", "{member.role} · {member.profile_id}" }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

async fn bootstrap_dashboard(
    client: &AdminClient,
) -> Result<(AdminOverviewResponse, GlobalChatPolicyResponse, Vec<AdminRoomListItem>), String> {
    let overview = client.fetch_overview().await?;
    let policy = client.fetch_policy().await?;
    let rooms = client.fetch_rooms(None).await?;
    Ok((overview, policy, rooms))
}

async fn load_room_context(
    client: &AdminClient,
    room_id: &str,
) -> Result<(AdminRoomDetailResponse, Vec<RoomMemberResponse>), String> {
    let detail = client.fetch_room_detail(room_id).await?;
    let members = client.fetch_room_members(room_id).await?;
    Ok((detail, members))
}

fn api_base() -> &'static str {
    option_env!("KOKO_API_BASE").unwrap_or("http://127.0.0.1:3000")
}

fn basic_auth_header(password: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("admin:{password}")))
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn non_empty_query(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn normalize_ban_until(value: &str) -> String {
    #[cfg(target_arch = "wasm32")]
    {
        if !value.trim().is_empty() {
            let date = js_sys::Date::new(&value.into());
            if !date.get_time().is_nan() {
                return date
                    .to_iso_string()
                    .as_string()
                    .unwrap_or_else(|| value.to_string());
            }
        }
    }

    value.to_string()
}

fn datetime_local_value(_value: Option<&str>) -> String {
    #[cfg(target_arch = "wasm32")]
    {
        if let Some(value) = _value {
            let date = js_sys::Date::new(&value.into());
            if !date.get_time().is_nan() {
                let year = date.get_full_year() as i32;
                let month = date.get_month() + 1;
                let day = date.get_date();
                let hours = date.get_hours();
                let minutes = date.get_minutes();
                return format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}");
            }
        }
    }

    String::new()
}

fn format_optional_text(value: &Option<String>) -> String {
    value.clone().unwrap_or_else(|| "未设置".to_string())
}

async fn parse_response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    if response.ok() {
        return response
            .json()
            .await
            .map_err(|error| format!("响应解析失败: {error}"));
    }

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status == 401 {
        Err("后台密码错误".to_string())
    } else if text.trim().is_empty() {
        Err(format!("请求失败: HTTP {status}"))
    } else {
        Err(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dioxus::prelude::{Element, VirtualDom, rsx};

    #[test]
    fn admin_login_view_should_render_password_gate() {
        #[component]
        fn TestLogin() -> Element {
            rsx! {
                Login {
                    password: String::new(),
                    loading: false,
                    error_message: None,
                    on_password: move |_| {},
                    on_submit: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestLogin);
        dom.rebuild_in_place();
        let markup = dioxus_ssr::render(&dom);

        assert!(markup.contains("Koko Admin"));
        assert!(markup.contains("输入后台密码"));
    }

    #[test]
    fn admin_dashboard_should_render_policy_entry() {
        #[component]
        fn TestDashboard() -> Element {
            rsx! {
                Dashboard {
                    loading: false,
                    error_message: None,
                    overview: Some(AdminOverviewResponse {
                        total_rooms: 3,
                        total_memberships: 9,
                        active_rooms_24h: 2,
                        messages_24h: 18,
                        online_connections: 4,
                    }),
                    policy: Some(GlobalChatPolicyResponse { max_message_length: 2000 }),
                    policy_input: "2000".to_string(),
                    room_query: String::new(),
                    rooms: vec![AdminRoomListItem {
                        room_id: "room-1".to_string(),
                        code: "1A234".to_string(),
                        member_count: 5,
                        last_message_at: Some("2026-03-27T12:34:56Z".to_string()),
                        banned_until: None,
                        ban_reason: None,
                    }],
                    selected_room_id: Some("room-1".to_string()),
                    selected_room: Some(AdminRoomDetailResponse {
                        room_id: "room-1".to_string(),
                        code: "1A234".to_string(),
                        member_count: 5,
                        last_message_at: Some("2026-03-27T12:34:56Z".to_string()),
                        banned_until: None,
                        ban_reason: None,
                    }),
                    members: vec![RoomMemberResponse {
                        profile_id: "member-1".to_string(),
                        display_name: "匿名用户".to_string(),
                        role: "owner".to_string(),
                        can_promote: false,
                        can_mute: false,
                        can_remove: false,
                    }],
                    ban_until: String::new(),
                    ban_reason: String::new(),
                    on_policy_input: move |_| {},
                    on_policy_save: move |_| {},
                    on_room_query: move |_| {},
                    on_room_search: move |_| {},
                    on_room_select: move |_| {},
                    on_ban_until: move |_| {},
                    on_ban_reason: move |_| {},
                    on_ban: move |_| {},
                    on_unban: move |_| {},
                    on_logout: move |_| {},
                }
            }
        }

        let mut dom = VirtualDom::new(TestDashboard);
        dom.rebuild_in_place();
        let markup = dioxus_ssr::render(&dom);

        assert!(markup.contains("全局消息长度"));
        assert!(markup.contains("房间管理"));
        assert!(markup.contains("在线连接数"));
    }

    #[test]
    fn basic_auth_header_should_encode_admin_password() {
        assert_eq!(
            basic_auth_header("test-admin-password"),
            "Basic YWRtaW46dGVzdC1hZG1pbi1wYXNzd29yZA=="
        );
    }

    #[test]
    fn api_base_should_default_to_local_server() {
        assert_eq!(api_base(), "http://127.0.0.1:3000");
    }
}

#[component]
fn App() -> Element {
    let mut password = use_signal(String::new);
    let mut client = use_signal(|| None::<AdminClient>);
    let mut loading = use_signal(|| false);
    let mut error = use_signal(|| None::<String>);
    let mut overview = use_signal(|| None::<AdminOverviewResponse>);
    let mut policy = use_signal(|| None::<GlobalChatPolicyResponse>);
    let mut max_message_length = use_signal(|| "2000".to_string());
    let mut room_query = use_signal(String::new);
    let mut rooms = use_signal(Vec::<AdminRoomListItem>::new);
    let mut selected_room_id = use_signal(|| None::<String>);
    let mut room_detail = use_signal(|| None::<AdminRoomDetailResponse>);
    let mut room_members = use_signal(Vec::<RoomMemberResponse>::new);
    let mut ban_until = use_signal(String::new);
    let mut ban_reason = use_signal(String::new);

    let content = if let Some(current_client) = client() {
        let policy_client = current_client.clone();
        let search_client = current_client.clone();
        let select_client = current_client.clone();
        let ban_client = current_client.clone();
        let unban_client = current_client.clone();
        rsx! {
            Dashboard {
                loading: loading(),
                error_message: error(),
                overview: overview(),
                policy: policy(),
                policy_input: max_message_length(),
                room_query: room_query(),
                rooms: rooms(),
                selected_room_id: selected_room_id(),
                selected_room: room_detail(),
                members: room_members(),
                ban_until: ban_until(),
                ban_reason: ban_reason(),
                on_policy_input: move |value| max_message_length.set(value),
                on_policy_save: move |_| {
                    let client = policy_client.clone();
                    let mut loading = loading;
                    let mut error = error;
                    let mut policy = policy;
                    let mut max_message_length = max_message_length;
                    spawn(async move {
                        loading.set(true);
                        error.set(None);
                        match max_message_length().trim().parse::<u32>() {
                            Ok(value) => match client.update_policy(value).await {
                                Ok(updated) => {
                                    max_message_length.set(updated.max_message_length.to_string());
                                    policy.set(Some(updated));
                                }
                                Err(reason) => error.set(Some(reason)),
                            },
                            Err(_) => error.set(Some("最大消息长度必须是整数".to_string())),
                        }
                        loading.set(false);
                    });
                },
                on_room_query: move |value| room_query.set(value),
                on_room_search: move |_| {
                    let client = search_client.clone();
                    let mut loading = loading;
                    let mut error = error;
                    let mut rooms = rooms;
                    let query = room_query();
                    spawn(async move {
                        loading.set(true);
                        error.set(None);
                        match client.fetch_rooms(non_empty_query(&query)).await {
                            Ok(items) => rooms.set(items),
                            Err(reason) => error.set(Some(reason)),
                        }
                        loading.set(false);
                    });
                },
                on_room_select: move |room_id: String| {
                    let client = select_client.clone();
                    let mut loading = loading;
                    let mut error = error;
                    let mut selected_room_id = selected_room_id;
                    let mut room_detail = room_detail;
                    let mut room_members = room_members;
                    let mut ban_until = ban_until;
                    let mut ban_reason = ban_reason;
                    spawn(async move {
                        loading.set(true);
                        error.set(None);
                        selected_room_id.set(Some(room_id.clone()));
                        match load_room_context(&client, &room_id).await {
                            Ok((detail, members)) => {
                                ban_until.set(datetime_local_value(detail.banned_until.as_deref()));
                                ban_reason.set(detail.ban_reason.clone().unwrap_or_default());
                                room_detail.set(Some(detail));
                                room_members.set(members);
                            }
                            Err(reason) => error.set(Some(reason)),
                        }
                        loading.set(false);
                    });
                },
                on_ban_until: move |value| ban_until.set(value),
                on_ban_reason: move |value| ban_reason.set(value),
                on_ban: move |_| {
                    let Some(room_id) = selected_room_id() else { return; };
                    let client = ban_client.clone();
                    let mut loading = loading;
                    let mut error = error;
                    let mut room_detail = room_detail;
                    let mut room_members = room_members;
                    let mut rooms = rooms;
                    let query = room_query();
                    let ban_until_value = ban_until();
                    let ban_reason_value = ban_reason();
                    spawn(async move {
                        loading.set(true);
                        error.set(None);
                        let banned_until = normalize_ban_until(&ban_until_value);
                        if banned_until.is_empty() {
                            error.set(Some("请填写封禁截止时间".to_string()));
                            loading.set(false);
                            return;
                        }
                        match client.ban_room(&room_id, banned_until, non_empty_string(&ban_reason_value)).await {
                            Ok(_) => {
                                if let Ok((detail, members)) = load_room_context(&client, &room_id).await {
                                    room_detail.set(Some(detail));
                                    room_members.set(members);
                                }
                                if let Ok(items) = client.fetch_rooms(non_empty_query(&query)).await {
                                    rooms.set(items);
                                }
                            }
                            Err(reason) => error.set(Some(reason)),
                        }
                        loading.set(false);
                    });
                },
                on_unban: move |_| {
                    let Some(room_id) = selected_room_id() else { return; };
                    let client = unban_client.clone();
                    let mut loading = loading;
                    let mut error = error;
                    let mut room_detail = room_detail;
                    let mut room_members = room_members;
                    let mut rooms = rooms;
                    let mut ban_until = ban_until;
                    let mut ban_reason = ban_reason;
                    let query = room_query();
                    spawn(async move {
                        loading.set(true);
                        error.set(None);
                        match client.unban_room(&room_id).await {
                            Ok(_) => {
                                ban_until.set(String::new());
                                ban_reason.set(String::new());
                                if let Ok((detail, members)) = load_room_context(&client, &room_id).await {
                                    room_detail.set(Some(detail));
                                    room_members.set(members);
                                }
                                if let Ok(items) = client.fetch_rooms(non_empty_query(&query)).await {
                                    rooms.set(items);
                                }
                            }
                            Err(reason) => error.set(Some(reason)),
                        }
                        loading.set(false);
                    });
                },
                on_logout: move |_| {
                    client.set(None);
                    password.set(String::new());
                    loading.set(false);
                    error.set(None);
                    overview.set(None);
                    policy.set(None);
                    max_message_length.set("2000".to_string());
                    room_query.set(String::new());
                    rooms.set(Vec::new());
                    selected_room_id.set(None);
                    room_detail.set(None);
                    room_members.set(Vec::new());
                    ban_until.set(String::new());
                    ban_reason.set(String::new());
                },
            }
        }
    } else {
        rsx! {
            Login {
                password: password(),
                loading: loading(),
                error_message: error(),
                on_password: move |value| password.set(value),
                on_submit: move |_| {
                    let candidate = password();
                    let current_client = AdminClient::new(&candidate);
                    let mut client = client;
                    let mut loading = loading;
                    let mut error = error;
                    let mut overview = overview;
                    let mut policy = policy;
                    let mut max_message_length = max_message_length;
                    let mut rooms = rooms;
                    let mut room_detail = room_detail;
                    let mut room_members = room_members;
                    let mut selected_room_id = selected_room_id;
                    let mut ban_until = ban_until;
                    let mut ban_reason = ban_reason;
                    spawn(async move {
                        loading.set(true);
                        error.set(None);
                        match bootstrap_dashboard(&current_client).await {
                            Ok((fetched_overview, fetched_policy, fetched_rooms)) => {
                                max_message_length.set(fetched_policy.max_message_length.to_string());
                                overview.set(Some(fetched_overview));
                                policy.set(Some(fetched_policy));
                                rooms.set(fetched_rooms.clone());
                                if let Some(first_room) = fetched_rooms.first() {
                                    selected_room_id.set(Some(first_room.room_id.clone()));
                                    if let Ok((detail, members)) = load_room_context(&current_client, &first_room.room_id).await {
                                        ban_until.set(datetime_local_value(detail.banned_until.as_deref()));
                                        ban_reason.set(detail.ban_reason.clone().unwrap_or_default());
                                        room_detail.set(Some(detail));
                                        room_members.set(members);
                                    }
                                }
                                client.set(Some(current_client));
                            }
                            Err(reason) => error.set(Some(reason)),
                        }
                        loading.set(false);
                    });
                },
            }
        }
    };

    rsx! {
        document::Title { "Koko Admin" }
        document::Style { "{ADMIN_STYLE}" }
        div { class: "shell", {content} }
    }
}
