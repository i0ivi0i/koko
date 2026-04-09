# graphify 自动更新常驻规则与边界

## 先把“自动”分成 3 种

官方其实给了 3 套不同机制，它们不是一回事：

- `$graphify . --watch`
  后台盯目录。
- `graphify hook install`
  绑到 git 提交和切分支。
- `graphify codex install`
  把图谱规则写进项目，让 Codex 默认先看图。

很多人误会 `graphify` 是“静默后台全自动”，其实不是。它更像 3 个不同力度的自动化开关。

## `--watch` 到底自动什么

官方 `watch.py` 的真实行为是：

- 代码文件变了：自动重跑 AST 提取、建图、聚类、报告生成
- 文档、论文、图片变了：不会自动做语义重提取，只会写一个 `graphify-out/needs_update`

大白话：

- 改 `.ts`、`.rs` 这类代码，`--watch` 很有用
- 改 `学习/` 里的 `.md`、图片、PDF，`--watch` 只会提醒你手动跑 `--update`

所以它不是“我一切都不用管了”，而是：

- 代码改动偏自动
- 文档类改动偏半自动

## `hook install` 到底自动什么

当前官方实现和测试都表明，`graphify hook install` 会装两种 git hook：

- `post-commit`
- `post-checkout`

它们做的也主要是代码侧自动化：

- commit 之后，会根据改动文件判断是否重建代码图
- 切分支之后，也会触发代码侧重建

这不是实时监控，也不是文档全自动更新。它的长处是：

- 不用常驻后台进程
- 跟任何编辑器无关
- 只要你走 git 提交/切分支，就会触发

## `codex install` 到底自动什么

当前官方源码已经不是“只写 AGENTS.md”了。

对 Codex，`graphify codex install` 现在会做两件事：

- 写项目根目录 `AGENTS.md`
- 写 `.codex/hooks.json`，注册 `PreToolUse` hook

这意味着在 Codex 里：

- 回答代码库问题前，会被提醒先看 `graphify-out/GRAPH_REPORT.md`
- 做代码工作时，更容易按图谱先导航

但它仍然不是系统级文件监控器。你自己在 IDE 里瞎改一堆文档，不会因为装了 `codex install` 就自动重建整张图。

## 对 Codex 还要补一个前提

官方 `skill-codex.md` 里明确写了：

- `~/.codex/config.toml` 里要开 `multi_agent = true`

这不是为了日常查询，而是为了全量建图时的并行语义提取。

大白话：

- 没开这个，不一定完全不能用
- 但并行抽取会受影响，官方技能也会退化

## 你在 koko 里怎么理解最稳

最稳的日常判断是：

- 我刚改的是代码：`--watch` 或 git hook 可能已经帮上忙了
- 我刚改的是 `学习/`、文档、笔记：手动 `$graphify . --update`
- 我想让 Codex 长期记住先看图：`graphify codex install`

别把这三件事混成一个“自动同步总开关”。

## 官方依据

- `graphify/watch.py`
- `graphify/hooks.py`
- `graphify/__main__.py`
- `tests/test_hooks.py`
- `graphify/skill-codex.md`
