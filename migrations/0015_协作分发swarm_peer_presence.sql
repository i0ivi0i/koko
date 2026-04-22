-- swarm 运行态存活真相：
-- 1. 这张表只承载易变的“谁在这个 swarm 里仍可作为来源”；
-- 2. attachment_distribution_metadata 继续只放稳定分发表面，避免被页面心跳污染；
-- 3. 后续 availability 只统计 verified complete peer / backend strong seed。
CREATE TABLE IF NOT EXISTS swarm_peer_presence (
    swarm_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
    peer_kind TEXT NOT NULL CHECK (
        peer_kind IN ('viewer_intent', 'complete_peer', 'backend_strong_seed')
    ),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (swarm_id, session_id, peer_kind)
);

CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_swarm_last_seen
ON swarm_peer_presence (swarm_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_attachment
ON swarm_peer_presence (attachment_id);
