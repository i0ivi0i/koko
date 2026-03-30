CREATE TABLE IF NOT EXISTS anonymous_sessions (
    session_id UUID PRIMARY KEY,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status = 'active')
);

CREATE TABLE IF NOT EXISTS rooms (
    room_id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status = 'active')
);

CREATE TABLE IF NOT EXISTS room_codes (
    room_code_id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(room_id),
    original_code TEXT NOT NULL,
    normalized_code TEXT NOT NULL,
    code_version SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_room_codes_room UNIQUE (room_id),
    CONSTRAINT uq_room_codes_normalized_code_version UNIQUE (normalized_code, code_version)
);

CREATE TABLE IF NOT EXISTS members (
    member_id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(room_id),
    session_id UUID NOT NULL REFERENCES anonymous_sessions(session_id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status = 'active'),
    CONSTRAINT uq_members_room_session UNIQUE (room_id, session_id)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(room_id),
    sender_session_id UUID NOT NULL,
    body TEXT NOT NULL CHECK (BTRIM(body) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status = 'active'),
    CONSTRAINT fk_messages_member_sender
        FOREIGN KEY (room_id, sender_session_id)
        REFERENCES members(room_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created_at
    ON messages(room_id, created_at DESC, message_id DESC);
