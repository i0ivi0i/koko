# graphify 版本变化与实战坑点

## 这份笔记基于什么

这次学习不是只看 README，我实际对的是：

- 官方仓库 `v3`
- 当前本机包版本 `graphifyy 0.3.20`
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

### `0.3.20`

- 发布时间是 `2026-04-09`
- 交互式 HTML 图把节点标签、文件类型、社区名、源文件和边关系都做了 HTML escaping，顺手堵上了一类 XSS 风险
- `graphify opencode install` 现在会写 `tool.execute.before` plugin，不再只改 `AGENTS.md`
- AST 调用边现在标成 `EXTRACTED / 1.0`，不再继续伪装成 `INFERRED / 0.8`
- `tree-sitter` 现在显式要求 `>= 0.23.0`，并加了版本守卫，旧环境会给更清楚的报错

这一版的方向很明确：

- 一部分是在修安全和标注准确性
- 一部分是在补 OpenCode 集成
- 另一部分是在收紧 `tree-sitter` 环境边界

### `0.3.19`

- 安装步骤先尝试普通 `pip install`，再回退到 `--break-system-packages`
- 对托管 Python 环境更稳，少一点把环境装坏的风险

### `0.3.18`

- `--watch` 终于会尊重 `.graphifyignore`
- Codex 的 `PreToolUse` hook 改成 `systemMessage`
- 官方新增 `graphify save-result`
- skill 模板不再靠一大段内联 Python 保存问答

这是非常关键的一版，因为它直接影响我们这种长期项目的日常使用感。

### `0.3.17`

- 语义提取 chunk 会按目录分组
- 大项目 AST 提取会打印进度
- `tree-sitter` 依赖约束更严

这版解决的是“看起来卡死”和“抽取结果不稳定”的问题。

### `0.3.14`

- `graphify codex install` 会写 `.codex/hooks.json`
- `--update` 会清掉已删除文件留下的 ghost nodes

这版之后，Codex 集成才真正比较像样。

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

### 坑 3：以为 `codex install` 只是加一段说明

不是。

它会改项目里的：

- `AGENTS.md`
- `.codex/hooks.json`

这是项目级长期规则，不是一次性命令提示。

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

### 坑 7：`watch.py` 里的代码重建现在仍然有结构性 bug

我这次把本机从 `0.3.19` 升到 `0.3.20` 后，重新跑：

- `py -3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

结果依然是：

- `[graphify watch] Rebuild failed: <FileType.CODE: 'code'>`

根因不是 koko 仓库私有逻辑，而是当前官方包里的：

- `detect()` 返回的是 `{"files": {"code": [...]}}`
- 但 `watch.py::_rebuild_code()` 还在读 `detected[FileType.CODE]`

也就是：

- 检测结果已经改成“字符串 key 包一层 `files`”
- watcher 这边却还按旧结构直接拿 `Enum key`

所以在当前 `0.3.20`，`_rebuild_code()` / hook 这条链对我们来说还不能当成可靠自动化。

## 对 koko 当前最实用的结论

- 我们现在已经升到 `0.3.20`
- `watch`、`hook`、`codex install` 三套机制在概念上能配合
- 但当前官方包里的 `watch.py` 仍有结构性 bug，`_rebuild_code()` 这条链在我们这里还是会炸
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
