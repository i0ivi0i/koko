# Graph Report - E:\koko  (2026-04-09)

## Corpus Check
- 191 files · ~306,610 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 871 nodes · 1403 edges · 69 communities detected
- Extraction: 62% EXTRACTED · 38% INFERRED · 0% AMBIGUOUS · INFERRED: 539 edges (avg confidence: 0.53)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `buildMergedSegmentation()` - 22 edges
2. `HttpRealtime传输` - 16 edges
3. `loadCorpus()` - 14 edges
4. `send_json()` - 13 edges
5. `parseBlockTokens()` - 11 edges
6. `已读锚点稳定化与首屏停靠` - 11 edges
7. `WhatsApp Multi-Device` - 11 edges
8. `frontend/房间滚动器.ts` - 10 edges
9. `frontend/聊天壳.ts` - 10 edges
10. `前端房间编排内核重构` - 10 edges

## Surprising Connections (you probably didn't know these)
- `socketioxide 实时适配器` --conceptually_related_to--> `src/实时外壳.rs`  [INFERRED]
  DESIGN.md → src/实时外壳.rs
- `本地存储端口` --conceptually_related_to--> `frontend/存储.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-07-前端房间编排内核重构-design.md → frontend/存储.ts
- `frontend/房间消息窗.ts` --conceptually_related_to--> `历史加载局部性`  [INFERRED]
  frontend/房间消息窗.ts → docs/superpowers/specs/2026-04-09-房间消息窗口独立化与历史补偿重构-design.md
- `锚点恢复补偿` --conceptually_related_to--> `frontend/房间滚动器.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-09-房间消息窗口独立化与历史补偿重构-design.md → frontend/房间滚动器.ts
- `后端外壳DDD与Unix收口拆分` --rationale_for--> `src/后台外壳.rs`  [EXTRACTED]
  docs/superpowers/plans/2026-04-08-后端外壳DDD与Unix收口拆分.md → src/后台外壳.rs

## Hyperedges (group relationships)
- **前端编排三元组** — room_recovery_orchestrator, room_realtime_orchestrator, read_progress_orchestrator [INFERRED 0.92]
- **后端外壳拆分三元组** — src_room_shell_rs, src_admin_shell_rs, src_realtime_shell_rs [INFERRED 0.90]
- **唯一壳级操作台模式** — unique_shell_console, single_form_shell_console, disabled_inert_semantics, native_form_submit_semantics [EXTRACTED 0.92]
- **阅读稳定链** — frontend_room_kernel_ts, frontend_room_scroller_ts, viewport_mode, candidate_read_anchor, anchor_based_history_compensation [INFERRED 0.88]
- **领域主权 + 边界 + 适配层模式** — domain_sovereignty, contract_boundary, shell_adapter_boundary [INFERRED 0.88]
- **设备级匿名身份升级模式** — anonymous_identity_mvp, device_token_rotation, local_storage_port [EXTRACTED 0.90]
- **命令送达与消息成立分层模式** — authoritative_room_event, broadcast_after_commit, optimistic_vs_authoritative [INFERRED 0.85]

## Communities

### Community 0 - "房间 API 测试"
Cohesion: 0.05
Nodes (19): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), 非成员不能通过events接口拉取房间增量(), 成员通过events接口只会拿到from之后的事件(), 不存在的房间通过events接口会返回room_not_found(), 非成员不能通过history接口读取更早消息(), http冷路径闭环() (+11 more)

### Community 1 - "Markdown Chat 块模型"
Cohesion: 0.09
Nodes (30): appendBlockGroup(), buildCodeBlock(), buildConversationFrame(), buildInlineBlocks(), buildListBlocks(), buildPlainTextBlocks(), buildPreparedInlineBlock(), buildPreparedInlineBlocks() (+22 more)

### Community 2 - "聊天壳 恢复 编排"
Cohesion: 0.15
Nodes (38): 锚点恢复补偿, 候选已读锚点, disabled / inert 交互语义, 固定底部操作台, frontend/聊天壳.ts, frontend/阅读推进编排.ts, frontend/房间内核.ts, frontend/房间消息窗.ts (+30 more)

### Community 3 - "Corpus 语料工具"
Cohesion: 0.12
Nodes (33): addDiagnostics(), buildFont(), buildReadyReport(), classifyBreakMismatch(), configureControls(), estimateBrowserLineCount(), getBrowserLinesFromRange(), getBrowserLinesFromSpans() (+25 more)

### Community 4 - "文本 分词 断行 分析"
Cohesion: 0.12
Nodes (34): analyzeText(), buildMergedSegmentation(), carryTrailingForwardStickyAcrossCJKBoundary(), classifySegmentBreakChar(), compileAnalysisChunks(), containsArabicScript(), endsWithArabicNoSpacePunctuation(), endsWithClosingQuote() (+26 more)

### Community 5 - "项目原则 与 架构约束"
Cohesion: 0.1
Nodes (34): 设备级花名匿名身份最小群聊 MVP, 权威房间事件, 后端外壳拆分三元组, bootstrap 接口限流与告警, 提交后广播, 代码宪法, 命令送达与消息成立分层模式, 验证后自动提交 (+26 more)

### Community 6 - "动态布局 演示"
Cohesion: 0.11
Nodes (24): buildLayout(), commitFrame(), easeSpin(), evaluateLayout(), fitHeadlineFontSize(), getLogoAnimation(), getLogoProjection(), getObstacleIntervals() (+16 more)

### Community 7 - "文本排版 核心"
Cohesion: 0.13
Nodes (28): buildLineTextFromRange(), clearCache(), createEmptyPrepared(), createLayoutLine(), getInternalPrepared(), getLineTextCache(), getSegmentGraphemes(), getSharedGraphemeSegmenter() (+20 more)

### Community 8 - "浏览器自动化 脚手架"
Cohesion: 0.16
Nodes (24): acquireBrowserAutomationLock(), canReachUrl(), connectFirefoxBidi(), createBrowserSession(), createChromeSession(), createFirefoxSession(), createSafariSession(), ensurePageServer() (+16 more)

### Community 9 - "私密消息 安全 模型"
Cohesion: 0.09
Nodes (24): Anonymous Credentials System, Attachment Unlinkability, Baseline Message Secrecy, Client-Centric Architecture, Cryptographic Primitives, Data Recovery Methods, De-identified Telemetry, Device Keychain (+16 more)

### Community 10 - "对齐 排版 比较"
Cohesion: 0.19
Nodes (19): buildCanvasColumnFrame(), buildDemoFrame(), buildMeasuredLineFromCandidateRange(), buildMeasuredLineFromLayoutResult(), computeMetrics(), finalizeMeasuredLine(), getDisplaySpacing(), getLineStatsFromBreakCandidates() (+11 more)

### Community 11 - "Gatsby 断行 诊断"
Cohesion: 0.18
Nodes (15): buildReport(), classifyBreakMismatch(), describeBoundary(), getBrowserLines(), getFirstBreakMismatch(), getOurLines(), getSegmentWindow(), init() (+7 more)

### Community 12 - "编辑排版 引擎"
Cohesion: 0.17
Nodes (16): carveTextLineSlots(), circleIntervalForBand(), clearQueuedPointerEvents(), enterTextSelectionMode(), fitHeadline(), hasActiveTextSelection(), hitTestOrbs(), isTextSelectionInteractionActive() (+8 more)

### Community 13 - "两栏排版 对比 UI"
Cohesion: 0.18
Nodes (20): applyColumnWidths(), applyControls(), createCanvasSurface(), createCssParagraphs(), createDomCache(), createMetricPanel(), createMetricRow(), ensureRiverMarkCount() (+12 more)

### Community 14 - "Markdown 聊天 演示"
Cohesion: 0.19
Nodes (16): appendMarker(), appendRails(), createBlockShell(), createMessageShell(), markerTop(), prepareRow(), projectMessageNode(), projectVisibleRows() (+8 more)

### Community 15 - "前端壳 端到端 测试"
Cohesion: 0.12
Nodes (1): 假Socket

### Community 16 - "布局引擎 测试"
Cohesion: 0.14
Nodes (7): getSegmentGraphemes(), isWideCharacter(), measureWidth(), parseFontSize(), slicePreparedText(), TestCanvasRenderingContext2D, TestOffscreenCanvas

### Community 17 - "行内流 排版"
Cohesion: 0.24
Nodes (15): cloneCursor(), endsInsideFirstSegment(), getCollapsedSpaceWidth(), getInternalPreparedInlineFlow(), isLineStartCursor(), layoutNextInlineFlowLine(), layoutNextInlineFlowLineRange(), measureInlineFlow() (+7 more)

### Community 18 - "断行 规则 处理"
Cohesion: 0.26
Nodes (15): canBreakAfter(), countPreparedLines(), countPreparedLinesSimple(), findChunkIndexForStart(), getTabAdvance(), layoutNextLineRange(), measurePreparedLineGeometry(), normalizeLineStart() (+7 more)

### Community 19 - "字形 测量 与 缓存"
Cohesion: 0.24
Nodes (13): countEmojiGraphemes(), getCorrectedSegmentWidth(), getEmojiCorrection(), getEmojiCount(), getFontMeasurementState(), getMeasureContext(), getSegmentGraphemePrefixWidths(), getSegmentGraphemeWidths() (+5 more)

### Community 20 - "pretext 开发原则"
Cohesion: 0.12
Nodes (17): Avoid Reinventing Wheels, Browser Accuracy and Benchmarking, Browser Spec Complexity, Canary Discipline, Commit After Completion, Current Priorities, DDD Modularity, Demo Work (+9 more)

### Community 21 - "HTTP 实时传输 适配"
Cohesion: 0.23
Nodes (1): HttpRealtime传输

### Community 22 - "断行 探针 工具"
Cohesion: 0.27
Nodes (11): classifyBreakMismatch(), getBrowserLines(), getBrowserLinesFromRange(), getBrowserLinesFromSpans(), getFirstBreakMismatch(), getPublicLines(), init(), publishReport() (+3 more)

### Community 23 - "语料 批量 诊断"
Cohesion: 0.23
Nodes (8): bucketMismatches(), hasFlag(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 24 - "排版 基准 测试"
Cohesion: 0.31
Nodes (10): bench(), buildCorpusBenchmarks(), buildRichBenchmarks(), median(), nextFrame(), publishNavigationReport(), renderBenchmarkTable(), run() (+2 more)

### Community 25 - "ASCII 字体 演示"
Cohesion: 0.21
Nodes (5): createFieldStamp(), getSpriteCanvas(), render(), splatFieldStamp(), spriteAlphaAt()

### Community 26 - "Socket.IO 投递 保证"
Cohesion: 0.2
Nodes (12): Ack Timeout Retries, Acknowledgement Callback, Connection State Recovery, Delivery Guarantees, Emitting Events, Message Ordering, Room Broadcasting, Rooms (+4 more)

### Community 27 - "WhatsApp 多设备 同步"
Cohesion: 0.17
Nodes (12): Application State Sync, Automatic Device Verification, Client Fanout, Companion Devices, Device List Keys, Message History Sync, Pairwise E2EE, Primary Device (+4 more)

### Community 28 - "手风琴 组件 演示"
Cohesion: 0.33
Nodes (9): boot(), getAccordionItemNodes(), getFontFromStyles(), getRequiredElement(), initializeStaticContent(), parsePx(), refreshPrepared(), render() (+1 more)

### Community 29 - "文字环绕 几何"
Cohesion: 0.25
Nodes (6): cross(), getPolygonIntervalForBand(), getPolygonXsAtY(), getWrapHull(), makeConvexHull(), makeWrapHull()

### Community 30 - "实时链路 测试 支架"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 31 - "聊天气泡 演示"
Cohesion: 0.24
Nodes (3): render(), scheduleRender(), updateBubbles()

### Community 32 - "语料检查 命令"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 33 - "语料字体 矩阵"
Cohesion: 0.36
Nodes (7): bucketMismatches(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 34 - "语料分类 命令"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 35 - "PowerShell 启动 脚本"
Cohesion: 0.28
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 36 - "准确性 报告 页面"
Cohesion: 0.31
Nodes (6): getBrowserLines(), publishReport(), render(), runSweep(), toNavigationReport(), withRequestId()

### Community 37 - "准确性 检查 脚本"
Cohesion: 0.31
Nodes (5): canReachServer(), formatDiff(), printReport(), sleep(), waitForServer()

### Community 38 - "包冒烟 测试"
Cohesion: 0.57
Nodes (7): createProject(), installTarball(), packPackage(), run(), smokeJavaScriptEsm(), smokeTypeScript(), tscBinaryName()

### Community 39 - "预换行 检查 命令"
Cohesion: 0.39
Nodes (6): buildProbeUrl(), parseNumberFlag(), parseStringFlag(), printCaseResult(), reportIsExact(), runBrowser()

### Community 40 - "聊天气泡 共享 计算"
Cohesion: 0.43
Nodes (3): collectWrapMetrics(), computeBubbleRender(), findTightWrapMetrics()

### Community 41 - "富文本 笔记 渲染"
Cohesion: 0.38
Nodes (3): render(), renderBody(), scheduleRender()

### Community 42 - "语料状态 仪表盘"
Cohesion: 0.29
Nodes (0): 

### Community 43 - "诊断 文本 工具"
Cohesion: 0.33
Nodes (0): 

### Community 44 - "Probe 检查 命令"
Cohesion: 0.47
Nodes (3): parseNumberFlag(), parseStringFlag(), requireFlag()

### Community 45 - "导航状态 辅助"
Cohesion: 0.47
Nodes (3): getHashParams(), readNavigationPhaseState(), readNavigationReportText()

### Community 46 - "导航报告 工具"
Cohesion: 0.7
Nodes (4): clearNavigationReport(), publishNavigationPhase(), publishNavigationReport(), replaceNavigationHash()

### Community 47 - "富笔记 布局 模型"
Cohesion: 0.5
Nodes (2): layoutRichInlineItems(), layoutRichNote()

### Community 48 - "Masonry 卡片 布局"
Cohesion: 0.7
Nodes (4): computeLayout(), getOrCreateCardNode(), render(), scheduleRender()

### Community 49 - "Benchmark 检查 命令"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 50 - "演示站点 构建 脚本"
Cohesion: 0.7
Nodes (4): moveBuiltHtml(), rebaseRelativeAssetUrls(), resolveBuiltHtmlPath(), rewriteDemoLinksForStaticRoot()

### Community 51 - "代表性 语料 行"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 52 - "状态仪表盘 命令"
Cohesion: 0.4
Nodes (0): 

### Community 53 - "对齐 比较 演示"
Cohesion: 0.83
Nodes (3): render(), scheduleCssOverlaySync(), scheduleRender()

### Community 54 - "双向文本 辅助"
Cohesion: 0.83
Nodes (3): classifyChar(), computeBidiLevels(), computeSegmentLevels()

### Community 55 - "Rust 入口 点"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Markdown Chat 数据"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "报告服务器 启动器"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "更新 启动脚本"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "房间实时 编排"
Cohesion: 1.0
Nodes (1): frontend/房间实时编排.ts

### Community 60 - "房间恢复 编排"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 61 - "Rust 库入口"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "动态布局 文本"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "对齐比较 数据"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "SVG 类型 定义"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Gatsby 检查 脚本"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Gatsby 扫描 脚本"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "测试 夹具 数据"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "文本模块 定义"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **55 isolated node(s):** `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `src/后台外壳.rs`, `src/房间外壳.rs`, `设备入口凭证轮换` (+50 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Rust 入口 点`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Markdown Chat 数据`** (2 nodes): `markdown-chat.data.ts`, `message()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `报告服务器 启动器`** (2 nodes): `report-server.ts`, `startPostedReportServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `更新 启动脚本`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `房间实时 编排`** (1 nodes): `frontend/房间实时编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `房间恢复 编排`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Rust 库入口`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `动态布局 文本`** (1 nodes): `dynamic-layout-text.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `对齐比较 数据`** (1 nodes): `justification-comparison.data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SVG 类型 定义`** (1 nodes): `svg.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gatsby 检查 脚本`** (1 nodes): `gatsby-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gatsby 扫描 脚本`** (1 nodes): `gatsby-sweep.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `测试 夹具 数据`** (1 nodes): `test-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `文本模块 定义`** (1 nodes): `text-modules.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `HttpRealtime传输` connect `HTTP 实时传输 适配` to `房间 API 测试`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `socketioxide 实时适配器` connect `项目原则 与 架构约束` to `聊天壳 恢复 编排`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `buildMergedSegmentation()` (e.g. with `getSharedWordSegmenter()` and `splitSegmentByBreakKind()`) actually correct?**
  _`buildMergedSegmentation()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `loadCorpus()` (e.g. with `loadText()` and `updateTitle()`) actually correct?**
  _`loadCorpus()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `send_json()` (e.g. with `领域测试.rs` and `http冷路径闭环()`) actually correct?**
  _`send_json()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `parseBlockTokens()` (e.g. with `parseMarkdownBlocks()` and `appendBlockGroup()`) actually correct?**
  _`parseBlockTokens()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `src/后台外壳.rs` to the rest of the system?**
  _55 weakly-connected nodes found - possible documentation gaps or missing edges._