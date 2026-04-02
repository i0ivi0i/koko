CREATE TABLE IF NOT EXISTS admin_session_truth (
    singleton_key BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_key),
    active_session_id TEXT NOT NULL,
    admin_token_fingerprint TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL
);
