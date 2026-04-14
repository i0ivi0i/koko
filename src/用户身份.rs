use names::{Generator, Name};
use uuid::Uuid;

/// 当前资料投影是匿名身份对外可见的外衣。
/// 它故意只保留“主题键 + 展示花名”这两个和资料投影直接相关的字段，
/// 不把数据库主键、会话锚点或设备入口凭证塞进这里。
pub(crate) struct 当前资料投影 {
    pub(crate) theme_key: &'static str,
    pub(crate) display_alias: String,
}

struct 主题词典 {
    key: &'static str,
    adjectives: &'static [&'static str],
    nouns: &'static [&'static str],
}

const 动物主题形容词: &[&str] = &["暴躁的", "潜水的", "开黑的", "叛逆的"];
const 动物主题名词: &[&str] = &["企鹅", "海豹", "水獭", "松鼠"];

const 宇宙主题形容词: &[&str] = &["失眠的", "跳跃的", "流浪的", "发光的"];
const 宇宙主题名词: &[&str] = &["彗星", "星云", "月兔", "极光"];

const 零食主题形容词: &[&str] = &["脆脆的", "冒泡的", "偷吃的", "加辣的"];
const 零食主题名词: &[&str] = &["薯片", "汽水", "团子", "曲奇"];

const 天气主题形容词: &[&str] = &["早起的", "打雷的", "回南天的", "晴窗边的"];
const 天气主题名词: &[&str] = &["阵雨", "晚风", "流云", "朝霞"];

const 主题词库: &[主题词典] = &[
    主题词典 {
        key: "wildlife",
        adjectives: 动物主题形容词,
        nouns: 动物主题名词,
    },
    主题词典 {
        key: "cosmos",
        adjectives: 宇宙主题形容词,
        nouns: 宇宙主题名词,
    },
    主题词典 {
        key: "snack",
        adjectives: 零食主题形容词,
        nouns: 零食主题名词,
    },
    主题词典 {
        key: "weather",
        adjectives: 天气主题形容词,
        nouns: 天气主题名词,
    },
];

/// 生成内部真实身份锚点。
/// `UUIDv7` 只在系统内部流转，既保留时间有序的数据库友好性，
/// 也避免再把展示花名或公开句柄误塞进主键语义。
pub(crate) fn 生成内部身份() -> Uuid {
    Uuid::now_v7()
}

/// 从项目级主题库里随机抽一套当前资料投影。
/// 这里复用成熟的 `names` 轮子负责“词典 -> 名字”的随机组合，
/// 我们自己只做一层很薄的中文格式适配：把默认连字符去掉，得到最终花名。
pub(crate) fn 随机分配资料投影() -> 当前资料投影 {
    let theme = 选择主题();
    let display_alias = 按主题生成花名(theme);
    当前资料投影 {
        theme_key: theme.key,
        display_alias,
    }
}

fn 选择主题() -> &'static 主题词典 {
    let entropy = Uuid::new_v4();
    let idx = (entropy.as_bytes()[0] as usize) % 主题词库.len();
    &主题词库[idx]
}

fn 按主题生成花名(theme: &主题词典) -> String {
    let mut generator = Generator::new(theme.adjectives, theme.nouns, Name::Plain);
    generator
        .next()
        .map(|alias| alias.replace('-', ""))
        .unwrap_or_else(|| format!("{}{}", theme.adjectives[0], theme.nouns[0]))
}

