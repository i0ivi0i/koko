-- 0021: 媒体 source_hash 权限边界注释。
-- 0020 已可能被本地或生产数据库应用，禁止再改 0020 正文，避免破坏 sqlx migration checksum。

COMMENT ON TABLE attachment_source_hashes IS
'source_hash 是上传前精确命中索引，不是全站可见资产身份；禁止跨权限存在性探测。';

COMMENT ON COLUMN attachment_source_hashes.source_hash IS
'原始 File 字节 SHA-256；禁止作为无权限全局媒体存在性探针。';

COMMENT ON COLUMN attachment_source_hashes.source_byte_size IS
'原始 File 字节长度；只能与 source_hash 一起服务受权限约束的上传前复用。';
