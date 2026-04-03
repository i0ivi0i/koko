use super::*;

#[tokio::test]
async fn admin_overview_requires_authorized_admin_context() {
    let error = get_admin_overview(
        &FakeAdminSessionPort::required(),
        &FakeAdminOverviewPort::default(),
        AdminSessionContext::new(Uuid::from_u128(501)),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::AdminSessionRequired);
}

#[tokio::test]
async fn admin_rooms_requires_authorized_admin_context() {
    let error = list_admin_rooms(
        &FakeAdminSessionPort::required(),
        &FakeAdminRoomsPort::default(),
        AdminSessionContext::new(Uuid::from_u128(502)),
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::AdminSessionRequired);
}

#[tokio::test]
async fn bootstrap_anonymous_session_reuses_existing_session_when_present() {
    let existing_session_id = Uuid::from_u128(100);
    let now = fixed_time();
    let existing_session = AnonymousSession {
        session_id: existing_session_id,
        issued_at: now,
        last_seen_at: now,
        status: SessionStatus::Active,
    };
    let bootstrap_port = FakeSessionBootstrapPort::with_existing(existing_session.clone());

    let session = bootstrap_anonymous_session(
        &bootstrap_port,
        &FakeClock::new(now),
        Some(existing_session_id),
        Uuid::from_u128(101),
    )
    .await
    .unwrap();

    assert_eq!(session.session_id, existing_session_id);
    assert_eq!(bootstrap_port.loaded_session_ids(), vec![existing_session_id]);
}

#[tokio::test]
async fn bootstrap_anonymous_session_refreshes_existing_session_state_when_reused() {
    let existing_session_id = Uuid::from_u128(102);
    let original_time = Utc.with_ymd_and_hms(2026, 3, 30, 11, 55, 0).unwrap();
    let reuse_time = fixed_time();
    let existing_session = AnonymousSession {
        session_id: existing_session_id,
        issued_at: original_time,
        last_seen_at: original_time,
        status: SessionStatus::Active,
    };
    let bootstrap_port = FakeSessionBootstrapPort::with_existing(existing_session.clone());

    let session = bootstrap_anonymous_session(
        &bootstrap_port,
        &FakeClock::new(reuse_time),
        Some(existing_session_id),
        Uuid::from_u128(103),
    )
    .await
    .unwrap();

    assert_eq!(session.session_id, existing_session_id);
    assert_eq!(session.issued_at, original_time);
    assert_eq!(session.last_seen_at, reuse_time);
    assert_eq!(bootstrap_port.loaded_session_ids(), vec![existing_session_id]);
    assert_eq!(bootstrap_port.saved_sessions().len(), 1);
    assert_eq!(bootstrap_port.saved_sessions()[0].session_id, existing_session_id);
    assert_eq!(bootstrap_port.saved_sessions()[0].last_seen_at, reuse_time);
}

#[tokio::test]
async fn send_text_message_returns_message_created_event() {
    let room_id = Uuid::from_u128(1);
    let session_id = Uuid::from_u128(2);
    let client_message_id = Uuid::from_u128(3);
    let message_id = Uuid::from_u128(4);
    let now = fixed_time();
    let store = FakeMessageStore::persisting(MessageStoreOutcome::same());

    let event = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &store,
        &FakeIdGenerator::new(message_id),
        &FakeClock::new(now),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "  hello koko  ".to_string(),
            client_message_id: Some(client_message_id),
        },
    )
    .await
    .unwrap();

    assert_eq!(store.recorded_bodies(), vec!["hello koko".to_string()]);
    assert!(matches!(
        event,
        AppEvent::MessageCreated(message_created)
            if message_created.message_id == message_id
                && message_created.room_id == room_id
                && message_created.session_id == session_id
                && message_created.body == "hello koko"
                && message_created.created_at == now
                && message_created.client_message_id == Some(client_message_id)
    ));
}

#[tokio::test]
async fn send_text_message_rejects_inactive_session() {
    let room_id = Uuid::from_u128(11);
    let session_id = Uuid::from_u128(12);
    let store = FakeMessageStore::persisting(MessageStoreOutcome::same());

    let error = send_text_message(
        &FakeSessionPort::deny(),
        &FakeMembershipPort::allow(),
        &store,
        &FakeIdGenerator::new(Uuid::from_u128(13)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert_eq!(error, AppError::SessionNotActive { session_id });
    assert!(store.recorded_bodies().is_empty());
}

#[tokio::test]
async fn send_text_message_rejects_non_member() {
    let room_id = Uuid::from_u128(21);
    let session_id = Uuid::from_u128(22);
    let store = FakeMessageStore::persisting(MessageStoreOutcome::same());

    let error = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        &store,
        &FakeIdGenerator::new(Uuid::from_u128(23)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
    assert_eq!(
        error,
        AppError::NotRoomMember {
            room_id,
            session_id
        }
    );
    assert!(store.recorded_bodies().is_empty());
}

#[tokio::test]
async fn send_text_message_rejects_persisted_message_drift() {
    let room_id = Uuid::from_u128(24);
    let session_id = Uuid::from_u128(25);

    let error = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeMessageStore::persisting(MessageStoreOutcome::rewrite_body("drifted")),
        &FakeIdGenerator::new(Uuid::from_u128(26)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id,
            session_id,
            body: "hello".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn send_text_message_rejects_empty_body() {
    let error = send_text_message(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeMessageStore::persisting(MessageStoreOutcome::same()),
        &FakeIdGenerator::new(Uuid::from_u128(27)),
        &FakeClock::new(fixed_time()),
        SendTextMessageInput {
            room_id: Uuid::from_u128(28),
            session_id: Uuid::from_u128(29),
            body: "   ".to_string(),
            client_message_id: None,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidMessageBody);
}

#[tokio::test]
async fn join_or_create_room_by_code_returns_snapshot_after_join() {
    let session_id = Uuid::from_u128(31);
    let room_id = Uuid::from_u128(32);
    let join_port = FakeRoomEntryPort::missing_room(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(
            Uuid::from_u128(33),
            room_id,
            session_id,
            "hello",
        )],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(room_id, Uuid::from_u128(3201), Uuid::from_u128(3202), Uuid::from_u128(3203)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        join_port.operations(),
        vec![
            "find_room_by_code",
            "create_room",
            "ensure_room_member",
            "load_recent_messages",
            "commit",
        ]
    );
    assert_eq!(snapshot, expected_snapshot(room_id, session_id, "hello"));
}

#[tokio::test]
async fn join_or_create_room_by_code_generates_room_and_member_facts_in_application() {
    let now = fixed_time();
    let join_port = FakeRoomEntryPort::missing_room(sample_snapshot_data(
        Uuid::from_u128(11),
        "A1234",
        vec![],
    ));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(
            Uuid::from_u128(11),
            Uuid::from_u128(12),
            Uuid::from_u128(13),
            Uuid::from_u128(14),
        ),
        &FakeClock::new(now),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id: Uuid::from_u128(99),
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.room_id, Uuid::from_u128(11));
    assert_eq!(join_port.recorded_room_code_id(), Some(Uuid::from_u128(12)));
    assert_eq!(join_port.recorded_member_id(), Some(Uuid::from_u128(13)));
    assert_eq!(join_port.recorded_room_created_at(), Some(now));
    assert_eq!(join_port.recorded_room_code_created_at(), Some(now));
    assert_eq!(join_port.recorded_member_joined_at(), Some(now));
}

#[tokio::test]
async fn join_or_create_room_by_code_reuses_existing_room_without_recreating_it() {
    let session_id = Uuid::from_u128(34);
    let room_id = Uuid::from_u128(35);
    let join_port =
        FakeRoomEntryPort::existing_room(sample_snapshot_data(room_id, "A1234", vec![]));

    let snapshot = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3401), Uuid::from_u128(3402), Uuid::from_u128(3403), Uuid::from_u128(3404)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.room_id, room_id);
    assert_eq!(
        join_port.operations(),
        vec![
            "find_room_by_code",
            "ensure_room_member",
            "load_recent_messages",
            "commit",
        ]
    );
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_invalid_room_code() {
    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &FakeRoomEntryPort::existing_room(sample_snapshot_data(
            Uuid::from_u128(36),
            "A1234",
            vec![],
        )),
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3601), Uuid::from_u128(3602), Uuid::from_u128(3603), Uuid::from_u128(3604)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "ABCDE".to_string(),
            session_id: Uuid::from_u128(37),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidRoomCode);
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_mismatched_room_code_snapshot() {
    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &FakeRoomEntryPort::existing_room(sample_snapshot_data(
            Uuid::from_u128(38),
            "B1234",
            vec![],
        )),
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3801), Uuid::from_u128(3802), Uuid::from_u128(3803), Uuid::from_u128(3804)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id: Uuid::from_u128(39),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn join_or_create_room_by_code_rejects_inactive_session() {
    let session_id = Uuid::from_u128(34);
    let join_port = FakeRoomEntryPort::existing_room(sample_snapshot_data(
        Uuid::from_u128(35),
        "A1234",
        vec![],
    ));

    let error = join_or_create_room_by_code(
        &FakeSessionPort::deny(),
        &join_port,
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(3901), Uuid::from_u128(3902), Uuid::from_u128(3903), Uuid::from_u128(3904)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "a1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert!(join_port.operations().is_empty());
}

#[tokio::test]
async fn join_or_create_room_by_code_skips_commit_when_member_write_fails() {
    let session_id = Uuid::from_u128(40);
    let join_port = FakeRoomEntryPort::member_failure(sample_snapshot_data(
        Uuid::from_u128(41),
        "A1234",
        vec![],
    ));

    let error = join_or_create_room_by_code(
        &FakeSessionPort::allow(),
        &join_port,
        &FakeIdGenerator::new_room_entry(Uuid::from_u128(4001), Uuid::from_u128(4002), Uuid::from_u128(4003), Uuid::from_u128(4004)),
        &FakeClock::new(fixed_time()),
        JoinOrCreateRoomByCodeCommand {
            room_code: "A1234".to_string(),
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
    assert_eq!(
        join_port.operations(),
        vec!["find_room_by_code", "ensure_room_member"]
    );
}

#[tokio::test]
async fn list_joined_rooms_returns_member_rooms_sorted_by_latest_message() {
    let session_id = Uuid::from_u128(540);
    let rooms_port = FakeJoinedRoomsPort::with_rooms(vec![
        joined_room_summary(Uuid::from_u128(541), "C1234", "third", None),
        joined_room_summary(
            Uuid::from_u128(542),
            "A1234",
            "first",
            Some(minute_time(2)),
        ),
        joined_room_summary(
            Uuid::from_u128(543),
            "B1234",
            "second",
            Some(minute_time(1)),
        ),
    ]);

    let rooms = list_joined_rooms(
        &FakeSessionPort::allow(),
        &rooms_port,
        ListJoinedRoomsQuery { session_id },
    )
    .await
    .unwrap();

    assert_eq!(rooms_port.requested_session_ids(), vec![session_id]);
    assert_eq!(
        rooms.into_iter().map(|room| room.room_code).collect::<Vec<_>>(),
        vec!["A1234".to_string(), "B1234".to_string(), "C1234".to_string()]
    );
}

#[tokio::test]
async fn list_joined_rooms_returns_empty_for_session_with_no_rooms() {
    let session_id = Uuid::from_u128(544);
    let rooms_port = FakeJoinedRoomsPort::with_rooms(vec![]);

    let rooms = list_joined_rooms(
        &FakeSessionPort::allow(),
        &rooms_port,
        ListJoinedRoomsQuery { session_id },
    )
    .await
    .unwrap();

    assert!(rooms.is_empty());
    assert_eq!(rooms_port.requested_session_ids(), vec![session_id]);
}

#[tokio::test]
async fn search_rooms_by_code_matches_case_insensitive_prefix_and_marks_membership() {
    let session_id = Uuid::from_u128(545);
    let search_port = FakeRoomSearchPort::with_results(vec![
        room_search_result(
            Uuid::from_u128(546),
            "A1234",
            "joined room",
            Some(minute_time(1)),
            true,
        ),
        room_search_result(
            Uuid::from_u128(547),
            "A1299",
            "candidate room",
            None,
            false,
        ),
    ]);

    let results = search_rooms_by_code(
        &FakeSessionPort::allow(),
        &search_port,
        SearchRoomsByCodeQuery {
            session_id,
            input: "a12".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(search_port.requested_session_ids(), vec![session_id]);
    assert_eq!(search_port.requested_inputs(), vec!["a12".to_string()]);
    assert_eq!(
        results
            .into_iter()
            .map(|room| (room.room_code, room.is_joined))
            .collect::<Vec<_>>(),
        vec![
            ("A1234".to_string(), true),
            ("A1299".to_string(), false),
        ]
    );
}

#[tokio::test]
async fn search_rooms_by_code_prioritizes_exact_hit_then_joined_rooms() {
    let session_id = Uuid::from_u128(548);
    let search_port = FakeRoomSearchPort::with_results(vec![
        room_search_result(
            Uuid::from_u128(549),
            "A1200",
            "joined newer",
            Some(minute_time(3)),
            true,
        ),
        room_search_result(
            Uuid::from_u128(550),
            "A1234",
            "exact hit",
            Some(minute_time(2)),
            false,
        ),
        room_search_result(
            Uuid::from_u128(551),
            "A1299",
            "not joined",
            Some(minute_time(4)),
            false,
        ),
    ]);

    let results = search_rooms_by_code(
        &FakeSessionPort::allow(),
        &search_port,
        SearchRoomsByCodeQuery {
            session_id,
            input: "a1234".to_string(),
        },
    )
    .await
    .unwrap();

    assert_eq!(
        results.into_iter().map(|room| room.room_code).collect::<Vec<_>>(),
        vec![
            "A1234".to_string(),
            "A1200".to_string(),
            "A1299".to_string(),
        ]
    );
}

#[tokio::test]
async fn load_room_snapshot_returns_messages_for_member() {
    let room_id = Uuid::from_u128(41);
    let session_id = Uuid::from_u128(42);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        room_id,
        "A1234",
        vec![sample_message(
            Uuid::from_u128(43),
            room_id,
            session_id,
            "hello again",
        )],
    ));

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot_port.requested_limits(), vec![50]);
    assert_eq!(snapshot.room_id, room_id);
    assert_eq!(snapshot.room_code, "A1234");
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].body, "hello again");
}

#[tokio::test]
async fn load_room_snapshot_sorts_and_truncates_to_latest_fifty_messages() {
    let room_id = Uuid::from_u128(430);
    let session_id = Uuid::from_u128(431);
    let mut messages: Vec<_> = (0..55)
        .map(|index| {
            sample_message_at(
                Uuid::from_u128(500 + index),
                room_id,
                session_id,
                &format!("message {index}"),
                index,
            )
        })
        .collect();
    messages.reverse();
    let snapshot_port =
        FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(room_id, "A1234", messages));

    let snapshot = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap();

    assert_eq!(snapshot.messages.len(), 50);
    assert_eq!(snapshot.messages.first().unwrap().body, "message 5");
    assert_eq!(snapshot.messages.last().unwrap().body, "message 54");
}

#[tokio::test]
async fn load_room_snapshot_rejects_inactive_session() {
    let room_id = Uuid::from_u128(44);
    let session_id = Uuid::from_u128(45);
    let snapshot_port =
        FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(room_id, "A1234", vec![]));

    let error = load_room_snapshot(
        &FakeSessionPort::deny(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::InvalidSession);
    assert!(snapshot_port.requested_limits().is_empty());
}

#[tokio::test]
async fn load_room_snapshot_rejects_non_member() {
    let room_id = Uuid::from_u128(46);
    let session_id = Uuid::from_u128(47);
    let snapshot_port =
        FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(room_id, "A1234", vec![]));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
    assert!(snapshot_port.requested_limits().is_empty());
}

#[tokio::test]
async fn load_room_snapshot_rejects_mismatched_room_snapshot() {
    let requested_room_id = Uuid::from_u128(48);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        Uuid::from_u128(49),
        "A1234",
        vec![],
    ));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id: requested_room_id,
            session_id: Uuid::from_u128(50),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn load_room_snapshot_rejects_snapshot_with_foreign_room_messages() {
    let requested_room_id = Uuid::from_u128(53);
    let snapshot_port = FakeRoomSnapshotPort::with_snapshot(sample_snapshot_data(
        requested_room_id,
        "A1234",
        vec![sample_message(
            Uuid::from_u128(54),
            Uuid::from_u128(55),
            Uuid::from_u128(56),
            "foreign",
        )],
    ));

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &snapshot_port,
        LoadRoomSnapshotQuery {
            room_id: requested_room_id,
            session_id: Uuid::from_u128(57),
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
}

#[tokio::test]
async fn load_room_snapshot_propagates_internal_error_code_for_dependency_failure() {
    let room_id = Uuid::from_u128(51);
    let session_id = Uuid::from_u128(52);

    let error = load_room_snapshot(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        &FakeRoomSnapshotPort::failing(),
        LoadRoomSnapshotQuery {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error.code(), AppErrorCode::Internal);
    assert!(matches!(error, AppError::DependencyFailure));
}

#[tokio::test]
async fn subscribe_room_stream_accepts_active_member() {
    subscribe_room_stream(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::allow(),
        SubscribeRoomStreamInput {
            room_id: Uuid::from_u128(58),
            session_id: Uuid::from_u128(59),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn subscribe_room_stream_rejects_non_member() {
    let room_id = Uuid::from_u128(60);
    let session_id = Uuid::from_u128(61);

    let error = subscribe_room_stream(
        &FakeSessionPort::allow(),
        &FakeMembershipPort::deny(),
        SubscribeRoomStreamInput {
            room_id,
            session_id,
        },
    )
    .await
    .unwrap_err();

    assert_eq!(
        error,
        AppError::NotRoomMember {
            room_id,
            session_id
        }
    );
    assert_eq!(error.code(), AppErrorCode::MembershipRequired);
}

