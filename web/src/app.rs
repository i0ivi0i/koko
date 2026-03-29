use dioxus::prelude::*;
use koko_contract::RoomLeftReason;

use crate::{
    chat::ChatScreen,
    client::{self, MemberAction},
    member::MemberSheet,
    room::RoomEntryScreen,
    state::{self, ActiveRoom},
    theme::APP_STYLE,
};

#[component]
pub fn App() -> Element {
    let mut members_open = use_signal(|| false);
    let mut room_state = use_signal(|| None::<ActiveRoom>);
    let mut room_client = use_signal(|| None::<client::JoinedRoomClient>);
    let mut room_attempt = use_signal(|| 0_u64);
    let loading = use_signal(|| false);
    let mut loading_older_messages = use_signal(|| false);
    let mut error_message = use_signal(|| None::<String>);

    rsx! {
        document::Title { "Koko" }
        document::Style { "{APP_STYLE}" }
        document::Script {
            src: "/assets/socketio-bridge.js",
            defer: true,
            r#type: "module",
        }

        div { class: "app-shell",
            if let Some(room) = room_state() {
                ChatScreen {
                    room_code: room.room_code.clone(),
                    profile_id: room.profile_id.clone(),
                    display_name: room.display_name.clone(),
                    messages: room.messages.clone(),
                    member_count: room.members.len(),
                    on_back: move |_| {
                        room_attempt.set(room_attempt().wrapping_add(1));
                        if let Some(client) = room_client() {
                            client.close();
                        }
                        room_state.with_mut(state::leave_room);
                        room_client.set(None);
                        members_open.set(false);
                        loading_older_messages.set(false);
                        error_message.set(None);
                    },
                    on_open_members: move |_| members_open.set(true),
                    has_more_messages: room.has_more_messages,
                    loading_more_messages: loading_older_messages(),
                    on_load_older: move |_| {
                        if loading_older_messages() {
                            return;
                        }
                        if let Some(current_room) = room_state() {
                            let Some(before_message_id) = state::earliest_message_id(&current_room) else {
                                return;
                            };
                            let room_id = current_room.room_id.clone();
                            let mut room_state = room_state;
                            let mut loading_older_messages = loading_older_messages;

                            spawn(async move {
                                loading_older_messages.set(true);

                                if let Ok(response) = client::fetch_room_messages(
                                    &room_id,
                                    &current_room.session_id,
                                    Some(&before_message_id),
                                )
                                .await
                                {
                                    room_state.with_mut(|state| {
                                        state::prepend_messages_if_room_matches(
                                            state,
                                            &room_id,
                                            response.items,
                                            response.has_more,
                                        );
                                    });
                                }

                                loading_older_messages.set(false);
                            });
                        }
                    },
                    on_send: move |content: String| {
                        if room_state().is_some() {
                            send_room_message(
                                room_client,
                                content,
                            );
                        }
                    },
                }
                MemberSheet {
                    open: members_open(),
                    members: room.members.clone(),
                    on_promote: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            spawn_member_action(room, target_profile_id, MemberAction::Promote);
                        }
                    },
                    on_mute: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            spawn_member_action(room, target_profile_id, MemberAction::Mute);
                        }
                    },
                    on_remove: move |target_profile_id: String| {
                        if let Some(room) = room_state() {
                            spawn_member_action(room, target_profile_id, MemberAction::Remove);
                        }
                    },
                    on_close: move |_| members_open.set(false),
                }
            } else {
                RoomEntryScreen {
                    loading: loading(),
                    error_message: error_message(),
                    on_enter: move |code: String| {
                        if loading() {
                            return;
                        }

                        let mut room_state = room_state;
                        let mut room_client = room_client;
                        let mut room_attempt = room_attempt;
                        let mut loading = loading;
                        let mut error_message = error_message;
                        let mut loading_older_messages = loading_older_messages;
                        let mut members_open = members_open;

                        spawn(async move {
                            let attempt = room_attempt().wrapping_add(1);
                            room_attempt.set(attempt);
                            loading.set(true);
                            error_message.set(None);
                            room_state.set(None);
                            room_client.with_mut(|client| {
                                if let Some(current) = client.take() {
                                    current.close();
                                }
                            });

                            match client::bootstrap_session().await {
                                Ok(session) => {
                                    let session_for_snapshot = session.clone();
                                    let connection = client::connect_room_by_code(
                                        code,
                                        session.session_id.clone(),
                                        move |message| {
                                            if room_attempt() != attempt {
                                                return;
                                            }
                                            let room_id = message.room_id.clone();
                                            room_state.with_mut(|state| {
                                                state::append_message_if_room_matches(
                                                    state,
                                                    &room_id,
                                                    message,
                                                );
                                            });
                                        },
                                        move |snapshot| {
                                            if room_attempt() != attempt {
                                                return;
                                            }
                                            room_state.with_mut(|state| {
                                                if state.is_none() {
                                                    *state = Some(state::build_active_room(
                                                        session_for_snapshot.clone(),
                                                        snapshot,
                                                    ));
                                                    return;
                                                }

                                                state::replace_room_snapshot_if_room_matches(state, snapshot);
                                            });
                                            error_message.set(None);
                                            loading.set(false);
                                        },
                                        move |snapshot| {
                                            if room_attempt() != attempt {
                                                return;
                                            }
                                            room_state.with_mut(|state| {
                                                state::replace_room_members_snapshot_if_room_matches(
                                                    state,
                                                    snapshot,
                                                );
                                            });
                                        },
                                        move |event| {
                                            if room_attempt() != attempt {
                                                return;
                                            }

                                            let active_room_matches = room_state()
                                                .as_ref()
                                                .is_some_and(|room| room.room_id == event.room_id);
                                            let join_inflight = room_state().is_none() && loading();
                                            if !active_room_matches && !join_inflight {
                                                return;
                                            }

                                            room_attempt.set(room_attempt().wrapping_add(1));
                                            room_client.with_mut(|client| {
                                                if let Some(current) = client.take() {
                                                    current.close();
                                                }
                                            });
                                            room_state.with_mut(state::leave_room);
                                            members_open.set(false);
                                            loading.set(false);
                                            loading_older_messages.set(false);
                                            error_message
                                                .set(Some(room_left_reason_message(&event.reason)));
                                        },
                                        move |error| {
                                            if room_attempt() != attempt {
                                                return;
                                            }
                                            if room_state().is_some() {
                                                show_runtime_error(error);
                                                return;
                                            }

                                            room_client.with_mut(|client| {
                                                if let Some(current) = client.take() {
                                                    current.close();
                                                }
                                            });
                                            loading.set(false);
                                            error_message.set(Some(error));
                                        },
                                    );

                                    match connection {
                                        Ok(connection) => {
                                            if room_attempt() != attempt {
                                                connection.close();
                                                return;
                                            }
                                            loading_older_messages.set(false);
                                            room_client.set(Some(connection));
                                        }
                                        Err(error) => {
                                            if room_attempt() != attempt {
                                                return;
                                            }
                                            loading.set(false);
                                            error_message.set(Some(error));
                                        }
                                    }
                                }
                                Err(error) => {
                                    if room_attempt() != attempt {
                                        return;
                                    }
                                    loading.set(false);
                                    error_message.set(Some(error));
                                }
                            }
                        });
                    },
                }
            }
        }
    }
}

fn send_room_message(room_client: Signal<Option<client::JoinedRoomClient>>, content: String) {
    if let Some(client) = room_client() {
        if let Err(error) = client.send_message(&content) {
            show_runtime_error(error);
        }
    }
}

fn show_runtime_error(message: String) {
    #[cfg(target_arch = "wasm32")]
    {
        let script = format!(
            "window.alert({});",
            serde_json::to_string(&message).expect("错误消息序列化不应失败")
        );
        spawn(async move {
            let _ = document::eval(&script).await;
        });
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = message;
    }
}

fn room_left_reason_message(reason: &RoomLeftReason) -> String {
    match reason {
        RoomLeftReason::Removed => "你已被移出房间".into(),
    }
}

fn spawn_member_action(room: ActiveRoom, target_profile_id: String, action: MemberAction) {
    spawn(async move {
        if let Err(error) =
            client::run_member_action(action, &room.room_id, &room.session_id, &target_profile_id)
                .await
        {
            show_runtime_error(error);
            return;
        }
    });
}
