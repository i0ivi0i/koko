ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS mezzanine_storage_key TEXT NULL,
    ADD COLUMN IF NOT EXISTS mezzanine_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS mezzanine_deleted_at TIMESTAMPTZ NULL;

ALTER TABLE attachment_upload_transports
    ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_mezzanine_cleanup
ON attachments (mezzanine_expires_at)
WHERE mezzanine_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attachment_upload_transports_abandoned
ON attachment_upload_transports (attachment_id)
WHERE abandoned_at IS NOT NULL;
