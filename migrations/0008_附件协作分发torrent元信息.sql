ALTER TABLE attachment_distribution_metadata
    ADD COLUMN IF NOT EXISTS torrent_bytes BYTEA,
    ADD COLUMN IF NOT EXISTS torrent_info_hash TEXT,
    ADD COLUMN IF NOT EXISTS piece_length_bytes INTEGER,
    ADD COLUMN IF NOT EXISTS last_peer_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_torrent_info_hash
ON attachment_distribution_metadata (torrent_info_hash)
WHERE torrent_info_hash IS NOT NULL;
