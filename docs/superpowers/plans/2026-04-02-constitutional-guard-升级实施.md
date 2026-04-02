# Constitutional Guard 升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** 将现有 `koko-constitutional-audit` 升级为通用、宿主无关的 `constitutional-guard`，让同一个 skill 同时覆盖开发前校准、开发中防漂移、开发后治理审查，并保留现有 anti-wheel 与宪法式审查能力。

**Architecture:** 对外保持一个统一 skill，对内重构成“薄路由层 + 三份模式协议 + 共享法则层 + 回归校验”。迁移时保留兼容 alias，但把 `constitutional-guard` 作为唯一 canonical name；所有新规则都优先落到 references 和 fixtures，而不是继续把 `SKILL.md` 堆胖。

**Tech Stack:** Markdown skill files, JSON fixtures/evals, Python validation scripts, host-neutral skill protocol

---

## 文件结构与职责

### 目标目录

- Skill root: `C:\Users\home\.claude\skills\constitutional-guard`
- 兼容入口: `C:\Users\home\.claude\skills\koko-constitutional-audit`
- 参考设计稿: `E:\koko\docs\superpowers\specs\2026-04-02-constitutional-guard-design.md`

### 计划中的主要文件职责

- `C:\Users\home\.claude\skills\constitutional-guard\SKILL.md`
  - 新 canonical 入口
  - 只保留触发、模式判定、能力协商、法则装载、路由规则
- `C:\Users\home\.claude\skills\constitutional-guard\references\mode-routing.md`
  - 明确 `pre / in-flight / post / combo` 判定与互斥规则
- `C:\Users\home\.claude\skills\constitutional-guard\references\modes\pre-code-calibration.md`
  - 写前校准协议
- `C:\Users\home\.claude\skills\constitutional-guard\references\modes\in-flight-drift-correction.md`
  - 写中轻量纠偏协议
- `C:\Users\home\.claude\skills\constitutional-guard\references\modes\post-code-audit.md`
  - 迁入并收口现有审查协议
- `C:\Users\home\.claude\skills\constitutional-guard\references\generic-constitutional-baseline.md`
  - 继续作为 baseline
- `C:\Users\home\.claude\skills\constitutional-guard\references\project-law-overlay.md`
  - 新增，明确项目治理文档发现与装载顺序
- `C:\Users\home\.claude\skills\constitutional-guard\references\report-template.md`
  - 升级为三态输出模板 + 状态机显性化规则
- `C:\Users\home\.claude\skills\constitutional-guard\references\protocol-conformance-rubric.md`
  - 加入三态守卫、一致性、状态机与审批闭环要求
- `C:\Users\home\.claude\skills\constitutional-guard\references\conformance-fixtures.json`
  - 扩展为三态、组合路由、状态机、高风险识别、例外/延期样例
- `C:\Users\home\.claude\skills\constitutional-guard\references\conformance-examples.md`
  - 更新为新 canonical name 与三态/状态机样例
- `C:\Users\home\.claude\skills\constitutional-guard\evals\evals.json`
  - 改成新 canonical name，并增加升级后的触发提示集
- `C:\Users\home\.claude\skills\constitutional-guard\scripts\check_protocol_conformance.py`
  - 继续校验 fixtures 与 verdict，但要识别新状态机与新字段
- `C:\Users\home\.claude\skills\constitutional-guard\scripts\run_fixture_batch.py`
  - 继续批跑，但要支持新增标签与三态矩阵
- `C:\Users\home\.claude\skills\koko-constitutional-audit\...`
  - 迁移窗口内保留兼容入口或兼容说明，不再承载新设计主逻辑

### 现状约束

- 当前 `koko-constitutional-audit` 目录还只有一套审查中心型结构，没有 `mode-routing.md` 和 `references/modes/`
- skill 不在 `E:\koko` git 仓库内，因此技能目录改动本身无法靠本仓库 commit 跟踪
- 但计划与设计稿在 `E:\koko` 仓库内，必须保持可追溯

---

## Task 1: 建立 canonical 目录与兼容迁移骨架

**Files:**
- Create: `C:\Users\home\.claude\skills\constitutional-guard\SKILL.md`
- Create: `C:\Users\home\.claude\skills\constitutional-guard\references\mode-routing.md`
- Create: `C:\Users\home\.claude\skills\constitutional-guard\references\project-law-overlay.md`
- Modify: `C:\Users\home\.claude\skills\koko-constitutional-audit\SKILL.md`

- [x] **Step 1: 复制现有 skill 到 canonical 新目录**

Run: `Copy-Item -Recurse -Force 'C:\Users\home\.claude\skills\koko-constitutional-audit' 'C:\Users\home\.claude\skills\constitutional-guard'`
Expected: 新目录存在，基础文件齐全

- [x] **Step 2: 写新的 canonical `SKILL.md` failing checklist**

写出一个最小草稿，先满足这些检查点：
- 名称改成 `constitutional-guard`
- description 改成生命周期治理触发
- 明确三态与 combo
- 明确 canonical name 与 compatibility alias

- [x] **Step 3: 写 `mode-routing.md`**

内容必须包含：
- `combo` 的前置判定条件
- `combo` 与 `pre / in-flight / post` 的排他关系
- 没命中 `combo` 时的顺序路由
- 哪些情况不得误判成 `combo`

- [x] **Step 4: 写 `project-law-overlay.md`**

内容必须包含：
- 文档发现顺序
- 装载顺序
- baseline-only 回退规则
- `审查维护.md` / `AGENTS.md` / 其他文档的终审顺序

- [x] **Step 5: 把旧入口改成兼容壳**

目标：
- 明确 `koko-constitutional-audit` 是 alias
- 旧入口必须是 `redirect-only` 最小兼容壳
- 不继续在旧入口里堆新规则
- 不保留任何新的可执行语义
- 至少能把使用者指向 `constitutional-guard`

- [x] **Step 6: 手工检查 canonical 与 alias 语义不打架**

检查：
- canonical name 唯一
- alias 只读兼容
- 旧入口不会继续成为双真值

- [x] **Step 7: 做一次全量旧名残留扫描**

Run: `Get-ChildItem -Recurse -File 'C:\Users\home\.claude\skills\constitutional-guard' | Select-String -Pattern 'koko-constitutional-audit'`
Expected: canonical 树内不再保留旧名残留；只有 alias 文件或迁移说明允许保留旧名

---

## Task 2: 拆出三态协议并收口输出契约

**Files:**
- Create: `C:\Users\home\.claude\skills\constitutional-guard\references\modes\pre-code-calibration.md`
- Create: `C:\Users\home\.claude\skills\constitutional-guard\references\modes\in-flight-drift-correction.md`
- Create: `C:\Users\home\.claude\skills\constitutional-guard\references\modes\post-code-audit.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\report-template.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\reviewer-roles.md`

- [x] **Step 1: 写 `pre-code-calibration.md`**

必须包含：
- 方案级校准与上下文级校准的区别
- 四栏输出
- 不顺手推荐别的 skill
- 调研不足时的暂定结论语义
- 自动介入后继续原任务

- [x] **Step 2: 写 `in-flight-drift-correction.md`**

必须包含：
- 持续轻量介入
- 典型漂移信号清单
- 极短双句纠偏
- 无问题静默通过
- 继续原任务

- [x] **Step 3: 写 `post-code-audit.md`**

目标：
- 把现有 repo/focused 审查协议迁过来
- 不削弱原有 anti-wheel / DDD / contract / decoupling 能力

- [x] **Step 4: 重写 `report-template.md`**

新增要求：
- 三态输出总表
- 高风险时显性化 `治理状态`
- `通过 / 驳回 / 例外放行 / 延期处理`
- `是否需要独立复核`
- 平时保持短、硬、清晰

- [x] **Step 5: 调整 `reviewer-roles.md`**

目标：
- repo/focused 审查继续用角色轴
- pre/in-flight 模式不要误用全套 reviewer 军团

---

## Task 3: 把治理状态机、独立复核、例外与延期闭环落进协议

**Files:**
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\SKILL.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\modes\pre-code-calibration.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\modes\in-flight-drift-correction.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\modes\post-code-audit.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\protocol-conformance-rubric.md`

- [x] **Step 1: 在主入口写入高风险识别器**

必须覆盖：
- 低风险判定条件
- 高风险默认规则
- 典型高风险信号

- [x] **Step 2: 在模式协议中接入四态状态机**

要求：
- 高风险场景不能没有治理状态
- `驳回 / 例外放行 / 延期处理` 的语义不能漂

- [x] **Step 3: 接入独立复核规则**

要求：
- AI / agent 不能既实施又唯一放行
- 高风险结论必须要求独立复核

- [x] **Step 4: 接入例外与延期规则**

要求：
- 例外不能突破根本红线
- 延期必须带债务字段
- 二者都不能伪装成通过

- [x] **Step 5: 升级 conformance rubric**

新增维度：
- 风险识别完整性
- 治理状态机完整性
- 独立复核完整性
- 例外/延期闭环完整性

---

## Task 4: 升级 fixtures、evals 和脚本回归

**Files:**
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\conformance-fixtures.json`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\references\conformance-examples.md`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\evals\evals.json`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\scripts\check_protocol_conformance.py`
- Modify: `C:\Users\home\.claude\skills\constitutional-guard\scripts\run_fixture_batch.py`

- [x] **Step 1: 给 fixtures 增加三态样本**

至少增加：
- `pre-code-calibration` 正/负例
- `in-flight-drift-correction` 触发/静默对照
- `combo` 命中/不命中对照

- [x] **Step 2: 增加治理状态机样本**

至少增加：
- `通过`
- `驳回`
- `例外放行`
- `延期处理`

- [x] **Step 3: 增加高风险/独立复核/延期字段样本**

至少覆盖：
- 需要独立复核的高风险样本
- 缺失债务字段的不合规样本
- 例外放行突破红线的不合规样本

- [x] **Step 4: 更新 `evals.json`**

要求：
- skill_name 改成 `constitutional-guard`
- 增加写前/写中/写后三态触发提示
- 保留对旧审查能力的回归样例

- [x] **Step 4.1: 更新 `conformance-examples.md`**

要求：
- 全部切换为 canonical name
- 增加三态与治理状态机场景示例
- 不让示例继续把旧名当主入口

- [x] **Step 5: 升级 `check_protocol_conformance.py`**

要求：
- 能识别新模式
- 能识别治理状态字段
- 能识别独立复核、例外放行、延期处理

- [x] **Step 6: 升级 `run_fixture_batch.py`**

要求：
- 按新 tags 跑三态矩阵
- 能快速筛选 `pre` / `in-flight` / `post` / `combo`

- [x] **Step 7: 写死 holdout 约束**

要求：
- 至少 `20%` fixtures 标记为 holdout
- holdout 不参与日常调 prompt / 调规则
- batch 与 checker 都能区分日常样本和 holdout 样本

---

## Task 5: 运行验证并收尾

**Files:**
- Verify only

- [x] **Step 1: 运行结构校验**

Run: `Get-ChildItem -Recurse -File 'C:\Users\home\.claude\skills\constitutional-guard'`
Expected: canonical 目录结构与计划一致

- [x] **Step 2: 运行 conformance checker**

Run: `python C:\Users\home\.claude\skills\constitutional-guard\scripts\check_protocol_conformance.py --fixtures C:\Users\home\.claude\skills\constitutional-guard\references\conformance-fixtures.json`
Expected: 能正确读取 fixtures，且不因新状态机字段报错

- [x] **Step 2.1: 运行 `evals.json` 解析校验**

Run: `Get-Content 'C:\Users\home\.claude\skills\constitutional-guard\evals\evals.json' | ConvertFrom-Json | Out-Null`
Expected: `evals.json` 可正常解析，且 `skill_name` 为 `constitutional-guard`

- [x] **Step 3: 运行 fixture batch**

Run: `python C:\Users\home\.claude\skills\constitutional-guard\scripts\run_fixture_batch.py --json --fail-on-mismatch`
Expected: 全量样本通过；至少 mode、state、anti-wheel、law-hierarchy 几条关键轴通过

- [x] **Step 4: 做一次别名检查**

检查：
- `constitutional-guard` 是唯一 canonical name
- `koko-constitutional-audit` 不承载新设计主逻辑

- [x] **Step 4.1: 做一次触发 smoke test**

检查：
- canonical 入口描述能覆盖三态触发
- alias 入口只做 redirect，不再作为新逻辑主入口
- canonical 与 alias 不会给出两套不同触发语义

- [x] **Step 5: 最终收尾**

确认：
- `E:\koko` 工作树干净
- 计划文档已提交
- 技能目录改动已完成本地验证

验证结果记录：
- `conformance-fixtures.json` 当前共 `44` 条，其中 holdout `9` 条，占比约 `20.45%`
- `pre-code calibration` 与 `in-flight drift correction` 均达到 `5` 正例 + `5` 负例
- `combo` 路由达到 `3` 命中 + `3` 不命中对照
- `evals.json` 当前共 `22` 条提示样例
- `check_protocol_conformance.py --fixtures ...conformance-fixtures.json` 通过
- `run_fixture_batch.py --json --include-holdout --fail-on-mismatch` 全量 `44/44` 通过
- `Get-Content ...evals.json | ConvertFrom-Json | Out-Null` 通过

---

## 实施顺序建议

严格按这个顺序执行：

1. 先搭 canonical 入口与路由骨架
2. 再拆三态协议
3. 再补治理状态机与审批闭环
4. 最后升级 fixtures / scripts / evals

不要反过来先调 fixtures，因为那样会在协议尚未稳定时反复返工。

---

## 风险提醒

- 最大风险不是“改坏一个文件”，而是让 `constitutional-guard` 变成另一个更胖的 `SKILL.md`
- 第二风险是 alias 和 canonical 双真值
- 第三风险是三态价值观漂移，导致写前说不要手搓、写中却默许继续包一层、写后再来批判

实现过程中，任何一步只要开始把规则重新塞回单一大文件，或者让 alias 与 canonical 分叉，就应立刻停下回到设计稿。

