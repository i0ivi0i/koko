use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use koko_contract::{ClientWsEvent, ServerWsEvent};
use koko_core::model::{ProfileId, RoomId};
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    app::AppState, http::ApiError, message_repo::PostgresMessageRepository,
    room_repo::PostgresRoomRepository, session,
};

#[derive(Clone, Default)]
pub struct RealtimeHub {
    inner: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>,
    online_connections: Arc<AtomicUsize>,
}

impl RealtimeHub {
    pub(crate) fn subscribe(&self, room_id: RoomId) -> broadcast::Receiver<String> {
        self.channel(room_id).subscribe()
    }

    pub(crate) fn publish(&self, room_id: RoomId, payload: String) {
        let _ = self.channel(room_id).send(payload);
    }

    pub(crate) fn online_connections(&self) -> u64 {
        self.online_connections.load(Ordering::Relaxed) as u64
    }

    pub(crate) fn connection_opened(&self) {
        self.online_connections.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn connection_closed(&self) {
        self.online_connections.fetch_sub(1, Ordering::Relaxed);
    }

    fn channel(&self, room_id: RoomId) -> broadcast::Sender<String> {
        let mut rooms = self.inner.lock().unwrap();
        rooms
            .entry(room_id.0)
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
    let session = session::authenticate_session(&state.pool, &query.session_id).await?;
    let room_repo = PostgresRoomRepository::new(state.pool.clone());

    koko_core::room::ensure_can_read_room(&room_repo, room_id, session.profile_id)
        .await
        .map_err(crate::http::map_domain_error)?;

    Ok(ws
        .on_upgrade(move |socket| handle_socket(socket, state, room_id, session.profile_id))
        .into_response())
}

async fn handle_socket(socket: WebSocket, state: AppState, room_id: RoomId, profile_id: ProfileId) {
    state.online_connection_opened();
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

    state.online_connection_closed();
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
                created_at: message.created_at.format(&Rfc3339).ok()?,
            })
            .ok()
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct WsConnectQuery {
    session_id: String,
}

fn parse_room_id(raw: &str) -> Result<RoomId, ApiError> {
    Uuid::parse_str(raw)
        .map(RoomId)
        .map_err(|_| ApiError::bad_request("room_id 不合法"))
}
