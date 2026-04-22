-- `last_peer_seen_at` 属于旧语义：
-- 1. 它把运行态心跳直接挂在 attachment 行上，无法表达 shared swarm；
-- 2. 它会把 viewer 意图误判成 available source；
-- 3. 新语义已收口到 `swarm_peer_presence`，这里必须删除旧字段避免回漂。
ALTER TABLE attachment_distribution_metadata
    DROP COLUMN IF EXISTS last_peer_seen_at;
