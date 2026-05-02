use names::{Generator, Name};
use serde::Deserialize;
use std::{collections::HashSet, sync::OnceLock};
use uuid::Uuid;

// 资料投影 owner 已搬进 `src/身份/`，静态词库仍保持仓库统一资产位置。
// 这里显式改成新的相对路径，避免“文件搬了但词库入口还指向旧位置”。
const 花名词库_JSON: &str = include_str!("../../assets/anonymous_alias_themes.json");
const 组合花名权重: u8 = 85;
const 最小花名空间: usize = 20_000;
const 最小组合主题数: usize = 23;
const 最小单主题词条数: usize = 30;
const 最小完整梗句数: usize = 200;

static 花名词库缓存: OnceLock<花名词库文件> = OnceLock::new();

/// 当前资料投影是匿名身份对外可见的外衣。
/// 它故意只保留“主题键 + 展示花名”这两个和资料投影直接相关的字段，
/// 不把数据库主键、会话锚点或设备入口凭证塞进这里。
pub(crate) struct 当前资料投影 {
    pub(crate) theme_key: String,
    pub(crate) display_alias: String,
}

/// 外置 JSON 是花名业务数据真相；Rust 结构只描述加载后的最小形状。
/// 这样扩花名时改业务数据，不把这份身份资料投影文件继续写成段子仓。
#[derive(Debug, Deserialize)]
struct 花名词库文件 {
    version: u32,
    combo_themes: Vec<组合主题词典>,
    phrase_themes: Vec<完整梗句主题>,
}

#[derive(Debug, Deserialize)]
struct 组合主题词典 {
    key: String,
    /// 字段名保留为 `names` crate 的 API 语义；业务上这里允许放“前半句/后半句”。
    /// 这样能继续复用成熟组合轮子，同时把关系错位、台词残片等中文梗语法榨进主组合空间。
    adjectives: Vec<String>,
    nouns: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct 完整梗句主题 {
    key: String,
    phrases: Vec<String>,
}

/// 生成内部真实身份锚点。
/// `UUIDv7` 只在系统内部流转，既保留时间有序的数据库友好性，
/// 也避免再把展示花名或公开句柄误塞进主键语义。
pub(crate) fn 生成内部身份() -> Uuid {
    Uuid::now_v7()
}

/// 从项目级主题库里随机抽一套当前资料投影。
/// 短组合仍由成熟 `names` 轮子完成；完整梗句只作为业务数据直接抽取，
/// 避免为了长句梗再手搓第二套组合算法。
pub(crate) fn 随机分配资料投影() -> 当前资料投影 {
    let catalog = 花名词库();
    let entropy = Uuid::new_v4();
    let bytes = entropy.as_bytes();

    if bytes[0] % 100 < 组合花名权重 || catalog.phrase_themes.is_empty() {
        return 按组合主题生成资料投影(catalog, bytes[1] as usize);
    }

    按完整梗句生成资料投影(catalog, bytes[1] as usize, bytes[2] as usize)
}

fn 花名词库() -> &'static 花名词库文件 {
    花名词库缓存.get_or_init(|| {
        let catalog = 解析花名词库(花名词库_JSON).expect("静态花名词库 JSON 必须可解析");
        校验花名词库(&catalog).expect("静态花名词库必须满足数量和结构约束");
        catalog
    })
}

fn 解析花名词库(raw: &str) -> Result<花名词库文件, String> {
    serde_json::from_str(raw).map_err(|err| format!("解析花名词库失败: {err}"))
}

fn 计算花名空间(catalog: &花名词库文件) -> usize {
    let combo_total = catalog
        .combo_themes
        .iter()
        .map(|theme| theme.adjectives.len() * theme.nouns.len())
        .sum::<usize>();
    let phrase_total = catalog
        .phrase_themes
        .iter()
        .map(|theme| theme.phrases.len())
        .sum::<usize>();

    combo_total + phrase_total
}

fn 校验花名词库(catalog: &花名词库文件) -> Result<(), String> {
    if catalog.version != 1 {
        return Err(format!("不支持的花名词库版本: {}", catalog.version));
    }
    if catalog.combo_themes.len() < 最小组合主题数 {
        return Err("组合主题数量不足".to_string());
    }
    if 计算花名空间(catalog) < 最小花名空间 {
        return Err("花名空间不足两万".to_string());
    }

    let phrase_count = catalog
        .phrase_themes
        .iter()
        .map(|theme| theme.phrases.len())
        .sum::<usize>();
    if phrase_count < 最小完整梗句数 {
        return Err("完整梗句数量不足".to_string());
    }

    let mut keys = HashSet::new();
    for theme in &catalog.combo_themes {
        校验主题键(&mut keys, &theme.key)?;
        校验词条列表(
            &theme.key,
            "adjectives",
            &theme.adjectives,
            最小单主题词条数,
        )?;
        校验词条列表(&theme.key, "nouns", &theme.nouns, 最小单主题词条数)?;
    }
    for theme in &catalog.phrase_themes {
        校验主题键(&mut keys, &theme.key)?;
        校验词条列表(&theme.key, "phrases", &theme.phrases, 1)?;
    }

    Ok(())
}

fn 校验主题键(keys: &mut HashSet<String>, key: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("主题键不能为空".to_string());
    }
    if !keys.insert(key.to_string()) {
        return Err(format!("主题键重复: {key}"));
    }
    Ok(())
}

fn 校验词条列表(
    key: &str,
    field: &str,
    values: &[String],
    min_len: usize,
) -> Result<(), String> {
    if values.len() < min_len {
        return Err(format!("{key}.{field} 词条数量不足"));
    }
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(format!("{key}.{field} 存在空词条"));
    }
    Ok(())
}

fn 按组合主题生成资料投影(
    catalog: &花名词库文件, entropy: usize
) -> 当前资料投影 {
    let theme = &catalog.combo_themes[entropy % catalog.combo_themes.len()];
    当前资料投影 {
        theme_key: theme.key.clone(),
        display_alias: 按组合主题生成花名(theme),
    }
}

fn 按组合主题生成花名(theme: &组合主题词典) -> String {
    let adjectives = theme
        .adjectives
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let nouns = theme.nouns.iter().map(String::as_str).collect::<Vec<_>>();
    let mut generator = Generator::new(&adjectives, &nouns, Name::Plain);

    generator
        .next()
        .map(|alias| alias.replace('-', ""))
        .unwrap_or_else(|| format!("{}{}", theme.adjectives[0], theme.nouns[0]))
}

fn 按完整梗句生成资料投影(
    catalog: &花名词库文件,
    theme_entropy: usize,
    phrase_entropy: usize,
) -> 当前资料投影 {
    let theme = &catalog.phrase_themes[theme_entropy % catalog.phrase_themes.len()];
    按完整梗句主题生成资料投影_带索引(theme, phrase_entropy)
}

#[cfg(test)]
fn 按完整梗句主题生成资料投影(theme: &完整梗句主题) -> 当前资料投影 {
    按完整梗句主题生成资料投影_带索引(theme, 0)
}

fn 按完整梗句主题生成资料投影_带索引(
    theme: &完整梗句主题,
    phrase_entropy: usize,
) -> 当前资料投影 {
    当前资料投影 {
        theme_key: theme.key.clone(),
        display_alias: theme.phrases[phrase_entropy % theme.phrases.len()].clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 花名词库组合空间至少两万() {
        let catalog = 花名词库();
        let combo_total = catalog
            .combo_themes
            .iter()
            .map(|theme| theme.adjectives.len() * theme.nouns.len())
            .sum::<usize>();

        assert!(
            catalog.combo_themes.len() >= 23,
            "names 主组合主题数量不足，不能靠完整梗句池凑两万空间"
        );
        assert!(
            combo_total >= 20_000,
            "names 主组合空间不能再退回当前 64 级别，也不能停在刚过一万的下限"
        );
        assert!(
            计算花名空间(catalog) >= combo_total,
            "总花名空间不能小于 names 主组合空间"
        );
    }

    #[test]
    fn 花名词库主题键唯一且词条非空() {
        let catalog = 花名词库();

        校验花名词库(catalog).expect("静态花名词库必须在启动前可校验");
    }

    #[test]
    fn 组合花名继续通过_names_轮子生成() {
        let catalog = 花名词库();
        let combo = catalog
            .combo_themes
            .iter()
            .find(|theme| theme.key == "programmer_mystic")
            .expect("应存在程序员玄学主题");

        let alias = 按组合主题生成花名(combo);

        assert!(!alias.trim().is_empty());
        assert!(
            combo
                .adjectives
                .iter()
                .any(|word| alias.contains(word.trim_end_matches('的')))
                || combo.nouns.iter().any(|word| alias.contains(word)),
            "生成结果应该来自主题数据，而不是硬编码兜底"
        );
    }

    #[test]
    fn 文学脱口秀语法必须进入_names_主组合主题() {
        let catalog = 花名词库();
        let required_keys = [
            "relationship_absurd",
            "profession_absurd",
            "pseudo_academic",
            "line_fragment",
            "subject_object_inversion",
            "gentle_absurd",
            "bureaucracy_myth",
            "infrastructure_poetry",
            "emotion_personification",
            "marketplace_timewarp",
            "micro_drama_logic",
        ];

        for key in required_keys {
            let combo = catalog
                .combo_themes
                .iter()
                .find(|theme| theme.key == key)
                .unwrap_or_else(|| panic!("应存在 names 主组合主题: {key}"));

            let alias = 按组合主题生成花名(combo);

            assert!(!alias.trim().is_empty());
            assert!(
                !alias.contains('-'),
                "中文主组合花名不应该暴露 names crate 的连字符"
            );
        }
    }

    #[test]
    fn 完整梗句池可以直接产出花名() {
        let catalog = 花名词库();
        let phrase_theme = catalog
            .phrase_themes
            .iter()
            .find(|theme| theme.key == "classic_meme_phrase")
            .expect("应存在经典完整梗句主题");

        let projection = 按完整梗句主题生成资料投影(phrase_theme);

        assert_eq!(projection.theme_key, "classic_meme_phrase");
        assert!(phrase_theme.phrases.contains(&projection.display_alias));
    }

    #[test]
    fn 随机分配资料投影会产出主题键和花名() {
        for _ in 0..100 {
            let projection = 随机分配资料投影();

            assert!(!projection.theme_key.trim().is_empty());
            assert!(!projection.display_alias.trim().is_empty());
        }
    }
}
