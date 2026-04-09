# graphify 忽略规则缓存与反馈回路

## `.graphifyignore` 是什么

官方明确支持一个单独的忽略文件：

- 文件名：`.graphifyignore`
- 语法：按 `.gitignore` 思路写
- 作用：告诉 graphify 哪些东西不要吃进去

它不是直接读取 `.gitignore`，而是 graphify 自己单独维护一套忽略规则。

## 它适合拿来排除什么

最典型的是这几类：

- 你不想进入知识图谱的生成产物
- 项目私有的临时目录
- 低价值噪音文档
- 会污染图谱的二手总结

比如我们现在排掉的：

```gitignore
graphify-out/
```

这等于告诉 graphify：

- 别把你自己上一次生成的报告和图，再拿回来继续喂自己

## 官方本来就会跳过哪些目录

就算你不写 `.graphifyignore`，当前官方实现也会默认跳过很多噪音目录，比如：

- `dist`
- `build`
- `target`
- `out`
- `node_modules`
- `__pycache__`
- `.git`
- `.pytest_cache`
- `.mypy_cache`
- `.ruff_cache`
- `.tox`
- `.venv`

所以常见构建产物、依赖目录、缓存目录，不是完全裸奔的。

但项目特有的垃圾目录，还是得你自己写 `.graphifyignore`。

## `graphify-out/` 有个例外

官方源码里有个很重要的特判：

- `graphify-out/memory/` 会被故意重新纳入扫描

原因是官方希望把你后续的问答结果再反馈回图里。

所以：

- `graphify-out/` 不是天然全忽略
- `memory/` 是官方设计出来的反馈回路

这也是为什么你会看到官方同时强调：

- 不要把垃圾报告反复喂回去
- 但可以把有价值的问答沉淀进 `memory/`

## 缓存怎么工作

官方有两层很实用的省成本机制：

- `graphify-out/cache/`
  语义提取缓存，没变的文件下次不用重复抽。
- `graphify-out/manifest.json`
  记录文件修改时间，让 `--update` 判断哪些是新文件、哪些变了。

大白话：

- 第一次建图最贵
- 后面只要不大洗牌，`--update` 会便宜很多

## `save-result` 和 `memory/` 是干嘛的

从 `0.3.18` 开始，官方专门给了：

```bash
graphify save-result
```

它会把你的问答结果存进：

- `graphify-out/memory/`

官方设计的意思是：

- 你问过的问题
- 图上走过的解释
- 你得到的结论

以后都可以再被抽取回知识图谱，形成“问答也变语料”的反馈回路。

## `needs_update` 是什么

当你开着 `--watch`，如果改的是文档、论文或图片，官方不会偷偷自动重跑完整语义提取，而是：

- 写一个 `graphify-out/needs_update`

这就是在提醒你：

- 代码图可以即时补
- 文档语义图还没补
- 现在该你手动跑 `$graphify . --update`

## 还有一个容易被忽略的安全边界

官方 `detect.py` 还会静默跳过一部分疑似敏感文件，比如：

- `.env`
- 私钥、证书
- 各类凭证命名文件

所以它不是见文件就吃，至少做了基础秘密过滤。

## 对 koko 的直接操作建议

- 长期保留 `.graphifyignore`
- 至少排掉 `graphify-out/`
- 文档整理完一轮后手动 `$graphify . --update`
- 真正值得沉淀的问答，再考虑 `graphify save-result`

## 官方依据

- `graphify/detect.py`
- `tests/test_detect.py`
- `CHANGELOG.md`
- `graphify --help`
