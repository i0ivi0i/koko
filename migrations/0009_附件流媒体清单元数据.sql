CREATE TABLE IF NOT EXISTS attachment_streaming_manifests (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    hls_master_storage_key TEXT NOT NULL,
    dash_mpd_storage_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
