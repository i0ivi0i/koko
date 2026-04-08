use super::*;

/// 房间冷路径外壳。
///
/// 当前阶段说明：
/// 1. 这个文件先只承接“接线入口”，用于把总壳拆成更清楚的职责边界。
/// 2. 真实实现暂时仍留在父模块 [外壳.rs] 中，后续任务会把函数体逐步迁进来。
/// 3. 这里的转调必须保持零语义变化，不能顺手改参数、错误码或日志字段。
pub(super) async fn bootstrap_session(
    State(state): State<应用状态>,
    Json(body): Json<BootstrapBody>,
) -> impl IntoResponse {
    super::bootstrap_session(State(state), Json(body)).await
}

/// 进房或建房的临时桥接入口。
pub(super) async fn join_or_create_room(
    State(state): State<应用状态>,
    Json(body): Json<JoinBody>,
) -> impl IntoResponse {
    super::join_or_create_room(State(state), Json(body)).await
}

/// 房间快照查询的临时桥接入口。
pub(super) async fn load_room_snapshot(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(query): Query<SnapshotQuery>,
) -> impl IntoResponse {
    super::load_room_snapshot(State(state), Path(room_id), Query(query)).await
}

/// 阅读推进的临时桥接入口。
pub(super) async fn update_room_read_anchor(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Json(body): Json<UpdateReadAnchorBody>,
) -> impl IntoResponse {
    super::update_room_read_anchor(State(state), Path(room_id), Json(body)).await
}

/// 增量事件查询的临时桥接入口。
pub(super) async fn load_room_events(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    super::load_room_events(State(state), Path(room_id), Query(raw_query)).await
}

/// 历史分页查询的临时桥接入口。
pub(super) async fn load_room_history(
    State(state): State<应用状态>,
    Path(room_id): Path<String>,
    Query(raw_query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    super::load_room_history(State(state), Path(room_id), Query(raw_query)).await
}
