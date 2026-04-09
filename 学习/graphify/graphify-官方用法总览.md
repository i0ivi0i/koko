# graphify 官方用法总览

## 一句话理解

`graphify` 不是普通文档索引器，它做的是：

- 把代码、文档、论文、图片混合语料抽成一张知识图
- 给每条边标记 `EXTRACTED / INFERRED / AMBIGUOUS`
- 产出 `graph.html`、`graph.json`、`GRAPH_REPORT.md`
- 让后续问答直接走图，而不是每次重读原文件

## 官方工作流到底分几层

- 第一层是 `detect`：先看这个目录里有哪些支持的文件、总词数多大、有没有必要建图。
- 第二层是 `extract`：代码走本地 AST，文档/论文/图片走语义提取。
- 第三层是 `build + cluster + analyze + export`：建图、聚类、生成报告和导出文件。

官方架构文档把它总结成一条管线：

```text
detect -> extract -> build -> cluster -> analyze -> report -> export
```

## 你真正会用到的产物

`graphify-out/` 里最关键的是：

- `graph.html`
  人看图用，能点节点、搜节点、按社区过滤。
- `graph.json`
  机器问答和后续查询的主真相。
- `GRAPH_REPORT.md`
  先看整体地图时最值钱，里面有 god nodes、意外连接、建议提问。
- `cache/`
  语义提取缓存，减少重复花 token。
- `manifest.json`
  让 `--update` 知道哪些文件变了。

## 常用命令怎么记

先分清 3 个入口，不要混：

- 在 Codex 对话里显式触发技能：`$graphify .`
- 在终端直接跑 CLI：`graphify ...`
- 在 README 里看到的 `/graphify ...`
  这是面向别的平台的技能触发写法，不是 PowerShell 命令

当前最容易混淆的一点是：

- 全量建图、`--update`、`--watch`、`--mode deep` 这类“跑整条图谱管线”的写法，官方主要写在 skill 模板里
- 当前 `graphify --help` 顶层真正列出来的，是 `query`、`save-result`、`benchmark`、`hook`、`codex install` 这类 CLI 子命令

所以对你最有用的官方命令，应该按两层记：

### 在 Codex 对话里用的 skill 命令

- 初次建图：`$graphify .`
- 增量更新：`$graphify . --update`
- 深模式：`$graphify . --mode deep`
- 只重聚类：`$graphify . --cluster-only`
- 加外部资料：`$graphify add <url>`
- 解释路径和节点：`$graphify query`、`$graphify path`、`$graphify explain`
- 额外导出：`$graphify . --wiki`、`--svg`、`--graphml`、`--neo4j`、`--mcp`
- 监听目录：`$graphify . --watch`

### 在终端里用的 CLI 命令

- 问图：`graphify query "问题"`
- 保存问答回图：`graphify save-result`
- 看压缩收益：`graphify benchmark graphify-out/graph.json`
- 装 git hooks：`graphify hook install`
- 装 Codex 常驻规则：`graphify codex install`

## 小白最够用的 4 个动作

如果你不想记太多，先只记这 4 个：

1. `$graphify .`
   第一次给一个目录建图。
2. `$graphify . --update`
   一轮改动之后手动补更新。
3. `graphify query "你的问题"`
   直接拿现成图回答问题。
4. `graphify codex install`
   让项目进入常驻图谱工作流。

## 它支持什么文件

当前官方实现里，核心支持是这几类：

- 代码：`.py .ts .js .jsx .tsx .go .rs .java .c .cpp .rb .cs .kt .scala .php .lua .zig .ps1 .ex .m .mm .jl ...`
- 文档：`.md .txt .rst`
- 论文：`.pdf`
- 图片：`.png .jpg .jpeg .gif .webp .svg`

大白话就是：

- 代码主要靠 tree-sitter AST，本地做。
- 文档、论文、图片主要靠模型做语义提取。

## 对 koko 最直接的理解

`graphify` 在这个项目里最适合做 3 件事：

- 给 `学习/` 和代码之间建立跨来源地图
- 给我这种代理先看总图，再下钻原文件
- 把“你已经学过但不在一个脑子里”的资料压成可持续复用的图

但它不是后台永远懂一切的神经系统。自动化边界要看下一篇。

## 官方依据

- `README.md`
- `README.zh-CN.md`
- `ARCHITECTURE.md`
- `graphify --help`
- `graphify/skill-codex.md`
