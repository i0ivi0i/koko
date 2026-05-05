-- 2026-05-06
--
-- attachment_streaming_manifests 已退出新附件正式主链。
-- 这里显式删除历史 HLS/DASH 清单表，而不是继续修改已经被 sqlx 应用过的 0001 基线，
-- 避免本地库、测试库和后续部署库因为 checksum 漂移而拒绝迁移。

DROP TABLE IF EXISTS attachment_streaming_manifests;
