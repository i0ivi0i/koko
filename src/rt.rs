use std::sync::Arc;

use axum::http::{HeaderMap, header::COOKIE};
use axum_extra::extract::cookie::Cookie;
use serde::Serialize;
use socketioxide::{
    SocketIo,
    extract::{Data, Extension, SocketRef},
    handler::ConnectHandler,
};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    app::{
        self, AppError, Clock, IdGenerator, MembershipPort, MessageStore, RoomEventPositionPort,
        SendTextMessageInput, SessionPort, SubscribeRoomStreamInput,
    },
    contract::{
        MessageAccepted, RejectedCommandKind, RoomStreamSubscribed, SendTextMessageCommand,
        SubscribeRoomStreamCommand,
    },
};

#[derive(Debug, Clone, Copy)]
pub struct Module;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthenticatedSession {
    pub session_id: Uuid,
}

#[derive(Clone)]
pub struct RealtimeState<Store, IdGen, AppClock> {
    store: Store,
    id_generator: IdGen,
    clock: AppClock,
}

impl<Store, IdGen, AppClock> RealtimeState<Store, IdGen, AppClock> {
    pub fn new(store: Store, id_generator: IdGen, clock: AppClock) -> Self {
        Self {
            store,
            id_generator,
            clock,
        }
    }
}

pub async fn authenticate_realtime_session<S>(
    session_port: &S,
    headers: &HeaderMap,
) -> Result<AuthenticatedSession, AppError>
where
    S: SessionPort,
{
    let session_id = resolve_session_id(headers)?;
    if !session_port.is_active_session(session_id).await? {
        return Err(AppError::SessionNotActive { session_id });
    }

    Ok(AuthenticatedSession { session_id })
}

fn resolve_session_id(headers: &HeaderMap) -> Result<Uuid, AppError> {
    find_session_cookie(headers)?
        .map(|cookie| cookie.value_trimmed().to_owned())
        .map(|value| Uuid::parse_str(&value).map_err(|_| invalid_session_error()))
        .transpose()?
        .ok_or_else(invalid_session_error)
}

fn find_session_cookie(headers: &HeaderMap) -> Result<Option<Cookie<'static>>, AppError> {
    for cookie_header in headers.get_all(COOKIE) {
        let raw_cookie = cookie_header
            .to_str()
            .map_err(|_| invalid_session_error())?;
        for cookie in Cookie::split_parse(raw_cookie).flatten() {
            if cookie.name() == crate::support::SESSION_COOKIE_NAME {
                return Ok(Some(cookie.into_owned()));
            }
        }
    }

    Ok(None)
}

fn warn_handler_failure(handler: &str, error: &AppError) {
    warn!(
        handler,
        code = crate::support::app_error_code(error),
        ?error,
        "realtime handler failed"
    );
}

fn invalid_session_error() -> AppError {
    AppError::SessionNotActive {
        session_id: Uuid::nil(),
    }
}

pub fn subscribe_room_stream_input(
    session: AuthenticatedSession,
    payload: SubscribeRoomStreamCommand,
) -> SubscribeRoomStreamInput {
    SubscribeRoomStreamInput {
        room_id: payload.room_id,
        session_id: session.session_id,
    }
}

pub fn send_text_message_input(
    session: AuthenticatedSession,
    payload: SendTextMessageCommand,
) -> SendTextMessageInput {
    SendTextMessageInput {
        room_id: payload.room_id,
        session_id: session.session_id,
        body: payload.body,
        client_message_id: payload.client_message_id,
    }
}

pub fn install_realtime<Store, IdGen, AppClock>(
    io: &SocketIo,
    state: Arc<RealtimeState<Store, IdGen, AppClock>>,
) where
    Store: SessionPort
        + MembershipPort
        + MessageStore
        + RoomEventPositionPort
        + Clone
        + Send
        + Sync
        + 'static,
    IdGen: IdGenerator + Clone + Send + Sync + 'static,
    AppClock: Clock + Clone + Send + Sync + 'static,
{
    let connect_state = state.clone();
    let on_connect = move |socket: SocketRef| {
        let state = connect_state.clone();
        async move {
            socket.on("subscribe_room_stream", {
                let state = state.clone();
                move |socket: SocketRef,
                      Extension(session): Extension<AuthenticatedSession>,
                      Data(payload): Data<SubscribeRoomStreamCommand>| {
                    let state = state.clone();
                    async move {
                        let room_id = payload.room_id;
                        let input = subscribe_room_stream_input(session, payload);
                        match app::subscribe_room_stream(
                            &state.store,
                            &state.store,
                            &state.store,
                            input,
                        )
                        .await
                        {
                            Ok(subscription) => {
                                info!(
                                    room_id = %room_id,
                                    session_id = %session.session_id,
                                    "subscribe_room_stream ok"
                                );
                                socket.join(room_name(room_id));
                                emit_to_socket(
                                    &socket,
                                    "room_stream_subscribed",
                                    &RoomStreamSubscribed {
                                        room_id: subscription.room_id,
                                        latest_event_position: subscription.latest_event_position,
                                    },
                                );
                            }
                            Err(error) => {
                                emit_command_rejected(
                                    &socket,
                                    &error,
                                    RejectedCommandKind::SubscribeRoomStream,
                                    Some(room_id),
                                    None,
                                );
                                warn!(
                                    room_id = %room_id,
                                    session_id = %session.session_id,
                                    code = crate::support::app_error_code(&error),
                                    ?error,
                                    "subscribe_room_stream rejected"
                                );
                                return;
                            }
                        }
                    }
                }
            });

            socket.on("send_text_message", {
                let state = state.clone();
                move |socket: SocketRef,
                      io: SocketIo,
                      Extension(session): Extension<AuthenticatedSession>,
                      Data(payload): Data<SendTextMessageCommand>| {
                    let state = state.clone();
                    async move {
                        let room_id = payload.room_id;
                        let client_message_id = payload.client_message_id;
                        let request_id = Uuid::now_v7();
                        let input = send_text_message_input(session, payload);
                        match app::send_text_message(
                            &state.store,
                            &state.store,
                            &state.store,
                            &state.id_generator,
                            &state.clock,
                            input,
                        )
                        .await
                        {
                            Ok(crate::contract::AppEvent::MessageCreated(payload)) => {
                                let trace = crate::support::trace_line(
                                    "adapter_rt",
                                    "send_text_message",
                                    &crate::support::TraceContext {
                                        request_id,
                                        session_id: Some(session.session_id),
                                        room_id: Some(room_id),
                                        client_message_id,
                                        event_position: Some(payload.event_position),
                                    },
                                );
                                info!(
                                    trace = %trace,
                                    room_id = %room_id,
                                    session_id = %session.session_id,
                                    client_message_id = ?client_message_id,
                                    "send_text_message accepted"
                                );
                                // transport 级别 accepted 只表示命令已受理，权威成立仍以 message_created 为准。
                                emit_to_socket(
                                    &socket,
                                    "message_accepted",
                                    &MessageAccepted {
                                        room_id,
                                        client_message_id,
                                    },
                                );
                                emit_to_room(&io, room_id, "message_created", &payload).await;
                            }
                            Err(error) => {
                                let trace = crate::support::trace_line(
                                    "adapter_rt",
                                    "send_text_message",
                                    &crate::support::TraceContext {
                                        request_id,
                                        session_id: Some(session.session_id),
                                        room_id: Some(room_id),
                                        client_message_id,
                                        event_position: None,
                                    },
                                );
                                emit_command_rejected(
                                    &socket,
                                    &error,
                                    RejectedCommandKind::SendTextMessage,
                                    Some(room_id),
                                    client_message_id,
                                );
                                warn!(
                                    trace = %trace,
                                    room_id = %room_id,
                                    session_id = %session.session_id,
                                    client_message_id = ?client_message_id,
                                    code = crate::support::app_error_code(&error),
                                    ?error,
                                    "send_text_message rejected"
                                );
                            }
                        }
                    }
                }
            });
        }
    };
    let auth_state = state.clone();
    let auth_middleware = move |socket: SocketRef| {
        let state = auth_state.clone();
        async move {
            let session = match authenticate_realtime_session(&state.store, &socket.req_parts().headers)
                .await
            {
                Ok(session) => session,
                Err(error) => {
                    warn!(
                        code = crate::support::app_error_code(&error),
                        ?error,
                        "rt auth rejected"
                    );
                    return Err(error);
                }
            };
            info!(session_id = %session.session_id, "rt connected");
            socket.extensions.insert(session);
            Ok::<(), AppError>(())
        }
    };

    io.ns("/", on_connect.with(auth_middleware));
}

fn room_name(room_id: Uuid) -> String {
    room_id.to_string()
}

fn emit_command_rejected(
    socket: &SocketRef,
    error: &AppError,
    command: RejectedCommandKind,
    room_id: Option<Uuid>,
    client_message_id: Option<Uuid>,
) {
    emit_to_socket(
        socket,
        "command_rejected",
        &app::command_rejection(error, command, room_id, client_message_id),
    );
}

fn emit_to_socket<T>(socket: &SocketRef, event: &'static str, payload: &T)
where
    T: Serialize,
{
    if socket.emit(event, payload).is_err() {
        warn_handler_failure(event, &AppError::DependencyFailure);
    }
}

async fn emit_to_room<T>(io: &SocketIo, room_id: Uuid, event: &'static str, payload: &T)
where
    T: Serialize,
{
    if io
        .to(room_name(room_id))
        .emit(event, payload)
        .await
        .is_err()
    {
        error!(
            room_id = %room_id,
            event,
            code = crate::support::app_error_code(&AppError::DependencyFailure),
            "broadcast failed"
        );
    }
}
