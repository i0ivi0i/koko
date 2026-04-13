ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS asset_original_storage_key TEXT NULL,
    ADD COLUMN IF NOT EXISTS full_storage_key TEXT NULL,
    ADD COLUMN IF NOT EXISTS origin_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS origin_deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_origin_cleanup
ON attachments (origin_expires_at)
WHERE origin_deleted_at IS NULL;
