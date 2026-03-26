use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use koko_core::{
    contract::{ClientWsEvent, ServerWsEvent},
    model::{ProfileId, RoomId},
    port::RoomRepository,
};
use serde::Deserialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    app::AppState,
    chat::PostgresMessageRepository,
    http::ApiError,
    room::PostgresRoomRepository,
};

#[derive(Clone, Default)]
pub struct RealtimeHub {
    inner: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
}

impl RealtimeHub {
    fn subscribe(&self, room_id: RoomId) -> broadcast::Receiver<String> {
        self.channel(room_id).subscribe()
    }

    fn publish(&self, room_id: RoomId, payload: String) {
        let _ = self.channel(room_id).send(payload);
    }

    fn channel(&self, room_id: RoomId) -> broadcast::Sender<String> {
        let mut rooms = self.inner.lock().unwrap();
        rooms.entry(room_id.0)
            .or_insert_with(|| broadcast::channel(128).0)
            .clone()
    }
}

pub(crate) async fn connect(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(query): Query<WsConnectQuery>,
) -> Result<Response, ApiError> {
    let room_id = parse_room_id(&room_id)?;
    let profile_id = parse_profile_id(&query.profile_id)?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    let role = room_repo
        .role_of(room_id, profile_id)
        .await
        .map_err(|_| ApiError::internal("房间成员校验失败"))?;

    if role.is_none() {
        return Err(ApiError::forbidden("不是房间成员"));
    }

    Ok(ws
        .on_upgrade(move |socket| handle_socket(socket, state, room_id, profile_id))
        .into_response())
}

async fn handle_socket(socket: WebSocket, state: AppState, room_id: RoomId, profile_id: ProfileId) {
    let (mut sender, mut receiver) = socket.split();
    let mut room_events = state.realtime.subscribe(room_id);

    loop {
        tokio::select! {
            inbound = receiver.next() => match inbound {
                Some(Ok(Message::Text(text))) => {
                    if let Some(payload) = handle_client_text(&state, room_id, profile_id, &text).await {
                        state.realtime.publish(room_id, payload);
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
            outbound = room_events.recv() => match outbound {
                Ok(payload) => {
                    if sender.send(Message::Text(payload.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}

async fn handle_client_text(
    state: &AppState,
    room_id: RoomId,
    profile_id: ProfileId,
    text: &str,
) -> Option<String> {
    let event: ClientWsEvent = serde_json::from_str(text).ok()?;

    match event {
        ClientWsEvent::SendMessage { content } => {
            let room_repo = PostgresRoomRepository::new(state.pool.clone());
            let message_repo = PostgresMessageRepository::new(state.pool.clone());
            let message = koko_core::chat::send_text_message(
                &room_repo,
                &message_repo,
                room_id,
                profile_id,
                &content,
            )
            .await
            .ok()?;

            serde_json::to_string(&ServerWsEvent::MessageCreated {
                message_id: message.id.0.to_string(),
                room_id: message.room_id.0.to_string(),
                sender_id: message.sender_id.0.to_string(),
                content: message.content.as_str().to_owned(),
            })
            .ok()
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct WsConnectQuery {
    profile_id: String,
}

fn parse_profile_id(raw: &str) -> Result<ProfileId, ApiError> {
    Uuid::parse_str(raw)
        .map(ProfileId)
        .map_err(|_| ApiError::bad_request("profile_id 不合法"))
}

fn parse_room_id(raw: &str) -> Result<RoomId, ApiError> {
    Uuid::parse_str(raw)
        .map(RoomId)
        .map_err(|_| ApiError::bad_request("room_id 不合法"))
}
