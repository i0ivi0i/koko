-- Phase 1 发现的真实问题：
-- swarm_id 来源于 content_hash，同内容的不同附件天然会共享同一个 swarm_id。
-- 因此这里不能继续把 swarm_id 设成唯一索引，否则第二个同内容附件会在 complete 后被误打成 system_error。
DROP INDEX IF EXISTS idx_attachment_distribution_metadata_swarm_id;

CREATE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_swarm_id
ON attachment_distribution_metadata (swarm_id);

CREATE INDEX IF NOT EXISTS idx_attachment_distribution_metadata_content_hash
ON attachment_distribution_metadata (content_hash);
