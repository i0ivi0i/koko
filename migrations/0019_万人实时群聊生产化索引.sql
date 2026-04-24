-- 万人实时群聊生产化索引：
-- 1. locator / availability 会按同一个 swarm 内的 peer_kind 找最近存活时间；
-- 2. 0015 只有 (swarm_id, last_seen_at DESC)，在 complete/partial/backend 多类型并存后不够贴合查询形状；
-- 3. room_events / messages 已有 (room_id, event_position) 唯一约束，可支撑事件游标正反向扫描，这里不重复建等价索引。
CREATE INDEX IF NOT EXISTS idx_swarm_peer_presence_swarm_kind_seen
ON swarm_peer_presence (swarm_id, peer_kind, last_seen_at DESC);
