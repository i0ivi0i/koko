-- 0020: 媒体 source_hash 精确去重与 canonical 资产索引。
-- 这条迁移只建立内容身份层的持久化真相；房间权限、消息成立、删除裁决仍由 application/usecase 统一处理。

CREATE TABLE IF NOT EXISTS canonical_media_assets (
    -- content_hash 是 canonical 字节的强身份，多个附件复用同一资产时只复用媒体资产，不复用消息事实。
    content_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    mime_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
    width INTEGER NULL CHECK (width IS NULL OR width > 0),
    height INTEGER NULL CHECK (height IS NULL OR height > 0),
    storage_key TEXT NOT NULL UNIQUE,
    torrent_bytes BYTEA NOT NULL,
    torrent_info_hash TEXT NOT NULL,
    piece_length_bytes INTEGER NOT NULL CHECK (piece_length_bytes > 0),
    web_seed_until TIMESTAMPTZ NOT NULL,
    origin_expires_at TIMESTAMPTZ NOT NULL,
    origin_deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CHECK (torrent_info_hash ~ '^[0-9a-f]{40}$')
);

CREATE INDEX IF NOT EXISTS idx_canonical_media_assets_cleanup
ON canonical_media_assets (origin_expires_at)
WHERE origin_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_media_assets_kind_hash
ON canonical_media_assets (kind, content_hash)
WHERE origin_deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS attachment_canonical_asset_refs (
    -- public attachment_id 负责业务附件引用，content_hash 负责媒体资产复用，二者不能互相替代。
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL REFERENCES canonical_media_assets(content_hash) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachment_canonical_asset_refs_content_hash
ON attachment_canonical_asset_refs (content_hash);

CREATE TABLE IF NOT EXISTS attachment_source_hashes (
    -- source_hash 是原始 File 字节的 SHA-256，只用于上传前精确命中；不加全局唯一，禁止跨权限存在性探测，禁止误把原文件身份当资产身份。
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    source_hash TEXT NOT NULL,
    source_byte_size BIGINT NOT NULL CHECK (source_byte_size >= 0),
    source_file_name TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_attachment_source_hashes_lookup
ON attachment_source_hashes (source_hash, source_byte_size);
