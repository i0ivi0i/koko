-- 匿名身份的真相开始从“兼容字符串 + 展示花名”升级到“内部 UUID + 当前资料投影”。
-- 这里先只加字段和兼容缝，不在还没完成存量回填前直接收紧成 NOT NULL。
ALTER TABLE anonymous_identities
    ADD COLUMN IF NOT EXISTS identity_uuid UUID;

ALTER TABLE anonymous_identities
    ADD COLUMN IF NOT EXISTS theme_key TEXT;

-- 旧 anonymous_identity_id TEXT 列继续保留，作为迁移窗口内的兼容缝。
UPDATE anonymous_identities
SET theme_key = 'legacy'
WHERE theme_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_anonymous_identities_identity_uuid
ON anonymous_identities (identity_uuid);
