# graphify 版本变化与实战坑点

## 这份笔记基于什么

这次学习不是只看 README，我实际对的是：

- 官方仓库 `v4`
- 当前本机包版本 `graphifyy 0.4.3`
- `README.md`
- `README.zh-CN.md`
- `CHANGELOG.md`
- `ARCHITECTURE.md`
- `graphify/__main__.py`
- `graphify/detect.py`
- `graphify/watch.py`
- `graphify/hooks.py`
- `tests/test_install.py`
- `tests/test_detect.py`
- `tests/test_hooks.py`
- `tests/test_watch.py`

## 近几版最该记住的变化

### `0.4.3`

- 发布时间是 `2026-04-12`
- JS/TS 的相对导入（`./foo`）现在会正确解析成完整节点 ID，大型 TypeScript 仓库里之前悄悄丢掉的 `imports_from` 边被补回来了
- `graphify watch` 现在会把新的 AST 节点和上一次全量建图留下的语义节点一起合并，不再出现“改一次代码就把文档/论文语义层擦掉”的问题
- Windows 下的 git hook 现在会在没有 `python3` 时自动回退到 `python`，两者都没有时安静退出，不再硬炸
- `.vue` 和 `.svelte` 现在会被当成代码文件参与提取

这一版对 koko 最关键，因为它同时打中：

- Windows 原生开发环境
- TypeScript 前端导入关系
- 代码图和语义图共存的长期项目

### `0.3.27`

- `graphify install --platform gemini` 会把 skill 真正复制到 Gemini 的技能目录，补上之前“命令装了但触发词没生效”的坑

这版跟 koko 关系不大，但能看出官方最近一直在收口“安装成功不等于真能用”的问题。

### `0.3.25`

- `.graphifyignore` 现在会像 `.gitignore` 一样沿父目录往上找，子目录扫描也会继承根规则
- MCP 路径校验和异常返回做了修补
- 新增 `--directed`
- Markdown frontmatter 改动不再无意义打爆缓存

### `0.3.24`

- `graphify codex install` / `opencode install` 的幂等性修过了
- 已有 `AGENTS.md` 但缺 `.codex/hooks.json` 时，重跑安装能自动补齐

这版很重要，因为它决定了“重跑官方安装命令到底是修复，还是只会早退”。

### `0.3.20`

- 交互式 HTML 图把节点标签、文件类型、社区名、源文件和边关系都做了 escaping
- `graphify opencode install` 开始写 `tool.execute.before` plugin
- AST 调用边统一标成 `EXTRACTED / 1.0`
- `tree-sitter` 开始显式要求 `>= 0.23.0`

这版更多是在补安全、标注准确性和依赖边界。

## 目前最容易踩的坑

### 坑 1：把 README 当成唯一真相

官方 README 有时会落后于当前实现。

这次我实际核到的一个例子就是：

- 当前 `__main__.py` 和更新日志都表明 Codex 会注册 `.codex/hooks.json`
- 但中文 README 某段仍保留了“Codex 没有 PreToolUse hook”的旧说法

遇到这种冲突，别猜，直接以：

- `graphify --help`
- `graphify/__main__.py`
- `tests/`

为准。

如果问题已经牵扯到 Codex 自己的能力边界，比如：

- `PreToolUse` hook 到底支不支持
- `hooks.json` 在哪一层生效
- Windows 和 WSL 有没有差别

那就不能只看 `graphify` 仓库，还得继续往上看 Codex 官方文档。

### 坑 2：以为 `--watch` 会自动重建一切

不是。

- 代码变更：自动
- 文档、PDF、图片变更：只打 `needs_update` 旗子

所以整理 `学习/` 这类文档工作，最后还是要手动 `$graphify . --update`。

### 坑 3：把 `install --platform codex` 和 `codex install` 当成一回事

不是。

官方现在至少有两步：

- `graphify install --platform codex`
  这是装全局 skill。我们这次实测落点是 `C:\Users\home\.agents\skills\graphify\SKILL.md`
- `graphify codex install`
  这是写项目规则，会改项目里的：
  - `AGENTS.md`
  - `.codex/hooks.json`

少任何一步，都会出现“好像装了，但少一半能力”的假成功。

但这里还要再补半句，不然又会误会：

- `写进去了` 不等于 `当前环境已经真生效了`

按 Codex 官方文档：

- hooks 是实验功能
- 要开 `features.codex_hooks = true`
- hooks 目前在 Windows 上禁用

所以对你现在这个 Windows 原生 Codex app，更稳的认知是：

- `AGENTS.md` 在生效
- `.codex/hooks.json` 已经配置好，但不要默认它在当前环境真跑起来了

### 坑 4：以为忽略规则一直都对

`--watch` 对 `.graphifyignore` 的尊重是 `0.3.18` 才修好的。

如果版本太旧，你以为自己排除了某些目录，后台 watcher 可能还是会吃进去。

### 坑 5：把自己的旧报告反复喂回去

如果不排 `graphify-out/`，图谱很容易被自己上一次产出的二手总结污染。

但 `graphify-out/memory/` 又是官方刻意保留的反馈回路。

所以要分清：

- 哪些是垃圾回声
- 哪些是有价值的问答沉淀

### 坑 6：没看 corpus warning 就硬跑大目录

当前官方检测里：

- 词数太少，会提示你“可能不需要图”
- 词数太大或文件太多，会提示你 token 成本高

如果目录大到离谱，先切子目录，不要机械全仓猛跑。

### 坑 7：把 `0.3.20` 的 `watch.py` 旧 bug 当成今天的现实

这个坑在我们旧笔记里是真坑，但它已经不是 `0.4.3` 的现实了。

我这次把本机升到 `0.4.3` 后，重新跑：

- `python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

这次实际结果是：

- `AST extraction: 110/110 files (100%)`
- `[graphify watch] Rebuilt: 283 nodes, 336 edges, 33 communities`
- `[graphify watch] graph.json and GRAPH_REPORT.md updated in graphify-out`

也就是说：

- `0.3.20` 那条 `_rebuild_code()` 结构性崩溃链，今天已经不能继续当结论复读
- 当前 `0.4.3` 下，koko 这套代码侧重建链已经能跑通
- 但它仍然只是代码图自动更新，不等于文档/PDF/图片也会自动重提取

## 对 koko 当前最实用的结论

- 我们现在已经升到 `0.4.3`
- `graphify install --platform codex` 和 `graphify codex install` 要分开理解：前者装全局 skill，后者写项目常驻规则
- `watch`、git hook、`codex install` 三套机制现在在概念和实测上都能配合
- 当前 `0.4.3` 下，`_rebuild_code()` 在 koko 里已经能跑通
- `graphify hook install` 在我们这台 Windows 原生环境也已经装上了 `post-commit` / `post-checkout`，而且新版本会在没有 `python3` 时回退到 `python`
- 但 `codex install` 写进去的 PreToolUse hook，在当前 Windows native 环境下不能默认当成已生效
- 但文档类更新依旧不要幻想成全自动
- 长期最好保留 `.graphifyignore`
- 发生 `graphify` 文档冲突时，先信当前 CLI 和源码
- 发生 Codex 能力边界冲突时，再往上信 Codex 官方文档

## 官方依据

- `CHANGELOG.md`
- `graphify/__main__.py`
- `graphify/detect.py`
- `graphify/watch.py`
- `tests/test_install.py`
- `tests/test_detect.py`
- `tests/test_hooks.py`
- [Hooks – Codex](https://developers.openai.com/codex/hooks)
- [Configuration Reference – Codex](https://developers.openai.com/codex/config-reference)
- [Windows – Codex app](https://developers.openai.com/codex/app/windows)
