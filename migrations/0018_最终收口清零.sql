-- 0018 最终收口清零：
-- 1. 把匿名身份存量补齐到 identity_uuid/theme_key，后续读取层不再回退旧串；
-- 2. 把历史视频记录里的 origin_* 生命周期补齐，后续读取层不再回退 mezzanine_*。

UPDATE anonymous_identities
SET identity_uuid = COALESCE(
        identity_uuid,
        (
            substr(md5('koko-identity-' || id::text), 1, 8) || '-' ||
            substr(md5('koko-identity-' || id::text), 9, 4) || '-' ||
            substr(md5('koko-identity-' || id::text), 13, 4) || '-' ||
            substr(md5('koko-identity-' || id::text), 17, 4) || '-' ||
            substr(md5('koko-identity-' || id::text), 21, 12)
        )::uuid
    ),
    theme_key = COALESCE(theme_key, 'legacy')
WHERE identity_uuid IS NULL
   OR theme_key IS NULL;

UPDATE attachments
SET origin_expires_at = COALESCE(origin_expires_at, mezzanine_expires_at),
    origin_deleted_at = COALESCE(origin_deleted_at, mezzanine_deleted_at)
WHERE kind = 'video'
  AND (origin_expires_at IS NULL OR origin_deleted_at IS NULL);
