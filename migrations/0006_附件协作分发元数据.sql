CREATE TABLE IF NOT EXISTS attachment_distribution_metadata (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    content_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    swarm_id TEXT NOT NULL,
    web_seed_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_content_id
ON attachment_distribution_metadata (content_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_swarm_id
ON attachment_distribution_metadata (swarm_id);
