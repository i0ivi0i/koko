use dioxus::prelude::*;
use futures_util::StreamExt;
use gloo_net::{
    http::Request,
    websocket::{futures::WebSocket, Message},
};
use koko_core::contract::{
    BootstrapSessionRequest, BootstrapSessionResponse, JoinOrCreateRoomRequest,
    JoinOrCreateRoomResponse, MessageResponse, ResolveRoomRequest, ResolveRoomResponse,
    RoomMemberResponse, RoomMembersResponse, RoomMessagesResponse, SendMessageRequest,
    PromoteAdminRequest, GovernanceActorRequest,
    ServerWsEvent,
};

use crate::{
    chat::ChatScreen,
    member::MemberSheet,
    room::RoomEntryScreen,
    theme::APP_STYLE,
};

#[derive(Clone, PartialEq)]
struct ActiveRoom {
    session_id: String,
    profile_id: String,
    display_name: String,
    room_id: String,
    room_code: String,
    role: String,
    messages: Vec<MessageResponse>,
    members: Vec<RoomMemberResponse>,
}

#[component]
pub fn App() -> Element {
    let mut active_room = use_signal(|| None::<String>);
    let mut members_open = use_signal(|| false);
    let mut room_state = use_signal(|| None::<ActiveRoom>);
    let loading = use_signal(|| false);
    let mut error_message = use_signal(|| None::<String>);

    rsx! {
        document::Title { "Koko" }
        document::Style { "{APP_STYLE}" }

        div { class: "app-shell",
            if let Some(room) = room_state() {
                ChatScreen {
                    room_code: room.room_code.clone(),
                    profile_id: room.profile_id.clone(),
                    display_name: room.display_name.clone(),
                    messages: room.messages.clone(),
                    member_count: room.members.len(),
                    on_back: move |_| {
                        active_room.set(None);
                        room_state.set(None);
                        members_open.set(false);
                        error_message.set(None);
                    },
                    on_open_members: move |_| members_open.set(true),
                    on_send: move |content: String| {
                        if let Some(current_room) = room_state() {
                            let mut room_state = room_state;
                            spawn(async move {
                                if let Ok(message) = send_message(&current_room.room_id, &current_room.profile_id, &content).await {
                                    room_state.with_mut(|state| {
                                        if let Some(room) = state.as_mut()
                                            && !room.messages.iter().any(|item| item.message_id == message.message_id)
                                        {
                                            room.messages.push(message);
                                        }
                                    });
                                }
                            });
                        }
                    },
                }
                MemberSheet {
                    open: members_open(),
                    current_role: room.role.clone(),
                    current_profile_id: room.profile_id.clone(),
                    members: room.members.clone(),
                    on_promote: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            let mut room_state = room_state;
                            spawn(async move {
                                let _ = promote_member(&room.room_id, &room.profile_id, &target_profile_id).await;
                                if let Ok(members) = fetch_room_members(&room.room_id).await {
                                    room_state.with_mut(|state| {
                                        if let Some(current) = state.as_mut() {
                                            current.members = members;
                                        }
                                    });
                                }
                            });
                        }
                    },
                    on_mute: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            let mut room_state = room_state;
                            spawn(async move {
                                let _ = mute_member(&room.room_id, &room.profile_id, &target_profile_id).await;
                                if let Ok(members) = fetch_room_members(&room.room_id).await {
                                    room_state.with_mut(|state| {
                                        if let Some(current) = state.as_mut() {
                                            current.members = members;
                                        }
                                    });
                                }
                            });
                        }
                    },
                    on_remove: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            let mut room_state = room_state;
                            spawn(async move {
                                let _ = remove_member(&room.room_id, &room.profile_id, &target_profile_id).await;
                                if let Ok(members) = fetch_room_members(&room.room_id).await {
                                    room_state.with_mut(|state| {
                                        if let Some(current) = state.as_mut() {
                                            current.members = members;
                                        }
                                    });
                                }
                            });
                        }
                    },
                    on_close: move |_| members_open.set(false),
                }
            } else {
                RoomEntryScreen {
                    loading: loading(),
                    error_message: error_message(),
                    on_enter: move |code: String| {
                        let mut active_room = active_room;
                        let mut room_state = room_state;
                        let mut loading = loading;
                        let mut error_message = error_message;

                        spawn(async move {
                            loading.set(true);
                            error_message.set(None);

                            match join_room(&code).await {
                                Ok(room) => {
                                    active_room.set(Some(room.room_code.clone()));
                                    let room_id = room.room_id.clone();
                                    let profile_id = room.profile_id.clone();
                                    room_state.set(Some(room));
                                    spawn(listen_room_events(room_id, profile_id, room_state));
                                }
                                Err(error) => error_message.set(Some(error)),
                            }

                            loading.set(false);
                        });
                    },
                }
            }
        }
    }
}

async fn join_room(code: &str) -> Result<ActiveRoom, String> {
    let session: BootstrapSessionResponse = Request::post(&format!("{}/session/bootstrap", api_base()))
        .json(&BootstrapSessionRequest {
            device_key: format!("web-{}", code.to_ascii_lowercase()),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let _: ResolveRoomResponse = Request::post(&format!("{}/rooms/resolve", api_base()))
        .json(&ResolveRoomRequest {
            code: code.to_ascii_uppercase(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let joined: JoinOrCreateRoomResponse = Request::post(&format!("{}/rooms/join-or-create", api_base()))
        .json(&JoinOrCreateRoomRequest {
            profile_id: session.profile_id.clone(),
            code: code.to_ascii_uppercase(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let messages: RoomMessagesResponse = Request::get(&format!("{}/rooms/{}/messages", api_base(), joined.room_id))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let members: RoomMembersResponse = Request::get(&format!("{}/rooms/{}/members", api_base(), joined.room_id))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;

    Ok(ActiveRoom {
        session_id: session.session_id,
        profile_id: session.profile_id,
        display_name: session.display_name,
        room_id: joined.room_id,
        room_code: joined.code,
        role: joined.role,
        messages: messages.items,
        members: members.items,
    })
}

async fn fetch_room_members(room_id: &str) -> Result<Vec<RoomMemberResponse>, String> {
    let members: RoomMembersResponse =
        Request::get(&format!("{}/rooms/{room_id}/members", api_base()))
            .send()
            .await
            .map_err(|error| error.to_string())?
            .json()
            .await
            .map_err(|error| error.to_string())?;

    Ok(members.items)
}

async fn send_message(room_id: &str, sender_id: &str, content: &str) -> Result<MessageResponse, String> {
    Request::post(&format!("{}/rooms/{room_id}/messages", api_base()))
        .json(&SendMessageRequest {
            sender_id: sender_id.to_string(),
            content: content.to_string(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())
}

async fn promote_member(room_id: &str, actor_profile_id: &str, target_profile_id: &str) -> Result<(), String> {
    Request::post(&format!("{}/rooms/{room_id}/roles/promote", api_base()))
        .json(&PromoteAdminRequest {
            actor_profile_id: actor_profile_id.to_string(),
            target_profile_id: target_profile_id.to_string(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

async fn mute_member(room_id: &str, actor_profile_id: &str, target_profile_id: &str) -> Result<(), String> {
    Request::post(&format!("{}/rooms/{room_id}/members/{target_profile_id}/mute", api_base()))
        .json(&GovernanceActorRequest {
            actor_profile_id: actor_profile_id.to_string(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

async fn remove_member(room_id: &str, actor_profile_id: &str, target_profile_id: &str) -> Result<(), String> {
    Request::post(&format!("{}/rooms/{room_id}/members/{target_profile_id}/remove", api_base()))
        .json(&GovernanceActorRequest {
            actor_profile_id: actor_profile_id.to_string(),
        })
        .map_err(|error| error.to_string())?
        .send()
        .await
        .map_err(|error| error.to_string())?;

    Ok(())
}

async fn listen_room_events(
    room_id: String,
    profile_id: String,
    mut room_state: Signal<Option<ActiveRoom>>,
) {
    let ws_url = format!(
        "{}://127.0.0.1:3000/ws/rooms/{}?profile_id={}",
        if cfg!(debug_assertions) { "ws" } else { "wss" },
        room_id,
        profile_id
    );

    let Ok(socket) = WebSocket::open(&ws_url) else {
        return;
    };
    let (_, mut stream) = socket.split();

    while let Some(next) = stream.next().await {
        let Ok(Message::Text(text)) = next else {
            continue;
        };

        let Ok(ServerWsEvent::MessageCreated {
            message_id,
            room_id,
            sender_id,
            content,
        }) = serde_json::from_str::<ServerWsEvent>(&text) else {
            continue;
        };

        room_state.with_mut(|state| {
            if let Some(room) = state.as_mut()
                && !room.messages.iter().any(|item| item.message_id == message_id)
            {
                room.messages.push(MessageResponse {
                    message_id,
                    room_id,
                    sender_id,
                    content,
                });
            }
        });
    }
}

fn api_base() -> &'static str {
    option_env!("KOKO_API_BASE").unwrap_or("http://127.0.0.1:3000")
}
