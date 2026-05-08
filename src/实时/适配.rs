use crate::{domain, message, realtime, shared::contract};

use super::{PgRealtime仓储, 房间阅读适配, 媒体附件适配, 消息事件适配};

/// realtime 热路径专属 PostgreSQL adapter。
/// 这层只保留 async 只读查询与单条消息提交，不再让 `src/适配/mod.rs` 背热路径细节。
impl realtime::application::实时会话房间校验仓储端口 for PgRealtime仓储 {
    async fn 检查会话存在(&self, 会话标识: &str) -> Result<bool, contract::错误码> {
        房间阅读适配::检查会话存在_异步(&self.repo.pool, 会话标识).await
    }

    async fn 检查房间存在(&self, 房间标识: &str) -> Result<bool, contract::错误码> {
        房间阅读适配::检查房间存在_异步(&self.repo.pool, 房间标识).await
    }

    async fn 检查成员资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<bool, contract::错误码> {
        房间阅读适配::检查成员资格_异步(&self.repo.pool, 房间标识, 会话标识).await
    }
}

impl realtime::application::实时房间仓储端口 for PgRealtime仓储 {
    async fn 拉取房间增量事件(
        &self,
        房间标识: &str,
        从位置开始: i64,
    ) -> Result<contract::快照, contract::错误码> {
        房间阅读适配::拉取房间增量事件_异步(&self.repo.pool, 房间标识, 从位置开始).await
    }
}

impl message::application::Realtime消息仓储端口 for PgRealtime仓储 {
    async fn 查询会话所属匿名身份(
        &self,
        会话标识: &str,
    ) -> Result<Option<String>, contract::错误码> {
        房间阅读适配::查询会话所属匿名身份_异步(&self.repo.pool, 会话标识).await
    }

    async fn 查询附件快照(
        &self,
        附件标识: &str,
    ) -> Result<Option<crate::media::模型::附件读取结果>, contract::错误码> {
        媒体附件适配::查询附件快照_异步(&self.repo.pool, 附件标识).await
    }

    async fn 批量查询附件快照(
        &self,
        附件标识列表: &[String],
    ) -> Result<Vec<crate::media::模型::附件读取结果>, contract::错误码> {
        媒体附件适配::批量查询附件快照_异步(&self.repo.pool, 附件标识列表).await
    }

    async fn 校验并读取消息发送资格(
        &self,
        房间标识: &str,
        会话标识: &str,
    ) -> Result<message::application::消息发送资格校验结果, contract::错误码> {
        房间阅读适配::校验消息发送资格_异步(&self.repo.pool, 房间标识, 会话标识).await
    }

    async fn 创建统一消息事件(
        &mut self,
        房间标识: &str,
        客户端消息标识: &str,
        会话标识: &str,
        文本: &str,
        附件: &[domain::message::已校验附件引用],
    ) -> Result<contract::领域事件, contract::错误码> {
        消息事件适配::提交统一消息事件_异步(
            &self.repo.pool,
            房间标识,
            客户端消息标识,
            会话标识,
            文本,
            附件,
        )
        .await
    }
}
