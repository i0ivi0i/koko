CREATE TABLE IF NOT EXISTS room_read_anchors (
    id BIGSERIAL PRIMARY KEY,
    anonymous_identity_id BIGINT NOT NULL REFERENCES anonymous_identities(id) ON DELETE CASCADE,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    last_read_event_position BIGINT NOT NULL CHECK (last_read_event_position >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (anonymous_identity_id, room_id)
);
