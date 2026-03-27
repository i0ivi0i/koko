# GitHub Releases 自动发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `koko` 增加 GitHub Actions 自动发布流程，在打 `v*` 标签后自动构建并上传四类 release 产物，供现有安装脚本消费。

**Architecture:** 只在发布壳层新增 workflow 和打包脚本，不改业务内核。工作流触发于 Git tag，统一生成 server/web/admin/migrations 四类 tar.gz 资产，并直接复用 Dioxus 默认 release 输出目录。

**Tech Stack:** GitHub Actions, Dioxus CLI, PowerShell, Rust release builds

---

### Task 1: 增加发布配置

**Files:**
- Create: `.github/workflows/release.yml`

- [x] **Step 1: 写 release workflow**

要求：
- 触发：`push tags v*`
- 安装 Rust
- 安装 `dx`
- 构建 `koko-server`
- 构建 `koko-web`
- 构建 `koko-admin`
- 直接使用 `target/dx/<package>/release/web/public` 打包前端产物
- 调用打包脚本
- 创建 GitHub Release 并上传资产

### Task 2: 增加统一打包脚本

**Files:**
- Create: `package-release.ps1`

- [x] **Step 1: 写失败测试思路并先手动验证缺文件会失败**

最小要求：
- 任一产物缺失时非 0 退出
- 产物齐全时产出四个固定命名包

- [x] **Step 2: 写打包脚本**

产物命名固定为：
- `koko-server-linux-x86_64.tar.gz`
- `koko-web.tar.gz`
- `koko-admin.tar.gz`
- `koko-migrations.tar.gz`

- [x] **Step 3: 本地 dry-run 打包验证**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File .\package-release.ps1 -Version v0.0.0-test -DryRun
```

Expected:
- 打印输入目录和目标产物名
- 不修改仓库业务代码

### Task 3: 让 install.sh 和发布流程对齐

**Files:**
- Modify: `install.sh`

- [x] **Step 1: 检查 install.sh 的资产命名与 workflow 一致**

- [x] **Step 2: 必要时最小修正 release 路径/版本变量**

### Task 4: 验证与收尾

**Files:**
- Modify: `docs/superpowers/plans/2026-03-28-GitHub-Releases自动发布实现计划.md`

- [x] **Step 1: 校验 workflow YAML 基本结构**

- [x] **Step 2: 运行打包脚本 dry-run**

- [x] **Step 3: 更新计划状态**

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/release.yml package-release.ps1 install.sh docs/superpowers/specs/2026-03-28-GitHub-Releases自动发布设计.md docs/superpowers/plans/2026-03-28-GitHub-Releases自动发布实现计划.md
git commit -m "发布: 新增 GitHub Releases 自动发布流程"
```
