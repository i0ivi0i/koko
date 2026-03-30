use std::sync::Arc;

use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tracing::warn;
use uuid::Uuid;

use crate::{
    app::{self, AppError, Clock, IdGenerator, MembershipPort, MessageStore, SessionPort},
    contract::{
        CommandRejected, MessageCreated, RoomStreamSubscribed, SendTextMessageCommand,
        SubscribeRoomStreamCommand,
    },
};

#[derive(Debug, Clone, Copy)]
pub struct Module;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RealtimeEffect {
    JoinRoom { room_id: Uuid },
    EmitRoomStreamSubscribed { room_id: Uuid },
    EmitMessageAccepted(MessageCreated),
    EmitCommandRejected(CommandRejected),
    BroadcastMessageCreated { room_id: Uuid, payload: MessageCreated },
}

#[derive(Debug, PartialEq, Eq)]
pub struct CommandPlan<T> {
    pub effects: Vec<RealtimeEffect>,
    pub result: Result<T, AppError>,
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

fn warn_handler_failure(handler: &str, error: &AppError) {
    warn!(
        handler,
        code = crate::support::app_error_code(error),
        ?error,
        "realtime handler failed"
    );
}

pub struct SubscribeRoomStreamDeps<'a, S, M> {
    pub session_port: &'a S,
    pub membership_port: &'a M,
}

pub struct SendTextMessageDeps<'a, S, M, Store, I, C> {
    pub session_port: &'a S,
    pub membership_port: &'a M,
    pub message_store: &'a Store,
    pub id_generator: &'a I,
    pub clock: &'a C,
}

pub async fn plan_subscribe_room_stream<S, M>(
    deps: SubscribeRoomStreamDeps<'_, S, M>,
    command: SubscribeRoomStreamCommand,
) -> CommandPlan<()>
where
    S: SessionPort,
    M: app::MembershipPort,
{
    match app::subscribe_room_stream(deps.session_port, deps.membership_port, command.clone()).await
    {
        Ok(()) => CommandPlan {
            effects: vec![
                RealtimeEffect::JoinRoom {
                    room_id: command.room_id,
                },
                RealtimeEffect::EmitRoomStreamSubscribed {
                    room_id: command.room_id,
                },
            ],
            result: Ok(()),
        },
        Err(error) => CommandPlan {
            effects: vec![RealtimeEffect::EmitCommandRejected(CommandRejected {
                code: error.code(),
            })],
            result: Err(error),
        },
    }
}

pub async fn plan_send_text_message<S, M, Store, I, C>(
    deps: SendTextMessageDeps<'_, S, M, Store, I, C>,
    command: SendTextMessageCommand,
) -> CommandPlan<MessageCreated>
where
    S: SessionPort,
    M: MembershipPort,
    Store: MessageStore,
    I: IdGenerator,
    C: Clock,
{
    let room_id = command.room_id;
    let event = match app::send_text_message(
        deps.session_port,
        deps.membership_port,
        deps.message_store,
        deps.id_generator,
        deps.clock,
        command,
    )
    .await
    {
        Ok(event) => event,
        Err(error) => {
            return CommandPlan {
                effects: vec![RealtimeEffect::EmitCommandRejected(CommandRejected {
                    code: error.code(),
                })],
                result: Err(error),
            };
        }
    };

    match event {
        crate::contract::AppEvent::MessageCreated(payload) => CommandPlan {
            effects: vec![
                RealtimeEffect::EmitMessageAccepted(payload.clone()),
                RealtimeEffect::BroadcastMessageCreated {
                    room_id,
                    payload: payload.clone(),
                },
            ],
            result: Ok(payload),
        },
    }
}

pub fn install_realtime<Store, IdGen, AppClock>(
    io: &SocketIo,
    state: Arc<RealtimeState<Store, IdGen, AppClock>>,
) where
    Store: SessionPort + MembershipPort + MessageStore + Clone + Send + Sync + 'static,
    IdGen: IdGenerator + Clone + Send + Sync + 'static,
    AppClock: Clock + Clone + Send + Sync + 'static,
{
    io.ns("/", move |socket: SocketRef, io: SocketIo| {
        let state = state.clone();
        async move {
            let subscribe_io = io.clone();
            let message_io = io.clone();

            socket.on("subscribe_room_stream", {
                let state = state.clone();
                let io = subscribe_io.clone();
                move |socket: SocketRef, Data(command): Data<SubscribeRoomStreamCommand>| {
                    let state = state.clone();
                    let io = io.clone();
                    async move {
                        let plan = plan_subscribe_room_stream(
                            SubscribeRoomStreamDeps {
                                session_port: &state.store,
                                membership_port: &state.store,
                            },
                            command,
                        )
                        .await;

                        if let Err(error) = apply_effects(&socket, &io, plan.effects).await {
                            warn_handler_failure("subscribe_room_stream", &error);
                        }
                        if let Err(error) = plan.result {
                            warn_handler_failure("subscribe_room_stream", &error);
                        }
                    }
                }
            });

            socket.on("send_text_message", {
                let state = state.clone();
                let io = message_io.clone();
                move |socket: SocketRef, Data(command): Data<SendTextMessageCommand>| {
                    let state = state.clone();
                    let io = io.clone();
                    async move {
                        let plan = plan_send_text_message(
                            SendTextMessageDeps {
                                session_port: &state.store,
                                membership_port: &state.store,
                                message_store: &state.store,
                                id_generator: &state.id_generator,
                                clock: &state.clock,
                            },
                            command,
                        )
                        .await;

                        if let Err(error) = apply_effects(&socket, &io, plan.effects).await {
                            warn_handler_failure("send_text_message", &error);
                        }
                        if let Err(error) = plan.result {
                            warn_handler_failure("send_text_message", &error);
                        }
                    }
                }
            });
        }
    });
}

async fn apply_effects(
    socket: &SocketRef,
    io: &SocketIo,
    effects: Vec<RealtimeEffect>,
) -> Result<(), AppError> {
    for effect in effects {
        match effect {
            RealtimeEffect::JoinRoom { room_id } => {
                socket.join(room_id.to_string());
            }
            RealtimeEffect::EmitRoomStreamSubscribed { room_id } => {
                socket
                    .emit("room_stream_subscribed", &RoomStreamSubscribed { room_id })
                    .map_err(|_| AppError::DependencyFailure)?;
            }
            RealtimeEffect::EmitMessageAccepted(payload) => {
                socket
                    .emit("message_accepted", &payload)
                    .map_err(|_| AppError::DependencyFailure)?;
            }
            RealtimeEffect::EmitCommandRejected(payload) => {
                socket
                    .emit("command_rejected", &payload)
                    .map_err(|_| AppError::DependencyFailure)?;
            }
            RealtimeEffect::BroadcastMessageCreated { room_id, payload } => {
                io.to(room_id.to_string())
                    .emit("message_created", &payload)
                    .await
                    .map_err(|_| AppError::DependencyFailure)?;
            }
        }
    }

    Ok(())
}
