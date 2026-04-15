ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS current_upload_session_id TEXT NULL;

CREATE TABLE IF NOT EXISTS attachment_upload_sessions (
    upload_session_id TEXT PRIMARY KEY,
    attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    transport_kind TEXT NOT NULL,
    upload_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    abandoned_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_upload_sessions_upload_token
ON attachment_upload_sessions (upload_token);

CREATE INDEX IF NOT EXISTS idx_attachment_upload_sessions_attachment
ON attachment_upload_sessions (attachment_id, created_at DESC);

INSERT INTO attachment_upload_sessions (
    upload_session_id,
    attachment_id,
    transport_kind,
    upload_token,
    token_expires_at,
    abandoned_at,
    created_at
)
SELECT
    attachment_id || '-legacy-session',
    attachment_id,
    transport_kind,
    upload_token,
    token_expires_at,
    abandoned_at,
    COALESCE(finished_at, NOW())
FROM attachment_upload_transports;

UPDATE attachments a
SET current_upload_session_id = s.upload_session_id
FROM attachment_upload_sessions s
WHERE a.attachment_id = s.attachment_id
  AND a.current_upload_session_id IS NULL
  AND s.abandoned_at IS NULL;

ALTER TABLE attachment_upload_transports
    RENAME TO attachment_upload_transports_legacy;

CREATE TABLE attachment_upload_transports (
    id BIGSERIAL,
    attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    upload_session_id TEXT NOT NULL REFERENCES attachment_upload_sessions(upload_session_id) ON DELETE CASCADE,
    transport_kind TEXT NOT NULL,
    transport_role TEXT NOT NULL,
    concat_order INTEGER NULL,
    abandoned_at TIMESTAMPTZ NULL,
    transport_upload_id TEXT NULL,
    storage_locator TEXT NULL,
    byte_size BIGINT NULL,
    finished_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attachment_upload_transports_v2_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX idx_attachment_upload_transports_transport_upload_id_v2
ON attachment_upload_transports (transport_upload_id)
WHERE transport_upload_id IS NOT NULL;

CREATE UNIQUE INDEX idx_attachment_upload_transports_final_once_v2
ON attachment_upload_transports (upload_session_id)
WHERE transport_role = 'final';

CREATE UNIQUE INDEX idx_attachment_upload_transports_single_once_v2
ON attachment_upload_transports (upload_session_id)
WHERE transport_role = 'single';

CREATE INDEX idx_attachment_upload_transports_session_role_v2
ON attachment_upload_transports (upload_session_id, transport_role, finished_at DESC);

INSERT INTO attachment_upload_transports (
    attachment_id,
    upload_session_id,
    transport_kind,
    transport_role,
    concat_order,
    abandoned_at,
    transport_upload_id,
    storage_locator,
    byte_size,
    finished_at,
    created_at
)
SELECT
    attachment_id,
    attachment_id || '-legacy-session',
    transport_kind,
    'single',
    NULL,
    abandoned_at,
    transport_upload_id,
    storage_locator,
    byte_size,
    finished_at,
    NOW()
FROM attachment_upload_transports_legacy;

DROP TABLE attachment_upload_transports_legacy;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_attachments_current_upload_session'
    ) THEN
        ALTER TABLE attachments
            ADD CONSTRAINT fk_attachments_current_upload_session
            FOREIGN KEY (current_upload_session_id)
            REFERENCES attachment_upload_sessions(upload_session_id)
            ON DELETE SET NULL;
    END IF;
END $$;
