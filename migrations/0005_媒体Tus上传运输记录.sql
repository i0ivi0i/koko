CREATE TABLE IF NOT EXISTS attachment_upload_transports (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    transport_kind TEXT NOT NULL,
    upload_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    transport_upload_id TEXT NULL,
    storage_locator TEXT NULL,
    byte_size BIGINT NULL,
    finished_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_upload_transports_upload_token
ON attachment_upload_transports (upload_token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_upload_transports_transport_upload_id
ON attachment_upload_transports (transport_upload_id)
WHERE transport_upload_id IS NOT NULL;
