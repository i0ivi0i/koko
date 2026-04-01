pub mod admin;
pub mod app;
pub mod chat;
pub mod contract;
pub mod domain;
#[cfg(not(target_arch = "wasm32"))]
pub mod http;
#[cfg(not(target_arch = "wasm32"))]
pub mod rt;
#[cfg(not(target_arch = "wasm32"))]
pub mod store;
pub mod support;
pub mod view;
pub mod web;

#[cfg(not(target_arch = "wasm32"))]
pub fn assemble_app(
    store: store::PgStore,
    admin_token: String,
    frontend_dist_dir: impl Into<std::path::PathBuf>,
    asset_dir: impl Into<std::path::PathBuf>,
) -> axum::Router {
    let (socket_layer, io) = socketioxide::SocketIo::new_layer();
    let realtime = std::sync::Arc::new(rt::RealtimeState::new(
        store.clone(),
        support::SystemIdGenerator,
        support::SystemClock,
    ));
    rt::install_realtime(&io, realtime);
    http::app_router(store, admin_token, frontend_dist_dir, asset_dir).layer(socket_layer)
}
