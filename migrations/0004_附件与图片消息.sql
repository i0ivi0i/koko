CREATE TABLE IF NOT EXISTS attachments (
    id BIGSERIAL PRIMARY KEY,
    attachment_id TEXT NOT NULL UNIQUE,
    owner_anonymous_identity_id BIGINT NOT NULL REFERENCES anonymous_identities(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    width INTEGER NULL,
    height INTEGER NULL,
    storage_key TEXT NOT NULL,
    thumbnail_storage_key TEXT NULL,
    status TEXT NOT NULL,
    committed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner_identity
ON attachments (owner_anonymous_identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_attachment_refs (
    message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
    attachment_id BIGINT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL,
    display_role TEXT NOT NULL,
    PRIMARY KEY (message_id, attachment_id),
    UNIQUE (message_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_message_attachment_refs_attachment_id
ON message_attachment_refs (attachment_id);
