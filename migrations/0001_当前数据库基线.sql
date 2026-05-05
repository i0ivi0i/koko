-- 当前数据库基线
--
-- 这不是历史补丁链，而是新环境一次性建成的当前 PostgreSQL 形状。
-- 旧库升级不再依赖本目录；未来真实线上升级应走发布期外部变更脚本，
-- 验证稳定后再重新折叠回这份基线，避免 migrations 长期膨胀。

CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anonymous_identities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anonymous_identity_id TEXT NOT NULL UNIQUE,
    display_alias TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    identity_uuid UUID NULL,
    theme_key TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anonymous_identities_identity_uuid
    ON anonymous_identities (identity_uuid);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS anonymous_identity_id BIGINT NULL REFERENCES anonymous_identities(id) ON DELETE RESTRICT;

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS device_anonymous_token TEXT NULL UNIQUE;

CREATE INDEX IF NOT EXISTS idx_sessions_anonymous_identity_id
    ON sessions (anonymous_identity_id);

CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id TEXT NOT NULL UNIQUE,
    room_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_by_session_id BIGINT NOT NULL REFERENCES sessions(id),
    latest_event_position BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_room_members_active
    ON room_members (room_id, session_id)
    WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS room_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    event_position BIGINT NOT NULL CHECK (event_position > 0),
    event_kind TEXT NOT NULL,
    actor_session_id BIGINT NULL REFERENCES sessions(id),
    message_id TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, event_position)
);

CREATE TABLE IF NOT EXISTS messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    client_message_id TEXT NOT NULL,
    event_position BIGINT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, sender_session_id, client_message_id),
    UNIQUE (room_id, event_position),
    FOREIGN KEY (room_id, event_position) REFERENCES room_events (room_id, event_position)
);

CREATE TABLE IF NOT EXISTS room_read_anchors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anonymous_identity_id BIGINT NOT NULL REFERENCES anonymous_identities(id) ON DELETE CASCADE,
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    last_read_event_position BIGINT NOT NULL CHECK (last_read_event_position >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (anonymous_identity_id, room_id)
);

CREATE TABLE IF NOT EXISTS attachments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asset_original_storage_key TEXT NULL,
    full_storage_key TEXT NULL,
    origin_expires_at TIMESTAMPTZ NULL,
    origin_deleted_at TIMESTAMPTZ NULL,
    abandoned_at TIMESTAMPTZ NULL,
    mezzanine_storage_key TEXT NULL,
    mezzanine_expires_at TIMESTAMPTZ NULL,
    mezzanine_deleted_at TIMESTAMPTZ NULL,
    current_upload_session_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_owner_identity
    ON attachments (owner_anonymous_identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_origin_cleanup
    ON attachments (origin_expires_at)
    WHERE origin_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_mezzanine_cleanup
    ON attachments (mezzanine_expires_at)
    WHERE mezzanine_deleted_at IS NULL;

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

CREATE TABLE IF NOT EXISTS attachment_upload_transports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_upload_transports_transport_upload_id_v2
    ON attachment_upload_transports (transport_upload_id)
    WHERE transport_upload_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_upload_transports_final_once_v2
    ON attachment_upload_transports (upload_session_id)
    WHERE transport_role = 'final';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_upload_transports_single_once_v2
    ON attachment_upload_transports (upload_session_id)
    WHERE transport_role = 'single';

CREATE INDEX IF NOT EXISTS idx_attachment_upload_transports_session_role_v2
    ON attachment_upload_transports (upload_session_id, transport_role, finished_at DESC);

-- 放弃上传会按 attachment_id 收口当前附件的活跃运输行；只建这一条窄索引，不恢复旧历史表索引。
CREATE INDEX IF NOT EXISTS idx_attachment_upload_transports_attachment_active
    ON attachment_upload_transports (attachment_id)
    WHERE abandoned_at IS NULL;

ALTER TABLE attachments
    ADD CONSTRAINT fk_attachments_current_upload_session
    FOREIGN KEY (current_upload_session_id)
    REFERENCES attachment_upload_sessions(upload_session_id)
    ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS attachment_distribution_metadata (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    content_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    swarm_id TEXT NOT NULL,
    web_seed_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    torrent_bytes BYTEA NULL,
    torrent_info_hash TEXT NULL,
    piece_length_bytes INTEGER NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_content_id
    ON attachment_distribution_metadata (content_id);

CREATE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_swarm_id
    ON attachment_distribution_metadata (swarm_id);

CREATE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_content_hash
    ON attachment_distribution_metadata (content_hash);

CREATE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_torrent_info_hash
    ON attachment_distribution_metadata (torrent_info_hash)
    WHERE torrent_info_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS swarm_peer_presence (
    swarm_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    peer_kind TEXT NOT NULL CHECK (
        peer_kind IN ('viewer_intent', 'partial_peer', 'complete_peer', 'backend_strong_seed')
    ),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (swarm_id, session_id, peer_kind)
);

-- locator/availability 的真实查询形状是 swarm + peer_kind + 最近存活时间。
-- 旧的 (swarm_id, last_seen_at) 是更宽但不贴合谓词的历史索引，新基线不继续带入。
CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_swarm_kind_seen
    ON swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_attachment
    ON swarm_peer_presence (attachment_id);

CREATE TABLE IF NOT EXISTS canonical_media_assets (
    -- content_hash 是 canonical 字节的强身份；多个附件复用同一资产时，只复用媒体资产，不复用消息事实。
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
    -- source_hash 是原始 File 字节的 SHA-256，只用于精确命中；不加全局唯一，避免跨权限探测。
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    source_hash TEXT NOT NULL,
    source_byte_size BIGINT NOT NULL CHECK (source_byte_size >= 0),
    source_file_name TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_attachment_source_hashes_lookup
    ON attachment_source_hashes (source_hash, source_byte_size);

COMMENT ON TABLE attachment_source_hashes IS
    'source_hash 是上传前精确命中索引，不是全站可见资产身份；禁止跨权限存在性探测。';

COMMENT ON COLUMN attachment_source_hashes.source_hash IS
    '原始 File 字节 SHA-256；禁止作为无权限全局媒体存在性探针。';

COMMENT ON COLUMN attachment_source_hashes.source_byte_size IS
    '原始 File 字节长度；只能与 source_hash 一起服务受权限约束的上传前复用。';
