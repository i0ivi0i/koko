CREATE TABLE room_governance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    actor_profile_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    target_profile_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_governance_logs_room_created_at
    ON room_governance_logs (room_id, created_at DESC);
