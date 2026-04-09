# Graph Report - E:\koko  (2026-04-09)

## Corpus Check
- 190 files · ~304,292 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1017 nodes · 1658 edges · 77 communities detected
- Extraction: 67% EXTRACTED · 33% INFERRED · 0% AMBIGUOUS · INFERRED: 543 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `buildMergedSegmentation()` - 22 edges
2. `Corpora README` - 19 edges
3. `HttpRealtime传输` - 16 edges
4. `loadCorpus()` - 14 edges
5. `send_json()` - 13 edges
6. `parseBlockTokens()` - 11 edges
7. `Socketioxide API docs` - 11 edges
8. `Labyrinth encrypted message storage protocol` - 10 edges
9. `Pretext library` - 10 edges
10. `measureWidth()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `不要自建 room -> sockets 广播表` --rationale_for--> `socketioxide 实时适配器`  [INFERRED]
  学习/2026-04-06-socketioxide官方最佳实践与多房间群聊落地笔记.md → 学习/2026-04-06-socketioxide与IM官方最佳实践补充.md
- `global state 与 socket extension 分层` --conceptually_related_to--> `socketioxide 实时适配器`  [INFERRED]
  学习/2026-04-06-socketioxide官方最佳实践与多房间群聊落地笔记.md → 学习/2026-04-06-socketioxide与IM官方最佳实践补充.md
- `Al-Bukhala (Arabic prose collection)` --semantically_similar_to--> `Epistle of Forgiveness, Part 1 (Arabic prose)`  [INFERRED] [semantically similar]
  学习/pretext/corpora/ar-al-bukhala.txt → 学习/pretext/corpora/ar-risalat-al-ghufran-part-1.txt
- `Rashomon (Japanese short story)` --semantically_similar_to--> `Spider's Thread (Japanese short story)`  [INFERRED] [semantically similar]
  学习/pretext/corpora/ja-rashomon.txt → 学习/pretext/corpora/ja-kumo-no-ito.txt
- `Bad Deeds Return to You (Teacher story)` --semantically_similar_to--> `Cunning Heron (Teacher story)`  [INFERRED] [semantically similar]
  学习/pretext/corpora/my-bad-deeds-return-to-you-teacher.txt → 学习/pretext/corpora/my-cunning-heron-teacher.txt

## Hyperedges (group relationships)
- **Frontend orchestration triad** — concept_room_recovery_orchestrator, concept_room_realtime_orchestrator, concept_read_progress_orchestrator [INFERRED 0.92]
- **Backend shell split triad** — concept_room_shell, concept_admin_shell, concept_realtime_shell [INFERRED 0.90]
- **Reading stability chain** — concept_room_kernel_ts, concept_room_scroller_ts, concept_viewport_mode, concept_candidate_read_anchor, concept_anchor_based_history_compensation [INFERRED 0.88]
- **领域主权 + 边界 + 适配层模式** — domain_sovereignty, bounded_context, ports_and_adapters, socketioxide_realtime_adapter [INFERRED 0.88]
- **同步锚点与恢复闭环模式** — event_position_anchor, gap_repair_snapshot_fallback, connection_state_recovery_buffer [INFERRED 0.90]
- **唯一壳级操作台模式** — single_form_shell_console, lit_render_purity, native_form_submit_semantics, disabled_inert_semantics [EXTRACTED 0.92]
- **设备级匿名身份升级模式** — device_anonymous_token, localstorage_device_persistence, anonymous_identity_upgrade [EXTRACTED 0.90]
- **命令送达与消息成立分层模式** — ack_is_not_message_created, command_delivery_retries, broadcast_after_commit [INFERRED 0.85]
- **Labyrinth privacy goals triplet** — labyrinth_baseline_message_secrecy, labyrinth_post_revocation_message_secrecy, labyrinth_attachment_unlinkability [EXTRACTED 1.00]
- **Telegram update integrity axes** — telegram_pts_sequence, telegram_seq_sequence, telegram_qts_sequence [EXTRACTED 1.00]
- **WhatsApp multi-device trust controls** — whatsapp_device_identity_keys, whatsapp_security_code, whatsapp_automatic_device_verification [EXTRACTED 1.00]
- **Corpus documentation stack** — readme, status, taxonomy [EXTRACTED 1.00]
- **Current corpus bundle** — mixed_app_text, en_gatsby_opening, ja_rashomon, ja_kumo_no_ito, ko_unsu_joh_eun_nal, zh_zhufu, zh_guxiang, th_nithan_vetal_story_1, th_nithan_vetal_story_7, my_cunning_heron_teacher, my_bad_deeds_return_to_you_teacher, km_prachum_reuang_preng_khmer_volume_7_stories_1_10, ar_risalat_al_ghufran_part_1, ar_al_bukhala, hi_eidgah, he_masaot_binyamin_metudela, ur_chughd [EXTRACTED 1.00]
- **OpenAI Brand Asset Form** — openai_symbol_svg, openai_symbol, openai [INFERRED 0.84]

## Communities

### Community 0 - "后台管理接口"
Cohesion: 0.03
Nodes (45): AdminLoginBody, AdminLoginResp, ApiError, 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), BootstrapBody, buildRoomViewResetPatch() (+37 more)

### Community 1 - "socket.io 实时架构"
Cohesion: 0.08
Nodes (46): ACK 不是消息成立, 活跃房间优先补洞, 匿名身份可升级, axum 共享状态, Bounded Context, 事务提交后广播, client_message_id 幂等键, 命令送达重试 (+38 more)

### Community 2 - "前端 壳编排"
Cohesion: 0.12
Nodes (45): Anchor-Based History Compensation, Candidate Read Anchor, Chat Shell, frontend/契约.ts, Fixed Bottom Console, Frontend Sync Orchestration, Happy DOM, History Prepend (+37 more)

### Community 3 - "Markdown 聊天模型"
Cohesion: 0.09
Nodes (30): appendBlockGroup(), buildCodeBlock(), buildConversationFrame(), buildInlineBlocks(), buildListBlocks(), buildPlainTextBlocks(), buildPreparedInlineBlock(), buildPreparedInlineBlocks() (+22 more)

### Community 4 - "语料 排版 测量"
Cohesion: 0.12
Nodes (33): addDiagnostics(), buildFont(), buildReadyReport(), classifyBreakMismatch(), configureControls(), estimateBrowserLineCount(), getBrowserLinesFromRange(), getBrowserLinesFromSpans() (+25 more)

### Community 5 - "文本 分段 解析"
Cohesion: 0.12
Nodes (34): analyzeText(), buildMergedSegmentation(), carryTrailingForwardStickyAcrossCJKBoundary(), classifySegmentBreakChar(), compileAnalysisChunks(), containsArabicScript(), endsWithArabicNoSpacePunctuation(), endsWithClosingQuote() (+26 more)

### Community 6 - "架构原则与边界"
Cohesion: 0.11
Nodes (36): Admin Shell, Anonymous Device MVP, Authoritative Room Event, Axum, Backend Shell Split, Chinese Comment Discipline, Commit After Success, Dead Code Governance (+28 more)

### Community 7 - "动态 Logo 版式"
Cohesion: 0.1
Nodes (27): buildLayout(), commitFrame(), easeSpin(), evaluateLayout(), fitHeadlineFontSize(), getLogoAnimation(), getLogoProjection(), getObstacleIntervals() (+19 more)

### Community 8 - "文本 布局 核心"
Cohesion: 0.13
Nodes (28): buildLineTextFromRange(), clearCache(), createEmptyPrepared(), createLayoutLine(), getInternalPrepared(), getLineTextCache(), getSegmentGraphemes(), getSharedGraphemeSegmenter() (+20 more)

### Community 9 - "浏览器 自动化"
Cohesion: 0.16
Nodes (24): acquireBrowserAutomationLock(), canReachUrl(), connectFirefoxBidi(), createBrowserSession(), createChromeSession(), createFirefoxSession(), createSafariSession(), ensurePageServer() (+16 more)

### Community 10 - "两端对齐 比较模型"
Cohesion: 0.19
Nodes (19): buildCanvasColumnFrame(), buildDemoFrame(), buildMeasuredLineFromCandidateRange(), buildMeasuredLineFromLayoutResult(), computeMetrics(), finalizeMeasuredLine(), getDisplaySpacing(), getLineStatsFromBreakCandidates() (+11 more)

### Community 11 - "Gatsby 报告 工具"
Cohesion: 0.18
Nodes (15): buildReport(), classifyBreakMismatch(), describeBoundary(), getBrowserLines(), getFirstBreakMismatch(), getOurLines(), getSegmentWindow(), init() (+7 more)

### Community 12 - "编辑排版 引擎"
Cohesion: 0.17
Nodes (16): carveTextLineSlots(), circleIntervalForBand(), clearQueuedPointerEvents(), enterTextSelectionMode(), fitHeadline(), hasActiveTextSelection(), hitTestOrbs(), isTextSelectionInteractionActive() (+8 more)

### Community 13 - "两端对齐 比较 UI"
Cohesion: 0.18
Nodes (20): applyColumnWidths(), applyControls(), createCanvasSurface(), createCssParagraphs(), createDomCache(), createMetricPanel(), createMetricRow(), ensureRiverMarkCount() (+12 more)

### Community 14 - "Markdown 聊天壳"
Cohesion: 0.19
Nodes (16): appendMarker(), appendRails(), createBlockShell(), createMessageShell(), markerTop(), prepareRow(), projectMessageNode(), projectVisibleRows() (+8 more)

### Community 15 - "Labyrinth 加密协议"
Cohesion: 0.13
Nodes (20): AES-GCM-Extended, Attachment access control, Attachment unlinkability, Baseline message secrecy, Database abstraction, Device revocation, Labyrinth encrypted message storage protocol, Known limitations (+12 more)

### Community 16 - "文学语料 集合"
Cohesion: 0.13
Nodes (20): Al-Bukhala (Arabic prose collection), Epistle of Forgiveness, Part 1 (Arabic prose), The Great Gatsby opening (English literary opening), Travels of Benjamin of Tudela (Hebrew travelogue), Eidgah (Hindi short story), Spider's Thread (Japanese short story), Rashomon (Japanese short story), Prachum Reuang Preng Khmer, Volume 7, Stories 1-10 (Khmer story collection) (+12 more)

### Community 17 - "后台壳 集成测试"
Cohesion: 0.12
Nodes (1): 假Socket

### Community 18 - "布局 算法 测试"
Cohesion: 0.14
Nodes (7): getSegmentGraphemes(), isWideCharacter(), measureWidth(), parseFontSize(), slicePreparedText(), TestCanvasRenderingContext2D, TestOffscreenCanvas

### Community 19 - "行内流 布局引擎"
Cohesion: 0.24
Nodes (15): cloneCursor(), endsInsideFirstSegment(), getCollapsedSpaceWidth(), getInternalPreparedInlineFlow(), isLineStartCursor(), layoutNextInlineFlowLine(), layoutNextInlineFlowLineRange(), measureInlineFlow() (+7 more)

### Community 20 - "断行 规则 引擎"
Cohesion: 0.26
Nodes (15): canBreakAfter(), countPreparedLines(), countPreparedLinesSimple(), findChunkIndexForStart(), getTabAdvance(), layoutNextLineRange(), measurePreparedLineGeometry(), normalizeLineStart() (+7 more)

### Community 21 - "字符 测量 指标"
Cohesion: 0.24
Nodes (13): countEmojiGraphemes(), getCorrectedSegmentWidth(), getEmojiCorrection(), getEmojiCount(), getFontMeasurementState(), getMeasureContext(), getSegmentGraphemePrefixWidths(), getSegmentGraphemeWidths() (+5 more)

### Community 22 - "实时传输 API 测试"
Cohesion: 0.23
Nodes (1): HttpRealtime传输

### Community 23 - "断行 探针 工具"
Cohesion: 0.27
Nodes (11): classifyBreakMismatch(), getBrowserLines(), getBrowserLinesFromRange(), getBrowserLinesFromSpans(), getFirstBreakMismatch(), getPublicLines(), init(), publishReport() (+3 more)

### Community 24 - "语料 扫描 命令"
Cohesion: 0.23
Nodes (8): bucketMismatches(), hasFlag(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 25 - "Socketioxide API 参考"
Cohesion: 0.3
Nodes (14): SocketRef, Socket struct, SocketIo handle, Acknowledgements, Adapter trait, Socketioxide API docs, Broadcast operators, Socketioxide crate metadata (+6 more)

### Community 26 - "排版 基准 测试"
Cohesion: 0.31
Nodes (10): bench(), buildCorpusBenchmarks(), buildRichBenchmarks(), median(), nextFrame(), publishNavigationReport(), renderBenchmarkTable(), run() (+2 more)

### Community 27 - "可变 字形 ASCII"
Cohesion: 0.21
Nodes (5): createFieldStamp(), getSpriteCanvas(), render(), splatFieldStamp(), spriteAlphaAt()

### Community 28 - "Pretext 研究 文档"
Cohesion: 0.32
Nodes (12): Changelog, Development commands, Inline-flow sidecar, Pretext library, pre-wrap mode, Research log, Rich layout API, Segment metrics cache (+4 more)

### Community 29 - "折叠面板 组件"
Cohesion: 0.33
Nodes (9): boot(), getAccordionItemNodes(), getFontFromStyles(), getRequiredElement(), initializeStaticContent(), parsePx(), refreshPrepared(), render() (+1 more)

### Community 30 - "文字 环绕 几何"
Cohesion: 0.25
Nodes (6): cross(), getPolygonIntervalForBand(), getPolygonXsAtY(), getWrapHull(), makeConvexHull(), makeWrapHull()

### Community 31 - "实时链路 集成测试"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 32 - "聊天气泡 渲染"
Cohesion: 0.24
Nodes (3): render(), scheduleRender(), updateBubbles()

### Community 33 - "语料 校验 命令"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 34 - "语料 字体 矩阵"
Cohesion: 0.36
Nodes (7): bucketMismatches(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 35 - "语料 分类 工具"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 36 - "Telegram 更新 恢复"
Cohesion: 0.36
Nodes (10): Channel difference polling, Channel update state, Gap recovery, pts sequence, qts sequence, seq sequence, Update state fetching, updateNewChannelMessage (+2 more)

### Community 37 - "PowerShell 启动脚本"
Cohesion: 0.28
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 38 - "准确性 报告 工具"
Cohesion: 0.31
Nodes (6): getBrowserLines(), publishReport(), render(), runSweep(), toNavigationReport(), withRequestId()

### Community 39 - "准确性 检查 命令"
Cohesion: 0.31
Nodes (5): canReachServer(), formatDiff(), printReport(), sleep(), waitForServer()

### Community 40 - "Airbnb 设计 参考"
Cohesion: 0.22
Nodes (9): Airbnb Cereal VF, Circular Nav Controls, Generous Border Radius, Palette Token System, Photography-First Listing Cards, Rausch Red, Three-Layer Card Shadow, Warm Near-Black Text (+1 more)

### Community 41 - "包发布 烟雾测试"
Cohesion: 0.57
Nodes (7): createProject(), installTarball(), packPackage(), run(), smokeJavaScriptEsm(), smokeTypeScript(), tscBinaryName()

### Community 42 - "预换行 检查 命令"
Cohesion: 0.39
Nodes (6): buildProbeUrl(), parseNumberFlag(), parseStringFlag(), printCaseResult(), reportIsExact(), runBrowser()

### Community 43 - "气泡 共享 指标"
Cohesion: 0.43
Nodes (3): collectWrapMetrics(), computeBubbleRender(), findTightWrapMetrics()

### Community 44 - "富文本 笔记 渲染"
Cohesion: 0.38
Nodes (3): render(), renderBody(), scheduleRender()

### Community 45 - "语料 状态 汇总"
Cohesion: 0.29
Nodes (0): 

### Community 46 - "WhatsApp 多设备 安全"
Cohesion: 0.48
Nodes (7): App state synchronization, Automatic device verification, Client-fanout encryption, Device identity keys, WhatsApp multi-device architecture, Security code, SRTP call protection

### Community 47 - "Socket 事件 行为测试"
Cohesion: 0.47
Nodes (1): 单连接发送到已关闭socket时降级为正常断开()

### Community 48 - "诊断 测量 工具"
Cohesion: 0.33
Nodes (0): 

### Community 49 - "探针 检查 命令"
Cohesion: 0.47
Nodes (3): parseNumberFlag(), parseStringFlag(), requireFlag()

### Community 50 - "导航 状态 哈希"
Cohesion: 0.47
Nodes (3): getHashParams(), readNavigationPhaseState(), readNavigationReportText()

### Community 51 - "报告 发布 工具"
Cohesion: 0.7
Nodes (4): clearNavigationReport(), publishNavigationPhase(), publishNavigationReport(), replaceNavigationHash()

### Community 52 - "富文本 笔记 布局"
Cohesion: 0.5
Nodes (2): layoutRichInlineItems(), layoutRichNote()

### Community 53 - "卡片 布局 入口"
Cohesion: 0.7
Nodes (4): computeLayout(), getOrCreateCardNode(), render(), scheduleRender()

### Community 54 - "基准 检查 命令"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 55 - "演示站 构建 脚本"
Cohesion: 0.7
Nodes (4): moveBuiltHtml(), rebaseRelativeAssetUrls(), resolveBuiltHtmlPath(), rewriteDemoLinksForStaticRoot()

### Community 56 - "语料 代表行"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 57 - "状态 面板 汇总"
Cohesion: 0.4
Nodes (0): 

### Community 58 - "表单 inert 语义"
Cohesion: 0.7
Nodes (5): disabled / inert 交互语义, Lit render 纯函数, 原生表单提交语义, 唯一壳级表单操作台, 唯一壳级操作台官方最佳实践与不手搓轮子依据

### Community 59 - "两端对齐 比较应用"
Cohesion: 0.83
Nodes (3): render(), scheduleCssOverlaySync(), scheduleRender()

### Community 60 - "双向 文本 算法"
Cohesion: 0.83
Nodes (3): classifyChar(), computeBidiLevels(), computeSegmentLevels()

### Community 61 - "DIT 隐私 流程"
Cohesion: 0.83
Nodes (4): De-identified telemetry, DIT rate limiting, DIT reidentification monitoring, VOPRF + ACS workflow

### Community 62 - "Claude 品牌 资源"
Cohesion: 0.67
Nodes (3): Anthropic, Claude, Claude Symbol

### Community 63 - "程序 主入口"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "聊天 数据 模块"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "报告 服务器 启动"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Pretext 研究 笔记"
Cohesion: 1.0
Nodes (2): pretext 多行文本测量与排版, pretext 调研记录

### Community 67 - "up 启动脚本"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "核心 库 入口"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "动态图文 布局"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "两端对齐 数据"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "SVG 路径 定义"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Gatsby 检查 脚本"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Gatsby 扫描 脚本"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "测试 数据 夹具"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "文本 模块 声明"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "官方 IM 资料索引"
Cohesion: 1.0
Nodes (1): 官方 IM 架构资料索引

## Ambiguous Edges - Review These
- `Claude` → `Anthropic`  [AMBIGUOUS]
  学习/pretext/pages/assets/claude-symbol.svg · relation: conceptually_related_to

## Knowledge Gaps
- **38 isolated node(s):** `AdminLoginBody`, `AdminLoginResp`, `ApiError`, `RealtimeConnectAuth`, `RealtimeSubscribeBody` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `程序 主入口`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `聊天 数据 模块`** (2 nodes): `markdown-chat.data.ts`, `message()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `报告 服务器 启动`** (2 nodes): `report-server.ts`, `startPostedReportServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pretext 研究 笔记`** (2 nodes): `pretext 多行文本测量与排版`, `pretext 调研记录`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `up 启动脚本`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `核心 库 入口`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `动态图文 布局`** (1 nodes): `dynamic-layout-text.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `两端对齐 数据`** (1 nodes): `justification-comparison.data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SVG 路径 定义`** (1 nodes): `svg.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gatsby 检查 脚本`** (1 nodes): `gatsby-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Gatsby 扫描 脚本`** (1 nodes): `gatsby-sweep.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `测试 数据 夹具`** (1 nodes): `test-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `文本 模块 声明`** (1 nodes): `text-modules.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `官方 IM 资料索引`** (1 nodes): `官方 IM 架构资料索引`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Claude` and `Anthropic`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `HttpRealtime传输` connect `实时传输 API 测试` to `后台管理接口`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `单连接发送到已关闭socket时降级为正常断开()` connect `Socket 事件 行为测试` to `后台管理接口`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `buildMergedSegmentation()` (e.g. with `getSharedWordSegmenter()` and `splitSegmentByBreakKind()`) actually correct?**
  _`buildMergedSegmentation()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AdminLoginBody`, `AdminLoginResp`, `ApiError` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `后台管理接口` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `socket.io 实时架构` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._