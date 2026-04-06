CREATE TABLE IF NOT EXISTS anonymous_identities (
    id BIGSERIAL PRIMARY KEY,
    anonymous_identity_id TEXT NOT NULL UNIQUE,
    display_alias TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS anonymous_identity_id BIGINT NULL REFERENCES anonymous_identities(id) ON DELETE RESTRICT;

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS device_anonymous_token TEXT NULL UNIQUE;

CREATE INDEX IF NOT EXISTS idx_sessions_anonymous_identity_id
ON sessions (anonymous_identity_id);
