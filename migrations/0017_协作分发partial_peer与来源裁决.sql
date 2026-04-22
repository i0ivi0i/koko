-- 扩展 swarm presence 来源语义：
-- 1. partial_peer 代表“已经真实进入 swarm 并持有部分块”，它有连接价值；
-- 2. 但 partial_peer 仍不等于 complete/backend strong seed，不能被偷换成 ready；
-- 3. 这次只扩约束，不新增第二张 availability 真相表。
ALTER TABLE swarm_peer_presence
DROP CONSTRAINT IF EXISTS swarm_peer_presence_peer_kind_check;

ALTER TABLE swarm_peer_presence
ADD CONSTRAINT swarm_peer_presence_peer_kind_check CHECK (
    peer_kind IN ('viewer_intent', 'partial_peer', 'complete_peer', 'backend_strong_seed')
);
