# Graph Report - E:\koko  (2026-04-09)

## Corpus Check
- 191 files · ~306,347 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 986 nodes · 1590 edges · 78 communities detected
- Extraction: 64% EXTRACTED · 36% INFERRED · 0% AMBIGUOUS · INFERRED: 571 edges (avg confidence: 0.54)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `buildMergedSegmentation()` - 22 edges
2. `Corpora README` - 19 edges
3. `HttpRealtime传输` - 16 edges
4. `loadCorpus()` - 14 edges
5. `send_json()` - 13 edges
6. `WhatsApp Multi-Device` - 12 edges
7. `parseBlockTokens()` - 11 edges
8. `event_position 同步锚点` - 11 edges
9. `Socketioxide API docs` - 11 edges
10. `The Labyrinth Encrypted Message Storage Protocol` - 11 edges

## Surprising Connections (you probably didn't know these)
- `socketioxide 实时适配器` --conceptually_related_to--> `src/实时外壳.rs`  [INFERRED]
  DESIGN.md → src/实时外壳.rs
- `本地存储端口` --conceptually_related_to--> `frontend/存储.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-07-前端房间编排内核重构-design.md → frontend/存储.ts
- `frontend/房间消息窗.ts` --conceptually_related_to--> `历史加载局部性`  [INFERRED]
  frontend/房间消息窗.ts → docs/superpowers/specs/2026-04-09-房间消息窗口独立化与历史补偿重构-design.md
- `锚点恢复补偿` --conceptually_related_to--> `frontend/房间滚动器.ts`  [INFERRED]
  docs/superpowers/specs/2026-04-09-房间消息窗口独立化与历史补偿重构-design.md → frontend/房间滚动器.ts
- `前端首页群列表与双态控制台` --rationale_for--> `frontend/视图.ts`  [EXTRACTED]
  docs/superpowers/plans/2026-04-08-前端首页群列表与双态控制台.md → frontend/视图.ts

## Hyperedges (group relationships)
- **Reading stability chain** — concept_room_kernel_ts, concept_room_scroller_ts, concept_viewport_mode, concept_candidate_read_anchor, concept_anchor_based_history_compensation [INFERRED 0.88]
- **Frontend orchestration triad** — concept_room_recovery_orchestrator, concept_room_realtime_orchestrator, concept_read_progress_orchestrator [INFERRED 0.92]
- **Backend shell split triad** — concept_room_shell, concept_admin_shell, concept_realtime_shell [INFERRED 0.90]
- **领域主权 + 边界 + 适配层模式** — domain_sovereignty, bounded_context, ports_and_adapters, socketioxide_realtime_adapter [INFERRED 0.88]
- **设备级匿名身份升级模式** — device_anonymous_token, localstorage_device_persistence, anonymous_identity_upgrade [EXTRACTED 0.90]
- **同步锚点与恢复闭环模式** — event_position_anchor, gap_repair_snapshot_fallback, connection_state_recovery_buffer [INFERRED 0.90]
- **唯一壳级操作台模式** — single_form_shell_console, lit_render_purity, native_form_submit_semantics, disabled_inert_semantics [EXTRACTED 0.92]
- **命令送达与消息成立分层模式** — ack_is_not_message_created, command_delivery_retries, broadcast_after_commit [INFERRED 0.85]
- **Telegram update integrity axes** — telegram_pts_sequence, telegram_seq_sequence, telegram_qts_sequence [EXTRACTED 1.00]
- **Corpus documentation stack** — readme, status, taxonomy [EXTRACTED 1.00]
- **Current corpus bundle** — mixed_app_text, en_gatsby_opening, ja_rashomon, ja_kumo_no_ito, ko_unsu_joh_eun_nal, zh_zhufu, zh_guxiang, th_nithan_vetal_story_1, th_nithan_vetal_story_7, my_cunning_heron_teacher, my_bad_deeds_return_to_you_teacher, km_prachum_reuang_preng_khmer_volume_7_stories_1_10, ar_risalat_al_ghufran_part_1, ar_al_bukhala, hi_eidgah, he_masaot_binyamin_metudela, ur_chughd [EXTRACTED 1.00]
- **OpenAI Brand Asset Form** — openai_symbol_svg, openai_symbol, openai [INFERRED 0.84]

## Communities

### Community 0 - "房间 API 测试"
Cohesion: 0.06
Nodes (66): ACK 不是消息成立, 活跃房间优先补洞, 设备级花名匿名身份最小群聊 MVP, 匿名身份可升级, 权威房间事件, axum 共享状态, bootstrap 接口限流与告警, Bounded Context (+58 more)

### Community 1 - "Markdown Chat 块模型"
Cohesion: 0.04
Nodes (29): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), buildRoomViewResetPatch(), 非成员不能通过events接口拉取房间增量(), 成员通过events接口只会拿到from之后的事件(), 不存在的房间通过events接口会返回room_not_found(), exitCurrentRoomView() (+21 more)

### Community 2 - "聊天壳 恢复 编排"
Cohesion: 0.09
Nodes (30): appendBlockGroup(), buildCodeBlock(), buildConversationFrame(), buildInlineBlocks(), buildListBlocks(), buildPlainTextBlocks(), buildPreparedInlineBlock(), buildPreparedInlineBlocks() (+22 more)

### Community 3 - "Corpus 语料工具"
Cohesion: 0.15
Nodes (38): 锚点恢复补偿, 候选已读锚点, disabled / inert 交互语义, 固定底部操作台, frontend/阅读推进编排.ts, frontend/房间内核.ts, frontend/房间消息窗.ts, frontend/房间滚动器.ts (+30 more)

### Community 4 - "文本 分词 断行 分析"
Cohesion: 0.12
Nodes (33): addDiagnostics(), buildFont(), buildReadyReport(), classifyBreakMismatch(), configureControls(), estimateBrowserLineCount(), getBrowserLinesFromRange(), getBrowserLinesFromSpans() (+25 more)

### Community 5 - "项目原则 与 架构约束"
Cohesion: 0.12
Nodes (34): analyzeText(), buildMergedSegmentation(), carryTrailingForwardStickyAcrossCJKBoundary(), classifySegmentBreakChar(), compileAnalysisChunks(), containsArabicScript(), endsWithArabicNoSpacePunctuation(), endsWithClosingQuote() (+26 more)

### Community 6 - "动态布局 演示"
Cohesion: 0.1
Nodes (27): buildLayout(), commitFrame(), easeSpin(), evaluateLayout(), fitHeadlineFontSize(), getLogoAnimation(), getLogoProjection(), getObstacleIntervals() (+19 more)

### Community 7 - "文本排版 核心"
Cohesion: 0.13
Nodes (28): buildLineTextFromRange(), clearCache(), createEmptyPrepared(), createLayoutLine(), getInternalPrepared(), getLineTextCache(), getSegmentGraphemes(), getSharedGraphemeSegmenter() (+20 more)

### Community 8 - "浏览器自动化 脚手架"
Cohesion: 0.08
Nodes (28): Anonymous Credentials System, Attachment Unlinkability, Baseline Message Secrecy, Be Transparent and Invite Scrutiny, Build for the Future, Build Secure Services for All, Client-Centric Architecture, Cryptographic Primitives (+20 more)

### Community 9 - "私密消息 安全 模型"
Cohesion: 0.16
Nodes (24): acquireBrowserAutomationLock(), canReachUrl(), connectFirefoxBidi(), createBrowserSession(), createChromeSession(), createFirefoxSession(), createSafariSession(), ensurePageServer() (+16 more)

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
Cohesion: 0.13
Nodes (20): Al-Bukhala (Arabic prose collection), Epistle of Forgiveness, Part 1 (Arabic prose), The Great Gatsby opening (English literary opening), Travels of Benjamin of Tudela (Hebrew travelogue), Eidgah (Hindi short story), Spider's Thread (Japanese short story), Rashomon (Japanese short story), Prachum Reuang Preng Khmer, Volume 7, Stories 1-10 (Khmer story collection) (+12 more)

### Community 16 - "布局引擎 测试"
Cohesion: 0.12
Nodes (1): 假Socket

### Community 17 - "行内流 排版"
Cohesion: 0.14
Nodes (7): getSegmentGraphemes(), isWideCharacter(), measureWidth(), parseFontSize(), slicePreparedText(), TestCanvasRenderingContext2D, TestOffscreenCanvas

### Community 18 - "断行 规则 处理"
Cohesion: 0.24
Nodes (15): cloneCursor(), endsInsideFirstSegment(), getCollapsedSpaceWidth(), getInternalPreparedInlineFlow(), isLineStartCursor(), layoutNextInlineFlowLine(), layoutNextInlineFlowLineRange(), measureInlineFlow() (+7 more)

### Community 19 - "字形 测量 与 缓存"
Cohesion: 0.26
Nodes (15): canBreakAfter(), countPreparedLines(), countPreparedLinesSimple(), findChunkIndexForStart(), getTabAdvance(), layoutNextLineRange(), measurePreparedLineGeometry(), normalizeLineStart() (+7 more)

### Community 20 - "pretext 开发原则"
Cohesion: 0.24
Nodes (13): countEmojiGraphemes(), getCorrectedSegmentWidth(), getEmojiCorrection(), getEmojiCount(), getFontMeasurementState(), getMeasureContext(), getSegmentGraphemePrefixWidths(), getSegmentGraphemeWidths() (+5 more)

### Community 21 - "HTTP 实时传输 适配"
Cohesion: 0.12
Nodes (17): Avoid Reinventing Wheels, Browser Accuracy and Benchmarking, Browser Spec Complexity, Canary Discipline, Commit After Completion, Current Priorities, DDD Modularity, Demo Work (+9 more)

### Community 22 - "断行 探针 工具"
Cohesion: 0.23
Nodes (1): HttpRealtime传输

### Community 23 - "语料 批量 诊断"
Cohesion: 0.27
Nodes (11): classifyBreakMismatch(), getBrowserLines(), getBrowserLinesFromRange(), getBrowserLinesFromSpans(), getFirstBreakMismatch(), getPublicLines(), init(), publishReport() (+3 more)

### Community 24 - "排版 基准 测试"
Cohesion: 0.23
Nodes (8): bucketMismatches(), hasFlag(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 25 - "ASCII 字体 演示"
Cohesion: 0.3
Nodes (14): SocketRef, Socket struct, SocketIo handle, Acknowledgements, Adapter trait, Socketioxide API docs, Broadcast operators, Socketioxide crate metadata (+6 more)

### Community 26 - "Socket.IO 投递 保证"
Cohesion: 0.31
Nodes (10): bench(), buildCorpusBenchmarks(), buildRichBenchmarks(), median(), nextFrame(), publishNavigationReport(), renderBenchmarkTable(), run() (+2 more)

### Community 27 - "WhatsApp 多设备 同步"
Cohesion: 0.15
Nodes (13): Application State Sync, Automatic Device Verification, Client Fanout, Companion Devices, Device List Keys, 2026-04-09 Graph Report, Message History Sync, Pairwise E2EE (+5 more)

### Community 28 - "手风琴 组件 演示"
Cohesion: 0.21
Nodes (5): createFieldStamp(), getSpriteCanvas(), render(), splatFieldStamp(), spriteAlphaAt()

### Community 29 - "文字环绕 几何"
Cohesion: 0.2
Nodes (12): Ack Timeout Retries, Acknowledgement Callback, Connection State Recovery, Delivery Guarantees, Emitting Events, Message Ordering, Room Broadcasting, Rooms (+4 more)

### Community 30 - "实时链路 测试 支架"
Cohesion: 0.32
Nodes (12): Changelog, Development commands, Inline-flow sidecar, Pretext library, pre-wrap mode, Research log, Rich layout API, Segment metrics cache (+4 more)

### Community 31 - "聊天气泡 演示"
Cohesion: 0.33
Nodes (9): boot(), getAccordionItemNodes(), getFontFromStyles(), getRequiredElement(), initializeStaticContent(), parsePx(), refreshPrepared(), render() (+1 more)

### Community 32 - "语料检查 命令"
Cohesion: 0.25
Nodes (6): cross(), getPolygonIntervalForBand(), getPolygonXsAtY(), getWrapHull(), makeConvexHull(), makeWrapHull()

### Community 33 - "语料字体 矩阵"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 34 - "语料分类 命令"
Cohesion: 0.24
Nodes (3): render(), scheduleRender(), updateBubbles()

### Community 35 - "PowerShell 启动 脚本"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 36 - "准确性 报告 页面"
Cohesion: 0.36
Nodes (7): bucketMismatches(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 37 - "准确性 检查 脚本"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 38 - "包冒烟 测试"
Cohesion: 0.36
Nodes (10): Channel difference polling, Channel update state, Gap recovery, pts sequence, qts sequence, seq sequence, Update state fetching, updateNewChannelMessage (+2 more)

### Community 39 - "预换行 检查 命令"
Cohesion: 0.28
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 40 - "聊天气泡 共享 计算"
Cohesion: 0.31
Nodes (6): getBrowserLines(), publishReport(), render(), runSweep(), toNavigationReport(), withRequestId()

### Community 41 - "富文本 笔记 渲染"
Cohesion: 0.31
Nodes (5): canReachServer(), formatDiff(), printReport(), sleep(), waitForServer()

### Community 42 - "语料状态 仪表盘"
Cohesion: 0.57
Nodes (7): createProject(), installTarball(), packPackage(), run(), smokeJavaScriptEsm(), smokeTypeScript(), tscBinaryName()

### Community 43 - "诊断 文本 工具"
Cohesion: 0.39
Nodes (6): buildProbeUrl(), parseNumberFlag(), parseStringFlag(), printCaseResult(), reportIsExact(), runBrowser()

### Community 44 - "Probe 检查 命令"
Cohesion: 0.43
Nodes (3): collectWrapMetrics(), computeBubbleRender(), findTightWrapMetrics()

### Community 45 - "导航状态 辅助"
Cohesion: 0.38
Nodes (3): render(), renderBody(), scheduleRender()

### Community 46 - "导航报告 工具"
Cohesion: 0.29
Nodes (0): 

### Community 47 - "富笔记 布局 模型"
Cohesion: 0.33
Nodes (0): 

### Community 48 - "Masonry 卡片 布局"
Cohesion: 0.47
Nodes (3): parseNumberFlag(), parseStringFlag(), requireFlag()

### Community 49 - "Benchmark 检查 命令"
Cohesion: 0.47
Nodes (3): getHashParams(), readNavigationPhaseState(), readNavigationReportText()

### Community 50 - "演示站点 构建 脚本"
Cohesion: 0.7
Nodes (4): clearNavigationReport(), publishNavigationPhase(), publishNavigationReport(), replaceNavigationHash()

### Community 51 - "代表性 语料 行"
Cohesion: 0.5
Nodes (2): layoutRichInlineItems(), layoutRichNote()

### Community 52 - "状态仪表盘 命令"
Cohesion: 0.7
Nodes (4): computeLayout(), getOrCreateCardNode(), render(), scheduleRender()

### Community 53 - "对齐 比较 演示"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 54 - "双向文本 辅助"
Cohesion: 0.7
Nodes (4): moveBuiltHtml(), rebaseRelativeAssetUrls(), resolveBuiltHtmlPath(), rewriteDemoLinksForStaticRoot()

### Community 55 - "Rust 入口 点"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 56 - "Markdown Chat 数据"
Cohesion: 0.4
Nodes (0): 

### Community 57 - "报告服务器 启动器"
Cohesion: 0.83
Nodes (3): render(), scheduleCssOverlaySync(), scheduleRender()

### Community 58 - "更新 启动脚本"
Cohesion: 0.83
Nodes (3): classifyChar(), computeBidiLevels(), computeSegmentLevels()

### Community 59 - "房间实时 编排"
Cohesion: 0.67
Nodes (3): Anthropic, Claude, Claude Symbol

### Community 60 - "房间恢复 编排"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Rust 库入口"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "动态布局 文本"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "对齐比较 数据"
Cohesion: 1.0
Nodes (2): pretext 多行文本测量与排版, pretext 调研记录

### Community 64 - "SVG 类型 定义"
Cohesion: 1.0
Nodes (2): 先读 GRAPH_REPORT, graphify Codex 规则

### Community 65 - "Gatsby 检查 脚本"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Gatsby 扫描 脚本"
Cohesion: 1.0
Nodes (1): frontend/房间实时编排.ts

### Community 67 - "测试 夹具 数据"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 68 - "文本模块 定义"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): 官方 IM 架构资料索引

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): 聊天壳首页与控制台集成测试

## Ambiguous Edges - Review These
- `Claude` → `Anthropic`  [AMBIGUOUS]
  学习/pretext/pages/assets/claude-symbol.svg · relation: conceptually_related_to

## Knowledge Gaps
- **74 isolated node(s):** `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `src/后台外壳.rs`, `src/房间外壳.rs`, `设备入口凭证轮换` (+69 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `房间恢复 编排`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Rust 库入口`** (2 nodes): `markdown-chat.data.ts`, `message()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `动态布局 文本`** (2 nodes): `report-server.ts`, `startPostedReportServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `对齐比较 数据`** (2 nodes): `pretext 多行文本测量与排版`, `pretext 调研记录`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SVG 类型 定义`** (2 nodes): `先读 GRAPH_REPORT`, `graphify Codex 规则`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gatsby 检查 脚本`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gatsby 扫描 脚本`** (1 nodes): `frontend/房间实时编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `测试 夹具 数据`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `文本模块 定义`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `dynamic-layout-text.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `justification-comparison.data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `svg.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `gatsby-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `gatsby-sweep.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `test-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `text-modules.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `官方 IM 架构资料索引`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `聊天壳首页与控制台集成测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Claude` and `Anthropic`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `event_position 同步锚点` connect `房间 API 测试` to `Corpus 语料工具`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `HttpRealtime传输` connect `断行 探针 工具` to `Markdown Chat 块模型`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `前端房间编排内核重构设计` connect `Corpus 语料工具` to `房间 API 测试`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `buildMergedSegmentation()` (e.g. with `getSharedWordSegmenter()` and `splitSegmentByBreakKind()`) actually correct?**
  _`buildMergedSegmentation()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `loadCorpus()` (e.g. with `loadText()` and `updateTitle()`) actually correct?**
  _`loadCorpus()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `send_json()` (e.g. with `领域测试.rs` and `http冷路径闭环()`) actually correct?**
  _`send_json()` has 13 INFERRED edges - model-reasoned connections that need verification._