/// 第一阶段共享命令契约：各壳层只能表达意图，不能直接裁决业务真相。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 命令 {
    引导匿名会话,
    按短码进房或建房 { 房间短码: String },
    发送文本消息 {
        房间标识: String,
        客户端消息标识: String,
        文本: String,
    },
    后台登录 { 用户名: String, 密码: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 命令结果 {
    成功,
    被拒绝 { 错误码: 错误码 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 查询 {
    拉取房间快照 { 房间标识: String },
    拉取房间增量事件 { 房间标识: String, 从位置开始: i64 },
    后台概览,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 快照 {
    会话 {
        会话标识: String,
        显示名: String,
    },
    房间 {
        房间标识: String,
        最新事件位置: i64,
    },
    后台概览 {
        房间总数: u64,
        消息总数: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 领域事件 {
    消息已创建 {
        房间标识: String,
        消息标识: String,
        客户端消息标识: String,
        发送者会话标识: String,
        文本: String,
        事件位置: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum 控制面结果 {
    订阅已建立 { 房间标识: String, 起始位置: i64 },
    需要重拉快照 { 房间标识: String, 期望位置: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum 错误码 {
    配置缺失,
    参数非法,
    会话无效,
    房间不存在,
    成员资格不足,
    系统错误,
}
