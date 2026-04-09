# graphify 分馆

这里收的是 `safishamsi/graphify` 官方仓库、官方 README、官方 skill 模板、更新日志和当前源码实现的学习结果。

## 资料清单

- [graphify-官方用法总览.md](./graphify-官方用法总览.md)
  把它到底是什么、怎么跑、产出什么、常用命令怎么分层讲清楚。
- [graphify-自动更新常驻规则与边界.md](./graphify-自动更新常驻规则与边界.md)
  专门讲 `--watch`、`hook install`、`codex install` 到底各自自动到什么程度。
- [graphify-忽略规则缓存与反馈回路.md](./graphify-忽略规则缓存与反馈回路.md)
  专门讲 `.graphifyignore`、默认跳过目录、缓存、`memory/`、`save-result`。
- [graphify-版本变化与实战坑点.md](./graphify-版本变化与实战坑点.md)
  收近几版关键变化、官方文档口径冲突和最容易踩的坑。

## 建议阅读顺序

1. 先看 [graphify-官方用法总览.md](./graphify-官方用法总览.md)，先把表面命令用顺。
2. 再看 [graphify-自动更新常驻规则与边界.md](./graphify-自动更新常驻规则与边界.md)，把“自动”这件事想明白。
3. 接着看 [graphify-忽略规则缓存与反馈回路.md](./graphify-忽略规则缓存与反馈回路.md)，避免把垃圾、缓存和旧报告喂回图里。
4. 最后看 [graphify-版本变化与实战坑点.md](./graphify-版本变化与实战坑点.md)，校准哪些说法已经过期。

## 这组资料的信任顺序

- 第一优先：当前 `graphify --help`
- 第二优先：当前版本源码里的 `graphify/__main__.py`、`graphify/detect.py`、`graphify/watch.py`、`graphify/hooks.py`
- 第三优先：`tests/` 里的行为测试
- 第四优先：`CHANGELOG.md`
- 第五优先：README

原因很简单：README 有时会落后于当前实现，尤其是平台集成和自动化边界这几块。
