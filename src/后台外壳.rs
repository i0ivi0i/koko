use super::*;

/// 后台 HTTP 外壳。
///
/// 当前阶段先只建立独立文件和公开接线点，真实实现仍从父模块转调。
/// 这样做的目的是先验证“边界拆开但语义不变”是否成立，再逐步迁入具体实现。
pub(super) async fn admin_login(
    State(state): State<应用状态>,
    Json(body): Json<AdminLoginBody>,
) -> impl IntoResponse {
    super::admin_login(State(state), Json(body)).await
}

/// 后台概览查询的临时桥接入口。
pub(super) async fn admin_overview(
    State(state): State<应用状态>,
    headers: HeaderMap,
) -> impl IntoResponse {
    super::admin_overview(State(state), headers).await
}

/// 后台房间列表查询的临时桥接入口。
pub(super) async fn admin_rooms(
    State(state): State<应用状态>,
    headers: HeaderMap,
) -> impl IntoResponse {
    super::admin_rooms(State(state), headers).await
}

/// 后台房间详情查询的临时桥接入口。
pub(super) async fn admin_room_detail(
    State(state): State<应用状态>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    super::admin_room_detail(State(state), headers, Path(room_id)).await
}
