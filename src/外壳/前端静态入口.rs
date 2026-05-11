use axum::{
    Router,
    http::{HeaderValue, StatusCode, header},
    response::{Html, IntoResponse},
    routing::get,
};
use serde::Deserialize;
use std::fs;
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::response::SetResponseHeaderLayer,
};

use super::{协议响应::err_resp, 应用状态};

/// hashed 静态资源清单只回答“当前构建产物的入口文件是谁”。
/// 它不承载房间、成员、媒体或恢复真相。
#[derive(Deserialize)]
struct 前端静态资源清单 {
    app_js: String,
    app_css: String,
}

/// 前端静态入口 owner 只做三件事：
/// 1. 根 HTML 回源；
/// 2. service worker 根作用域挂载；
/// 3. hashed 资源长期缓存。
pub(crate) fn 构建前端静态资源路由() -> Router<应用状态> {
    let html_router = Router::<应用状态>::new()
        // 入口 HTML 必须始终回源确认最新 manifest。
        // 只有这样，浏览器才能持续拿到当前这轮构建对应的 hashed 资源 URL。
        .route("/", get(load_frontend_index))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));
    let root_scope_service_worker_router = Router::<应用状态>::new()
        // App shell worker 负责根导航兜底。
        // 它必须挂在根路径，浏览器才能以 "/" scope 接管离线重载与房间恢复。
        .route_service("/app-sw.js", ServeFile::new("frontend/dist/app-sw.js"))
        .route_service("/media-sw.js", ServeFile::new("frontend/dist/media-sw.js"))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("service-worker-allowed"),
            HeaderValue::from_static("/"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));
    let assets_router = Router::<应用状态>::new()
        // 带 hash 的静态资源 URL 已经自带内容指纹。
        // 因此这里改成长期强缓存，避免继续让移动端在每个子资源上反复回源。
        .nest_service("/dist", ServeDir::new("frontend/dist"))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));
    html_router
        .merge(root_scope_service_worker_router)
        .merge(assets_router)
}

fn 读取前端静态资源清单() -> Result<前端静态资源清单, String> {
    let raw = fs::read_to_string("frontend/dist/asset-manifest.json")
        .map_err(|err| format!("读取前端静态资源清单失败: {err}"))?;
    serde_json::from_str::<前端静态资源清单>(&raw)
        .map_err(|err| format!("解析前端静态资源清单失败: {err}"))
}

fn 渲染前端入口_html() -> Result<String, String> {
    let template = fs::read_to_string("frontend/index.html")
        .map_err(|err| format!("读取前端入口模板失败: {err}"))?;
    let manifest = 读取前端静态资源清单()?;
    Ok(template
        .replace("{{APP_CSS_PATH}}", manifest.app_css.as_str())
        .replace("{{APP_JS_PATH}}", manifest.app_js.as_str()))
}

async fn load_frontend_index() -> impl IntoResponse {
    match 渲染前端入口_html() {
        Ok(html) => Html(html).into_response(),
        Err(err) => {
            tracing::error!(%err, "渲染前端入口失败");
            err_resp(StatusCode::INTERNAL_SERVER_ERROR, "system_error", "系统错误")
        }
    }
}
