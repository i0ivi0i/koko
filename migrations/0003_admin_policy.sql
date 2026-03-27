CREATE TABLE global_chat_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    max_message_length INTEGER NOT NULL CHECK (max_message_length > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO global_chat_policy (singleton, max_message_length)
VALUES (TRUE, 2000)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE room_governance_state (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    banned_until TIMESTAMPTZ NULL,
    ban_reason TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_governance_state_banned_until
    ON room_governance_state (banned_until);
