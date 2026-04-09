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

### Community 39 - "Community 39"
Cohesion: 0.28
Nodes (4): New-StreamState(), New-ManagedProcess(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (29): http冷路径闭环(), login(), loadOverview(), loadRooms(), submitLoginForm(), submitRoomSearchForm(), render(), roomShellState() (+21 more)

### Community 22 - "Community 22"
Cohesion: 0.23
Nodes (1): HttpRealtime传输

### Community 3 - "Community 3"
Cohesion: 0.15
Nodes (38): frontend/存储.ts, frontend/房间内核.ts, frontend/房间消息窗.ts, frontend/房间滚动器.ts, frontend/视图.ts, frontend/阅读推进编排.ts, 前端房间编排内核重构, XState 5 状态机 (+30 more)

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): frontend/房间实时编排.ts

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 33 - "Community 33"
Cohesion: 0.22
Nodes (2): startBackend(), ensureBackendBinaryPrepared()

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (1): 假Socket

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (66): src/后台外壳.rs, src/外壳.rs, src/实时外壳.rs, src/房间外壳.rs, src/用例.rs, src/适配.rs, socketioxide 实时适配器, 代码宪法 (+58 more)

### Community 40 - "Community 40"
Cohesion: 0.31
Nodes (6): withRequestId(), publishReport(), toNavigationReport(), getBrowserLines(), runSweep(), render()

### Community 26 - "Community 26"
Cohesion: 0.31
Nodes (10): median(), bench(), nextFrame(), withRequestId(), publishNavigationReport(), setReport(), buildCorpusBenchmarks(), buildRichBenchmarks() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (33): withRequestId(), toNavigationReport(), getEnvironmentFingerprint(), buildFont(), getLineHeight(), getDirection(), estimateBrowserLineCount(), pushDiagnosticLine() (+25 more)

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (15): withRequestId(), toNavigationReport(), publishNavigationReport(), setReport(), describeBoundary(), getSegmentWindow(), getBrowserLines(), getOurLines() (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.27
Nodes (11): withRequestId(), publishReport(), setError(), getBrowserLinesFromSpans(), getBrowserLines(), getBrowserLinesFromRange(), getPublicLines(), summarizeLines() (+3 more)

### Community 50 - "Community 50"
Cohesion: 0.7
Nodes (4): replaceNavigationHash(), clearNavigationReport(), publishNavigationPhase(), publishNavigationReport()

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (9): getRequiredElement(), getAccordionItemNodes(), initializeStaticContent(), parsePx(), getFontFromStyles(), refreshPrepared(), scheduleRender(), boot() (+1 more)

### Community 44 - "Community 44"
Cohesion: 0.43
Nodes (3): collectWrapMetrics(), findTightWrapMetrics(), computeBubbleRender()

### Community 34 - "Community 34"
Cohesion: 0.24
Nodes (3): scheduleRender(), render(), updateBubbles()

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (27): getTypography(), getPrepared(), headlineBreaksInsideWord(), getObstacleIntervals(), layoutColumn(), syncPool(), projectHeadlineLines(), projectChromeLayout() (+19 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (16): carveTextLineSlots(), circleIntervalForBand(), syncPool(), fitHeadline(), layoutColumn(), hitTestOrbs(), hasActiveTextSelection(), clearQueuedPointerEvents() (+8 more)

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (19): buildDemoFrame(), hyphenateParagraphText(), hyphenateWord(), layoutParagraphsGreedy(), layoutParagraphGreedy(), buildMeasuredLineFromLayoutResult(), layoutParagraphsOptimal(), layoutParagraphOptimal() (+11 more)

### Community 57 - "Community 57"
Cohesion: 0.83
Nodes (3): scheduleRender(), render(), scheduleCssOverlaySync()

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (20): createDomCache(), renderFrame(), syncCssRiverOverlay(), getHtmlElement(), getInputElement(), getCanvasElement(), createCanvasSurface(), createCssParagraphs() (+12 more)

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (30): buildConversationFrame(), parseMarkdownBlocks(), parseBlockTokens(), buildListBlocks(), decorateListItemBlocks(), buildPlainTextBlocks(), buildInlineBlocks(), buildPreparedInlineBlocks() (+22 more)

### Community 14 - "Community 14"
Cohesion: 0.19
Nodes (16): scheduleRender(), render(), projectVisibleRows(), prepareRow(), createMessageShell(), renderMessageContents(), projectMessageNode(), renderBlock() (+8 more)

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (2): layoutRichInlineItems(), layoutRichNote()

### Community 45 - "Community 45"
Cohesion: 0.38
Nodes (3): scheduleRender(), renderBody(), render()

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 0.21
Nodes (5): getSpriteCanvas(), spriteAlphaAt(), createFieldStamp(), splatFieldStamp(), render()

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (6): getWrapHull(), getPolygonIntervalForBand(), makeWrapHull(), getPolygonXsAtY(), cross(), makeConvexHull()

### Community 52 - "Community 52"
Cohesion: 0.7
Nodes (4): computeLayout(), getOrCreateCardNode(), scheduleRender(), render()

### Community 41 - "Community 41"
Cohesion: 0.31
Nodes (5): sleep(), canReachServer(), waitForServer(), formatDiff(), printReport()

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (2): parseStringFlag(), parseNumberFlag()

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (24): runAppleScript(), getFrontmostApplicationName(), restoreFrontmostApplication(), runBackgroundAppleScript(), sleep(), waitForPort(), getAvailablePort(), readLockMetadata() (+16 more)

### Community 54 - "Community 54"
Cohesion: 0.7
Nodes (4): resolveBuiltHtmlPath(), moveBuiltHtml(), rebaseRelativeAssetUrls(), rewriteDemoLinksForStaticRoot()

### Community 35 - "Community 35"
Cohesion: 0.24
Nodes (3): parseStringFlag(), parseNumberFlag(), parseOptionalNumberFlag()

### Community 36 - "Community 36"
Cohesion: 0.36
Nodes (7): parseStringFlag(), parseNumberFlag(), parseOptionalNumberFlag(), parseBrowser(), parseOptions(), bucketMismatches(), printSummary()

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (2): parseStringFlag(), parseNumberFlag()

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 0.23
Nodes (8): parseStringFlag(), parseNumberFlag(), parseOptionalNumberFlag(), hasFlag(), parseBrowser(), parseOptions(), bucketMismatches(), printSummary()

### Community 37 - "Community 37"
Cohesion: 0.24
Nodes (3): parseStringFlag(), parseNumberFlag(), parseOptionalNumberFlag()

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 0.57
Nodes (7): packPackage(), smokeJavaScriptEsm(), smokeTypeScript(), createProject(), installTarball(), tscBinaryName(), run()

### Community 43 - "Community 43"
Cohesion: 0.39
Nodes (6): parseStringFlag(), parseNumberFlag(), buildProbeUrl(), printCaseResult(), reportIsExact(), runBrowser()

### Community 48 - "Community 48"
Cohesion: 0.47
Nodes (3): parseStringFlag(), parseNumberFlag(), requireFlag()

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 0.4
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 0.47
Nodes (3): getHashParams(), readNavigationReportText(), readNavigationPhaseState()

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (34): getWhiteSpaceProfile(), normalizeWhitespaceNormal(), normalizeWhitespacePreWrap(), getSharedWordSegmenter(), containsArabicScript(), isCJK(), isLeftStickyPunctuationSegment(), isCJKLineStartProhibitedSegment() (+26 more)

### Community 58 - "Community 58"
Cohesion: 0.83
Nodes (3): classifyChar(), computeBidiLevels(), computeSegmentLevels()

### Community 18 - "Community 18"
Cohesion: 0.24
Nodes (15): getInternalPreparedInlineFlow(), cloneCursor(), isLineStartCursor(), getCollapsedSpaceWidth(), prepareWholeItemLine(), endsInsideFirstSegment(), prepareInlineFlow(), stepInlineFlowLine() (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (7): parseFontSize(), isWideCharacter(), measureWidth(), getSegmentGraphemes(), slicePreparedText(), TestCanvasRenderingContext2D, TestOffscreenCanvas

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (28): getSharedGraphemeSegmenter(), createEmptyPrepared(), measureAnalysis(), mapAnalysisChunksToPreparedChunks(), prepareInternal(), profilePrepare(), prepare(), prepareWithSegments() (+20 more)

### Community 19 - "Community 19"
Cohesion: 0.26
Nodes (15): canBreakAfter(), normalizeSimpleLineStartSegmentIndex(), getTabAdvance(), findChunkIndexForStart(), normalizeLineStartChunkIndex(), normalizeLineStart(), countPreparedLines(), countPreparedLinesSimple() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.24
Nodes (13): getMeasureContext(), getSegmentMetricCache(), getSegmentMetrics(), parseFontSize(), getSharedGraphemeSegmenter(), isEmojiGrapheme(), getEmojiCorrection(), countEmojiGraphemes() (+5 more)

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (2): pretext 调研记录, pretext 多行文本测量与排版

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): 官方 IM 架构资料索引

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (12): Connection State Recovery, Session Recovery, Delivery Guarantees, Message Ordering, Ack Timeout Retries, Emitting Events, Volatile Events, Acknowledgement Callback (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.3
Nodes (14): Socketioxide API docs, SocketIo handle, Handler model, Extractors, Adapter trait, LocalAdapter, State management, Broadcast operators (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.36
Nodes (10): updateNewChannelMessage, Telegram updates handling, Telegram Updates object, pts sequence, seq sequence, qts sequence, Update state fetching, Channel update state (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (28): The Labyrinth Encrypted Message Storage Protocol, Baseline Message Secrecy, Post-Revocation Message Secrecy, Attachment Unlinkability, Cryptographic Primitives, Oblivious Revocable Function, Data Recovery Methods, Recovery Codes (+20 more)

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (13): WhatsApp Multi-Device, WhatsApp Multi-Device Architecture, Automatic Device Verification, Message History Sync, Application State Sync, Primary Device, Companion Devices, Device List Keys (+5 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (17): Pretext AGENTS Guidance, Avoid Reinventing Wheels, DDD Modularity, Hot Path Thinness, Verification Before Completion, Commit After Completion, Browser Accuracy and Benchmarking, Pretext CLAUDE Note (+9 more)

### Community 30 - "Community 30"
Cohesion: 0.32
Nodes (12): Changelog, Development commands, Pretext library, Two-phase layout pipeline, Rich layout API, Inline-flow sidecar, pre-wrap mode, Segment metrics cache (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (20): Al-Bukhala (Arabic prose collection), Epistle of Forgiveness, Part 1 (Arabic prose), The Great Gatsby opening (English literary opening), Travels of Benjamin of Tudela (Hebrew travelogue), Eidgah (Hindi short story), Spider's Thread (Japanese short story), Rashomon (Japanese short story), Prachum Reuang Preng Khmer, Volume 7, Stories 1-10 (Khmer story collection) (+12 more)

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (3): Claude Symbol, Claude, Anthropic

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): 聊天壳首页与控制台集成测试

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (2): graphify Codex 规则, 先读 GRAPH_REPORT

## Ambiguous Edges - Review These
- `Claude` → `Anthropic`  [AMBIGUOUS]
  学习/pretext/pages/assets/claude-symbol.svg · relation: conceptually_related_to

## Knowledge Gaps
- **74 isolated node(s):** `frontend/房间实时编排.ts`, `frontend/房间恢复编排.ts`, `src/后台外壳.rs`, `src/房间外壳.rs`, `设备入口凭证轮换` (+69 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 65`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `frontend/房间实时编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `main.rs`, `main()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `dynamic-layout-text.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `justification-comparison.data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `markdown-chat.data.ts`, `message()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `svg.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `gatsby-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `gatsby-sweep.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (2 nodes): `report-server.ts`, `startPostedReportServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `test-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `text-modules.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (2 nodes): `pretext 调研记录`, `pretext 多行文本测量与排版`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `官方 IM 架构资料索引`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `聊天壳首页与控制台集成测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (2 nodes): `graphify Codex 规则`, `先读 GRAPH_REPORT`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Claude` and `Anthropic`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `event_position 同步锚点` connect `Community 0` to `Community 3`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `HttpRealtime传输` connect `Community 22` to `Community 1`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `前端房间编排内核重构设计` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `buildMergedSegmentation()` (e.g. with `getSharedWordSegmenter()` and `containsArabicScript()`) actually correct?**
  _`buildMergedSegmentation()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `loadCorpus()` (e.g. with `buildFont()` and `getLineHeight()`) actually correct?**
  _`loadCorpus()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `send_json()` (e.g. with `领域测试.rs` and `http冷路径闭环()`) actually correct?**
  _`send_json()` has 13 INFERRED edges - model-reasoned connections that need verification._