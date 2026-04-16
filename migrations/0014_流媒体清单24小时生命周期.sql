-- 流媒体清单生命周期只描述服务端 HLS/DASH 冷备窗口：
-- 1. streaming_expires_at 表达标准流媒体何时该退场；
-- 2. streaming_deleted_at 表达对象真的删完了；
-- 3. 这里绝不能顺手删除协作分发元数据，避免把 swarm 长期线索和服务器冷备窗口混成同一条真相。
ALTER TABLE attachment_streaming_manifests
    ADD COLUMN IF NOT EXISTS streaming_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS streaming_deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_attachment_streaming_manifest_cleanup
ON attachment_streaming_manifests (streaming_expires_at)
WHERE streaming_deleted_at IS NULL;
