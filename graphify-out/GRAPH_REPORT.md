# Graph Report - .  (2026-04-09)

## Corpus Check
- 2492 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 21231 nodes · 47057 edges · 1618 communities detected
- Extraction: 42% EXTRACTED · 58% INFERRED · 0% AMBIGUOUS · INFERRED: 27404 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `CSSStyleDeclaration` - 799 edges
2. `push()` - 250 edges
3. `assert()` - 226 edges
4. `map()` - 190 edges
5. `Document` - 181 edges
6. `Token()` - 181 edges
7. `Token()` - 181 edges
8. `forEach()` - 171 edges
9. `get()` - 158 edges
10. `isIdentifier()` - 154 edges

## Surprising Connections (you probably didn't know these)
- `connectedCallback()` --calls--> `bootstrap接口会返回稳定花名快照()`  [INFERRED]
  frontend\dist\聊天壳.js → E:\koko\tests\集成测试.rs
- `bootstrap接口会返回稳定花名快照()` --calls--> `updateChat()`  [INFERRED]
  E:\koko\tests\集成测试.rs → frontend\dist\聊天壳.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.0
Nodes (4806): absolutePositionOfStartOfLine(), accessKind(), accessPrivateIdentifier(), add(), addChildrenRecursively(), addClassStaticThisReferences(), addCodeAction(), addCommonjsExport() (+4798 more)

### Community 1 - "Community 1"
Cohesion: 0.0
Nodes (2548): abortParsingListOrMoveToNextToken(), accessKind(), accessPrivateIdentifier(), add(), addDefaultValueAssignmentForBindingPattern(), addDefaultValueAssignmentForInitializer(), addDefaultValueAssignmentIfNeeded(), addDefaultValueAssignmentsIfNeeded() (+2540 more)

### Community 2 - "Community 2"
Cohesion: 0.0
Nodes (0): 

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (1): CSSStyleDeclaration

### Community 4 - "Community 4"
Cohesion: 0.01
Nodes (180): assert(), astCollectTests(), astParseFile(), atomicWriteFile(), BrowserPool, BrowserSessions, buildOptions(), cloneByOwnProperties() (+172 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (415): abortParsingListOrMoveToNextToken(), addRelatedInfo(), allowConditionalTypesAnd(), allowInAnd(), attachFileToDiagnostics(), canFollowContextualOfKeyword(), canFollowExportModifier(), canFollowGetOrSetKeyword() (+407 more)

### Community 6 - "Community 6"
Cohesion: 0.01
Nodes (126): AgentReporter, ancestor(), BaseReporter, BenchmarkReporter, binarySearch(), BlobReporter, buildBySources(), capturePrintError() (+118 more)

### Community 7 - "Community 7"
Cohesion: 0.01
Nodes (32): BrowserFrameURL, BrowserFrameURL, BrowserFrameValidator, BrowserFrameValidator, BrowserWindow, PerformanceObserverEntryList, Timeout, CSSModule (+24 more)

### Community 8 - "Community 8"
Cohesion: 0.01
Nodes (202): addAncestorStatesToEnter(), addDescendantStatesToEnter(), addProperAncestorStatesToEnter(), after(), areStateNodeCollectionsEqual(), _$AS(), assign(), _$AT() (+194 more)

### Community 9 - "Community 9"
Cohesion: 0.01
Nodes (127): 房间历史分页会返回before_event_position之前的消息(), 房间历史分页缺少before_event_position会返回invalid_argument(), bootstrap接口会返回稳定花名快照(), connectedCallback(), create(), fail(), generateExampleFiles(), generateFrameworkConfigFile() (+119 more)

### Community 10 - "Community 10"
Cohesion: 0.01
Nodes (110): run(), runBaseTests(), setupConsoleLogSpy(), setupGlobalEnv(), startModuleRunner(), Browser, Browser, BaseCoverageProvider (+102 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (34): at(), B(), bt, c(), ct(), d(), encode(), encodeAsBinary() (+26 more)

### Community 12 - "Community 12"
Cohesion: 0.01
Nodes (1): Document

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (87): Actor, addAncestorStatesToEnter(), addDescendantStatesToEnter(), addProperAncestorStatesToEnter(), areStateNodeCollectionsEqual(), checkNot(), checkStateIn(), cloneMachineSnapshot() (+79 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (87): Actor, addAncestorStatesToEnter(), addDescendantStatesToEnter(), addProperAncestorStatesToEnter(), areStateNodeCollectionsEqual(), checkNot(), checkStateIn(), cloneMachineSnapshot() (+79 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (87): Actor, addAncestorStatesToEnter(), addDescendantStatesToEnter(), addProperAncestorStatesToEnter(), areStateNodeCollectionsEqual(), checkNot(), checkStateIn(), cloneMachineSnapshot() (+79 more)

### Community 16 - "Community 16"
Cohesion: 0.03
Nodes (87): Actor, addAncestorStatesToEnter(), addDescendantStatesToEnter(), addProperAncestorStatesToEnter(), areStateNodeCollectionsEqual(), checkNot(), checkStateIn(), cloneMachineSnapshot() (+79 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (64): a(), ae(), at(), b(), bt(), c(), ce(), ct() (+56 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (63): a(), at(), b(), bt(), c(), ce(), clearTimeout(), ct() (+55 more)

### Community 19 - "Community 19"
Cohesion: 0.02
Nodes (1): SVGElement

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (1): CSSStyleDeclarationPropertySetParser

### Community 21 - "Community 21"
Cohesion: 0.03
Nodes (1): Element

### Community 22 - "Community 22"
Cohesion: 0.04
Nodes (43): addCliOptions(), addCommand(), benchmark(), CAC, CACError, collect(), Command, complete() (+35 more)

### Community 23 - "Community 23"
Cohesion: 0.02
Nodes (1): HTMLElement

### Community 24 - "Community 24"
Cohesion: 0.04
Nodes (57): _arrayLikeToArray(), _arrayWithoutHoles(), byteLength(), concatChunks(), _construct(), _createClass(), createCookieJar(), _createForOfIteratorHelper() (+49 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (62): createError(), defaultGetFormatWithoutErrors(), emitInvalidSegmentDeprecation(), emitLegacyIndexDeprecation(), emitTrailingSlashPatternDeprecation(), exportsNotFound(), extname(), fileExists() (+54 more)

### Community 26 - "Community 26"
Cohesion: 0.03
Nodes (1): DOMMatrixReadOnly

### Community 27 - "Community 27"
Cohesion: 0.03
Nodes (1): HTMLMediaElement

### Community 28 - "Community 28"
Cohesion: 0.05
Nodes (14): BareModuleMocker, cleanUrl(), createImportMetaResolver(), createNodeImportMeta(), fixLeadingSlashes(), getMockType(), groupByConsecutiveAction(), injectQuery() (+6 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (43): analyzeMetafileSync(), applyProperties(), buildOrContextImpl(), buildSync(), checkForInvalidFlags(), createObjectStash(), decodePacket(), downloadedBinPath() (+35 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (26): a(), b(), C(), ct(), d(), e, g, h() (+18 more)

### Community 31 - "Community 31"
Cohesion: 0.04
Nodes (1): SVGSVGElement

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (19): assertConfigurationModule(), BaseCoverageProvider, BaseSequencer, getWorkersCountByPercentage(), hasBrowserChromium(), hasOnlyBrowserChromium(), isBrowserEnabled(), isChromiumName() (+11 more)

### Community 33 - "Community 33"
Cohesion: 0.07
Nodes (2): 假Socket, Socket

### Community 34 - "Community 34"
Cohesion: 0.07
Nodes (12): CommonjsExecutor, EsmExecutor, ExternalModulesExecutor, FileMap, interopCommonJsModule(), IPmask(), IPnumber(), isPrimitive() (+4 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (26): alterPath(), createDefaultLogicOptions(), createDefaultMachineOptions(), createMockActorScope(), createShortestPathsGen(), createSimplePathsGen(), createTestModel(), deduplicatePaths() (+18 more)

### Community 36 - "Community 36"
Cohesion: 0.09
Nodes (26): alterPath(), createDefaultLogicOptions(), createDefaultMachineOptions(), createMockActorScope(), createShortestPathsGen(), createSimplePathsGen(), createTestModel(), deduplicatePaths() (+18 more)

### Community 37 - "Community 37"
Cohesion: 0.09
Nodes (26): alterPath(), createDefaultLogicOptions(), createDefaultMachineOptions(), createMockActorScope(), createShortestPathsGen(), createSimplePathsGen(), createTestModel(), deduplicatePaths() (+18 more)

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (26): alterPath(), createDefaultLogicOptions(), createDefaultMachineOptions(), createMockActorScope(), createShortestPathsGen(), createSimplePathsGen(), createTestModel(), deduplicatePaths() (+18 more)

### Community 39 - "Community 39"
Cohesion: 0.09
Nodes (30): appendBlockGroup(), buildCodeBlock(), buildConversationFrame(), buildInlineBlocks(), buildListBlocks(), buildPlainTextBlocks(), buildPreparedInlineBlock(), buildPreparedInlineBlocks() (+22 more)

### Community 40 - "Community 40"
Cohesion: 0.05
Nodes (1): DOMMatrix

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (33): addDiagnostics(), buildFont(), buildReadyReport(), classifyBreakMismatch(), configureControls(), estimateBrowserLineCount(), getBrowserLinesFromRange(), getBrowserLinesFromSpans() (+25 more)

### Community 42 - "Community 42"
Cohesion: 0.07
Nodes (16): buildUnicodeData(), getLineInfo(), getOptions(), isControlLetter(), isDecimalDigit(), isIdentifierChar(), isIdentifierStart(), isInAstralSet() (+8 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (34): analyzeText(), buildMergedSegmentation(), carryTrailingForwardStickyAcrossCJKBoundary(), classifySegmentBreakChar(), compileAnalysisChunks(), containsArabicScript(), endsWithArabicNoSpacePunctuation(), endsWithClosingQuote() (+26 more)

### Community 44 - "Community 44"
Cohesion: 0.06
Nodes (1): CharacterData

### Community 45 - "Community 45"
Cohesion: 0.07
Nodes (1): HTMLTextAreaElement

### Community 46 - "Community 46"
Cohesion: 0.07
Nodes (1): Range

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (6): a(), i(), l, o(), r(), s

### Community 48 - "Community 48"
Cohesion: 0.11
Nodes (24): buildLayout(), commitFrame(), easeSpin(), evaluateLayout(), fitHeadlineFontSize(), getLogoAnimation(), getLogoProjection(), getObstacleIntervals() (+16 more)

### Community 49 - "Community 49"
Cohesion: 0.1
Nodes (31): compareBooleans(), compareComparableValues(), compareCompletionEntries(), compareDiagnostics(), compareDiagnosticsSkipRelatedInformation(), compareEmitHelpers(), compareGeneratedPositions(), compareImportOrExportSpecifiers() (+23 more)

### Community 50 - "Community 50"
Cohesion: 0.07
Nodes (1): HTMLSelectElement

### Community 51 - "Community 51"
Cohesion: 0.09
Nodes (1): Selection

### Community 52 - "Community 52"
Cohesion: 0.11
Nodes (15): a(), c(), ct(), e(), f(), Ft(), gt(), h() (+7 more)

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (3): memo(), StateMachine, StateNode

### Community 54 - "Community 54"
Cohesion: 0.09
Nodes (3): memo(), StateMachine, StateNode

### Community 55 - "Community 55"
Cohesion: 0.09
Nodes (3): memo(), StateMachine, StateNode

### Community 56 - "Community 56"
Cohesion: 0.09
Nodes (3): memo(), StateMachine, StateNode

### Community 57 - "Community 57"
Cohesion: 0.07
Nodes (1): Navigator

### Community 58 - "Community 58"
Cohesion: 0.13
Nodes (28): buildLineTextFromRange(), clearCache(), createEmptyPrepared(), createLayoutLine(), getInternalPrepared(), getLineTextCache(), getSegmentGraphemes(), getSharedGraphemeSegmenter() (+20 more)

### Community 59 - "Community 59"
Cohesion: 0.14
Nodes (21): a(), At(), c(), e(), Et(), f(), ft(), G() (+13 more)

### Community 60 - "Community 60"
Cohesion: 0.16
Nodes (24): acquireBrowserAutomationLock(), canReachUrl(), connectFirefoxBidi(), createBrowserSession(), createChromeSession(), createFirefoxSession(), createSafariSession(), ensurePageServer() (+16 more)

### Community 61 - "Community 61"
Cohesion: 0.08
Nodes (1): VirtualConsole

### Community 62 - "Community 62"
Cohesion: 0.1
Nodes (1): HTMLScriptElement

### Community 63 - "Community 63"
Cohesion: 0.08
Nodes (1): HTMLAnchorElement

### Community 64 - "Community 64"
Cohesion: 0.08
Nodes (1): HTMLAreaElement

### Community 65 - "Community 65"
Cohesion: 0.09
Nodes (1): HTMLFormElement

### Community 66 - "Community 66"
Cohesion: 0.15
Nodes (1): HTMLHyperlinkElementUtility

### Community 67 - "Community 67"
Cohesion: 0.11
Nodes (1): HTMLIFrameElement

### Community 68 - "Community 68"
Cohesion: 0.14
Nodes (8): createInertActorScope(), getInitialMicrosteps(), getInitialSnapshot(), getMicrosteps(), getNextSnapshot(), initialTransition(), SimulatedClock, transition()

### Community 69 - "Community 69"
Cohesion: 0.14
Nodes (8): createInertActorScope(), getInitialMicrosteps(), getInitialSnapshot(), getMicrosteps(), getNextSnapshot(), initialTransition(), SimulatedClock, transition()

### Community 70 - "Community 70"
Cohesion: 0.14
Nodes (8): createInertActorScope(), getInitialMicrosteps(), getInitialSnapshot(), getMicrosteps(), getNextSnapshot(), initialTransition(), SimulatedClock, transition()

### Community 71 - "Community 71"
Cohesion: 0.14
Nodes (8): createInertActorScope(), getInitialMicrosteps(), getInitialSnapshot(), getMicrosteps(), getNextSnapshot(), initialTransition(), SimulatedClock, transition()

### Community 72 - "Community 72"
Cohesion: 0.09
Nodes (1): HTMLImageElement

### Community 73 - "Community 73"
Cohesion: 0.09
Nodes (1): SVGMatrix

### Community 74 - "Community 74"
Cohesion: 0.19
Nodes (19): buildCanvasColumnFrame(), buildDemoFrame(), buildMeasuredLineFromCandidateRange(), buildMeasuredLineFromLayoutResult(), computeMetrics(), finalizeMeasuredLine(), getDisplaySpacing(), getLineStatsFromBreakCandidates() (+11 more)

### Community 75 - "Community 75"
Cohesion: 0.14
Nodes (1): CSSStyleDeclarationPropertyGetParser

### Community 76 - "Community 76"
Cohesion: 0.11
Nodes (1): XMLHttpRequest

### Community 77 - "Community 77"
Cohesion: 0.17
Nodes (16): carveTextLineSlots(), circleIntervalForBand(), clearQueuedPointerEvents(), enterTextSelectionMode(), fitHeadline(), hasActiveTextSelection(), hitTestOrbs(), isTextSelectionInteractionActive() (+8 more)

### Community 78 - "Community 78"
Cohesion: 0.18
Nodes (20): applyColumnWidths(), applyControls(), createCanvasSurface(), createCssParagraphs(), createDomCache(), createMetricPanel(), createMetricRow(), ensureRiverMarkCount() (+12 more)

### Community 79 - "Community 79"
Cohesion: 0.18
Nodes (15): buildReport(), classifyBreakMismatch(), describeBoundary(), getBrowserLines(), getFirstBreakMismatch(), getOurLines(), getSegmentWindow(), init() (+7 more)

### Community 80 - "Community 80"
Cohesion: 0.1
Nodes (1): HTMLBodyElement

### Community 81 - "Community 81"
Cohesion: 0.19
Nodes (16): appendMarker(), appendRails(), createBlockShell(), createMessageShell(), markerTop(), prepareRow(), projectMessageNode(), projectVisibleRows() (+8 more)

### Community 82 - "Community 82"
Cohesion: 0.14
Nodes (1): CSSStyleDeclarationValueParser

### Community 83 - "Community 83"
Cohesion: 0.13
Nodes (1): DOMTokenList

### Community 84 - "Community 84"
Cohesion: 0.14
Nodes (1): HTMLLinkElement

### Community 85 - "Community 85"
Cohesion: 0.11
Nodes (1): ShadowRoot

### Community 86 - "Community 86"
Cohesion: 0.11
Nodes (1): SVGFEConvolveMatrixElement

### Community 87 - "Community 87"
Cohesion: 0.13
Nodes (1): Traces

### Community 88 - "Community 88"
Cohesion: 0.11
Nodes (1): BrowserPage

### Community 89 - "Community 89"
Cohesion: 0.11
Nodes (1): DetachedBrowserPage

### Community 90 - "Community 90"
Cohesion: 0.11
Nodes (1): Event

### Community 91 - "Community 91"
Cohesion: 0.11
Nodes (1): Location

### Community 92 - "Community 92"
Cohesion: 0.18
Nodes (13): cleanup(), collect(), createEnvironmentLoader(), createImportMetaEnvProxy(), execute(), init(), isBuiltinEnvironment(), loadEnvironment() (+5 more)

### Community 93 - "Community 93"
Cohesion: 0.14
Nodes (7): getSegmentGraphemes(), isWideCharacter(), measureWidth(), parseFontSize(), slicePreparedText(), TestCanvasRenderingContext2D, TestOffscreenCanvas

### Community 94 - "Community 94"
Cohesion: 0.17
Nodes (1): AsyncTaskManager

### Community 95 - "Community 95"
Cohesion: 0.12
Nodes (1): HTMLObjectElement

### Community 96 - "Community 96"
Cohesion: 0.14
Nodes (1): WebSocket

### Community 97 - "Community 97"
Cohesion: 0.15
Nodes (7): capitalize(), divider(), errorBanner(), formatProjectName(), formatTestPath(), getCols(), renderSnapshotSummary()

### Community 98 - "Community 98"
Cohesion: 0.24
Nodes (15): cloneCursor(), endsInsideFirstSegment(), getCollapsedSpaceWidth(), getInternalPreparedInlineFlow(), isLineStartCursor(), layoutNextInlineFlowLine(), layoutNextInlineFlowLineRange(), measureInlineFlow() (+7 more)

### Community 99 - "Community 99"
Cohesion: 0.26
Nodes (15): canBreakAfter(), countPreparedLines(), countPreparedLinesSimple(), findChunkIndexForStart(), getTabAdvance(), layoutNextLineRange(), measurePreparedLineGeometry(), normalizeLineStart() (+7 more)

### Community 100 - "Community 100"
Cohesion: 0.24
Nodes (13): countEmojiGraphemes(), getCorrectedSegmentWidth(), getEmojiCorrection(), getEmojiCount(), getFontMeasurementState(), getMeasureContext(), getSegmentGraphemePrefixWidths(), getSegmentGraphemeWidths() (+5 more)

### Community 101 - "Community 101"
Cohesion: 0.12
Nodes (1): BrowserFrame

### Community 102 - "Community 102"
Cohesion: 0.12
Nodes (1): DetachedBrowserFrame

### Community 103 - "Community 103"
Cohesion: 0.15
Nodes (1): NamedNodeMap

### Community 104 - "Community 104"
Cohesion: 0.12
Nodes (1): HTMLTableElement

### Community 105 - "Community 105"
Cohesion: 0.17
Nodes (1): FormData

### Community 106 - "Community 106"
Cohesion: 0.14
Nodes (1): HTMLOutputElement

### Community 107 - "Community 107"
Cohesion: 0.18
Nodes (1): DetachedWindowAPI

### Community 108 - "Community 108"
Cohesion: 0.15
Nodes (3): forwardTo(), sendParent(), sendTo()

### Community 109 - "Community 109"
Cohesion: 0.15
Nodes (3): forwardTo(), sendParent(), sendTo()

### Community 110 - "Community 110"
Cohesion: 0.15
Nodes (3): forwardTo(), sendParent(), sendTo()

### Community 111 - "Community 111"
Cohesion: 0.15
Nodes (3): forwardTo(), sendParent(), sendTo()

### Community 112 - "Community 112"
Cohesion: 0.27
Nodes (12): applyManualBinaryPathOverride(), binaryIntegrityCheck(), checkAndPreparePackage(), downloadDirectlyFromNPM(), downloadedBinPath(), extractFileFromTarGzip(), fetch(), installUsingNPM() (+4 more)

### Community 113 - "Community 113"
Cohesion: 0.22
Nodes (1): Headers

### Community 114 - "Community 114"
Cohesion: 0.14
Nodes (1): HTMLCanvasElement

### Community 115 - "Community 115"
Cohesion: 0.14
Nodes (1): SVGLengthList

### Community 116 - "Community 116"
Cohesion: 0.14
Nodes (1): SVGNumberList

### Community 117 - "Community 117"
Cohesion: 0.14
Nodes (1): SVGPointList

### Community 118 - "Community 118"
Cohesion: 0.16
Nodes (1): SVGStringList

### Community 119 - "Community 119"
Cohesion: 0.14
Nodes (1): SVGTransformList

### Community 120 - "Community 120"
Cohesion: 0.19
Nodes (1): TreeWalker

### Community 121 - "Community 121"
Cohesion: 0.14
Nodes (1): ValidityState

### Community 122 - "Community 122"
Cohesion: 0.27
Nodes (1): XMLParser

### Community 123 - "Community 123"
Cohesion: 0.21
Nodes (5): genSourceMapUrl(), getBuiltinModule(), injectQuery(), NativeModuleMocker, transformCode()

### Community 124 - "Community 124"
Cohesion: 0.27
Nodes (11): classifyBreakMismatch(), getBrowserLines(), getBrowserLinesFromRange(), getBrowserLinesFromSpans(), getFirstBreakMismatch(), getPublicLines(), init(), publishReport() (+3 more)

### Community 125 - "Community 125"
Cohesion: 0.23
Nodes (8): bucketMismatches(), hasFlag(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 126 - "Community 126"
Cohesion: 0.15
Nodes (1): DOMRectReadOnly

### Community 127 - "Community 127"
Cohesion: 0.15
Nodes (1): DocumentFragment

### Community 128 - "Community 128"
Cohesion: 0.17
Nodes (1): HTMLTemplateElement

### Community 129 - "Community 129"
Cohesion: 0.15
Nodes (1): NodeList

### Community 130 - "Community 130"
Cohesion: 0.15
Nodes (1): SVGFEDropShadowElement

### Community 131 - "Community 131"
Cohesion: 0.15
Nodes (1): SVGFESpecularLightingElement

### Community 132 - "Community 132"
Cohesion: 0.15
Nodes (1): SVGFETurbulenceElement

### Community 133 - "Community 133"
Cohesion: 0.15
Nodes (1): SVGMarkerElement

### Community 134 - "Community 134"
Cohesion: 0.31
Nodes (13): finishTransformNamedEvaluation(), getAssignedNameOfIdentifier(), getAssignedNameOfPropertyName(), isEmptyStringLiteral(), transformNamedEvaluation(), transformNamedEvaluationOfAssignmentExpression(), transformNamedEvaluationOfBindingElement(), transformNamedEvaluationOfExportAssignment() (+5 more)

### Community 135 - "Community 135"
Cohesion: 0.33
Nodes (11): catchWindowErrors(), createCompatRequest(), createCompatUtils(), createJSDOMCompatURL(), getWindowKeys(), isClassLikeName(), patchAddEventListener(), populateGlobal() (+3 more)

### Community 136 - "Community 136"
Cohesion: 0.31
Nodes (10): bench(), buildCorpusBenchmarks(), buildRichBenchmarks(), median(), nextFrame(), publishNavigationReport(), renderBenchmarkTable(), run() (+2 more)

### Community 137 - "Community 137"
Cohesion: 0.17
Nodes (11): Certificate, Cipheriv, Decipheriv, DiffieHellman, ECDH, Hash, Hmac, KeyObject (+3 more)

### Community 138 - "Community 138"
Cohesion: 0.17
Nodes (11): BrotliCompress, BrotliDecompress, Deflate, DeflateRaw, Gunzip, Gzip, Inflate, InflateRaw (+3 more)

### Community 139 - "Community 139"
Cohesion: 0.3
Nodes (1): HTMLParser

### Community 140 - "Community 140"
Cohesion: 0.17
Nodes (1): HTMLFieldSetElement

### Community 141 - "Community 141"
Cohesion: 0.17
Nodes (1): TextTrack

### Community 142 - "Community 142"
Cohesion: 0.17
Nodes (1): HTMLOptionElement

### Community 143 - "Community 143"
Cohesion: 0.17
Nodes (1): SVGFEDiffuseLightingElement

### Community 144 - "Community 144"
Cohesion: 0.17
Nodes (1): SVGFEDisplacementMapElement

### Community 145 - "Community 145"
Cohesion: 0.17
Nodes (1): SVGFEGaussianBlurElement

### Community 146 - "Community 146"
Cohesion: 0.17
Nodes (1): SVGTextContentElement

### Community 147 - "Community 147"
Cohesion: 0.17
Nodes (1): SVGTransform

### Community 148 - "Community 148"
Cohesion: 0.17
Nodes (1): CrossOriginBrowserWindow

### Community 149 - "Community 149"
Cohesion: 0.21
Nodes (5): createFieldStamp(), getSpriteCanvas(), render(), splatFieldStamp(), spriteAlphaAt()

### Community 150 - "Community 150"
Cohesion: 0.24
Nodes (1): VirtualConsolePrinter

### Community 151 - "Community 151"
Cohesion: 0.24
Nodes (1): StylePropertyMapReadOnly

### Community 152 - "Community 152"
Cohesion: 0.27
Nodes (1): EventTarget

### Community 153 - "Community 153"
Cohesion: 0.2
Nodes (1): AbortSignal

### Community 154 - "Community 154"
Cohesion: 0.18
Nodes (1): Attr

### Community 155 - "Community 155"
Cohesion: 0.2
Nodes (1): MediaStreamTrack

### Community 156 - "Community 156"
Cohesion: 0.18
Nodes (1): SVGFEColorMatrixElement

### Community 157 - "Community 157"
Cohesion: 0.18
Nodes (1): SVGFEMorphologyElement

### Community 158 - "Community 158"
Cohesion: 0.18
Nodes (1): SVGGraphicsElement

### Community 159 - "Community 159"
Cohesion: 0.18
Nodes (1): SVGImageElement

### Community 160 - "Community 160"
Cohesion: 0.27
Nodes (1): WindowBrowserContext

### Community 161 - "Community 161"
Cohesion: 0.27
Nodes (9): createCancellationToken(), findArgumentStringArray(), getLogLevel(), initializeNodeSystem(), parseEventPort(), parseLoggingEnvironmentString(), parseServerMode(), start() (+1 more)

### Community 162 - "Community 162"
Cohesion: 0.33
Nodes (9): boot(), getAccordionItemNodes(), getFontFromStyles(), getRequiredElement(), initializeStaticContent(), parsePx(), refreshPrepared(), render() (+1 more)

### Community 163 - "Community 163"
Cohesion: 0.25
Nodes (6): cross(), getPolygonIntervalForBand(), getPolygonXsAtY(), getWrapHull(), makeConvexHull(), makeWrapHull()

### Community 164 - "Community 164"
Cohesion: 0.2
Nodes (1): DetachedBrowser

### Community 165 - "Community 165"
Cohesion: 0.33
Nodes (1): CSSStyleDeclarationPropertyManager

### Community 166 - "Community 166"
Cohesion: 0.2
Nodes (1): CSSKeyframesRule

### Community 167 - "Community 167"
Cohesion: 0.33
Nodes (1): MediaQueryItem

### Community 168 - "Community 168"
Cohesion: 0.36
Nodes (1): ECMAScriptModuleCompiler

### Community 169 - "Community 169"
Cohesion: 0.2
Nodes (1): HTMLCollection

### Community 170 - "Community 170"
Cohesion: 0.2
Nodes (1): HTMLSlotElement

### Community 171 - "Community 171"
Cohesion: 0.2
Nodes (1): HTMLTrackElement

### Community 172 - "Community 172"
Cohesion: 0.24
Nodes (1): NodeUtility

### Community 173 - "Community 173"
Cohesion: 0.22
Nodes (1): ParentNodeUtility

### Community 174 - "Community 174"
Cohesion: 0.2
Nodes (1): SVGFECompositeElement

### Community 175 - "Community 175"
Cohesion: 0.2
Nodes (1): SVGFEImageElement

### Community 176 - "Community 176"
Cohesion: 0.2
Nodes (1): SVGFEOffsetElement

### Community 177 - "Community 177"
Cohesion: 0.2
Nodes (1): SVGFESpotLightElement

### Community 178 - "Community 178"
Cohesion: 0.2
Nodes (1): SVGPatternElement

### Community 179 - "Community 179"
Cohesion: 0.2
Nodes (1): SVGStyleElement

### Community 180 - "Community 180"
Cohesion: 0.2
Nodes (1): Text

### Community 181 - "Community 181"
Cohesion: 0.38
Nodes (1): SelectorItem

### Community 182 - "Community 182"
Cohesion: 0.38
Nodes (1): SelectorParser

### Community 183 - "Community 183"
Cohesion: 0.2
Nodes (1): XMLEncodeUtility

### Community 184 - "Community 184"
Cohesion: 0.33
Nodes (8): constructor(), execSyncAndLog(), getDefaultNPMLocation(), getTypesRegistryFileLocation(), handleRequest(), indent(), loadTypesRegistryFile(), sendResponse()

### Community 185 - "Community 185"
Cohesion: 0.4
Nodes (9): detect(), detectPackageManager(), getNameAndVer(), handlePackageManager(), installPackage(), isMetadataYarnClassic(), parsePackageJson(), pathExists() (+1 more)

### Community 186 - "Community 186"
Cohesion: 0.22
Nodes (3): createRuntimeRpc(), createSafeRpc(), MockDate

### Community 187 - "Community 187"
Cohesion: 0.22
Nodes (2): ensureBackendBinaryPrepared(), startBackend()

### Community 188 - "Community 188"
Cohesion: 0.24
Nodes (3): render(), scheduleRender(), updateBubbles()

### Community 189 - "Community 189"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 190 - "Community 190"
Cohesion: 0.36
Nodes (7): bucketMismatches(), parseBrowser(), parseNumberFlag(), parseOptionalNumberFlag(), parseOptions(), parseStringFlag(), printSummary()

### Community 191 - "Community 191"
Cohesion: 0.24
Nodes (3): parseNumberFlag(), parseOptionalNumberFlag(), parseStringFlag()

### Community 192 - "Community 192"
Cohesion: 0.22
Nodes (1): MediaList

### Community 193 - "Community 193"
Cohesion: 0.31
Nodes (1): CustomElementRegistry

### Community 194 - "Community 194"
Cohesion: 0.22
Nodes (1): DOMPointReadOnly

### Community 195 - "Community 195"
Cohesion: 0.25
Nodes (1): DataTransfer

### Community 196 - "Community 196"
Cohesion: 0.25
Nodes (1): Blob

### Community 197 - "Community 197"
Cohesion: 0.33
Nodes (1): FileReader

### Community 198 - "Community 198"
Cohesion: 0.28
Nodes (1): MediaQueryList

### Community 199 - "Community 199"
Cohesion: 0.22
Nodes (1): HTMLDialogElement

### Community 200 - "Community 200"
Cohesion: 0.22
Nodes (1): MediaStream

### Community 201 - "Community 201"
Cohesion: 0.22
Nodes (1): TextTrackList

### Community 202 - "Community 202"
Cohesion: 0.22
Nodes (1): TimeRanges

### Community 203 - "Community 203"
Cohesion: 0.22
Nodes (1): HTMLMeterElement

### Community 204 - "Community 204"
Cohesion: 0.22
Nodes (1): HTMLSourceElement

### Community 205 - "Community 205"
Cohesion: 0.22
Nodes (1): HTMLStyleElement

### Community 206 - "Community 206"
Cohesion: 0.22
Nodes (1): SVGComponentTransferFunctionElement

### Community 207 - "Community 207"
Cohesion: 0.22
Nodes (1): SVGFEBlendElement

### Community 208 - "Community 208"
Cohesion: 0.22
Nodes (1): SVGFilterElement

### Community 209 - "Community 209"
Cohesion: 0.22
Nodes (1): Storage

### Community 210 - "Community 210"
Cohesion: 0.22
Nodes (1): SVGAngle

### Community 211 - "Community 211"
Cohesion: 0.22
Nodes (1): SVGLength

### Community 212 - "Community 212"
Cohesion: 0.22
Nodes (1): XMLHttpRequestEventTarget

### Community 213 - "Community 213"
Cohesion: 0.22
Nodes (8): AutoImportProviderProject, ConfiguredProject, ExternalProject, InferredProject, OperationCanceledException, ProjectService, ScriptInfo, Session

### Community 214 - "Community 214"
Cohesion: 0.28
Nodes (4): EnvironmentTeardownError, getWorkerState(), waitForImportsToResolve(), waitNextTick()

### Community 215 - "Community 215"
Cohesion: 0.28
Nodes (4): New-ManagedProcess(), New-StreamState(), Read-NewLogLines(), Write-ManagedProcessLogs()

### Community 216 - "Community 216"
Cohesion: 0.31
Nodes (6): getBrowserLines(), publishReport(), render(), runSweep(), toNavigationReport(), withRequestId()

### Community 217 - "Community 217"
Cohesion: 0.31
Nodes (5): canReachServer(), formatDiff(), printReport(), sleep(), waitForServer()

### Community 218 - "Community 218"
Cohesion: 0.25
Nodes (7): Dir, Dirent, ReadStream, Stats, StatsFs, Utf8Stream, WriteStream

### Community 219 - "Community 219"
Cohesion: 0.25
Nodes (1): CSSRule

### Community 220 - "Community 220"
Cohesion: 0.39
Nodes (1): CSSStyleDeclarationComputedStyle

### Community 221 - "Community 221"
Cohesion: 0.25
Nodes (1): CSSGroupingRule

### Community 222 - "Community 222"
Cohesion: 0.25
Nodes (1): MessagePort

### Community 223 - "Community 223"
Cohesion: 0.36
Nodes (1): FetchRequestReferrerUtility

### Community 224 - "Community 224"
Cohesion: 0.25
Nodes (1): FetchRequestValidationUtility

### Community 225 - "Community 225"
Cohesion: 0.25
Nodes (1): DocumentType

### Community 226 - "Community 226"
Cohesion: 0.57
Nodes (2): HTMLInputElementValueSanitizer, parseInts()

### Community 227 - "Community 227"
Cohesion: 0.25
Nodes (1): HTMLTableCellElement

### Community 228 - "Community 228"
Cohesion: 0.25
Nodes (1): SVGAnimationElement

### Community 229 - "Community 229"
Cohesion: 0.25
Nodes (1): SVGFEComponentTransferElement

### Community 230 - "Community 230"
Cohesion: 0.25
Nodes (1): SVGFETileElement

### Community 231 - "Community 231"
Cohesion: 0.25
Nodes (1): SVGMaskElement

### Community 232 - "Community 232"
Cohesion: 0.25
Nodes (1): SVGRectElement

### Community 233 - "Community 233"
Cohesion: 0.36
Nodes (1): QuerySelector

### Community 234 - "Community 234"
Cohesion: 0.25
Nodes (1): NodeIterator

### Community 235 - "Community 235"
Cohesion: 0.57
Nodes (7): createProject(), installTarball(), packPackage(), run(), smokeJavaScriptEsm(), smokeTypeScript(), tscBinaryName()

### Community 236 - "Community 236"
Cohesion: 0.39
Nodes (6): buildProbeUrl(), parseNumberFlag(), parseStringFlag(), printCaseResult(), reportIsExact(), runBrowser()

### Community 237 - "Community 237"
Cohesion: 0.29
Nodes (6): Agent, ClientRequest, IncomingMessage, OutgoingMessage, Server, ServerResponse

### Community 238 - "Community 238"
Cohesion: 0.29
Nodes (6): Duplex, PassThrough, Readable, Stream, Transform, Writable

### Community 239 - "Community 239"
Cohesion: 0.29
Nodes (1): BrowserContext

### Community 240 - "Community 240"
Cohesion: 0.29
Nodes (1): DetachedBrowserContext

### Community 241 - "Community 241"
Cohesion: 0.52
Nodes (1): BrowserFrameNavigator

### Community 242 - "Community 242"
Cohesion: 0.29
Nodes (1): Clipboard

### Community 243 - "Community 243"
Cohesion: 0.33
Nodes (1): CSSStyleSheet

### Community 244 - "Community 244"
Cohesion: 0.29
Nodes (1): CSSStyleRule

### Community 245 - "Community 245"
Cohesion: 0.29
Nodes (1): DOMRect

### Community 246 - "Community 246"
Cohesion: 0.43
Nodes (1): MultipartReader

### Community 247 - "Community 247"
Cohesion: 0.29
Nodes (1): IntersectionObserver

### Community 248 - "Community 248"
Cohesion: 0.33
Nodes (1): MutationObserver

### Community 249 - "Community 249"
Cohesion: 0.29
Nodes (1): PluginArray

### Community 250 - "Community 250"
Cohesion: 0.29
Nodes (1): CharacterDataUtility

### Community 251 - "Community 251"
Cohesion: 0.29
Nodes (1): DocumentReadyStateManager

### Community 252 - "Community 252"
Cohesion: 0.38
Nodes (1): HTMLDetailsElement

### Community 253 - "Community 253"
Cohesion: 0.29
Nodes (1): HTMLLabelElement

### Community 254 - "Community 254"
Cohesion: 0.29
Nodes (1): HTMLTableRowElement

### Community 255 - "Community 255"
Cohesion: 0.29
Nodes (1): SVGFEFloodElement

### Community 256 - "Community 256"
Cohesion: 0.29
Nodes (1): SVGFEMergeElement

### Community 257 - "Community 257"
Cohesion: 0.29
Nodes (1): SVGGeometryElement

### Community 258 - "Community 258"
Cohesion: 0.29
Nodes (1): SVGRadialGradientElement

### Community 259 - "Community 259"
Cohesion: 0.29
Nodes (1): SVGTextPositioningElement

### Community 260 - "Community 260"
Cohesion: 0.29
Nodes (1): SVGUseElement

### Community 261 - "Community 261"
Cohesion: 0.29
Nodes (1): SVGRect

### Community 262 - "Community 262"
Cohesion: 0.33
Nodes (2): getTestRunnerConstructor(), resolveTestRunner()

### Community 263 - "Community 263"
Cohesion: 0.29
Nodes (0): 

### Community 264 - "Community 264"
Cohesion: 0.29
Nodes (0): 

### Community 265 - "Community 265"
Cohesion: 0.29
Nodes (0): 

### Community 266 - "Community 266"
Cohesion: 0.29
Nodes (0): 

### Community 267 - "Community 267"
Cohesion: 0.43
Nodes (3): collectWrapMetrics(), computeBubbleRender(), findTightWrapMetrics()

### Community 268 - "Community 268"
Cohesion: 0.38
Nodes (3): render(), renderBody(), scheduleRender()

### Community 269 - "Community 269"
Cohesion: 0.29
Nodes (0): 

### Community 270 - "Community 270"
Cohesion: 0.33
Nodes (5): DefaultDeserializer, DefaultSerializer, Deserializer, GCProfiler, Serializer

### Community 271 - "Community 271"
Cohesion: 0.53
Nodes (1): VirtualConsoleLogEntryStringifier

### Community 272 - "Community 272"
Cohesion: 0.33
Nodes (1): CSSKeyframeRule

### Community 273 - "Community 273"
Cohesion: 0.33
Nodes (1): CSSMediaRule

### Community 274 - "Community 274"
Cohesion: 0.33
Nodes (1): CSSScopeRule

### Community 275 - "Community 275"
Cohesion: 0.33
Nodes (1): StylePropertyMap

### Community 276 - "Community 276"
Cohesion: 0.33
Nodes (1): DOMPoint

### Community 277 - "Community 277"
Cohesion: 0.33
Nodes (1): DOMImplementation

### Community 278 - "Community 278"
Cohesion: 0.47
Nodes (1): ResponseCache

### Community 279 - "Community 279"
Cohesion: 0.47
Nodes (1): JavaScriptCompiler

### Community 280 - "Community 280"
Cohesion: 0.33
Nodes (1): MutationObserverListener

### Community 281 - "Community 281"
Cohesion: 0.33
Nodes (1): MimeTypeArray

### Community 282 - "Community 282"
Cohesion: 0.33
Nodes (1): Plugin

### Community 283 - "Community 283"
Cohesion: 0.33
Nodes (1): ChildNodeUtility

### Community 284 - "Community 284"
Cohesion: 0.33
Nodes (1): CanvasCaptureMediaStreamTrack

### Community 285 - "Community 285"
Cohesion: 0.33
Nodes (1): OffscreenCanvas

### Community 286 - "Community 286"
Cohesion: 0.33
Nodes (1): HTMLEmbedElement

### Community 287 - "Community 287"
Cohesion: 0.33
Nodes (1): RemotePlayback

### Community 288 - "Community 288"
Cohesion: 0.33
Nodes (1): TextTrackCue

### Community 289 - "Community 289"
Cohesion: 0.33
Nodes (1): HTMLMetaElement

### Community 290 - "Community 290"
Cohesion: 0.33
Nodes (1): HTMLProgressElement

### Community 291 - "Community 291"
Cohesion: 0.33
Nodes (1): HTMLOptionsCollection

### Community 292 - "Community 292"
Cohesion: 0.33
Nodes (1): SVGEllipseElement

### Community 293 - "Community 293"
Cohesion: 0.33
Nodes (1): SVGForeignObjectElement

### Community 294 - "Community 294"
Cohesion: 0.33
Nodes (1): SVGGradientElement

### Community 295 - "Community 295"
Cohesion: 0.33
Nodes (1): SVGLineElement

### Community 296 - "Community 296"
Cohesion: 0.33
Nodes (1): SVGLinearGradientElement

### Community 297 - "Community 297"
Cohesion: 0.33
Nodes (1): SVGTextPathElement

### Community 298 - "Community 298"
Cohesion: 0.4
Nodes (1): RangeUtility

### Community 299 - "Community 299"
Cohesion: 0.53
Nodes (1): XMLSerializer

### Community 300 - "Community 300"
Cohesion: 0.4
Nodes (2): createLoadHook(), setupNodeLoaderHooks()

### Community 301 - "Community 301"
Cohesion: 0.4
Nodes (2): n(), u()

### Community 302 - "Community 302"
Cohesion: 0.33
Nodes (0): 

### Community 303 - "Community 303"
Cohesion: 0.47
Nodes (3): parseNumberFlag(), parseStringFlag(), requireFlag()

### Community 304 - "Community 304"
Cohesion: 0.47
Nodes (3): getHashParams(), readNavigationPhaseState(), readNavigationReportText()

### Community 305 - "Community 305"
Cohesion: 0.4
Nodes (4): Interface, Readline, Resolver, Session

### Community 306 - "Community 306"
Cohesion: 0.4
Nodes (4): BlockList, Server, Socket, SocketAddress

### Community 307 - "Community 307"
Cohesion: 0.4
Nodes (4): QuicEndpoint, QuicSession, QuicStream, Stats

### Community 308 - "Community 308"
Cohesion: 0.4
Nodes (4): Module, Script, SourceTextModule, SyntheticModule

### Community 309 - "Community 309"
Cohesion: 0.5
Nodes (1): BrowserPageUtility

### Community 310 - "Community 310"
Cohesion: 0.4
Nodes (1): ClipboardItem

### Community 311 - "Community 311"
Cohesion: 0.4
Nodes (1): CookieContainer

### Community 312 - "Community 312"
Cohesion: 0.4
Nodes (1): CSSFontFaceRule

### Community 313 - "Community 313"
Cohesion: 0.5
Nodes (1): CSSParser

### Community 314 - "Community 314"
Cohesion: 0.4
Nodes (1): DataTransferItem

### Community 315 - "Community 315"
Cohesion: 0.4
Nodes (1): DataTransferItemList

### Community 316 - "Community 316"
Cohesion: 0.4
Nodes (1): CustomEvent

### Community 317 - "Community 317"
Cohesion: 0.5
Nodes (1): PreflightResponseCache

### Community 318 - "Community 318"
Cohesion: 0.5
Nodes (1): MultipartFormDataParser

### Community 319 - "Community 319"
Cohesion: 0.4
Nodes (1): ResourceFetch

### Community 320 - "Community 320"
Cohesion: 0.5
Nodes (1): HistoryItemList

### Community 321 - "Community 321"
Cohesion: 0.5
Nodes (1): HTMLSerializer

### Community 322 - "Community 322"
Cohesion: 0.5
Nodes (1): ModuleFactory

### Community 323 - "Community 323"
Cohesion: 0.4
Nodes (1): Comment

### Community 324 - "Community 324"
Cohesion: 0.4
Nodes (1): HTMLBaseElement

### Community 325 - "Community 325"
Cohesion: 0.4
Nodes (1): HTMLDocument

### Community 326 - "Community 326"
Cohesion: 0.6
Nodes (1): HTMLElementUtility

### Community 327 - "Community 327"
Cohesion: 0.4
Nodes (1): FileList

### Community 328 - "Community 328"
Cohesion: 0.4
Nodes (1): HTMLOListElement

### Community 329 - "Community 329"
Cohesion: 0.4
Nodes (1): SVGCircleElement

### Community 330 - "Community 330"
Cohesion: 0.4
Nodes (1): SVGFEPointLightElement

### Community 331 - "Community 331"
Cohesion: 0.4
Nodes (1): ResizeObserver

### Community 332 - "Community 332"
Cohesion: 0.4
Nodes (1): SVGAnimatedAngle

### Community 333 - "Community 333"
Cohesion: 0.4
Nodes (1): SVGAnimatedBoolean

### Community 334 - "Community 334"
Cohesion: 0.4
Nodes (1): SVGAnimatedEnumeration

### Community 335 - "Community 335"
Cohesion: 0.4
Nodes (1): SVGAnimatedInteger

### Community 336 - "Community 336"
Cohesion: 0.4
Nodes (1): SVGAnimatedLength

### Community 337 - "Community 337"
Cohesion: 0.4
Nodes (1): SVGAnimatedLengthList

### Community 338 - "Community 338"
Cohesion: 0.4
Nodes (1): SVGAnimatedNumber

### Community 339 - "Community 339"
Cohesion: 0.4
Nodes (1): SVGAnimatedNumberList

### Community 340 - "Community 340"
Cohesion: 0.4
Nodes (1): SVGAnimatedPreserveAspectRatio

### Community 341 - "Community 341"
Cohesion: 0.4
Nodes (1): SVGAnimatedRect

### Community 342 - "Community 342"
Cohesion: 0.4
Nodes (1): SVGAnimatedString

### Community 343 - "Community 343"
Cohesion: 0.4
Nodes (1): SVGAnimatedTransformList

### Community 344 - "Community 344"
Cohesion: 0.4
Nodes (1): SVGPoint

### Community 345 - "Community 345"
Cohesion: 0.4
Nodes (1): SVGPreserveAspectRatio

### Community 346 - "Community 346"
Cohesion: 0.4
Nodes (1): ClassMethodBinder

### Community 347 - "Community 347"
Cohesion: 0.4
Nodes (1): StringScriptSnapshot

### Community 348 - "Community 348"
Cohesion: 0.4
Nodes (0): 

### Community 349 - "Community 349"
Cohesion: 0.4
Nodes (0): 

### Community 350 - "Community 350"
Cohesion: 0.5
Nodes (2): isBuiltin(), isNodeBuiltin()

### Community 351 - "Community 351"
Cohesion: 0.7
Nodes (4): devToolsAdapter(), getDevTools(), getGlobal(), registerService()

### Community 352 - "Community 352"
Cohesion: 0.7
Nodes (4): devToolsAdapter(), getDevTools(), getGlobal(), registerService()

### Community 353 - "Community 353"
Cohesion: 0.7
Nodes (4): devToolsAdapter(), getDevTools(), getGlobal(), registerService()

### Community 354 - "Community 354"
Cohesion: 0.7
Nodes (4): devToolsAdapter(), getDevTools(), getGlobal(), registerService()

### Community 355 - "Community 355"
Cohesion: 0.5
Nodes (2): layoutRichInlineItems(), layoutRichNote()

### Community 356 - "Community 356"
Cohesion: 0.7
Nodes (4): clearNavigationReport(), publishNavigationPhase(), publishNavigationReport(), replaceNavigationHash()

### Community 357 - "Community 357"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 358 - "Community 358"
Cohesion: 0.7
Nodes (4): moveBuiltHtml(), rebaseRelativeAssetUrls(), resolveBuiltHtmlPath(), rewriteDemoLinksForStaticRoot()

### Community 359 - "Community 359"
Cohesion: 0.5
Nodes (2): parseNumberFlag(), parseStringFlag()

### Community 360 - "Community 360"
Cohesion: 0.4
Nodes (0): 

### Community 361 - "Community 361"
Cohesion: 0.5
Nodes (1): Base64

### Community 362 - "Community 362"
Cohesion: 0.67
Nodes (1): BrowserSettingsFactory

### Community 363 - "Community 363"
Cohesion: 0.5
Nodes (1): BrowserExceptionObserver

### Community 364 - "Community 364"
Cohesion: 0.5
Nodes (1): BrowserFrameFactory

### Community 365 - "Community 365"
Cohesion: 0.67
Nodes (1): BrowserFrameScriptEvaluator

### Community 366 - "Community 366"
Cohesion: 0.5
Nodes (1): CookieStringUtility

### Community 367 - "Community 367"
Cohesion: 0.5
Nodes (1): CSS

### Community 368 - "Community 368"
Cohesion: 0.67
Nodes (1): CSSMeasurementConverter

### Community 369 - "Community 369"
Cohesion: 0.5
Nodes (1): CSSStyleDeclarationValueUtility

### Community 370 - "Community 370"
Cohesion: 0.5
Nodes (1): CSSConditionRule

### Community 371 - "Community 371"
Cohesion: 0.5
Nodes (1): CSSContainerRule

### Community 372 - "Community 372"
Cohesion: 0.5
Nodes (1): CSSSupportsRule

### Community 373 - "Community 373"
Cohesion: 0.5
Nodes (1): CSSKeywordValue

### Community 374 - "Community 374"
Cohesion: 0.5
Nodes (1): CSSStyleValue

### Community 375 - "Community 375"
Cohesion: 0.5
Nodes (1): CustomElementReactionStack

### Community 376 - "Community 376"
Cohesion: 0.5
Nodes (1): DOMRectList

### Community 377 - "Community 377"
Cohesion: 0.5
Nodes (1): DOMStringMapUtility

### Community 378 - "Community 378"
Cohesion: 0.5
Nodes (1): KeyboardEvent

### Community 379 - "Community 379"
Cohesion: 0.5
Nodes (1): PreloadEntry

### Community 380 - "Community 380"
Cohesion: 0.5
Nodes (1): FetchResponseRedirectUtility

### Community 381 - "Community 381"
Cohesion: 0.5
Nodes (1): MimeType

### Community 382 - "Community 382"
Cohesion: 0.5
Nodes (1): NonDocumentChildNodeUtility

### Community 383 - "Community 383"
Cohesion: 0.5
Nodes (1): ImageBitmap

### Community 384 - "Community 384"
Cohesion: 0.5
Nodes (1): HTMLFormControlsCollection

### Community 385 - "Community 385"
Cohesion: 0.5
Nodes (1): HTMLInputElementDateUtility

### Community 386 - "Community 386"
Cohesion: 0.67
Nodes (1): HTMLInputElementValueStepping

### Community 387 - "Community 387"
Cohesion: 0.5
Nodes (1): HTMLMapElement

### Community 388 - "Community 388"
Cohesion: 0.5
Nodes (1): TextTrackCueList

### Community 389 - "Community 389"
Cohesion: 0.5
Nodes (1): VTTCue

### Community 390 - "Community 390"
Cohesion: 0.5
Nodes (1): HTMLModElement

### Community 391 - "Community 391"
Cohesion: 0.5
Nodes (1): HTMLOptGroupElement

### Community 392 - "Community 392"
Cohesion: 0.5
Nodes (1): HTMLTableSectionElement

### Community 393 - "Community 393"
Cohesion: 0.5
Nodes (1): HTMLTitleElement

### Community 394 - "Community 394"
Cohesion: 0.5
Nodes (1): NodeFactory

### Community 395 - "Community 395"
Cohesion: 0.5
Nodes (1): SVGFEDistantLightElement

### Community 396 - "Community 396"
Cohesion: 0.5
Nodes (1): SVGPolygonElement

### Community 397 - "Community 397"
Cohesion: 0.5
Nodes (1): SVGPolylineElement

### Community 398 - "Community 398"
Cohesion: 0.5
Nodes (1): SVGScriptElement

### Community 399 - "Community 399"
Cohesion: 0.5
Nodes (1): Permissions

### Community 400 - "Community 400"
Cohesion: 0.5
Nodes (1): SVGNumber

### Community 401 - "Community 401"
Cohesion: 0.5
Nodes (1): StringUtility

### Community 402 - "Community 402"
Cohesion: 0.5
Nodes (1): GlobalWindow

### Community 403 - "Community 403"
Cohesion: 0.83
Nodes (3): closeInspector(), setupInspect(), shouldKeepOpen()

### Community 404 - "Community 404"
Cohesion: 0.5
Nodes (1): NativeModuleRunner

### Community 405 - "Community 405"
Cohesion: 0.5
Nodes (1): VitestNodeSnapshotEnvironment

### Community 406 - "Community 406"
Cohesion: 0.67
Nodes (2): ensureModuleGraphEntry(), resolve()

### Community 407 - "Community 407"
Cohesion: 0.83
Nodes (3): assign(), createSpawner(), resolveAssign()

### Community 408 - "Community 408"
Cohesion: 0.83
Nodes (3): assign(), createSpawner(), resolveAssign()

### Community 409 - "Community 409"
Cohesion: 0.83
Nodes (3): assign(), createSpawner(), resolveAssign()

### Community 410 - "Community 410"
Cohesion: 0.83
Nodes (3): assign(), createSpawner(), resolveAssign()

### Community 411 - "Community 411"
Cohesion: 0.83
Nodes (3): render(), scheduleCssOverlaySync(), scheduleRender()

### Community 412 - "Community 412"
Cohesion: 0.83
Nodes (3): classifyChar(), computeBidiLevels(), computeSegmentLevels()

### Community 413 - "Community 413"
Cohesion: 0.67
Nodes (2): AsyncLocalStorage, AsyncResource

### Community 414 - "Community 414"
Cohesion: 0.67
Nodes (2): Channel, TracingChannel

### Community 415 - "Community 415"
Cohesion: 0.67
Nodes (2): EventEmitter, EventEmitterAsyncResource

### Community 416 - "Community 416"
Cohesion: 0.67
Nodes (2): Http2ServerRequest, Http2ServerResponse

### Community 417 - "Community 417"
Cohesion: 0.67
Nodes (2): Agent, Server

### Community 418 - "Community 418"
Cohesion: 0.67
Nodes (2): Module, SourceMap

### Community 419 - "Community 419"
Cohesion: 0.67
Nodes (2): Recoverable, REPLServer

### Community 420 - "Community 420"
Cohesion: 0.67
Nodes (2): DatabaseSync, StatementSync

### Community 421 - "Community 421"
Cohesion: 0.67
Nodes (1): MockPropertyContext

### Community 422 - "Community 422"
Cohesion: 0.67
Nodes (2): Server, TLSSocket

### Community 423 - "Community 423"
Cohesion: 0.67
Nodes (2): ReadStream, WriteStream

### Community 424 - "Community 424"
Cohesion: 0.67
Nodes (2): MIMEParams, MIMEType

### Community 425 - "Community 425"
Cohesion: 0.67
Nodes (1): AsyncTaskManagerDebugError

### Community 426 - "Community 426"
Cohesion: 0.67
Nodes (1): CookieExpireUtility

### Community 427 - "Community 427"
Cohesion: 0.67
Nodes (1): CookieURLUtility

### Community 428 - "Community 428"
Cohesion: 0.67
Nodes (1): CSSUnitValue

### Community 429 - "Community 429"
Cohesion: 0.67
Nodes (1): CSSStyleDeclarationCSSParser

### Community 430 - "Community 430"
Cohesion: 0.67
Nodes (1): CSSEscaper

### Community 431 - "Community 431"
Cohesion: 0.67
Nodes (1): CustomElementUtility

### Community 432 - "Community 432"
Cohesion: 0.67
Nodes (1): DOMStringMap

### Community 433 - "Community 433"
Cohesion: 0.67
Nodes (1): DOMParser

### Community 434 - "Community 434"
Cohesion: 0.67
Nodes (1): AnimationEvent

### Community 435 - "Community 435"
Cohesion: 0.67
Nodes (1): ClipboardEvent

### Community 436 - "Community 436"
Cohesion: 0.67
Nodes (1): CloseEvent

### Community 437 - "Community 437"
Cohesion: 0.67
Nodes (1): ErrorEvent

### Community 438 - "Community 438"
Cohesion: 0.67
Nodes (1): FocusEvent

### Community 439 - "Community 439"
Cohesion: 0.67
Nodes (1): HashChangeEvent

### Community 440 - "Community 440"
Cohesion: 0.67
Nodes (1): InputEvent

### Community 441 - "Community 441"
Cohesion: 0.67
Nodes (1): MediaQueryListEvent

### Community 442 - "Community 442"
Cohesion: 0.67
Nodes (1): MediaStreamTrackEvent

### Community 443 - "Community 443"
Cohesion: 0.67
Nodes (1): MessageEvent

### Community 444 - "Community 444"
Cohesion: 0.67
Nodes (1): MouseEvent

### Community 445 - "Community 445"
Cohesion: 0.67
Nodes (1): PointerEvent

### Community 446 - "Community 446"
Cohesion: 0.67
Nodes (1): PopStateEvent

### Community 447 - "Community 447"
Cohesion: 0.67
Nodes (1): ProgressEvent

### Community 448 - "Community 448"
Cohesion: 0.67
Nodes (1): StorageEvent

### Community 449 - "Community 449"
Cohesion: 0.67
Nodes (1): SubmitEvent

### Community 450 - "Community 450"
Cohesion: 0.67
Nodes (1): TouchEvent

### Community 451 - "Community 451"
Cohesion: 0.67
Nodes (1): WheelEvent

### Community 452 - "Community 452"
Cohesion: 0.67
Nodes (1): Touch

### Community 453 - "Community 453"
Cohesion: 0.67
Nodes (1): UIEvent

### Community 454 - "Community 454"
Cohesion: 0.67
Nodes (1): DOMException

### Community 455 - "Community 455"
Cohesion: 0.67
Nodes (1): AbortController

### Community 456 - "Community 456"
Cohesion: 0.67
Nodes (1): DataURIParser

### Community 457 - "Community 457"
Cohesion: 0.67
Nodes (1): PreloadUtility

### Community 458 - "Community 458"
Cohesion: 0.67
Nodes (1): FetchResponseHeaderUtility

### Community 459 - "Community 459"
Cohesion: 0.67
Nodes (1): SyncFetchScriptBuilder

### Community 460 - "Community 460"
Cohesion: 0.67
Nodes (1): File

### Community 461 - "Community 461"
Cohesion: 0.67
Nodes (1): IntersectionObserverEntry

### Community 462 - "Community 462"
Cohesion: 0.67
Nodes (1): MediaQueryParser

### Community 463 - "Community 463"
Cohesion: 0.67
Nodes (1): MutationRecord

### Community 464 - "Community 464"
Cohesion: 0.67
Nodes (1): ElementEventAttributeUtility

### Community 465 - "Community 465"
Cohesion: 0.67
Nodes (1): NamedNodeMapProxyFactory

### Community 466 - "Community 466"
Cohesion: 0.67
Nodes (1): Audio

### Community 467 - "Community 467"
Cohesion: 0.67
Nodes (1): HTMLDataElement

### Community 468 - "Community 468"
Cohesion: 0.67
Nodes (1): HTMLDataListElement

### Community 469 - "Community 469"
Cohesion: 0.67
Nodes (1): RadioNodeList

### Community 470 - "Community 470"
Cohesion: 0.67
Nodes (1): Image

### Community 471 - "Community 471"
Cohesion: 0.67
Nodes (1): HTMLLabelElementUtility

### Community 472 - "Community 472"
Cohesion: 0.67
Nodes (1): HTMLLegendElement

### Community 473 - "Community 473"
Cohesion: 0.67
Nodes (1): HTMLLIElement

### Community 474 - "Community 474"
Cohesion: 0.67
Nodes (1): HTMLQuoteElement

### Community 475 - "Community 475"
Cohesion: 0.67
Nodes (1): HTMLTimeElement

### Community 476 - "Community 476"
Cohesion: 0.67
Nodes (1): ProcessingInstruction

### Community 477 - "Community 477"
Cohesion: 0.67
Nodes (1): SVGClipPathElement

### Community 478 - "Community 478"
Cohesion: 0.67
Nodes (1): SVGFEMergeNodeElement

### Community 479 - "Community 479"
Cohesion: 0.67
Nodes (1): SVGMPathElement

### Community 480 - "Community 480"
Cohesion: 0.67
Nodes (1): SVGStopElement

### Community 481 - "Community 481"
Cohesion: 0.67
Nodes (1): PermissionStatus

### Community 482 - "Community 482"
Cohesion: 0.67
Nodes (1): ScreenDetails

### Community 483 - "Community 483"
Cohesion: 0.67
Nodes (1): SVGUnitTypes

### Community 484 - "Community 484"
Cohesion: 0.67
Nodes (1): AttributeUtility

### Community 485 - "Community 485"
Cohesion: 0.67
Nodes (1): Window

### Community 486 - "Community 486"
Cohesion: 0.67
Nodes (1): WindowContextClassExtender

### Community 487 - "Community 487"
Cohesion: 0.67
Nodes (1): XMLHttpRequestResponseDataParser

### Community 488 - "Community 488"
Cohesion: 0.67
Nodes (2): SafeArray, VarDate

### Community 489 - "Community 489"
Cohesion: 0.67
Nodes (0): 

### Community 490 - "Community 490"
Cohesion: 0.67
Nodes (1): VitestEvaluatedModules

### Community 491 - "Community 491"
Cohesion: 0.67
Nodes (0): 

### Community 492 - "Community 492"
Cohesion: 0.67
Nodes (0): 

### Community 493 - "Community 493"
Cohesion: 1.0
Nodes (2): n(), t()

### Community 494 - "Community 494"
Cohesion: 1.0
Nodes (1): AssertionError

### Community 495 - "Community 495"
Cohesion: 1.0
Nodes (1): ChildProcess

### Community 496 - "Community 496"
Cohesion: 1.0
Nodes (1): Worker

### Community 497 - "Community 497"
Cohesion: 1.0
Nodes (1): Socket

### Community 498 - "Community 498"
Cohesion: 1.0
Nodes (1): Resolver

### Community 499 - "Community 499"
Cohesion: 1.0
Nodes (1): Domain

### Community 500 - "Community 500"
Cohesion: 1.0
Nodes (1): Session

### Community 501 - "Community 501"
Cohesion: 1.0
Nodes (1): PerformanceNodeEntry

### Community 502 - "Community 502"
Cohesion: 1.0
Nodes (1): Interface

### Community 503 - "Community 503"
Cohesion: 1.0
Nodes (1): StringDecoder

### Community 504 - "Community 504"
Cohesion: 1.0
Nodes (1): WASI

### Community 505 - "Community 505"
Cohesion: 1.0
Nodes (1): DOMException

### Community 506 - "Community 506"
Cohesion: 1.0
Nodes (1): Storage

### Community 507 - "Community 507"
Cohesion: 1.0
Nodes (1): Worker

### Community 508 - "Community 508"
Cohesion: 1.0
Nodes (1): AsyncTaskManager

### Community 509 - "Community 509"
Cohesion: 1.0
Nodes (1): AsyncTaskManagerDebugError

### Community 510 - "Community 510"
Cohesion: 1.0
Nodes (1): Base64

### Community 511 - "Community 511"
Cohesion: 1.0
Nodes (1): BrowserContext

### Community 512 - "Community 512"
Cohesion: 1.0
Nodes (1): BrowserFrame

### Community 513 - "Community 513"
Cohesion: 1.0
Nodes (1): BrowserPage

### Community 514 - "Community 514"
Cohesion: 1.0
Nodes (1): BrowserSettingsFactory

### Community 515 - "Community 515"
Cohesion: 1.0
Nodes (1): DetachedBrowser

### Community 516 - "Community 516"
Cohesion: 1.0
Nodes (1): DetachedBrowserContext

### Community 517 - "Community 517"
Cohesion: 1.0
Nodes (1): DetachedBrowserFrame

### Community 518 - "Community 518"
Cohesion: 1.0
Nodes (1): DetachedBrowserPage

### Community 519 - "Community 519"
Cohesion: 1.0
Nodes (1): BrowserExceptionObserver

### Community 520 - "Community 520"
Cohesion: 1.0
Nodes (1): BrowserFrameFactory

### Community 521 - "Community 521"
Cohesion: 1.0
Nodes (1): BrowserFrameNavigator

### Community 522 - "Community 522"
Cohesion: 1.0
Nodes (1): BrowserFrameScriptEvaluator

### Community 523 - "Community 523"
Cohesion: 1.0
Nodes (1): BrowserPageUtility

### Community 524 - "Community 524"
Cohesion: 1.0
Nodes (1): Clipboard

### Community 525 - "Community 525"
Cohesion: 1.0
Nodes (1): ClipboardItem

### Community 526 - "Community 526"
Cohesion: 1.0
Nodes (1): VirtualConsoleLogEntryStringifier

### Community 527 - "Community 527"
Cohesion: 1.0
Nodes (1): VirtualConsole

### Community 528 - "Community 528"
Cohesion: 1.0
Nodes (1): VirtualConsolePrinter

### Community 529 - "Community 529"
Cohesion: 1.0
Nodes (1): CookieContainer

### Community 530 - "Community 530"
Cohesion: 1.0
Nodes (1): CookieExpireUtility

### Community 531 - "Community 531"
Cohesion: 1.0
Nodes (1): CookieStringUtility

### Community 532 - "Community 532"
Cohesion: 1.0
Nodes (1): CookieURLUtility

### Community 533 - "Community 533"
Cohesion: 1.0
Nodes (1): CSS

### Community 534 - "Community 534"
Cohesion: 1.0
Nodes (1): CSSStyleSheet

### Community 535 - "Community 535"
Cohesion: 1.0
Nodes (1): CSSUnitValue

### Community 536 - "Community 536"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationComputedStyle

### Community 537 - "Community 537"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationCSSParser

### Community 538 - "Community 538"
Cohesion: 1.0
Nodes (1): CSSStyleDeclaration

### Community 539 - "Community 539"
Cohesion: 1.0
Nodes (1): CSSMeasurementConverter

### Community 540 - "Community 540"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationPropertyGetParser

### Community 541 - "Community 541"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationPropertyManager

### Community 542 - "Community 542"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationPropertySetParser

### Community 543 - "Community 543"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationValueParser

### Community 544 - "Community 544"
Cohesion: 1.0
Nodes (1): CSSStyleDeclarationValueUtility

### Community 545 - "Community 545"
Cohesion: 1.0
Nodes (1): MediaList

### Community 546 - "Community 546"
Cohesion: 1.0
Nodes (1): CSSContainerRule

### Community 547 - "Community 547"
Cohesion: 1.0
Nodes (1): CSSFontFaceRule

### Community 548 - "Community 548"
Cohesion: 1.0
Nodes (1): CSSKeyframeRule

### Community 549 - "Community 549"
Cohesion: 1.0
Nodes (1): CSSKeyframesRule

### Community 550 - "Community 550"
Cohesion: 1.0
Nodes (1): CSSMediaRule

### Community 551 - "Community 551"
Cohesion: 1.0
Nodes (1): CSSScopeRule

### Community 552 - "Community 552"
Cohesion: 1.0
Nodes (1): CSSStyleRule

### Community 553 - "Community 553"
Cohesion: 1.0
Nodes (1): CSSSupportsRule

### Community 554 - "Community 554"
Cohesion: 1.0
Nodes (1): CSSKeywordValue

### Community 555 - "Community 555"
Cohesion: 1.0
Nodes (1): CSSStyleValue

### Community 556 - "Community 556"
Cohesion: 1.0
Nodes (1): StylePropertyMap

### Community 557 - "Community 557"
Cohesion: 1.0
Nodes (1): StylePropertyMapReadOnly

### Community 558 - "Community 558"
Cohesion: 1.0
Nodes (1): CSSEscaper

### Community 559 - "Community 559"
Cohesion: 1.0
Nodes (1): CSSParser

### Community 560 - "Community 560"
Cohesion: 1.0
Nodes (1): CustomElementReactionStack

### Community 561 - "Community 561"
Cohesion: 1.0
Nodes (1): CustomElementRegistry

### Community 562 - "Community 562"
Cohesion: 1.0
Nodes (1): CustomElementUtility

### Community 563 - "Community 563"
Cohesion: 1.0
Nodes (1): DOMMatrix

### Community 564 - "Community 564"
Cohesion: 1.0
Nodes (1): DOMMatrixReadOnly

### Community 565 - "Community 565"
Cohesion: 1.0
Nodes (1): DOMPoint

### Community 566 - "Community 566"
Cohesion: 1.0
Nodes (1): DOMPointReadOnly

### Community 567 - "Community 567"
Cohesion: 1.0
Nodes (1): DOMRect

### Community 568 - "Community 568"
Cohesion: 1.0
Nodes (1): DOMRectList

### Community 569 - "Community 569"
Cohesion: 1.0
Nodes (1): DOMRectReadOnly

### Community 570 - "Community 570"
Cohesion: 1.0
Nodes (1): DOMStringMap

### Community 571 - "Community 571"
Cohesion: 1.0
Nodes (1): DOMStringMapUtility

### Community 572 - "Community 572"
Cohesion: 1.0
Nodes (1): DOMTokenList

### Community 573 - "Community 573"
Cohesion: 1.0
Nodes (1): DOMImplementation

### Community 574 - "Community 574"
Cohesion: 1.0
Nodes (1): DOMParser

### Community 575 - "Community 575"
Cohesion: 1.0
Nodes (1): DataTransfer

### Community 576 - "Community 576"
Cohesion: 1.0
Nodes (1): DataTransferItem

### Community 577 - "Community 577"
Cohesion: 1.0
Nodes (1): DataTransferItemList

### Community 578 - "Community 578"
Cohesion: 1.0
Nodes (1): Event

### Community 579 - "Community 579"
Cohesion: 1.0
Nodes (1): AnimationEvent

### Community 580 - "Community 580"
Cohesion: 1.0
Nodes (1): ClipboardEvent

### Community 581 - "Community 581"
Cohesion: 1.0
Nodes (1): CloseEvent

### Community 582 - "Community 582"
Cohesion: 1.0
Nodes (1): CustomEvent

### Community 583 - "Community 583"
Cohesion: 1.0
Nodes (1): ErrorEvent

### Community 584 - "Community 584"
Cohesion: 1.0
Nodes (1): FocusEvent

### Community 585 - "Community 585"
Cohesion: 1.0
Nodes (1): HashChangeEvent

### Community 586 - "Community 586"
Cohesion: 1.0
Nodes (1): InputEvent

### Community 587 - "Community 587"
Cohesion: 1.0
Nodes (1): KeyboardEvent

### Community 588 - "Community 588"
Cohesion: 1.0
Nodes (1): MediaQueryListEvent

### Community 589 - "Community 589"
Cohesion: 1.0
Nodes (1): MediaStreamTrackEvent

### Community 590 - "Community 590"
Cohesion: 1.0
Nodes (1): MessageEvent

### Community 591 - "Community 591"
Cohesion: 1.0
Nodes (1): MouseEvent

### Community 592 - "Community 592"
Cohesion: 1.0
Nodes (1): PointerEvent

### Community 593 - "Community 593"
Cohesion: 1.0
Nodes (1): PopStateEvent

### Community 594 - "Community 594"
Cohesion: 1.0
Nodes (1): ProgressEvent

### Community 595 - "Community 595"
Cohesion: 1.0
Nodes (1): StorageEvent

### Community 596 - "Community 596"
Cohesion: 1.0
Nodes (1): SubmitEvent

### Community 597 - "Community 597"
Cohesion: 1.0
Nodes (1): TouchEvent

### Community 598 - "Community 598"
Cohesion: 1.0
Nodes (1): WheelEvent

### Community 599 - "Community 599"
Cohesion: 1.0
Nodes (1): EventTarget

### Community 600 - "Community 600"
Cohesion: 1.0
Nodes (1): Touch

### Community 601 - "Community 601"
Cohesion: 1.0
Nodes (1): UIEvent

### Community 602 - "Community 602"
Cohesion: 1.0
Nodes (1): AbortController

### Community 603 - "Community 603"
Cohesion: 1.0
Nodes (1): AbortSignal

### Community 604 - "Community 604"
Cohesion: 1.0
Nodes (1): PreflightResponseCache

### Community 605 - "Community 605"
Cohesion: 1.0
Nodes (1): ResponseCache

### Community 606 - "Community 606"
Cohesion: 1.0
Nodes (1): ResponseCacheFileSystem

### Community 607 - "Community 607"
Cohesion: 1.0
Nodes (1): DataURIParser

### Community 608 - "Community 608"
Cohesion: 1.0
Nodes (1): Fetch

### Community 609 - "Community 609"
Cohesion: 1.0
Nodes (1): Headers

### Community 610 - "Community 610"
Cohesion: 1.0
Nodes (1): MultipartFormDataParser

### Community 611 - "Community 611"
Cohesion: 1.0
Nodes (1): MultipartReader

### Community 612 - "Community 612"
Cohesion: 1.0
Nodes (1): PreloadEntry

### Community 613 - "Community 613"
Cohesion: 1.0
Nodes (1): PreloadUtility

### Community 614 - "Community 614"
Cohesion: 1.0
Nodes (1): ResourceFetch

### Community 615 - "Community 615"
Cohesion: 1.0
Nodes (1): Response

### Community 616 - "Community 616"
Cohesion: 1.0
Nodes (1): SyncFetch

### Community 617 - "Community 617"
Cohesion: 1.0
Nodes (1): FetchBodyUtility

### Community 618 - "Community 618"
Cohesion: 1.0
Nodes (1): FetchRequestHeaderUtility

### Community 619 - "Community 619"
Cohesion: 1.0
Nodes (1): FetchRequestReferrerUtility

### Community 620 - "Community 620"
Cohesion: 1.0
Nodes (1): FetchRequestValidationUtility

### Community 621 - "Community 621"
Cohesion: 1.0
Nodes (1): FetchResponseHeaderUtility

### Community 622 - "Community 622"
Cohesion: 1.0
Nodes (1): FetchResponseRedirectUtility

### Community 623 - "Community 623"
Cohesion: 1.0
Nodes (1): SyncFetchScriptBuilder

### Community 624 - "Community 624"
Cohesion: 1.0
Nodes (1): VirtualServerUtility

### Community 625 - "Community 625"
Cohesion: 1.0
Nodes (1): Blob

### Community 626 - "Community 626"
Cohesion: 1.0
Nodes (1): File

### Community 627 - "Community 627"
Cohesion: 1.0
Nodes (1): FileReader

### Community 628 - "Community 628"
Cohesion: 1.0
Nodes (1): FormData

### Community 629 - "Community 629"
Cohesion: 1.0
Nodes (1): History

### Community 630 - "Community 630"
Cohesion: 1.0
Nodes (1): HistoryItemList

### Community 631 - "Community 631"
Cohesion: 1.0
Nodes (1): HTMLParser

### Community 632 - "Community 632"
Cohesion: 1.0
Nodes (1): HTMLSerializer

### Community 633 - "Community 633"
Cohesion: 1.0
Nodes (1): IntersectionObserver

### Community 634 - "Community 634"
Cohesion: 1.0
Nodes (1): IntersectionObserverEntry

### Community 635 - "Community 635"
Cohesion: 1.0
Nodes (1): JavaScriptCompiler

### Community 636 - "Community 636"
Cohesion: 1.0
Nodes (1): Location

### Community 637 - "Community 637"
Cohesion: 1.0
Nodes (1): MediaQueryItem

### Community 638 - "Community 638"
Cohesion: 1.0
Nodes (1): MediaQueryList

### Community 639 - "Community 639"
Cohesion: 1.0
Nodes (1): MediaQueryParser

### Community 640 - "Community 640"
Cohesion: 1.0
Nodes (1): ECMAScriptModuleCompiler

### Community 641 - "Community 641"
Cohesion: 1.0
Nodes (1): ModuleFactory

### Community 642 - "Community 642"
Cohesion: 1.0
Nodes (1): MutationObserver

### Community 643 - "Community 643"
Cohesion: 1.0
Nodes (1): MutationObserverListener

### Community 644 - "Community 644"
Cohesion: 1.0
Nodes (1): MutationRecord

### Community 645 - "Community 645"
Cohesion: 1.0
Nodes (1): MimeType

### Community 646 - "Community 646"
Cohesion: 1.0
Nodes (1): MimeTypeArray

### Community 647 - "Community 647"
Cohesion: 1.0
Nodes (1): Navigator

### Community 648 - "Community 648"
Cohesion: 1.0
Nodes (1): Plugin

### Community 649 - "Community 649"
Cohesion: 1.0
Nodes (1): PluginArray

### Community 650 - "Community 650"
Cohesion: 1.0
Nodes (1): Attr

### Community 651 - "Community 651"
Cohesion: 1.0
Nodes (1): CharacterDataUtility

### Community 652 - "Community 652"
Cohesion: 1.0
Nodes (1): ChildNodeUtility

### Community 653 - "Community 653"
Cohesion: 1.0
Nodes (1): NonDocumentChildNodeUtility

### Community 654 - "Community 654"
Cohesion: 1.0
Nodes (1): Comment

### Community 655 - "Community 655"
Cohesion: 1.0
Nodes (1): Document

### Community 656 - "Community 656"
Cohesion: 1.0
Nodes (1): DocumentReadyStateManager

### Community 657 - "Community 657"
Cohesion: 1.0
Nodes (1): DocumentFragment

### Community 658 - "Community 658"
Cohesion: 1.0
Nodes (1): DocumentType

### Community 659 - "Community 659"
Cohesion: 1.0
Nodes (1): Element

### Community 660 - "Community 660"
Cohesion: 1.0
Nodes (1): ElementEventAttributeUtility

### Community 661 - "Community 661"
Cohesion: 1.0
Nodes (1): HTMLCollection

### Community 662 - "Community 662"
Cohesion: 1.0
Nodes (1): NamedNodeMap

### Community 663 - "Community 663"
Cohesion: 1.0
Nodes (1): NamedNodeMapProxyFactory

### Community 664 - "Community 664"
Cohesion: 1.0
Nodes (1): HTMLAnchorElement

### Community 665 - "Community 665"
Cohesion: 1.0
Nodes (1): HTMLAreaElement

### Community 666 - "Community 666"
Cohesion: 1.0
Nodes (1): Audio

### Community 667 - "Community 667"
Cohesion: 1.0
Nodes (1): HTMLAudioElement

### Community 668 - "Community 668"
Cohesion: 1.0
Nodes (1): HTMLAudioElement

### Community 669 - "Community 669"
Cohesion: 1.0
Nodes (1): HTMLBaseElement

### Community 670 - "Community 670"
Cohesion: 1.0
Nodes (1): HTMLBodyElement

### Community 671 - "Community 671"
Cohesion: 1.0
Nodes (1): HTMLBRElement

### Community 672 - "Community 672"
Cohesion: 1.0
Nodes (1): HTMLBRElement

### Community 673 - "Community 673"
Cohesion: 1.0
Nodes (1): HTMLButtonElement

### Community 674 - "Community 674"
Cohesion: 1.0
Nodes (1): CanvasCaptureMediaStreamTrack

### Community 675 - "Community 675"
Cohesion: 1.0
Nodes (1): HTMLCanvasElement

### Community 676 - "Community 676"
Cohesion: 1.0
Nodes (1): ImageBitmap

### Community 677 - "Community 677"
Cohesion: 1.0
Nodes (1): OffscreenCanvas

### Community 678 - "Community 678"
Cohesion: 1.0
Nodes (1): HTMLDListElement

### Community 679 - "Community 679"
Cohesion: 1.0
Nodes (1): HTMLDListElement

### Community 680 - "Community 680"
Cohesion: 1.0
Nodes (1): HTMLDataElement

### Community 681 - "Community 681"
Cohesion: 1.0
Nodes (1): HTMLDataListElement

### Community 682 - "Community 682"
Cohesion: 1.0
Nodes (1): HTMLDetailsElement

### Community 683 - "Community 683"
Cohesion: 1.0
Nodes (1): HTMLDialogElement

### Community 684 - "Community 684"
Cohesion: 1.0
Nodes (1): HTMLDivElement

### Community 685 - "Community 685"
Cohesion: 1.0
Nodes (1): HTMLDivElement

### Community 686 - "Community 686"
Cohesion: 1.0
Nodes (1): HTMLDocument

### Community 687 - "Community 687"
Cohesion: 1.0
Nodes (1): HTMLElement

### Community 688 - "Community 688"
Cohesion: 1.0
Nodes (1): HTMLElementUtility

### Community 689 - "Community 689"
Cohesion: 1.0
Nodes (1): HTMLEmbedElement

### Community 690 - "Community 690"
Cohesion: 1.0
Nodes (1): HTMLFieldSetElement

### Community 691 - "Community 691"
Cohesion: 1.0
Nodes (1): HTMLFormControlsCollection

### Community 692 - "Community 692"
Cohesion: 1.0
Nodes (1): HTMLFormElement

### Community 693 - "Community 693"
Cohesion: 1.0
Nodes (1): RadioNodeList

### Community 694 - "Community 694"
Cohesion: 1.0
Nodes (1): HTMLHeadElement

### Community 695 - "Community 695"
Cohesion: 1.0
Nodes (1): HTMLHeadElement

### Community 696 - "Community 696"
Cohesion: 1.0
Nodes (1): HTMLHeadingElement

### Community 697 - "Community 697"
Cohesion: 1.0
Nodes (1): HTMLHeadingElement

### Community 698 - "Community 698"
Cohesion: 1.0
Nodes (1): HTMLHRElement

### Community 699 - "Community 699"
Cohesion: 1.0
Nodes (1): HTMLHRElement

### Community 700 - "Community 700"
Cohesion: 1.0
Nodes (1): HTMLHtmlElement

### Community 701 - "Community 701"
Cohesion: 1.0
Nodes (1): HTMLHtmlElement

### Community 702 - "Community 702"
Cohesion: 1.0
Nodes (1): HTMLHyperlinkElementUtility

### Community 703 - "Community 703"
Cohesion: 1.0
Nodes (1): HTMLIFrameElement

### Community 704 - "Community 704"
Cohesion: 1.0
Nodes (1): HTMLImageElement

### Community 705 - "Community 705"
Cohesion: 1.0
Nodes (1): Image

### Community 706 - "Community 706"
Cohesion: 1.0
Nodes (1): FileList

### Community 707 - "Community 707"
Cohesion: 1.0
Nodes (1): HTMLInputElement

### Community 708 - "Community 708"
Cohesion: 1.0
Nodes (1): HTMLInputElementDateUtility

### Community 709 - "Community 709"
Cohesion: 1.0
Nodes (1): HTMLInputElementValueSanitizer

### Community 710 - "Community 710"
Cohesion: 1.0
Nodes (1): HTMLInputElementValueStepping

### Community 711 - "Community 711"
Cohesion: 1.0
Nodes (1): HTMLLabelElement

### Community 712 - "Community 712"
Cohesion: 1.0
Nodes (1): HTMLLabelElementUtility

### Community 713 - "Community 713"
Cohesion: 1.0
Nodes (1): HTMLLegendElement

### Community 714 - "Community 714"
Cohesion: 1.0
Nodes (1): HTMLLIElement

### Community 715 - "Community 715"
Cohesion: 1.0
Nodes (1): HTMLLinkElement

### Community 716 - "Community 716"
Cohesion: 1.0
Nodes (1): HTMLMapElement

### Community 717 - "Community 717"
Cohesion: 1.0
Nodes (1): HTMLMediaElement

### Community 718 - "Community 718"
Cohesion: 1.0
Nodes (1): MediaStream

### Community 719 - "Community 719"
Cohesion: 1.0
Nodes (1): MediaStreamTrack

### Community 720 - "Community 720"
Cohesion: 1.0
Nodes (1): RemotePlayback

### Community 721 - "Community 721"
Cohesion: 1.0
Nodes (1): TextTrack

### Community 722 - "Community 722"
Cohesion: 1.0
Nodes (1): TextTrackCueList

### Community 723 - "Community 723"
Cohesion: 1.0
Nodes (1): TextTrackList

### Community 724 - "Community 724"
Cohesion: 1.0
Nodes (1): TimeRanges

### Community 725 - "Community 725"
Cohesion: 1.0
Nodes (1): VTTCue

### Community 726 - "Community 726"
Cohesion: 1.0
Nodes (1): VTTRegion

### Community 727 - "Community 727"
Cohesion: 1.0
Nodes (1): VTTRegion

### Community 728 - "Community 728"
Cohesion: 1.0
Nodes (1): HTMLMenuElement

### Community 729 - "Community 729"
Cohesion: 1.0
Nodes (1): HTMLMenuElement

### Community 730 - "Community 730"
Cohesion: 1.0
Nodes (1): HTMLMetaElement

### Community 731 - "Community 731"
Cohesion: 1.0
Nodes (1): HTMLMeterElement

### Community 732 - "Community 732"
Cohesion: 1.0
Nodes (1): HTMLModElement

### Community 733 - "Community 733"
Cohesion: 1.0
Nodes (1): HTMLOListElement

### Community 734 - "Community 734"
Cohesion: 1.0
Nodes (1): HTMLObjectElement

### Community 735 - "Community 735"
Cohesion: 1.0
Nodes (1): HTMLOptGroupElement

### Community 736 - "Community 736"
Cohesion: 1.0
Nodes (1): HTMLOptionElement

### Community 737 - "Community 737"
Cohesion: 1.0
Nodes (1): HTMLOutputElement

### Community 738 - "Community 738"
Cohesion: 1.0
Nodes (1): HTMLParagraphElement

### Community 739 - "Community 739"
Cohesion: 1.0
Nodes (1): HTMLParagraphElement

### Community 740 - "Community 740"
Cohesion: 1.0
Nodes (1): HTMLParamElement

### Community 741 - "Community 741"
Cohesion: 1.0
Nodes (1): HTMLParamElement

### Community 742 - "Community 742"
Cohesion: 1.0
Nodes (1): HTMLPictureElement

### Community 743 - "Community 743"
Cohesion: 1.0
Nodes (1): HTMLPictureElement

### Community 744 - "Community 744"
Cohesion: 1.0
Nodes (1): HTMLPreElement

### Community 745 - "Community 745"
Cohesion: 1.0
Nodes (1): HTMLPreElement

### Community 746 - "Community 746"
Cohesion: 1.0
Nodes (1): HTMLProgressElement

### Community 747 - "Community 747"
Cohesion: 1.0
Nodes (1): HTMLQuoteElement

### Community 748 - "Community 748"
Cohesion: 1.0
Nodes (1): HTMLScriptElement

### Community 749 - "Community 749"
Cohesion: 1.0
Nodes (1): HTMLOptionsCollection

### Community 750 - "Community 750"
Cohesion: 1.0
Nodes (1): HTMLSelectElement

### Community 751 - "Community 751"
Cohesion: 1.0
Nodes (1): HTMLSlotElement

### Community 752 - "Community 752"
Cohesion: 1.0
Nodes (1): HTMLSourceElement

### Community 753 - "Community 753"
Cohesion: 1.0
Nodes (1): HTMLSpanElement

### Community 754 - "Community 754"
Cohesion: 1.0
Nodes (1): HTMLSpanElement

### Community 755 - "Community 755"
Cohesion: 1.0
Nodes (1): HTMLStyleElement

### Community 756 - "Community 756"
Cohesion: 1.0
Nodes (1): HTMLTableCaptionElement

### Community 757 - "Community 757"
Cohesion: 1.0
Nodes (1): HTMLTableCaptionElement

### Community 758 - "Community 758"
Cohesion: 1.0
Nodes (1): HTMLTableCellElement

### Community 759 - "Community 759"
Cohesion: 1.0
Nodes (1): HTMLTableColElement

### Community 760 - "Community 760"
Cohesion: 1.0
Nodes (1): HTMLTableColElement

### Community 761 - "Community 761"
Cohesion: 1.0
Nodes (1): HTMLTableElement

### Community 762 - "Community 762"
Cohesion: 1.0
Nodes (1): HTMLTableRowElement

### Community 763 - "Community 763"
Cohesion: 1.0
Nodes (1): HTMLTableSectionElement

### Community 764 - "Community 764"
Cohesion: 1.0
Nodes (1): HTMLTemplateElement

### Community 765 - "Community 765"
Cohesion: 1.0
Nodes (1): HTMLTextAreaElement

### Community 766 - "Community 766"
Cohesion: 1.0
Nodes (1): HTMLTimeElement

### Community 767 - "Community 767"
Cohesion: 1.0
Nodes (1): HTMLTitleElement

### Community 768 - "Community 768"
Cohesion: 1.0
Nodes (1): HTMLTrackElement

### Community 769 - "Community 769"
Cohesion: 1.0
Nodes (1): HTMLUListElement

### Community 770 - "Community 770"
Cohesion: 1.0
Nodes (1): HTMLUListElement

### Community 771 - "Community 771"
Cohesion: 1.0
Nodes (1): HTMLUnknownElement

### Community 772 - "Community 772"
Cohesion: 1.0
Nodes (1): HTMLUnknownElement

### Community 773 - "Community 773"
Cohesion: 1.0
Nodes (1): HTMLVideoElement

### Community 774 - "Community 774"
Cohesion: 1.0
Nodes (1): HTMLVideoElement

### Community 775 - "Community 775"
Cohesion: 1.0
Nodes (1): NodeList

### Community 776 - "Community 776"
Cohesion: 1.0
Nodes (1): NodeUtility

### Community 777 - "Community 777"
Cohesion: 1.0
Nodes (1): NodeFactory

### Community 778 - "Community 778"
Cohesion: 1.0
Nodes (1): ParentNodeUtility

### Community 779 - "Community 779"
Cohesion: 1.0
Nodes (1): ProcessingInstruction

### Community 780 - "Community 780"
Cohesion: 1.0
Nodes (1): ShadowRoot

### Community 781 - "Community 781"
Cohesion: 1.0
Nodes (1): SVGAnimateElement

### Community 782 - "Community 782"
Cohesion: 1.0
Nodes (1): SVGAnimateElement

### Community 783 - "Community 783"
Cohesion: 1.0
Nodes (1): SVGAnimateMotionElement

### Community 784 - "Community 784"
Cohesion: 1.0
Nodes (1): SVGAnimateMotionElement

### Community 785 - "Community 785"
Cohesion: 1.0
Nodes (1): SVGAnimateTransformElement

### Community 786 - "Community 786"
Cohesion: 1.0
Nodes (1): SVGAnimateTransformElement

### Community 787 - "Community 787"
Cohesion: 1.0
Nodes (1): SVGAnimationElement

### Community 788 - "Community 788"
Cohesion: 1.0
Nodes (1): SVGCircleElement

### Community 789 - "Community 789"
Cohesion: 1.0
Nodes (1): SVGClipPathElement

### Community 790 - "Community 790"
Cohesion: 1.0
Nodes (1): SVGComponentTransferFunctionElement

### Community 791 - "Community 791"
Cohesion: 1.0
Nodes (1): SVGDefsElement

### Community 792 - "Community 792"
Cohesion: 1.0
Nodes (1): SVGDefsElement

### Community 793 - "Community 793"
Cohesion: 1.0
Nodes (1): SVGDescElement

### Community 794 - "Community 794"
Cohesion: 1.0
Nodes (1): SVGDescElement

### Community 795 - "Community 795"
Cohesion: 1.0
Nodes (1): SVGElement

### Community 796 - "Community 796"
Cohesion: 1.0
Nodes (1): SVGEllipseElement

### Community 797 - "Community 797"
Cohesion: 1.0
Nodes (1): SVGFEBlendElement

### Community 798 - "Community 798"
Cohesion: 1.0
Nodes (1): SVGFEColorMatrixElement

### Community 799 - "Community 799"
Cohesion: 1.0
Nodes (1): SVGFEComponentTransferElement

### Community 800 - "Community 800"
Cohesion: 1.0
Nodes (1): SVGFECompositeElement

### Community 801 - "Community 801"
Cohesion: 1.0
Nodes (1): SVGFEConvolveMatrixElement

### Community 802 - "Community 802"
Cohesion: 1.0
Nodes (1): SVGFEDiffuseLightingElement

### Community 803 - "Community 803"
Cohesion: 1.0
Nodes (1): SVGFEDisplacementMapElement

### Community 804 - "Community 804"
Cohesion: 1.0
Nodes (1): SVGFEDistantLightElement

### Community 805 - "Community 805"
Cohesion: 1.0
Nodes (1): SVGFEDropShadowElement

### Community 806 - "Community 806"
Cohesion: 1.0
Nodes (1): SVGFEFloodElement

### Community 807 - "Community 807"
Cohesion: 1.0
Nodes (1): SVGFEFuncAElement

### Community 808 - "Community 808"
Cohesion: 1.0
Nodes (1): SVGFEFuncAElement

### Community 809 - "Community 809"
Cohesion: 1.0
Nodes (1): SVGFEFuncBElement

### Community 810 - "Community 810"
Cohesion: 1.0
Nodes (1): SVGFEFuncBElement

### Community 811 - "Community 811"
Cohesion: 1.0
Nodes (1): SVGFEFuncGElement

### Community 812 - "Community 812"
Cohesion: 1.0
Nodes (1): SVGFEFuncGElement

### Community 813 - "Community 813"
Cohesion: 1.0
Nodes (1): SVGFEFuncRElement

### Community 814 - "Community 814"
Cohesion: 1.0
Nodes (1): SVGFEFuncRElement

### Community 815 - "Community 815"
Cohesion: 1.0
Nodes (1): SVGFEGaussianBlurElement

### Community 816 - "Community 816"
Cohesion: 1.0
Nodes (1): SVGFEImageElement

### Community 817 - "Community 817"
Cohesion: 1.0
Nodes (1): SVGFEMergeElement

### Community 818 - "Community 818"
Cohesion: 1.0
Nodes (1): SVGFEMergeNodeElement

### Community 819 - "Community 819"
Cohesion: 1.0
Nodes (1): SVGFEMorphologyElement

### Community 820 - "Community 820"
Cohesion: 1.0
Nodes (1): SVGFEOffsetElement

### Community 821 - "Community 821"
Cohesion: 1.0
Nodes (1): SVGFEPointLightElement

### Community 822 - "Community 822"
Cohesion: 1.0
Nodes (1): SVGFESpecularLightingElement

### Community 823 - "Community 823"
Cohesion: 1.0
Nodes (1): SVGFESpotLightElement

### Community 824 - "Community 824"
Cohesion: 1.0
Nodes (1): SVGFETileElement

### Community 825 - "Community 825"
Cohesion: 1.0
Nodes (1): SVGFETurbulenceElement

### Community 826 - "Community 826"
Cohesion: 1.0
Nodes (1): SVGFilterElement

### Community 827 - "Community 827"
Cohesion: 1.0
Nodes (1): SVGForeignObjectElement

### Community 828 - "Community 828"
Cohesion: 1.0
Nodes (1): SVGGElement

### Community 829 - "Community 829"
Cohesion: 1.0
Nodes (1): SVGGElement

### Community 830 - "Community 830"
Cohesion: 1.0
Nodes (1): SVGGeometryElement

### Community 831 - "Community 831"
Cohesion: 1.0
Nodes (1): SVGGradientElement

### Community 832 - "Community 832"
Cohesion: 1.0
Nodes (1): SVGGraphicsElement

### Community 833 - "Community 833"
Cohesion: 1.0
Nodes (1): SVGImageElement

### Community 834 - "Community 834"
Cohesion: 1.0
Nodes (1): SVGLineElement

### Community 835 - "Community 835"
Cohesion: 1.0
Nodes (1): SVGLinearGradientElement

### Community 836 - "Community 836"
Cohesion: 1.0
Nodes (1): SVGMPathElement

### Community 837 - "Community 837"
Cohesion: 1.0
Nodes (1): SVGMarkerElement

### Community 838 - "Community 838"
Cohesion: 1.0
Nodes (1): SVGMaskElement

### Community 839 - "Community 839"
Cohesion: 1.0
Nodes (1): SVGMetadataElement

### Community 840 - "Community 840"
Cohesion: 1.0
Nodes (1): SVGMetadataElement

### Community 841 - "Community 841"
Cohesion: 1.0
Nodes (1): SVGPathElement

### Community 842 - "Community 842"
Cohesion: 1.0
Nodes (1): SVGPathElement

### Community 843 - "Community 843"
Cohesion: 1.0
Nodes (1): SVGPatternElement

### Community 844 - "Community 844"
Cohesion: 1.0
Nodes (1): SVGPolygonElement

### Community 845 - "Community 845"
Cohesion: 1.0
Nodes (1): SVGPolylineElement

### Community 846 - "Community 846"
Cohesion: 1.0
Nodes (1): SVGRadialGradientElement

### Community 847 - "Community 847"
Cohesion: 1.0
Nodes (1): SVGRectElement

### Community 848 - "Community 848"
Cohesion: 1.0
Nodes (1): SVGScriptElement

### Community 849 - "Community 849"
Cohesion: 1.0
Nodes (1): SVGSetElement

### Community 850 - "Community 850"
Cohesion: 1.0
Nodes (1): SVGSetElement

### Community 851 - "Community 851"
Cohesion: 1.0
Nodes (1): SVGStopElement

### Community 852 - "Community 852"
Cohesion: 1.0
Nodes (1): SVGStyleElement

### Community 853 - "Community 853"
Cohesion: 1.0
Nodes (1): SVGSVGElement

### Community 854 - "Community 854"
Cohesion: 1.0
Nodes (1): SVGSwitchElement

### Community 855 - "Community 855"
Cohesion: 1.0
Nodes (1): SVGSwitchElement

### Community 856 - "Community 856"
Cohesion: 1.0
Nodes (1): SVGSymbolElement

### Community 857 - "Community 857"
Cohesion: 1.0
Nodes (1): SVGSymbolElement

### Community 858 - "Community 858"
Cohesion: 1.0
Nodes (1): SVGTSpanElement

### Community 859 - "Community 859"
Cohesion: 1.0
Nodes (1): SVGTSpanElement

### Community 860 - "Community 860"
Cohesion: 1.0
Nodes (1): SVGTextContentElement

### Community 861 - "Community 861"
Cohesion: 1.0
Nodes (1): SVGTextElement

### Community 862 - "Community 862"
Cohesion: 1.0
Nodes (1): SVGTextElement

### Community 863 - "Community 863"
Cohesion: 1.0
Nodes (1): SVGTextPathElement

### Community 864 - "Community 864"
Cohesion: 1.0
Nodes (1): SVGTextPositioningElement

### Community 865 - "Community 865"
Cohesion: 1.0
Nodes (1): SVGTitleElement

### Community 866 - "Community 866"
Cohesion: 1.0
Nodes (1): SVGTitleElement

### Community 867 - "Community 867"
Cohesion: 1.0
Nodes (1): SVGUseElement

### Community 868 - "Community 868"
Cohesion: 1.0
Nodes (1): SVGViewElement

### Community 869 - "Community 869"
Cohesion: 1.0
Nodes (1): SVGViewElement

### Community 870 - "Community 870"
Cohesion: 1.0
Nodes (1): Text

### Community 871 - "Community 871"
Cohesion: 1.0
Nodes (1): XMLDocument

### Community 872 - "Community 872"
Cohesion: 1.0
Nodes (1): XMLDocument

### Community 873 - "Community 873"
Cohesion: 1.0
Nodes (1): Permissions

### Community 874 - "Community 874"
Cohesion: 1.0
Nodes (1): PermissionStatus

### Community 875 - "Community 875"
Cohesion: 1.0
Nodes (1): QuerySelector

### Community 876 - "Community 876"
Cohesion: 1.0
Nodes (1): SelectorItem

### Community 877 - "Community 877"
Cohesion: 1.0
Nodes (1): SelectorParser

### Community 878 - "Community 878"
Cohesion: 1.0
Nodes (1): Range

### Community 879 - "Community 879"
Cohesion: 1.0
Nodes (1): RangeUtility

### Community 880 - "Community 880"
Cohesion: 1.0
Nodes (1): ResizeObserver

### Community 881 - "Community 881"
Cohesion: 1.0
Nodes (1): Screen

### Community 882 - "Community 882"
Cohesion: 1.0
Nodes (1): Screen

### Community 883 - "Community 883"
Cohesion: 1.0
Nodes (1): ScreenDetailed

### Community 884 - "Community 884"
Cohesion: 1.0
Nodes (1): ScreenDetailed

### Community 885 - "Community 885"
Cohesion: 1.0
Nodes (1): ScreenDetails

### Community 886 - "Community 886"
Cohesion: 1.0
Nodes (1): Selection

### Community 887 - "Community 887"
Cohesion: 1.0
Nodes (1): SVGAngle

### Community 888 - "Community 888"
Cohesion: 1.0
Nodes (1): SVGAnimatedAngle

### Community 889 - "Community 889"
Cohesion: 1.0
Nodes (1): SVGAnimatedBoolean

### Community 890 - "Community 890"
Cohesion: 1.0
Nodes (1): SVGAnimatedEnumeration

### Community 891 - "Community 891"
Cohesion: 1.0
Nodes (1): SVGAnimatedInteger

### Community 892 - "Community 892"
Cohesion: 1.0
Nodes (1): SVGAnimatedLength

### Community 893 - "Community 893"
Cohesion: 1.0
Nodes (1): SVGAnimatedLengthList

### Community 894 - "Community 894"
Cohesion: 1.0
Nodes (1): SVGAnimatedNumber

### Community 895 - "Community 895"
Cohesion: 1.0
Nodes (1): SVGAnimatedNumberList

### Community 896 - "Community 896"
Cohesion: 1.0
Nodes (1): SVGAnimatedPreserveAspectRatio

### Community 897 - "Community 897"
Cohesion: 1.0
Nodes (1): SVGAnimatedRect

### Community 898 - "Community 898"
Cohesion: 1.0
Nodes (1): SVGAnimatedString

### Community 899 - "Community 899"
Cohesion: 1.0
Nodes (1): SVGAnimatedTransformList

### Community 900 - "Community 900"
Cohesion: 1.0
Nodes (1): SVGLength

### Community 901 - "Community 901"
Cohesion: 1.0
Nodes (1): SVGLengthList

### Community 902 - "Community 902"
Cohesion: 1.0
Nodes (1): SVGMatrix

### Community 903 - "Community 903"
Cohesion: 1.0
Nodes (1): SVGNumber

### Community 904 - "Community 904"
Cohesion: 1.0
Nodes (1): SVGNumberList

### Community 905 - "Community 905"
Cohesion: 1.0
Nodes (1): SVGPoint

### Community 906 - "Community 906"
Cohesion: 1.0
Nodes (1): SVGPointList

### Community 907 - "Community 907"
Cohesion: 1.0
Nodes (1): SVGPreserveAspectRatio

### Community 908 - "Community 908"
Cohesion: 1.0
Nodes (1): SVGRect

### Community 909 - "Community 909"
Cohesion: 1.0
Nodes (1): SVGStringList

### Community 910 - "Community 910"
Cohesion: 1.0
Nodes (1): SVGTransform

### Community 911 - "Community 911"
Cohesion: 1.0
Nodes (1): SVGTransformList

### Community 912 - "Community 912"
Cohesion: 1.0
Nodes (1): SVGUnitTypes

### Community 913 - "Community 913"
Cohesion: 1.0
Nodes (1): NodeIterator

### Community 914 - "Community 914"
Cohesion: 1.0
Nodes (1): TreeWalker

### Community 915 - "Community 915"
Cohesion: 1.0
Nodes (1): AttributeUtility

### Community 916 - "Community 916"
Cohesion: 1.0
Nodes (1): ClassMethodBinder

### Community 917 - "Community 917"
Cohesion: 1.0
Nodes (1): StringUtility

### Community 918 - "Community 918"
Cohesion: 1.0
Nodes (1): XMLEncodeUtility

### Community 919 - "Community 919"
Cohesion: 1.0
Nodes (1): ValidityState

### Community 920 - "Community 920"
Cohesion: 1.0
Nodes (1): WebSocket

### Community 921 - "Community 921"
Cohesion: 1.0
Nodes (1): CrossOriginBrowserWindow

### Community 922 - "Community 922"
Cohesion: 1.0
Nodes (1): DetachedWindowAPI

### Community 923 - "Community 923"
Cohesion: 1.0
Nodes (1): GlobalWindow

### Community 924 - "Community 924"
Cohesion: 1.0
Nodes (1): Window

### Community 925 - "Community 925"
Cohesion: 1.0
Nodes (1): WindowBrowserContext

### Community 926 - "Community 926"
Cohesion: 1.0
Nodes (1): WindowContextClassExtender

### Community 927 - "Community 927"
Cohesion: 1.0
Nodes (1): WindowPageOpenUtility

### Community 928 - "Community 928"
Cohesion: 1.0
Nodes (1): XMLHttpRequest

### Community 929 - "Community 929"
Cohesion: 1.0
Nodes (1): XMLHttpRequestEventTarget

### Community 930 - "Community 930"
Cohesion: 1.0
Nodes (1): XMLHttpRequestResponseDataParser

### Community 931 - "Community 931"
Cohesion: 1.0
Nodes (1): XMLHttpRequestUpload

### Community 932 - "Community 932"
Cohesion: 1.0
Nodes (1): XMLHttpRequestUpload

### Community 933 - "Community 933"
Cohesion: 1.0
Nodes (1): XMLParser

### Community 934 - "Community 934"
Cohesion: 1.0
Nodes (1): XMLSerializer

### Community 935 - "Community 935"
Cohesion: 1.0
Nodes (0): 

### Community 936 - "Community 936"
Cohesion: 1.0
Nodes (1): Manager

### Community 937 - "Community 937"
Cohesion: 1.0
Nodes (0): 

### Community 938 - "Community 938"
Cohesion: 1.0
Nodes (1): Socket

### Community 939 - "Community 939"
Cohesion: 1.0
Nodes (0): 

### Community 940 - "Community 940"
Cohesion: 1.0
Nodes (0): 

### Community 941 - "Community 941"
Cohesion: 1.0
Nodes (1): VitestEvaluatedModules

### Community 942 - "Community 942"
Cohesion: 1.0
Nodes (0): 

### Community 943 - "Community 943"
Cohesion: 1.0
Nodes (1): Traces

### Community 944 - "Community 944"
Cohesion: 1.0
Nodes (1): VitestNodeSnapshotEnvironment

### Community 945 - "Community 945"
Cohesion: 1.0
Nodes (1): Actor

### Community 946 - "Community 946"
Cohesion: 1.0
Nodes (1): TestModel

### Community 947 - "Community 947"
Cohesion: 1.0
Nodes (1): SimulatedClock

### Community 948 - "Community 948"
Cohesion: 1.0
Nodes (1): StateMachine

### Community 949 - "Community 949"
Cohesion: 1.0
Nodes (1): StateNode

### Community 950 - "Community 950"
Cohesion: 1.0
Nodes (0): 

### Community 951 - "Community 951"
Cohesion: 1.0
Nodes (0): 

### Community 952 - "Community 952"
Cohesion: 1.0
Nodes (0): 

### Community 953 - "Community 953"
Cohesion: 1.0
Nodes (0): 

### Community 954 - "Community 954"
Cohesion: 1.0
Nodes (0): 

### Community 955 - "Community 955"
Cohesion: 1.0
Nodes (0): 

### Community 956 - "Community 956"
Cohesion: 1.0
Nodes (0): 

### Community 957 - "Community 957"
Cohesion: 1.0
Nodes (0): 

### Community 958 - "Community 958"
Cohesion: 1.0
Nodes (0): 

### Community 959 - "Community 959"
Cohesion: 1.0
Nodes (0): 

### Community 960 - "Community 960"
Cohesion: 1.0
Nodes (0): 

### Community 961 - "Community 961"
Cohesion: 1.0
Nodes (0): 

### Community 962 - "Community 962"
Cohesion: 1.0
Nodes (0): 

### Community 963 - "Community 963"
Cohesion: 1.0
Nodes (0): 

### Community 964 - "Community 964"
Cohesion: 1.0
Nodes (0): 

### Community 965 - "Community 965"
Cohesion: 1.0
Nodes (0): 

### Community 966 - "Community 966"
Cohesion: 1.0
Nodes (0): 

### Community 967 - "Community 967"
Cohesion: 1.0
Nodes (0): 

### Community 968 - "Community 968"
Cohesion: 1.0
Nodes (0): 

### Community 969 - "Community 969"
Cohesion: 1.0
Nodes (0): 

### Community 970 - "Community 970"
Cohesion: 1.0
Nodes (0): 

### Community 971 - "Community 971"
Cohesion: 1.0
Nodes (0): 

### Community 972 - "Community 972"
Cohesion: 1.0
Nodes (0): 

### Community 973 - "Community 973"
Cohesion: 1.0
Nodes (0): 

### Community 974 - "Community 974"
Cohesion: 1.0
Nodes (0): 

### Community 975 - "Community 975"
Cohesion: 1.0
Nodes (0): 

### Community 976 - "Community 976"
Cohesion: 1.0
Nodes (0): 

### Community 977 - "Community 977"
Cohesion: 1.0
Nodes (0): 

### Community 978 - "Community 978"
Cohesion: 1.0
Nodes (0): 

### Community 979 - "Community 979"
Cohesion: 1.0
Nodes (0): 

### Community 980 - "Community 980"
Cohesion: 1.0
Nodes (0): 

### Community 981 - "Community 981"
Cohesion: 1.0
Nodes (0): 

### Community 982 - "Community 982"
Cohesion: 1.0
Nodes (0): 

### Community 983 - "Community 983"
Cohesion: 1.0
Nodes (0): 

### Community 984 - "Community 984"
Cohesion: 1.0
Nodes (0): 

### Community 985 - "Community 985"
Cohesion: 1.0
Nodes (0): 

### Community 986 - "Community 986"
Cohesion: 1.0
Nodes (0): 

### Community 987 - "Community 987"
Cohesion: 1.0
Nodes (0): 

### Community 988 - "Community 988"
Cohesion: 1.0
Nodes (0): 

### Community 989 - "Community 989"
Cohesion: 1.0
Nodes (0): 

### Community 990 - "Community 990"
Cohesion: 1.0
Nodes (0): 

### Community 991 - "Community 991"
Cohesion: 1.0
Nodes (0): 

### Community 992 - "Community 992"
Cohesion: 1.0
Nodes (0): 

### Community 993 - "Community 993"
Cohesion: 1.0
Nodes (0): 

### Community 994 - "Community 994"
Cohesion: 1.0
Nodes (0): 

### Community 995 - "Community 995"
Cohesion: 1.0
Nodes (0): 

### Community 996 - "Community 996"
Cohesion: 1.0
Nodes (0): 

### Community 997 - "Community 997"
Cohesion: 1.0
Nodes (0): 

### Community 998 - "Community 998"
Cohesion: 1.0
Nodes (0): 

### Community 999 - "Community 999"
Cohesion: 1.0
Nodes (0): 

### Community 1000 - "Community 1000"
Cohesion: 1.0
Nodes (0): 

### Community 1001 - "Community 1001"
Cohesion: 1.0
Nodes (0): 

### Community 1002 - "Community 1002"
Cohesion: 1.0
Nodes (0): 

### Community 1003 - "Community 1003"
Cohesion: 1.0
Nodes (0): 

### Community 1004 - "Community 1004"
Cohesion: 1.0
Nodes (0): 

### Community 1005 - "Community 1005"
Cohesion: 1.0
Nodes (0): 

### Community 1006 - "Community 1006"
Cohesion: 1.0
Nodes (0): 

### Community 1007 - "Community 1007"
Cohesion: 1.0
Nodes (0): 

### Community 1008 - "Community 1008"
Cohesion: 1.0
Nodes (0): 

### Community 1009 - "Community 1009"
Cohesion: 1.0
Nodes (0): 

### Community 1010 - "Community 1010"
Cohesion: 1.0
Nodes (0): 

### Community 1011 - "Community 1011"
Cohesion: 1.0
Nodes (0): 

### Community 1012 - "Community 1012"
Cohesion: 1.0
Nodes (0): 

### Community 1013 - "Community 1013"
Cohesion: 1.0
Nodes (0): 

### Community 1014 - "Community 1014"
Cohesion: 1.0
Nodes (0): 

### Community 1015 - "Community 1015"
Cohesion: 1.0
Nodes (0): 

### Community 1016 - "Community 1016"
Cohesion: 1.0
Nodes (0): 

### Community 1017 - "Community 1017"
Cohesion: 1.0
Nodes (0): 

### Community 1018 - "Community 1018"
Cohesion: 1.0
Nodes (0): 

### Community 1019 - "Community 1019"
Cohesion: 1.0
Nodes (0): 

### Community 1020 - "Community 1020"
Cohesion: 1.0
Nodes (0): 

### Community 1021 - "Community 1021"
Cohesion: 1.0
Nodes (0): 

### Community 1022 - "Community 1022"
Cohesion: 1.0
Nodes (0): 

### Community 1023 - "Community 1023"
Cohesion: 1.0
Nodes (0): 

### Community 1024 - "Community 1024"
Cohesion: 1.0
Nodes (0): 

### Community 1025 - "Community 1025"
Cohesion: 1.0
Nodes (0): 

### Community 1026 - "Community 1026"
Cohesion: 1.0
Nodes (0): 

### Community 1027 - "Community 1027"
Cohesion: 1.0
Nodes (0): 

### Community 1028 - "Community 1028"
Cohesion: 1.0
Nodes (0): 

### Community 1029 - "Community 1029"
Cohesion: 1.0
Nodes (0): 

### Community 1030 - "Community 1030"
Cohesion: 1.0
Nodes (0): 

### Community 1031 - "Community 1031"
Cohesion: 1.0
Nodes (0): 

### Community 1032 - "Community 1032"
Cohesion: 1.0
Nodes (0): 

### Community 1033 - "Community 1033"
Cohesion: 1.0
Nodes (0): 

### Community 1034 - "Community 1034"
Cohesion: 1.0
Nodes (0): 

### Community 1035 - "Community 1035"
Cohesion: 1.0
Nodes (0): 

### Community 1036 - "Community 1036"
Cohesion: 1.0
Nodes (0): 

### Community 1037 - "Community 1037"
Cohesion: 1.0
Nodes (0): 

### Community 1038 - "Community 1038"
Cohesion: 1.0
Nodes (0): 

### Community 1039 - "Community 1039"
Cohesion: 1.0
Nodes (0): 

### Community 1040 - "Community 1040"
Cohesion: 1.0
Nodes (0): 

### Community 1041 - "Community 1041"
Cohesion: 1.0
Nodes (0): 

### Community 1042 - "Community 1042"
Cohesion: 1.0
Nodes (0): 

### Community 1043 - "Community 1043"
Cohesion: 1.0
Nodes (0): 

### Community 1044 - "Community 1044"
Cohesion: 1.0
Nodes (0): 

### Community 1045 - "Community 1045"
Cohesion: 1.0
Nodes (0): 

### Community 1046 - "Community 1046"
Cohesion: 1.0
Nodes (0): 

### Community 1047 - "Community 1047"
Cohesion: 1.0
Nodes (0): 

### Community 1048 - "Community 1048"
Cohesion: 1.0
Nodes (0): 

### Community 1049 - "Community 1049"
Cohesion: 1.0
Nodes (0): 

### Community 1050 - "Community 1050"
Cohesion: 1.0
Nodes (0): 

### Community 1051 - "Community 1051"
Cohesion: 1.0
Nodes (0): 

### Community 1052 - "Community 1052"
Cohesion: 1.0
Nodes (0): 

### Community 1053 - "Community 1053"
Cohesion: 1.0
Nodes (0): 

### Community 1054 - "Community 1054"
Cohesion: 1.0
Nodes (0): 

### Community 1055 - "Community 1055"
Cohesion: 1.0
Nodes (0): 

### Community 1056 - "Community 1056"
Cohesion: 1.0
Nodes (0): 

### Community 1057 - "Community 1057"
Cohesion: 1.0
Nodes (0): 

### Community 1058 - "Community 1058"
Cohesion: 1.0
Nodes (0): 

### Community 1059 - "Community 1059"
Cohesion: 1.0
Nodes (0): 

### Community 1060 - "Community 1060"
Cohesion: 1.0
Nodes (0): 

### Community 1061 - "Community 1061"
Cohesion: 1.0
Nodes (0): 

### Community 1062 - "Community 1062"
Cohesion: 1.0
Nodes (0): 

### Community 1063 - "Community 1063"
Cohesion: 1.0
Nodes (0): 

### Community 1064 - "Community 1064"
Cohesion: 1.0
Nodes (0): 

### Community 1065 - "Community 1065"
Cohesion: 1.0
Nodes (0): 

### Community 1066 - "Community 1066"
Cohesion: 1.0
Nodes (0): 

### Community 1067 - "Community 1067"
Cohesion: 1.0
Nodes (0): 

### Community 1068 - "Community 1068"
Cohesion: 1.0
Nodes (0): 

### Community 1069 - "Community 1069"
Cohesion: 1.0
Nodes (0): 

### Community 1070 - "Community 1070"
Cohesion: 1.0
Nodes (0): 

### Community 1071 - "Community 1071"
Cohesion: 1.0
Nodes (0): 

### Community 1072 - "Community 1072"
Cohesion: 1.0
Nodes (0): 

### Community 1073 - "Community 1073"
Cohesion: 1.0
Nodes (0): 

### Community 1074 - "Community 1074"
Cohesion: 1.0
Nodes (0): 

### Community 1075 - "Community 1075"
Cohesion: 1.0
Nodes (0): 

### Community 1076 - "Community 1076"
Cohesion: 1.0
Nodes (0): 

### Community 1077 - "Community 1077"
Cohesion: 1.0
Nodes (0): 

### Community 1078 - "Community 1078"
Cohesion: 1.0
Nodes (0): 

### Community 1079 - "Community 1079"
Cohesion: 1.0
Nodes (0): 

### Community 1080 - "Community 1080"
Cohesion: 1.0
Nodes (0): 

### Community 1081 - "Community 1081"
Cohesion: 1.0
Nodes (0): 

### Community 1082 - "Community 1082"
Cohesion: 1.0
Nodes (0): 

### Community 1083 - "Community 1083"
Cohesion: 1.0
Nodes (0): 

### Community 1084 - "Community 1084"
Cohesion: 1.0
Nodes (0): 

### Community 1085 - "Community 1085"
Cohesion: 1.0
Nodes (0): 

### Community 1086 - "Community 1086"
Cohesion: 1.0
Nodes (0): 

### Community 1087 - "Community 1087"
Cohesion: 1.0
Nodes (0): 

### Community 1088 - "Community 1088"
Cohesion: 1.0
Nodes (0): 

### Community 1089 - "Community 1089"
Cohesion: 1.0
Nodes (0): 

### Community 1090 - "Community 1090"
Cohesion: 1.0
Nodes (0): 

### Community 1091 - "Community 1091"
Cohesion: 1.0
Nodes (0): 

### Community 1092 - "Community 1092"
Cohesion: 1.0
Nodes (0): 

### Community 1093 - "Community 1093"
Cohesion: 1.0
Nodes (0): 

### Community 1094 - "Community 1094"
Cohesion: 1.0
Nodes (0): 

### Community 1095 - "Community 1095"
Cohesion: 1.0
Nodes (0): 

### Community 1096 - "Community 1096"
Cohesion: 1.0
Nodes (0): 

### Community 1097 - "Community 1097"
Cohesion: 1.0
Nodes (0): 

### Community 1098 - "Community 1098"
Cohesion: 1.0
Nodes (0): 

### Community 1099 - "Community 1099"
Cohesion: 1.0
Nodes (0): 

### Community 1100 - "Community 1100"
Cohesion: 1.0
Nodes (0): 

### Community 1101 - "Community 1101"
Cohesion: 1.0
Nodes (0): 

### Community 1102 - "Community 1102"
Cohesion: 1.0
Nodes (0): 

### Community 1103 - "Community 1103"
Cohesion: 1.0
Nodes (0): 

### Community 1104 - "Community 1104"
Cohesion: 1.0
Nodes (0): 

### Community 1105 - "Community 1105"
Cohesion: 1.0
Nodes (0): 

### Community 1106 - "Community 1106"
Cohesion: 1.0
Nodes (0): 

### Community 1107 - "Community 1107"
Cohesion: 1.0
Nodes (0): 

### Community 1108 - "Community 1108"
Cohesion: 1.0
Nodes (0): 

### Community 1109 - "Community 1109"
Cohesion: 1.0
Nodes (0): 

### Community 1110 - "Community 1110"
Cohesion: 1.0
Nodes (0): 

### Community 1111 - "Community 1111"
Cohesion: 1.0
Nodes (0): 

### Community 1112 - "Community 1112"
Cohesion: 1.0
Nodes (0): 

### Community 1113 - "Community 1113"
Cohesion: 1.0
Nodes (0): 

### Community 1114 - "Community 1114"
Cohesion: 1.0
Nodes (0): 

### Community 1115 - "Community 1115"
Cohesion: 1.0
Nodes (0): 

### Community 1116 - "Community 1116"
Cohesion: 1.0
Nodes (0): 

### Community 1117 - "Community 1117"
Cohesion: 1.0
Nodes (0): 

### Community 1118 - "Community 1118"
Cohesion: 1.0
Nodes (0): 

### Community 1119 - "Community 1119"
Cohesion: 1.0
Nodes (0): 

### Community 1120 - "Community 1120"
Cohesion: 1.0
Nodes (0): 

### Community 1121 - "Community 1121"
Cohesion: 1.0
Nodes (0): 

### Community 1122 - "Community 1122"
Cohesion: 1.0
Nodes (0): 

### Community 1123 - "Community 1123"
Cohesion: 1.0
Nodes (0): 

### Community 1124 - "Community 1124"
Cohesion: 1.0
Nodes (0): 

### Community 1125 - "Community 1125"
Cohesion: 1.0
Nodes (0): 

### Community 1126 - "Community 1126"
Cohesion: 1.0
Nodes (0): 

### Community 1127 - "Community 1127"
Cohesion: 1.0
Nodes (0): 

### Community 1128 - "Community 1128"
Cohesion: 1.0
Nodes (0): 

### Community 1129 - "Community 1129"
Cohesion: 1.0
Nodes (0): 

### Community 1130 - "Community 1130"
Cohesion: 1.0
Nodes (0): 

### Community 1131 - "Community 1131"
Cohesion: 1.0
Nodes (0): 

### Community 1132 - "Community 1132"
Cohesion: 1.0
Nodes (0): 

### Community 1133 - "Community 1133"
Cohesion: 1.0
Nodes (0): 

### Community 1134 - "Community 1134"
Cohesion: 1.0
Nodes (0): 

### Community 1135 - "Community 1135"
Cohesion: 1.0
Nodes (0): 

### Community 1136 - "Community 1136"
Cohesion: 1.0
Nodes (0): 

### Community 1137 - "Community 1137"
Cohesion: 1.0
Nodes (0): 

### Community 1138 - "Community 1138"
Cohesion: 1.0
Nodes (0): 

### Community 1139 - "Community 1139"
Cohesion: 1.0
Nodes (0): 

### Community 1140 - "Community 1140"
Cohesion: 1.0
Nodes (0): 

### Community 1141 - "Community 1141"
Cohesion: 1.0
Nodes (0): 

### Community 1142 - "Community 1142"
Cohesion: 1.0
Nodes (0): 

### Community 1143 - "Community 1143"
Cohesion: 1.0
Nodes (0): 

### Community 1144 - "Community 1144"
Cohesion: 1.0
Nodes (0): 

### Community 1145 - "Community 1145"
Cohesion: 1.0
Nodes (0): 

### Community 1146 - "Community 1146"
Cohesion: 1.0
Nodes (0): 

### Community 1147 - "Community 1147"
Cohesion: 1.0
Nodes (0): 

### Community 1148 - "Community 1148"
Cohesion: 1.0
Nodes (0): 

### Community 1149 - "Community 1149"
Cohesion: 1.0
Nodes (0): 

### Community 1150 - "Community 1150"
Cohesion: 1.0
Nodes (0): 

### Community 1151 - "Community 1151"
Cohesion: 1.0
Nodes (0): 

### Community 1152 - "Community 1152"
Cohesion: 1.0
Nodes (0): 

### Community 1153 - "Community 1153"
Cohesion: 1.0
Nodes (0): 

### Community 1154 - "Community 1154"
Cohesion: 1.0
Nodes (0): 

### Community 1155 - "Community 1155"
Cohesion: 1.0
Nodes (0): 

### Community 1156 - "Community 1156"
Cohesion: 1.0
Nodes (0): 

### Community 1157 - "Community 1157"
Cohesion: 1.0
Nodes (0): 

### Community 1158 - "Community 1158"
Cohesion: 1.0
Nodes (0): 

### Community 1159 - "Community 1159"
Cohesion: 1.0
Nodes (0): 

### Community 1160 - "Community 1160"
Cohesion: 1.0
Nodes (0): 

### Community 1161 - "Community 1161"
Cohesion: 1.0
Nodes (0): 

### Community 1162 - "Community 1162"
Cohesion: 1.0
Nodes (0): 

### Community 1163 - "Community 1163"
Cohesion: 1.0
Nodes (0): 

### Community 1164 - "Community 1164"
Cohesion: 1.0
Nodes (0): 

### Community 1165 - "Community 1165"
Cohesion: 1.0
Nodes (0): 

### Community 1166 - "Community 1166"
Cohesion: 1.0
Nodes (0): 

### Community 1167 - "Community 1167"
Cohesion: 1.0
Nodes (0): 

### Community 1168 - "Community 1168"
Cohesion: 1.0
Nodes (0): 

### Community 1169 - "Community 1169"
Cohesion: 1.0
Nodes (0): 

### Community 1170 - "Community 1170"
Cohesion: 1.0
Nodes (0): 

### Community 1171 - "Community 1171"
Cohesion: 1.0
Nodes (0): 

### Community 1172 - "Community 1172"
Cohesion: 1.0
Nodes (0): 

### Community 1173 - "Community 1173"
Cohesion: 1.0
Nodes (0): 

### Community 1174 - "Community 1174"
Cohesion: 1.0
Nodes (0): 

### Community 1175 - "Community 1175"
Cohesion: 1.0
Nodes (0): 

### Community 1176 - "Community 1176"
Cohesion: 1.0
Nodes (0): 

### Community 1177 - "Community 1177"
Cohesion: 1.0
Nodes (0): 

### Community 1178 - "Community 1178"
Cohesion: 1.0
Nodes (0): 

### Community 1179 - "Community 1179"
Cohesion: 1.0
Nodes (0): 

### Community 1180 - "Community 1180"
Cohesion: 1.0
Nodes (0): 

### Community 1181 - "Community 1181"
Cohesion: 1.0
Nodes (0): 

### Community 1182 - "Community 1182"
Cohesion: 1.0
Nodes (0): 

### Community 1183 - "Community 1183"
Cohesion: 1.0
Nodes (0): 

### Community 1184 - "Community 1184"
Cohesion: 1.0
Nodes (0): 

### Community 1185 - "Community 1185"
Cohesion: 1.0
Nodes (0): 

### Community 1186 - "Community 1186"
Cohesion: 1.0
Nodes (0): 

### Community 1187 - "Community 1187"
Cohesion: 1.0
Nodes (0): 

### Community 1188 - "Community 1188"
Cohesion: 1.0
Nodes (0): 

### Community 1189 - "Community 1189"
Cohesion: 1.0
Nodes (0): 

### Community 1190 - "Community 1190"
Cohesion: 1.0
Nodes (0): 

### Community 1191 - "Community 1191"
Cohesion: 1.0
Nodes (0): 

### Community 1192 - "Community 1192"
Cohesion: 1.0
Nodes (0): 

### Community 1193 - "Community 1193"
Cohesion: 1.0
Nodes (0): 

### Community 1194 - "Community 1194"
Cohesion: 1.0
Nodes (0): 

### Community 1195 - "Community 1195"
Cohesion: 1.0
Nodes (0): 

### Community 1196 - "Community 1196"
Cohesion: 1.0
Nodes (0): 

### Community 1197 - "Community 1197"
Cohesion: 1.0
Nodes (0): 

### Community 1198 - "Community 1198"
Cohesion: 1.0
Nodes (0): 

### Community 1199 - "Community 1199"
Cohesion: 1.0
Nodes (0): 

### Community 1200 - "Community 1200"
Cohesion: 1.0
Nodes (0): 

### Community 1201 - "Community 1201"
Cohesion: 1.0
Nodes (0): 

### Community 1202 - "Community 1202"
Cohesion: 1.0
Nodes (0): 

### Community 1203 - "Community 1203"
Cohesion: 1.0
Nodes (0): 

### Community 1204 - "Community 1204"
Cohesion: 1.0
Nodes (0): 

### Community 1205 - "Community 1205"
Cohesion: 1.0
Nodes (0): 

### Community 1206 - "Community 1206"
Cohesion: 1.0
Nodes (0): 

### Community 1207 - "Community 1207"
Cohesion: 1.0
Nodes (0): 

### Community 1208 - "Community 1208"
Cohesion: 1.0
Nodes (0): 

### Community 1209 - "Community 1209"
Cohesion: 1.0
Nodes (0): 

### Community 1210 - "Community 1210"
Cohesion: 1.0
Nodes (0): 

### Community 1211 - "Community 1211"
Cohesion: 1.0
Nodes (0): 

### Community 1212 - "Community 1212"
Cohesion: 1.0
Nodes (0): 

### Community 1213 - "Community 1213"
Cohesion: 1.0
Nodes (0): 

### Community 1214 - "Community 1214"
Cohesion: 1.0
Nodes (0): 

### Community 1215 - "Community 1215"
Cohesion: 1.0
Nodes (0): 

### Community 1216 - "Community 1216"
Cohesion: 1.0
Nodes (0): 

### Community 1217 - "Community 1217"
Cohesion: 1.0
Nodes (0): 

### Community 1218 - "Community 1218"
Cohesion: 1.0
Nodes (0): 

### Community 1219 - "Community 1219"
Cohesion: 1.0
Nodes (0): 

### Community 1220 - "Community 1220"
Cohesion: 1.0
Nodes (0): 

### Community 1221 - "Community 1221"
Cohesion: 1.0
Nodes (0): 

### Community 1222 - "Community 1222"
Cohesion: 1.0
Nodes (0): 

### Community 1223 - "Community 1223"
Cohesion: 1.0
Nodes (0): 

### Community 1224 - "Community 1224"
Cohesion: 1.0
Nodes (0): 

### Community 1225 - "Community 1225"
Cohesion: 1.0
Nodes (0): 

### Community 1226 - "Community 1226"
Cohesion: 1.0
Nodes (0): 

### Community 1227 - "Community 1227"
Cohesion: 1.0
Nodes (0): 

### Community 1228 - "Community 1228"
Cohesion: 1.0
Nodes (0): 

### Community 1229 - "Community 1229"
Cohesion: 1.0
Nodes (0): 

### Community 1230 - "Community 1230"
Cohesion: 1.0
Nodes (0): 

### Community 1231 - "Community 1231"
Cohesion: 1.0
Nodes (0): 

### Community 1232 - "Community 1232"
Cohesion: 1.0
Nodes (0): 

### Community 1233 - "Community 1233"
Cohesion: 1.0
Nodes (0): 

### Community 1234 - "Community 1234"
Cohesion: 1.0
Nodes (0): 

### Community 1235 - "Community 1235"
Cohesion: 1.0
Nodes (0): 

### Community 1236 - "Community 1236"
Cohesion: 1.0
Nodes (0): 

### Community 1237 - "Community 1237"
Cohesion: 1.0
Nodes (0): 

### Community 1238 - "Community 1238"
Cohesion: 1.0
Nodes (0): 

### Community 1239 - "Community 1239"
Cohesion: 1.0
Nodes (0): 

### Community 1240 - "Community 1240"
Cohesion: 1.0
Nodes (0): 

### Community 1241 - "Community 1241"
Cohesion: 1.0
Nodes (0): 

### Community 1242 - "Community 1242"
Cohesion: 1.0
Nodes (0): 

### Community 1243 - "Community 1243"
Cohesion: 1.0
Nodes (0): 

### Community 1244 - "Community 1244"
Cohesion: 1.0
Nodes (0): 

### Community 1245 - "Community 1245"
Cohesion: 1.0
Nodes (0): 

### Community 1246 - "Community 1246"
Cohesion: 1.0
Nodes (0): 

### Community 1247 - "Community 1247"
Cohesion: 1.0
Nodes (0): 

### Community 1248 - "Community 1248"
Cohesion: 1.0
Nodes (0): 

### Community 1249 - "Community 1249"
Cohesion: 1.0
Nodes (0): 

### Community 1250 - "Community 1250"
Cohesion: 1.0
Nodes (0): 

### Community 1251 - "Community 1251"
Cohesion: 1.0
Nodes (0): 

### Community 1252 - "Community 1252"
Cohesion: 1.0
Nodes (0): 

### Community 1253 - "Community 1253"
Cohesion: 1.0
Nodes (0): 

### Community 1254 - "Community 1254"
Cohesion: 1.0
Nodes (0): 

### Community 1255 - "Community 1255"
Cohesion: 1.0
Nodes (0): 

### Community 1256 - "Community 1256"
Cohesion: 1.0
Nodes (0): 

### Community 1257 - "Community 1257"
Cohesion: 1.0
Nodes (0): 

### Community 1258 - "Community 1258"
Cohesion: 1.0
Nodes (0): 

### Community 1259 - "Community 1259"
Cohesion: 1.0
Nodes (0): 

### Community 1260 - "Community 1260"
Cohesion: 1.0
Nodes (0): 

### Community 1261 - "Community 1261"
Cohesion: 1.0
Nodes (0): 

### Community 1262 - "Community 1262"
Cohesion: 1.0
Nodes (0): 

### Community 1263 - "Community 1263"
Cohesion: 1.0
Nodes (0): 

### Community 1264 - "Community 1264"
Cohesion: 1.0
Nodes (0): 

### Community 1265 - "Community 1265"
Cohesion: 1.0
Nodes (0): 

### Community 1266 - "Community 1266"
Cohesion: 1.0
Nodes (0): 

### Community 1267 - "Community 1267"
Cohesion: 1.0
Nodes (0): 

### Community 1268 - "Community 1268"
Cohesion: 1.0
Nodes (0): 

### Community 1269 - "Community 1269"
Cohesion: 1.0
Nodes (0): 

### Community 1270 - "Community 1270"
Cohesion: 1.0
Nodes (0): 

### Community 1271 - "Community 1271"
Cohesion: 1.0
Nodes (0): 

### Community 1272 - "Community 1272"
Cohesion: 1.0
Nodes (0): 

### Community 1273 - "Community 1273"
Cohesion: 1.0
Nodes (0): 

### Community 1274 - "Community 1274"
Cohesion: 1.0
Nodes (0): 

### Community 1275 - "Community 1275"
Cohesion: 1.0
Nodes (0): 

### Community 1276 - "Community 1276"
Cohesion: 1.0
Nodes (0): 

### Community 1277 - "Community 1277"
Cohesion: 1.0
Nodes (0): 

### Community 1278 - "Community 1278"
Cohesion: 1.0
Nodes (0): 

### Community 1279 - "Community 1279"
Cohesion: 1.0
Nodes (0): 

### Community 1280 - "Community 1280"
Cohesion: 1.0
Nodes (0): 

### Community 1281 - "Community 1281"
Cohesion: 1.0
Nodes (0): 

### Community 1282 - "Community 1282"
Cohesion: 1.0
Nodes (0): 

### Community 1283 - "Community 1283"
Cohesion: 1.0
Nodes (0): 

### Community 1284 - "Community 1284"
Cohesion: 1.0
Nodes (0): 

### Community 1285 - "Community 1285"
Cohesion: 1.0
Nodes (0): 

### Community 1286 - "Community 1286"
Cohesion: 1.0
Nodes (0): 

### Community 1287 - "Community 1287"
Cohesion: 1.0
Nodes (0): 

### Community 1288 - "Community 1288"
Cohesion: 1.0
Nodes (0): 

### Community 1289 - "Community 1289"
Cohesion: 1.0
Nodes (0): 

### Community 1290 - "Community 1290"
Cohesion: 1.0
Nodes (0): 

### Community 1291 - "Community 1291"
Cohesion: 1.0
Nodes (0): 

### Community 1292 - "Community 1292"
Cohesion: 1.0
Nodes (0): 

### Community 1293 - "Community 1293"
Cohesion: 1.0
Nodes (0): 

### Community 1294 - "Community 1294"
Cohesion: 1.0
Nodes (0): 

### Community 1295 - "Community 1295"
Cohesion: 1.0
Nodes (0): 

### Community 1296 - "Community 1296"
Cohesion: 1.0
Nodes (0): 

### Community 1297 - "Community 1297"
Cohesion: 1.0
Nodes (0): 

### Community 1298 - "Community 1298"
Cohesion: 1.0
Nodes (0): 

### Community 1299 - "Community 1299"
Cohesion: 1.0
Nodes (0): 

### Community 1300 - "Community 1300"
Cohesion: 1.0
Nodes (0): 

### Community 1301 - "Community 1301"
Cohesion: 1.0
Nodes (0): 

### Community 1302 - "Community 1302"
Cohesion: 1.0
Nodes (0): 

### Community 1303 - "Community 1303"
Cohesion: 1.0
Nodes (0): 

### Community 1304 - "Community 1304"
Cohesion: 1.0
Nodes (0): 

### Community 1305 - "Community 1305"
Cohesion: 1.0
Nodes (0): 

### Community 1306 - "Community 1306"
Cohesion: 1.0
Nodes (0): 

### Community 1307 - "Community 1307"
Cohesion: 1.0
Nodes (0): 

### Community 1308 - "Community 1308"
Cohesion: 1.0
Nodes (0): 

### Community 1309 - "Community 1309"
Cohesion: 1.0
Nodes (0): 

### Community 1310 - "Community 1310"
Cohesion: 1.0
Nodes (0): 

### Community 1311 - "Community 1311"
Cohesion: 1.0
Nodes (0): 

### Community 1312 - "Community 1312"
Cohesion: 1.0
Nodes (0): 

### Community 1313 - "Community 1313"
Cohesion: 1.0
Nodes (0): 

### Community 1314 - "Community 1314"
Cohesion: 1.0
Nodes (0): 

### Community 1315 - "Community 1315"
Cohesion: 1.0
Nodes (0): 

### Community 1316 - "Community 1316"
Cohesion: 1.0
Nodes (0): 

### Community 1317 - "Community 1317"
Cohesion: 1.0
Nodes (0): 

### Community 1318 - "Community 1318"
Cohesion: 1.0
Nodes (0): 

### Community 1319 - "Community 1319"
Cohesion: 1.0
Nodes (0): 

### Community 1320 - "Community 1320"
Cohesion: 1.0
Nodes (0): 

### Community 1321 - "Community 1321"
Cohesion: 1.0
Nodes (0): 

### Community 1322 - "Community 1322"
Cohesion: 1.0
Nodes (0): 

### Community 1323 - "Community 1323"
Cohesion: 1.0
Nodes (0): 

### Community 1324 - "Community 1324"
Cohesion: 1.0
Nodes (0): 

### Community 1325 - "Community 1325"
Cohesion: 1.0
Nodes (0): 

### Community 1326 - "Community 1326"
Cohesion: 1.0
Nodes (0): 

### Community 1327 - "Community 1327"
Cohesion: 1.0
Nodes (0): 

### Community 1328 - "Community 1328"
Cohesion: 1.0
Nodes (0): 

### Community 1329 - "Community 1329"
Cohesion: 1.0
Nodes (0): 

### Community 1330 - "Community 1330"
Cohesion: 1.0
Nodes (0): 

### Community 1331 - "Community 1331"
Cohesion: 1.0
Nodes (0): 

### Community 1332 - "Community 1332"
Cohesion: 1.0
Nodes (0): 

### Community 1333 - "Community 1333"
Cohesion: 1.0
Nodes (0): 

### Community 1334 - "Community 1334"
Cohesion: 1.0
Nodes (0): 

### Community 1335 - "Community 1335"
Cohesion: 1.0
Nodes (0): 

### Community 1336 - "Community 1336"
Cohesion: 1.0
Nodes (0): 

### Community 1337 - "Community 1337"
Cohesion: 1.0
Nodes (0): 

### Community 1338 - "Community 1338"
Cohesion: 1.0
Nodes (0): 

### Community 1339 - "Community 1339"
Cohesion: 1.0
Nodes (0): 

### Community 1340 - "Community 1340"
Cohesion: 1.0
Nodes (0): 

### Community 1341 - "Community 1341"
Cohesion: 1.0
Nodes (0): 

### Community 1342 - "Community 1342"
Cohesion: 1.0
Nodes (0): 

### Community 1343 - "Community 1343"
Cohesion: 1.0
Nodes (0): 

### Community 1344 - "Community 1344"
Cohesion: 1.0
Nodes (0): 

### Community 1345 - "Community 1345"
Cohesion: 1.0
Nodes (0): 

### Community 1346 - "Community 1346"
Cohesion: 1.0
Nodes (0): 

### Community 1347 - "Community 1347"
Cohesion: 1.0
Nodes (0): 

### Community 1348 - "Community 1348"
Cohesion: 1.0
Nodes (0): 

### Community 1349 - "Community 1349"
Cohesion: 1.0
Nodes (0): 

### Community 1350 - "Community 1350"
Cohesion: 1.0
Nodes (0): 

### Community 1351 - "Community 1351"
Cohesion: 1.0
Nodes (0): 

### Community 1352 - "Community 1352"
Cohesion: 1.0
Nodes (0): 

### Community 1353 - "Community 1353"
Cohesion: 1.0
Nodes (0): 

### Community 1354 - "Community 1354"
Cohesion: 1.0
Nodes (0): 

### Community 1355 - "Community 1355"
Cohesion: 1.0
Nodes (0): 

### Community 1356 - "Community 1356"
Cohesion: 1.0
Nodes (0): 

### Community 1357 - "Community 1357"
Cohesion: 1.0
Nodes (0): 

### Community 1358 - "Community 1358"
Cohesion: 1.0
Nodes (0): 

### Community 1359 - "Community 1359"
Cohesion: 1.0
Nodes (0): 

### Community 1360 - "Community 1360"
Cohesion: 1.0
Nodes (0): 

### Community 1361 - "Community 1361"
Cohesion: 1.0
Nodes (0): 

### Community 1362 - "Community 1362"
Cohesion: 1.0
Nodes (0): 

### Community 1363 - "Community 1363"
Cohesion: 1.0
Nodes (0): 

### Community 1364 - "Community 1364"
Cohesion: 1.0
Nodes (0): 

### Community 1365 - "Community 1365"
Cohesion: 1.0
Nodes (0): 

### Community 1366 - "Community 1366"
Cohesion: 1.0
Nodes (0): 

### Community 1367 - "Community 1367"
Cohesion: 1.0
Nodes (0): 

### Community 1368 - "Community 1368"
Cohesion: 1.0
Nodes (0): 

### Community 1369 - "Community 1369"
Cohesion: 1.0
Nodes (0): 

### Community 1370 - "Community 1370"
Cohesion: 1.0
Nodes (0): 

### Community 1371 - "Community 1371"
Cohesion: 1.0
Nodes (0): 

### Community 1372 - "Community 1372"
Cohesion: 1.0
Nodes (0): 

### Community 1373 - "Community 1373"
Cohesion: 1.0
Nodes (0): 

### Community 1374 - "Community 1374"
Cohesion: 1.0
Nodes (0): 

### Community 1375 - "Community 1375"
Cohesion: 1.0
Nodes (0): 

### Community 1376 - "Community 1376"
Cohesion: 1.0
Nodes (0): 

### Community 1377 - "Community 1377"
Cohesion: 1.0
Nodes (0): 

### Community 1378 - "Community 1378"
Cohesion: 1.0
Nodes (0): 

### Community 1379 - "Community 1379"
Cohesion: 1.0
Nodes (0): 

### Community 1380 - "Community 1380"
Cohesion: 1.0
Nodes (0): 

### Community 1381 - "Community 1381"
Cohesion: 1.0
Nodes (0): 

### Community 1382 - "Community 1382"
Cohesion: 1.0
Nodes (0): 

### Community 1383 - "Community 1383"
Cohesion: 1.0
Nodes (0): 

### Community 1384 - "Community 1384"
Cohesion: 1.0
Nodes (0): 

### Community 1385 - "Community 1385"
Cohesion: 1.0
Nodes (0): 

### Community 1386 - "Community 1386"
Cohesion: 1.0
Nodes (0): 

### Community 1387 - "Community 1387"
Cohesion: 1.0
Nodes (0): 

### Community 1388 - "Community 1388"
Cohesion: 1.0
Nodes (0): 

### Community 1389 - "Community 1389"
Cohesion: 1.0
Nodes (0): 

### Community 1390 - "Community 1390"
Cohesion: 1.0
Nodes (0): 

### Community 1391 - "Community 1391"
Cohesion: 1.0
Nodes (0): 

### Community 1392 - "Community 1392"
Cohesion: 1.0
Nodes (0): 

### Community 1393 - "Community 1393"
Cohesion: 1.0
Nodes (0): 

### Community 1394 - "Community 1394"
Cohesion: 1.0
Nodes (0): 

### Community 1395 - "Community 1395"
Cohesion: 1.0
Nodes (0): 

### Community 1396 - "Community 1396"
Cohesion: 1.0
Nodes (0): 

### Community 1397 - "Community 1397"
Cohesion: 1.0
Nodes (0): 

### Community 1398 - "Community 1398"
Cohesion: 1.0
Nodes (0): 

### Community 1399 - "Community 1399"
Cohesion: 1.0
Nodes (0): 

### Community 1400 - "Community 1400"
Cohesion: 1.0
Nodes (0): 

### Community 1401 - "Community 1401"
Cohesion: 1.0
Nodes (0): 

### Community 1402 - "Community 1402"
Cohesion: 1.0
Nodes (0): 

### Community 1403 - "Community 1403"
Cohesion: 1.0
Nodes (0): 

### Community 1404 - "Community 1404"
Cohesion: 1.0
Nodes (0): 

### Community 1405 - "Community 1405"
Cohesion: 1.0
Nodes (0): 

### Community 1406 - "Community 1406"
Cohesion: 1.0
Nodes (0): 

### Community 1407 - "Community 1407"
Cohesion: 1.0
Nodes (0): 

### Community 1408 - "Community 1408"
Cohesion: 1.0
Nodes (0): 

### Community 1409 - "Community 1409"
Cohesion: 1.0
Nodes (0): 

### Community 1410 - "Community 1410"
Cohesion: 1.0
Nodes (0): 

### Community 1411 - "Community 1411"
Cohesion: 1.0
Nodes (0): 

### Community 1412 - "Community 1412"
Cohesion: 1.0
Nodes (0): 

### Community 1413 - "Community 1413"
Cohesion: 1.0
Nodes (0): 

### Community 1414 - "Community 1414"
Cohesion: 1.0
Nodes (0): 

### Community 1415 - "Community 1415"
Cohesion: 1.0
Nodes (0): 

### Community 1416 - "Community 1416"
Cohesion: 1.0
Nodes (0): 

### Community 1417 - "Community 1417"
Cohesion: 1.0
Nodes (0): 

### Community 1418 - "Community 1418"
Cohesion: 1.0
Nodes (0): 

### Community 1419 - "Community 1419"
Cohesion: 1.0
Nodes (0): 

### Community 1420 - "Community 1420"
Cohesion: 1.0
Nodes (0): 

### Community 1421 - "Community 1421"
Cohesion: 1.0
Nodes (0): 

### Community 1422 - "Community 1422"
Cohesion: 1.0
Nodes (0): 

### Community 1423 - "Community 1423"
Cohesion: 1.0
Nodes (0): 

### Community 1424 - "Community 1424"
Cohesion: 1.0
Nodes (0): 

### Community 1425 - "Community 1425"
Cohesion: 1.0
Nodes (0): 

### Community 1426 - "Community 1426"
Cohesion: 1.0
Nodes (0): 

### Community 1427 - "Community 1427"
Cohesion: 1.0
Nodes (0): 

### Community 1428 - "Community 1428"
Cohesion: 1.0
Nodes (0): 

### Community 1429 - "Community 1429"
Cohesion: 1.0
Nodes (0): 

### Community 1430 - "Community 1430"
Cohesion: 1.0
Nodes (0): 

### Community 1431 - "Community 1431"
Cohesion: 1.0
Nodes (0): 

### Community 1432 - "Community 1432"
Cohesion: 1.0
Nodes (0): 

### Community 1433 - "Community 1433"
Cohesion: 1.0
Nodes (0): 

### Community 1434 - "Community 1434"
Cohesion: 1.0
Nodes (0): 

### Community 1435 - "Community 1435"
Cohesion: 1.0
Nodes (0): 

### Community 1436 - "Community 1436"
Cohesion: 1.0
Nodes (0): 

### Community 1437 - "Community 1437"
Cohesion: 1.0
Nodes (0): 

### Community 1438 - "Community 1438"
Cohesion: 1.0
Nodes (0): 

### Community 1439 - "Community 1439"
Cohesion: 1.0
Nodes (0): 

### Community 1440 - "Community 1440"
Cohesion: 1.0
Nodes (0): 

### Community 1441 - "Community 1441"
Cohesion: 1.0
Nodes (0): 

### Community 1442 - "Community 1442"
Cohesion: 1.0
Nodes (0): 

### Community 1443 - "Community 1443"
Cohesion: 1.0
Nodes (0): 

### Community 1444 - "Community 1444"
Cohesion: 1.0
Nodes (0): 

### Community 1445 - "Community 1445"
Cohesion: 1.0
Nodes (0): 

### Community 1446 - "Community 1446"
Cohesion: 1.0
Nodes (0): 

### Community 1447 - "Community 1447"
Cohesion: 1.0
Nodes (0): 

### Community 1448 - "Community 1448"
Cohesion: 1.0
Nodes (0): 

### Community 1449 - "Community 1449"
Cohesion: 1.0
Nodes (0): 

### Community 1450 - "Community 1450"
Cohesion: 1.0
Nodes (0): 

### Community 1451 - "Community 1451"
Cohesion: 1.0
Nodes (0): 

### Community 1452 - "Community 1452"
Cohesion: 1.0
Nodes (0): 

### Community 1453 - "Community 1453"
Cohesion: 1.0
Nodes (0): 

### Community 1454 - "Community 1454"
Cohesion: 1.0
Nodes (0): 

### Community 1455 - "Community 1455"
Cohesion: 1.0
Nodes (0): 

### Community 1456 - "Community 1456"
Cohesion: 1.0
Nodes (0): 

### Community 1457 - "Community 1457"
Cohesion: 1.0
Nodes (0): 

### Community 1458 - "Community 1458"
Cohesion: 1.0
Nodes (0): 

### Community 1459 - "Community 1459"
Cohesion: 1.0
Nodes (0): 

### Community 1460 - "Community 1460"
Cohesion: 1.0
Nodes (0): 

### Community 1461 - "Community 1461"
Cohesion: 1.0
Nodes (0): 

### Community 1462 - "Community 1462"
Cohesion: 1.0
Nodes (0): 

### Community 1463 - "Community 1463"
Cohesion: 1.0
Nodes (0): 

### Community 1464 - "Community 1464"
Cohesion: 1.0
Nodes (0): 

### Community 1465 - "Community 1465"
Cohesion: 1.0
Nodes (0): 

### Community 1466 - "Community 1466"
Cohesion: 1.0
Nodes (0): 

### Community 1467 - "Community 1467"
Cohesion: 1.0
Nodes (0): 

### Community 1468 - "Community 1468"
Cohesion: 1.0
Nodes (0): 

### Community 1469 - "Community 1469"
Cohesion: 1.0
Nodes (0): 

### Community 1470 - "Community 1470"
Cohesion: 1.0
Nodes (0): 

### Community 1471 - "Community 1471"
Cohesion: 1.0
Nodes (0): 

### Community 1472 - "Community 1472"
Cohesion: 1.0
Nodes (0): 

### Community 1473 - "Community 1473"
Cohesion: 1.0
Nodes (0): 

### Community 1474 - "Community 1474"
Cohesion: 1.0
Nodes (0): 

### Community 1475 - "Community 1475"
Cohesion: 1.0
Nodes (0): 

### Community 1476 - "Community 1476"
Cohesion: 1.0
Nodes (0): 

### Community 1477 - "Community 1477"
Cohesion: 1.0
Nodes (0): 

### Community 1478 - "Community 1478"
Cohesion: 1.0
Nodes (0): 

### Community 1479 - "Community 1479"
Cohesion: 1.0
Nodes (0): 

### Community 1480 - "Community 1480"
Cohesion: 1.0
Nodes (0): 

### Community 1481 - "Community 1481"
Cohesion: 1.0
Nodes (0): 

### Community 1482 - "Community 1482"
Cohesion: 1.0
Nodes (0): 

### Community 1483 - "Community 1483"
Cohesion: 1.0
Nodes (0): 

### Community 1484 - "Community 1484"
Cohesion: 1.0
Nodes (0): 

### Community 1485 - "Community 1485"
Cohesion: 1.0
Nodes (0): 

### Community 1486 - "Community 1486"
Cohesion: 1.0
Nodes (0): 

### Community 1487 - "Community 1487"
Cohesion: 1.0
Nodes (0): 

### Community 1488 - "Community 1488"
Cohesion: 1.0
Nodes (0): 

### Community 1489 - "Community 1489"
Cohesion: 1.0
Nodes (0): 

### Community 1490 - "Community 1490"
Cohesion: 1.0
Nodes (0): 

### Community 1491 - "Community 1491"
Cohesion: 1.0
Nodes (0): 

### Community 1492 - "Community 1492"
Cohesion: 1.0
Nodes (0): 

### Community 1493 - "Community 1493"
Cohesion: 1.0
Nodes (0): 

### Community 1494 - "Community 1494"
Cohesion: 1.0
Nodes (0): 

### Community 1495 - "Community 1495"
Cohesion: 1.0
Nodes (0): 

### Community 1496 - "Community 1496"
Cohesion: 1.0
Nodes (0): 

### Community 1497 - "Community 1497"
Cohesion: 1.0
Nodes (0): 

### Community 1498 - "Community 1498"
Cohesion: 1.0
Nodes (0): 

### Community 1499 - "Community 1499"
Cohesion: 1.0
Nodes (0): 

### Community 1500 - "Community 1500"
Cohesion: 1.0
Nodes (0): 

### Community 1501 - "Community 1501"
Cohesion: 1.0
Nodes (0): 

### Community 1502 - "Community 1502"
Cohesion: 1.0
Nodes (0): 

### Community 1503 - "Community 1503"
Cohesion: 1.0
Nodes (0): 

### Community 1504 - "Community 1504"
Cohesion: 1.0
Nodes (0): 

### Community 1505 - "Community 1505"
Cohesion: 1.0
Nodes (0): 

### Community 1506 - "Community 1506"
Cohesion: 1.0
Nodes (0): 

### Community 1507 - "Community 1507"
Cohesion: 1.0
Nodes (0): 

### Community 1508 - "Community 1508"
Cohesion: 1.0
Nodes (0): 

### Community 1509 - "Community 1509"
Cohesion: 1.0
Nodes (0): 

### Community 1510 - "Community 1510"
Cohesion: 1.0
Nodes (0): 

### Community 1511 - "Community 1511"
Cohesion: 1.0
Nodes (0): 

### Community 1512 - "Community 1512"
Cohesion: 1.0
Nodes (0): 

### Community 1513 - "Community 1513"
Cohesion: 1.0
Nodes (0): 

### Community 1514 - "Community 1514"
Cohesion: 1.0
Nodes (0): 

### Community 1515 - "Community 1515"
Cohesion: 1.0
Nodes (0): 

### Community 1516 - "Community 1516"
Cohesion: 1.0
Nodes (0): 

### Community 1517 - "Community 1517"
Cohesion: 1.0
Nodes (0): 

### Community 1518 - "Community 1518"
Cohesion: 1.0
Nodes (0): 

### Community 1519 - "Community 1519"
Cohesion: 1.0
Nodes (0): 

### Community 1520 - "Community 1520"
Cohesion: 1.0
Nodes (0): 

### Community 1521 - "Community 1521"
Cohesion: 1.0
Nodes (0): 

### Community 1522 - "Community 1522"
Cohesion: 1.0
Nodes (0): 

### Community 1523 - "Community 1523"
Cohesion: 1.0
Nodes (0): 

### Community 1524 - "Community 1524"
Cohesion: 1.0
Nodes (0): 

### Community 1525 - "Community 1525"
Cohesion: 1.0
Nodes (0): 

### Community 1526 - "Community 1526"
Cohesion: 1.0
Nodes (0): 

### Community 1527 - "Community 1527"
Cohesion: 1.0
Nodes (0): 

### Community 1528 - "Community 1528"
Cohesion: 1.0
Nodes (0): 

### Community 1529 - "Community 1529"
Cohesion: 1.0
Nodes (0): 

### Community 1530 - "Community 1530"
Cohesion: 1.0
Nodes (0): 

### Community 1531 - "Community 1531"
Cohesion: 1.0
Nodes (0): 

### Community 1532 - "Community 1532"
Cohesion: 1.0
Nodes (0): 

### Community 1533 - "Community 1533"
Cohesion: 1.0
Nodes (0): 

### Community 1534 - "Community 1534"
Cohesion: 1.0
Nodes (0): 

### Community 1535 - "Community 1535"
Cohesion: 1.0
Nodes (0): 

### Community 1536 - "Community 1536"
Cohesion: 1.0
Nodes (0): 

### Community 1537 - "Community 1537"
Cohesion: 1.0
Nodes (0): 

### Community 1538 - "Community 1538"
Cohesion: 1.0
Nodes (0): 

### Community 1539 - "Community 1539"
Cohesion: 1.0
Nodes (0): 

### Community 1540 - "Community 1540"
Cohesion: 1.0
Nodes (0): 

### Community 1541 - "Community 1541"
Cohesion: 1.0
Nodes (0): 

### Community 1542 - "Community 1542"
Cohesion: 1.0
Nodes (0): 

### Community 1543 - "Community 1543"
Cohesion: 1.0
Nodes (0): 

### Community 1544 - "Community 1544"
Cohesion: 1.0
Nodes (0): 

### Community 1545 - "Community 1545"
Cohesion: 1.0
Nodes (0): 

### Community 1546 - "Community 1546"
Cohesion: 1.0
Nodes (0): 

### Community 1547 - "Community 1547"
Cohesion: 1.0
Nodes (0): 

### Community 1548 - "Community 1548"
Cohesion: 1.0
Nodes (0): 

### Community 1549 - "Community 1549"
Cohesion: 1.0
Nodes (0): 

### Community 1550 - "Community 1550"
Cohesion: 1.0
Nodes (0): 

### Community 1551 - "Community 1551"
Cohesion: 1.0
Nodes (0): 

### Community 1552 - "Community 1552"
Cohesion: 1.0
Nodes (0): 

### Community 1553 - "Community 1553"
Cohesion: 1.0
Nodes (0): 

### Community 1554 - "Community 1554"
Cohesion: 1.0
Nodes (0): 

### Community 1555 - "Community 1555"
Cohesion: 1.0
Nodes (0): 

### Community 1556 - "Community 1556"
Cohesion: 1.0
Nodes (0): 

### Community 1557 - "Community 1557"
Cohesion: 1.0
Nodes (0): 

### Community 1558 - "Community 1558"
Cohesion: 1.0
Nodes (0): 

### Community 1559 - "Community 1559"
Cohesion: 1.0
Nodes (0): 

### Community 1560 - "Community 1560"
Cohesion: 1.0
Nodes (0): 

### Community 1561 - "Community 1561"
Cohesion: 1.0
Nodes (0): 

### Community 1562 - "Community 1562"
Cohesion: 1.0
Nodes (0): 

### Community 1563 - "Community 1563"
Cohesion: 1.0
Nodes (0): 

### Community 1564 - "Community 1564"
Cohesion: 1.0
Nodes (0): 

### Community 1565 - "Community 1565"
Cohesion: 1.0
Nodes (0): 

### Community 1566 - "Community 1566"
Cohesion: 1.0
Nodes (0): 

### Community 1567 - "Community 1567"
Cohesion: 1.0
Nodes (0): 

### Community 1568 - "Community 1568"
Cohesion: 1.0
Nodes (0): 

### Community 1569 - "Community 1569"
Cohesion: 1.0
Nodes (0): 

### Community 1570 - "Community 1570"
Cohesion: 1.0
Nodes (0): 

### Community 1571 - "Community 1571"
Cohesion: 1.0
Nodes (0): 

### Community 1572 - "Community 1572"
Cohesion: 1.0
Nodes (0): 

### Community 1573 - "Community 1573"
Cohesion: 1.0
Nodes (0): 

### Community 1574 - "Community 1574"
Cohesion: 1.0
Nodes (0): 

### Community 1575 - "Community 1575"
Cohesion: 1.0
Nodes (0): 

### Community 1576 - "Community 1576"
Cohesion: 1.0
Nodes (0): 

### Community 1577 - "Community 1577"
Cohesion: 1.0
Nodes (0): 

### Community 1578 - "Community 1578"
Cohesion: 1.0
Nodes (0): 

### Community 1579 - "Community 1579"
Cohesion: 1.0
Nodes (0): 

### Community 1580 - "Community 1580"
Cohesion: 1.0
Nodes (0): 

### Community 1581 - "Community 1581"
Cohesion: 1.0
Nodes (0): 

### Community 1582 - "Community 1582"
Cohesion: 1.0
Nodes (0): 

### Community 1583 - "Community 1583"
Cohesion: 1.0
Nodes (0): 

### Community 1584 - "Community 1584"
Cohesion: 1.0
Nodes (0): 

### Community 1585 - "Community 1585"
Cohesion: 1.0
Nodes (0): 

### Community 1586 - "Community 1586"
Cohesion: 1.0
Nodes (0): 

### Community 1587 - "Community 1587"
Cohesion: 1.0
Nodes (0): 

### Community 1588 - "Community 1588"
Cohesion: 1.0
Nodes (0): 

### Community 1589 - "Community 1589"
Cohesion: 1.0
Nodes (0): 

### Community 1590 - "Community 1590"
Cohesion: 1.0
Nodes (0): 

### Community 1591 - "Community 1591"
Cohesion: 1.0
Nodes (0): 

### Community 1592 - "Community 1592"
Cohesion: 1.0
Nodes (0): 

### Community 1593 - "Community 1593"
Cohesion: 1.0
Nodes (1): 聊天壳首页与控制台集成测试

### Community 1594 - "Community 1594"
Cohesion: 1.0
Nodes (1): frontend/存储.ts

### Community 1595 - "Community 1595"
Cohesion: 1.0
Nodes (1): frontend/房间内核.ts

### Community 1596 - "Community 1596"
Cohesion: 1.0
Nodes (1): frontend/房间实时编排.ts

### Community 1597 - "Community 1597"
Cohesion: 1.0
Nodes (1): frontend/房间恢复编排.ts

### Community 1598 - "Community 1598"
Cohesion: 1.0
Nodes (1): frontend/房间消息窗.ts

### Community 1599 - "Community 1599"
Cohesion: 1.0
Nodes (1): frontend/房间滚动器.ts

### Community 1600 - "Community 1600"
Cohesion: 1.0
Nodes (1): frontend/视图.ts

### Community 1601 - "Community 1601"
Cohesion: 1.0
Nodes (1): frontend/阅读推进编排.ts

### Community 1602 - "Community 1602"
Cohesion: 1.0
Nodes (0): 

### Community 1603 - "Community 1603"
Cohesion: 1.0
Nodes (1): src/后台外壳.rs

### Community 1604 - "Community 1604"
Cohesion: 1.0
Nodes (1): src/外壳.rs

### Community 1605 - "Community 1605"
Cohesion: 1.0
Nodes (1): src/实时外壳.rs

### Community 1606 - "Community 1606"
Cohesion: 1.0
Nodes (1): src/房间外壳.rs

### Community 1607 - "Community 1607"
Cohesion: 1.0
Nodes (1): src/用例.rs

### Community 1608 - "Community 1608"
Cohesion: 1.0
Nodes (1): src/适配.rs

### Community 1609 - "Community 1609"
Cohesion: 1.0
Nodes (0): 

### Community 1610 - "Community 1610"
Cohesion: 1.0
Nodes (0): 

### Community 1611 - "Community 1611"
Cohesion: 1.0
Nodes (0): 

### Community 1612 - "Community 1612"
Cohesion: 1.0
Nodes (0): 

### Community 1613 - "Community 1613"
Cohesion: 1.0
Nodes (0): 

### Community 1614 - "Community 1614"
Cohesion: 1.0
Nodes (0): 

### Community 1615 - "Community 1615"
Cohesion: 1.0
Nodes (0): 

### Community 1616 - "Community 1616"
Cohesion: 1.0
Nodes (0): 

### Community 1617 - "Community 1617"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **626 isolated node(s):** `AssertionError`, `AsyncResource`, `AsyncLocalStorage`, `ChildProcess`, `Worker` (+621 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 494`** (2 nodes): `assert.d.ts`, `AssertionError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 495`** (2 nodes): `child_process.d.ts`, `ChildProcess`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 496`** (2 nodes): `cluster.d.ts`, `Worker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 497`** (2 nodes): `dgram.d.ts`, `Socket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 498`** (2 nodes): `dns.d.ts`, `Resolver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 499`** (2 nodes): `domain.d.ts`, `Domain`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 500`** (2 nodes): `inspector.d.ts`, `Session`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 501`** (2 nodes): `perf_hooks.d.ts`, `PerformanceNodeEntry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 502`** (2 nodes): `readline.d.ts`, `Interface`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 503`** (2 nodes): `string_decoder.d.ts`, `StringDecoder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 504`** (2 nodes): `wasi.d.ts`, `WASI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 505`** (2 nodes): `DOMException.d.ts`, `DOMException`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 506`** (2 nodes): `Storage.d.ts`, `Storage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 507`** (2 nodes): `worker_threads.d.ts`, `Worker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 508`** (2 nodes): `AsyncTaskManager.d.ts`, `AsyncTaskManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 509`** (2 nodes): `AsyncTaskManagerDebugError.d.ts`, `AsyncTaskManagerDebugError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 510`** (2 nodes): `Base64.d.ts`, `Base64`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 511`** (2 nodes): `BrowserContext.d.ts`, `BrowserContext`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 512`** (2 nodes): `BrowserFrame.d.ts`, `BrowserFrame`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 513`** (2 nodes): `BrowserPage.d.ts`, `BrowserPage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 514`** (2 nodes): `BrowserSettingsFactory.d.ts`, `BrowserSettingsFactory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 515`** (2 nodes): `DetachedBrowser.d.ts`, `DetachedBrowser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 516`** (2 nodes): `DetachedBrowserContext.d.ts`, `DetachedBrowserContext`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 517`** (2 nodes): `DetachedBrowserFrame.d.ts`, `DetachedBrowserFrame`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 518`** (2 nodes): `DetachedBrowserPage.d.ts`, `DetachedBrowserPage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 519`** (2 nodes): `BrowserExceptionObserver.d.ts`, `BrowserExceptionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 520`** (2 nodes): `BrowserFrameFactory.d.ts`, `BrowserFrameFactory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 521`** (2 nodes): `BrowserFrameNavigator.d.ts`, `BrowserFrameNavigator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 522`** (2 nodes): `BrowserFrameScriptEvaluator.d.ts`, `BrowserFrameScriptEvaluator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 523`** (2 nodes): `BrowserPageUtility.d.ts`, `BrowserPageUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 524`** (2 nodes): `Clipboard.d.ts`, `Clipboard`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 525`** (2 nodes): `ClipboardItem.d.ts`, `ClipboardItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 526`** (2 nodes): `VirtualConsoleLogEntryStringifier.d.ts`, `VirtualConsoleLogEntryStringifier`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 527`** (2 nodes): `VirtualConsole.d.ts`, `VirtualConsole`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 528`** (2 nodes): `VirtualConsolePrinter.d.ts`, `VirtualConsolePrinter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 529`** (2 nodes): `CookieContainer.d.ts`, `CookieContainer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 530`** (2 nodes): `CookieExpireUtility.d.ts`, `CookieExpireUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 531`** (2 nodes): `CookieStringUtility.d.ts`, `CookieStringUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 532`** (2 nodes): `CookieURLUtility.d.ts`, `CookieURLUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 533`** (2 nodes): `CSS.d.ts`, `CSS`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 534`** (2 nodes): `CSSStyleSheet.d.ts`, `CSSStyleSheet`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 535`** (2 nodes): `CSSUnitValue.d.ts`, `CSSUnitValue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 536`** (2 nodes): `CSSStyleDeclarationComputedStyle.d.ts`, `CSSStyleDeclarationComputedStyle`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 537`** (2 nodes): `CSSStyleDeclarationCSSParser.d.ts`, `CSSStyleDeclarationCSSParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 538`** (2 nodes): `CSSStyleDeclaration.d.ts`, `CSSStyleDeclaration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 539`** (2 nodes): `CSSMeasurementConverter.d.ts`, `CSSMeasurementConverter`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 540`** (2 nodes): `CSSStyleDeclarationPropertyGetParser.d.ts`, `CSSStyleDeclarationPropertyGetParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 541`** (2 nodes): `CSSStyleDeclarationPropertyManager.d.ts`, `CSSStyleDeclarationPropertyManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 542`** (2 nodes): `CSSStyleDeclarationPropertySetParser.d.ts`, `CSSStyleDeclarationPropertySetParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 543`** (2 nodes): `CSSStyleDeclarationValueParser.d.ts`, `CSSStyleDeclarationValueParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 544`** (2 nodes): `CSSStyleDeclarationValueUtility.d.ts`, `CSSStyleDeclarationValueUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 545`** (2 nodes): `MediaList.d.ts`, `MediaList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 546`** (2 nodes): `CSSContainerRule.d.ts`, `CSSContainerRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 547`** (2 nodes): `CSSFontFaceRule.d.ts`, `CSSFontFaceRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 548`** (2 nodes): `CSSKeyframeRule.d.ts`, `CSSKeyframeRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 549`** (2 nodes): `CSSKeyframesRule.d.ts`, `CSSKeyframesRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 550`** (2 nodes): `CSSMediaRule.d.ts`, `CSSMediaRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 551`** (2 nodes): `CSSScopeRule.d.ts`, `CSSScopeRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 552`** (2 nodes): `CSSStyleRule.d.ts`, `CSSStyleRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 553`** (2 nodes): `CSSSupportsRule.d.ts`, `CSSSupportsRule`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 554`** (2 nodes): `CSSKeywordValue.d.ts`, `CSSKeywordValue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 555`** (2 nodes): `CSSStyleValue.d.ts`, `CSSStyleValue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 556`** (2 nodes): `StylePropertyMap.d.ts`, `StylePropertyMap`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 557`** (2 nodes): `StylePropertyMapReadOnly.d.ts`, `StylePropertyMapReadOnly`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 558`** (2 nodes): `CSSEscaper.d.ts`, `CSSEscaper`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 559`** (2 nodes): `CSSParser.d.ts`, `CSSParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 560`** (2 nodes): `CustomElementReactionStack.d.ts`, `CustomElementReactionStack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 561`** (2 nodes): `CustomElementRegistry.d.ts`, `CustomElementRegistry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 562`** (2 nodes): `CustomElementUtility.d.ts`, `CustomElementUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 563`** (2 nodes): `DOMMatrix.d.ts`, `DOMMatrix`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 564`** (2 nodes): `DOMMatrixReadOnly.d.ts`, `DOMMatrixReadOnly`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 565`** (2 nodes): `DOMPoint.d.ts`, `DOMPoint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 566`** (2 nodes): `DOMPointReadOnly.d.ts`, `DOMPointReadOnly`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 567`** (2 nodes): `DOMRect.d.ts`, `DOMRect`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 568`** (2 nodes): `DOMRectList.d.ts`, `DOMRectList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 569`** (2 nodes): `DOMRectReadOnly.d.ts`, `DOMRectReadOnly`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 570`** (2 nodes): `DOMStringMap.d.ts`, `DOMStringMap`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 571`** (2 nodes): `DOMStringMapUtility.d.ts`, `DOMStringMapUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 572`** (2 nodes): `DOMTokenList.d.ts`, `DOMTokenList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 573`** (2 nodes): `DOMImplementation.d.ts`, `DOMImplementation`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 574`** (2 nodes): `DOMParser.d.ts`, `DOMParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 575`** (2 nodes): `DataTransfer.d.ts`, `DataTransfer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 576`** (2 nodes): `DataTransferItem.d.ts`, `DataTransferItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 577`** (2 nodes): `DataTransferItemList.d.ts`, `DataTransferItemList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 578`** (2 nodes): `Event.d.ts`, `Event`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 579`** (2 nodes): `AnimationEvent.d.ts`, `AnimationEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 580`** (2 nodes): `ClipboardEvent.d.ts`, `ClipboardEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 581`** (2 nodes): `CloseEvent.d.ts`, `CloseEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 582`** (2 nodes): `CustomEvent.d.ts`, `CustomEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 583`** (2 nodes): `ErrorEvent.d.ts`, `ErrorEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 584`** (2 nodes): `FocusEvent.d.ts`, `FocusEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 585`** (2 nodes): `HashChangeEvent.d.ts`, `HashChangeEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 586`** (2 nodes): `InputEvent.d.ts`, `InputEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 587`** (2 nodes): `KeyboardEvent.d.ts`, `KeyboardEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 588`** (2 nodes): `MediaQueryListEvent.d.ts`, `MediaQueryListEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 589`** (2 nodes): `MediaStreamTrackEvent.d.ts`, `MediaStreamTrackEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 590`** (2 nodes): `MessageEvent.d.ts`, `MessageEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 591`** (2 nodes): `MouseEvent.d.ts`, `MouseEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 592`** (2 nodes): `PointerEvent.d.ts`, `PointerEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 593`** (2 nodes): `PopStateEvent.d.ts`, `PopStateEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 594`** (2 nodes): `ProgressEvent.d.ts`, `ProgressEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 595`** (2 nodes): `StorageEvent.d.ts`, `StorageEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 596`** (2 nodes): `SubmitEvent.d.ts`, `SubmitEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 597`** (2 nodes): `TouchEvent.d.ts`, `TouchEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 598`** (2 nodes): `WheelEvent.d.ts`, `WheelEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 599`** (2 nodes): `EventTarget.d.ts`, `EventTarget`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 600`** (2 nodes): `Touch.d.ts`, `Touch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 601`** (2 nodes): `UIEvent.d.ts`, `UIEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 602`** (2 nodes): `AbortController.d.ts`, `AbortController`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 603`** (2 nodes): `AbortSignal.d.ts`, `AbortSignal`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 604`** (2 nodes): `PreflightResponseCache.d.ts`, `PreflightResponseCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 605`** (2 nodes): `ResponseCache.d.ts`, `ResponseCache`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 606`** (2 nodes): `ResponseCacheFileSystem.d.ts`, `ResponseCacheFileSystem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 607`** (2 nodes): `DataURIParser.d.ts`, `DataURIParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 608`** (2 nodes): `Fetch.d.ts`, `Fetch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 609`** (2 nodes): `Headers.d.ts`, `Headers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 610`** (2 nodes): `MultipartFormDataParser.d.ts`, `MultipartFormDataParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 611`** (2 nodes): `MultipartReader.d.ts`, `MultipartReader`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 612`** (2 nodes): `PreloadEntry.d.ts`, `PreloadEntry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 613`** (2 nodes): `PreloadUtility.d.ts`, `PreloadUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 614`** (2 nodes): `ResourceFetch.d.ts`, `ResourceFetch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 615`** (2 nodes): `Response.d.ts`, `Response`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 616`** (2 nodes): `SyncFetch.d.ts`, `SyncFetch`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 617`** (2 nodes): `FetchBodyUtility.d.ts`, `FetchBodyUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 618`** (2 nodes): `FetchRequestHeaderUtility.d.ts`, `FetchRequestHeaderUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 619`** (2 nodes): `FetchRequestReferrerUtility.d.ts`, `FetchRequestReferrerUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 620`** (2 nodes): `FetchRequestValidationUtility.d.ts`, `FetchRequestValidationUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 621`** (2 nodes): `FetchResponseHeaderUtility.d.ts`, `FetchResponseHeaderUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 622`** (2 nodes): `FetchResponseRedirectUtility.d.ts`, `FetchResponseRedirectUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 623`** (2 nodes): `SyncFetchScriptBuilder.d.ts`, `SyncFetchScriptBuilder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 624`** (2 nodes): `VirtualServerUtility.d.ts`, `VirtualServerUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 625`** (2 nodes): `Blob.d.ts`, `Blob`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 626`** (2 nodes): `File.d.ts`, `File`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 627`** (2 nodes): `FileReader.d.ts`, `FileReader`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 628`** (2 nodes): `FormData.d.ts`, `FormData`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 629`** (2 nodes): `History.d.ts`, `History`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 630`** (2 nodes): `HistoryItemList.d.ts`, `HistoryItemList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 631`** (2 nodes): `HTMLParser.d.ts`, `HTMLParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 632`** (2 nodes): `HTMLSerializer.d.ts`, `HTMLSerializer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 633`** (2 nodes): `IntersectionObserver.d.ts`, `IntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 634`** (2 nodes): `IntersectionObserverEntry.d.ts`, `IntersectionObserverEntry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 635`** (2 nodes): `JavaScriptCompiler.d.ts`, `JavaScriptCompiler`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 636`** (2 nodes): `Location.d.ts`, `Location`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 637`** (2 nodes): `MediaQueryItem.d.ts`, `MediaQueryItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 638`** (2 nodes): `MediaQueryList.d.ts`, `MediaQueryList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 639`** (2 nodes): `MediaQueryParser.d.ts`, `MediaQueryParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 640`** (2 nodes): `ECMAScriptModuleCompiler.d.ts`, `ECMAScriptModuleCompiler`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 641`** (2 nodes): `ModuleFactory.d.ts`, `ModuleFactory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 642`** (2 nodes): `MutationObserver.d.ts`, `MutationObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 643`** (2 nodes): `MutationObserverListener.d.ts`, `MutationObserverListener`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 644`** (2 nodes): `MutationRecord.d.ts`, `MutationRecord`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 645`** (2 nodes): `MimeType.d.ts`, `MimeType`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 646`** (2 nodes): `MimeTypeArray.d.ts`, `MimeTypeArray`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 647`** (2 nodes): `Navigator.d.ts`, `Navigator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 648`** (2 nodes): `Plugin.d.ts`, `Plugin`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 649`** (2 nodes): `PluginArray.d.ts`, `PluginArray`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 650`** (2 nodes): `Attr.d.ts`, `Attr`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 651`** (2 nodes): `CharacterDataUtility.d.ts`, `CharacterDataUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 652`** (2 nodes): `ChildNodeUtility.d.ts`, `ChildNodeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 653`** (2 nodes): `NonDocumentChildNodeUtility.d.ts`, `NonDocumentChildNodeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 654`** (2 nodes): `Comment.d.ts`, `Comment`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 655`** (2 nodes): `Document.d.ts`, `Document`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 656`** (2 nodes): `DocumentReadyStateManager.d.ts`, `DocumentReadyStateManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 657`** (2 nodes): `DocumentFragment.d.ts`, `DocumentFragment`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 658`** (2 nodes): `DocumentType.d.ts`, `DocumentType`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 659`** (2 nodes): `Element.d.ts`, `Element`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 660`** (2 nodes): `ElementEventAttributeUtility.d.ts`, `ElementEventAttributeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 661`** (2 nodes): `HTMLCollection.d.ts`, `HTMLCollection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 662`** (2 nodes): `NamedNodeMap.d.ts`, `NamedNodeMap`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 663`** (2 nodes): `NamedNodeMapProxyFactory.d.ts`, `NamedNodeMapProxyFactory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 664`** (2 nodes): `HTMLAnchorElement.d.ts`, `HTMLAnchorElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 665`** (2 nodes): `HTMLAreaElement.d.ts`, `HTMLAreaElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 666`** (2 nodes): `Audio.d.ts`, `Audio`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 667`** (2 nodes): `HTMLAudioElement.d.ts`, `HTMLAudioElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 668`** (2 nodes): `HTMLAudioElement.ts`, `HTMLAudioElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 669`** (2 nodes): `HTMLBaseElement.d.ts`, `HTMLBaseElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 670`** (2 nodes): `HTMLBodyElement.d.ts`, `HTMLBodyElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 671`** (2 nodes): `HTMLBRElement.d.ts`, `HTMLBRElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 672`** (2 nodes): `HTMLBRElement.ts`, `HTMLBRElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 673`** (2 nodes): `HTMLButtonElement.d.ts`, `HTMLButtonElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 674`** (2 nodes): `CanvasCaptureMediaStreamTrack.d.ts`, `CanvasCaptureMediaStreamTrack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 675`** (2 nodes): `HTMLCanvasElement.d.ts`, `HTMLCanvasElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 676`** (2 nodes): `ImageBitmap.d.ts`, `ImageBitmap`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 677`** (2 nodes): `OffscreenCanvas.d.ts`, `OffscreenCanvas`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 678`** (2 nodes): `HTMLDListElement.d.ts`, `HTMLDListElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 679`** (2 nodes): `HTMLDListElement.ts`, `HTMLDListElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 680`** (2 nodes): `HTMLDataElement.d.ts`, `HTMLDataElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 681`** (2 nodes): `HTMLDataListElement.d.ts`, `HTMLDataListElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 682`** (2 nodes): `HTMLDetailsElement.d.ts`, `HTMLDetailsElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 683`** (2 nodes): `HTMLDialogElement.d.ts`, `HTMLDialogElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 684`** (2 nodes): `HTMLDivElement.d.ts`, `HTMLDivElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 685`** (2 nodes): `HTMLDivElement.ts`, `HTMLDivElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 686`** (2 nodes): `HTMLDocument.d.ts`, `HTMLDocument`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 687`** (2 nodes): `HTMLElement.d.ts`, `HTMLElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 688`** (2 nodes): `HTMLElementUtility.d.ts`, `HTMLElementUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 689`** (2 nodes): `HTMLEmbedElement.d.ts`, `HTMLEmbedElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 690`** (2 nodes): `HTMLFieldSetElement.d.ts`, `HTMLFieldSetElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 691`** (2 nodes): `HTMLFormControlsCollection.d.ts`, `HTMLFormControlsCollection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 692`** (2 nodes): `HTMLFormElement.d.ts`, `HTMLFormElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 693`** (2 nodes): `RadioNodeList.d.ts`, `RadioNodeList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 694`** (2 nodes): `HTMLHeadElement.d.ts`, `HTMLHeadElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 695`** (2 nodes): `HTMLHeadElement.ts`, `HTMLHeadElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 696`** (2 nodes): `HTMLHeadingElement.d.ts`, `HTMLHeadingElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 697`** (2 nodes): `HTMLHeadingElement.ts`, `HTMLHeadingElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 698`** (2 nodes): `HTMLHRElement.d.ts`, `HTMLHRElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 699`** (2 nodes): `HTMLHRElement.ts`, `HTMLHRElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 700`** (2 nodes): `HTMLHtmlElement.d.ts`, `HTMLHtmlElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 701`** (2 nodes): `HTMLHtmlElement.ts`, `HTMLHtmlElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 702`** (2 nodes): `HTMLHyperlinkElementUtility.d.ts`, `HTMLHyperlinkElementUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 703`** (2 nodes): `HTMLIFrameElement.d.ts`, `HTMLIFrameElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 704`** (2 nodes): `HTMLImageElement.d.ts`, `HTMLImageElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 705`** (2 nodes): `Image.d.ts`, `Image`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 706`** (2 nodes): `FileList.d.ts`, `FileList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 707`** (2 nodes): `HTMLInputElement.d.ts`, `HTMLInputElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 708`** (2 nodes): `HTMLInputElementDateUtility.d.ts`, `HTMLInputElementDateUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 709`** (2 nodes): `HTMLInputElementValueSanitizer.d.ts`, `HTMLInputElementValueSanitizer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 710`** (2 nodes): `HTMLInputElementValueStepping.d.ts`, `HTMLInputElementValueStepping`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 711`** (2 nodes): `HTMLLabelElement.d.ts`, `HTMLLabelElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 712`** (2 nodes): `HTMLLabelElementUtility.d.ts`, `HTMLLabelElementUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 713`** (2 nodes): `HTMLLegendElement.d.ts`, `HTMLLegendElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 714`** (2 nodes): `HTMLLIElement.d.ts`, `HTMLLIElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 715`** (2 nodes): `HTMLLinkElement.d.ts`, `HTMLLinkElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 716`** (2 nodes): `HTMLMapElement.d.ts`, `HTMLMapElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 717`** (2 nodes): `HTMLMediaElement.d.ts`, `HTMLMediaElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 718`** (2 nodes): `MediaStream.d.ts`, `MediaStream`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 719`** (2 nodes): `MediaStreamTrack.d.ts`, `MediaStreamTrack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 720`** (2 nodes): `RemotePlayback.d.ts`, `RemotePlayback`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 721`** (2 nodes): `TextTrack.d.ts`, `TextTrack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 722`** (2 nodes): `TextTrackCueList.d.ts`, `TextTrackCueList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 723`** (2 nodes): `TextTrackList.d.ts`, `TextTrackList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 724`** (2 nodes): `TimeRanges.d.ts`, `TimeRanges`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 725`** (2 nodes): `VTTCue.d.ts`, `VTTCue`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 726`** (2 nodes): `VTTRegion.d.ts`, `VTTRegion`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 727`** (2 nodes): `VTTRegion.ts`, `VTTRegion`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 728`** (2 nodes): `HTMLMenuElement.d.ts`, `HTMLMenuElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 729`** (2 nodes): `HTMLMenuElement.ts`, `HTMLMenuElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 730`** (2 nodes): `HTMLMetaElement.d.ts`, `HTMLMetaElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 731`** (2 nodes): `HTMLMeterElement.d.ts`, `HTMLMeterElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 732`** (2 nodes): `HTMLModElement.d.ts`, `HTMLModElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 733`** (2 nodes): `HTMLOListElement.d.ts`, `HTMLOListElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 734`** (2 nodes): `HTMLObjectElement.d.ts`, `HTMLObjectElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 735`** (2 nodes): `HTMLOptGroupElement.d.ts`, `HTMLOptGroupElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 736`** (2 nodes): `HTMLOptionElement.d.ts`, `HTMLOptionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 737`** (2 nodes): `HTMLOutputElement.d.ts`, `HTMLOutputElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 738`** (2 nodes): `HTMLParagraphElement.d.ts`, `HTMLParagraphElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 739`** (2 nodes): `HTMLParagraphElement.ts`, `HTMLParagraphElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 740`** (2 nodes): `HTMLParamElement.d.ts`, `HTMLParamElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 741`** (2 nodes): `HTMLParamElement.ts`, `HTMLParamElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 742`** (2 nodes): `HTMLPictureElement.d.ts`, `HTMLPictureElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 743`** (2 nodes): `HTMLPictureElement.ts`, `HTMLPictureElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 744`** (2 nodes): `HTMLPreElement.d.ts`, `HTMLPreElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 745`** (2 nodes): `HTMLPreElement.ts`, `HTMLPreElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 746`** (2 nodes): `HTMLProgressElement.d.ts`, `HTMLProgressElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 747`** (2 nodes): `HTMLQuoteElement.d.ts`, `HTMLQuoteElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 748`** (2 nodes): `HTMLScriptElement.d.ts`, `HTMLScriptElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 749`** (2 nodes): `HTMLOptionsCollection.d.ts`, `HTMLOptionsCollection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 750`** (2 nodes): `HTMLSelectElement.d.ts`, `HTMLSelectElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 751`** (2 nodes): `HTMLSlotElement.d.ts`, `HTMLSlotElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 752`** (2 nodes): `HTMLSourceElement.d.ts`, `HTMLSourceElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 753`** (2 nodes): `HTMLSpanElement.d.ts`, `HTMLSpanElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 754`** (2 nodes): `HTMLSpanElement.ts`, `HTMLSpanElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 755`** (2 nodes): `HTMLStyleElement.d.ts`, `HTMLStyleElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 756`** (2 nodes): `HTMLTableCaptionElement.d.ts`, `HTMLTableCaptionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 757`** (2 nodes): `HTMLTableCaptionElement.ts`, `HTMLTableCaptionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 758`** (2 nodes): `HTMLTableCellElement.d.ts`, `HTMLTableCellElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 759`** (2 nodes): `HTMLTableColElement.d.ts`, `HTMLTableColElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 760`** (2 nodes): `HTMLTableColElement.ts`, `HTMLTableColElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 761`** (2 nodes): `HTMLTableElement.d.ts`, `HTMLTableElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 762`** (2 nodes): `HTMLTableRowElement.d.ts`, `HTMLTableRowElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 763`** (2 nodes): `HTMLTableSectionElement.d.ts`, `HTMLTableSectionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 764`** (2 nodes): `HTMLTemplateElement.d.ts`, `HTMLTemplateElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 765`** (2 nodes): `HTMLTextAreaElement.d.ts`, `HTMLTextAreaElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 766`** (2 nodes): `HTMLTimeElement.d.ts`, `HTMLTimeElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 767`** (2 nodes): `HTMLTitleElement.d.ts`, `HTMLTitleElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 768`** (2 nodes): `HTMLTrackElement.d.ts`, `HTMLTrackElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 769`** (2 nodes): `HTMLUListElement.d.ts`, `HTMLUListElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 770`** (2 nodes): `HTMLUListElement.ts`, `HTMLUListElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 771`** (2 nodes): `HTMLUnknownElement.d.ts`, `HTMLUnknownElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 772`** (2 nodes): `HTMLUnknownElement.ts`, `HTMLUnknownElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 773`** (2 nodes): `HTMLVideoElement.d.ts`, `HTMLVideoElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 774`** (2 nodes): `HTMLVideoElement.ts`, `HTMLVideoElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 775`** (2 nodes): `NodeList.d.ts`, `NodeList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 776`** (2 nodes): `NodeUtility.d.ts`, `NodeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 777`** (2 nodes): `NodeFactory.d.ts`, `NodeFactory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 778`** (2 nodes): `ParentNodeUtility.d.ts`, `ParentNodeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 779`** (2 nodes): `ProcessingInstruction.d.ts`, `ProcessingInstruction`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 780`** (2 nodes): `ShadowRoot.d.ts`, `ShadowRoot`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 781`** (2 nodes): `SVGAnimateElement.d.ts`, `SVGAnimateElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 782`** (2 nodes): `SVGAnimateElement.ts`, `SVGAnimateElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 783`** (2 nodes): `SVGAnimateMotionElement.d.ts`, `SVGAnimateMotionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 784`** (2 nodes): `SVGAnimateMotionElement.ts`, `SVGAnimateMotionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 785`** (2 nodes): `SVGAnimateTransformElement.d.ts`, `SVGAnimateTransformElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 786`** (2 nodes): `SVGAnimateTransformElement.ts`, `SVGAnimateTransformElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 787`** (2 nodes): `SVGAnimationElement.d.ts`, `SVGAnimationElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 788`** (2 nodes): `SVGCircleElement.d.ts`, `SVGCircleElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 789`** (2 nodes): `SVGClipPathElement.d.ts`, `SVGClipPathElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 790`** (2 nodes): `SVGComponentTransferFunctionElement.d.ts`, `SVGComponentTransferFunctionElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 791`** (2 nodes): `SVGDefsElement.d.ts`, `SVGDefsElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 792`** (2 nodes): `SVGDefsElement.ts`, `SVGDefsElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 793`** (2 nodes): `SVGDescElement.d.ts`, `SVGDescElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 794`** (2 nodes): `SVGDescElement.ts`, `SVGDescElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 795`** (2 nodes): `SVGElement.d.ts`, `SVGElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 796`** (2 nodes): `SVGEllipseElement.d.ts`, `SVGEllipseElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 797`** (2 nodes): `SVGFEBlendElement.d.ts`, `SVGFEBlendElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 798`** (2 nodes): `SVGFEColorMatrixElement.d.ts`, `SVGFEColorMatrixElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 799`** (2 nodes): `SVGFEComponentTransferElement.d.ts`, `SVGFEComponentTransferElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 800`** (2 nodes): `SVGFECompositeElement.d.ts`, `SVGFECompositeElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 801`** (2 nodes): `SVGFEConvolveMatrixElement.d.ts`, `SVGFEConvolveMatrixElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 802`** (2 nodes): `SVGFEDiffuseLightingElement.d.ts`, `SVGFEDiffuseLightingElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 803`** (2 nodes): `SVGFEDisplacementMapElement.d.ts`, `SVGFEDisplacementMapElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 804`** (2 nodes): `SVGFEDistantLightElement.d.ts`, `SVGFEDistantLightElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 805`** (2 nodes): `SVGFEDropShadowElement.d.ts`, `SVGFEDropShadowElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 806`** (2 nodes): `SVGFEFloodElement.d.ts`, `SVGFEFloodElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 807`** (2 nodes): `SVGFEFuncAElement.d.ts`, `SVGFEFuncAElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 808`** (2 nodes): `SVGFEFuncAElement.ts`, `SVGFEFuncAElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 809`** (2 nodes): `SVGFEFuncBElement.d.ts`, `SVGFEFuncBElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 810`** (2 nodes): `SVGFEFuncBElement.ts`, `SVGFEFuncBElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 811`** (2 nodes): `SVGFEFuncGElement.d.ts`, `SVGFEFuncGElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 812`** (2 nodes): `SVGFEFuncGElement.ts`, `SVGFEFuncGElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 813`** (2 nodes): `SVGFEFuncRElement.d.ts`, `SVGFEFuncRElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 814`** (2 nodes): `SVGFEFuncRElement.ts`, `SVGFEFuncRElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 815`** (2 nodes): `SVGFEGaussianBlurElement.d.ts`, `SVGFEGaussianBlurElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 816`** (2 nodes): `SVGFEImageElement.d.ts`, `SVGFEImageElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 817`** (2 nodes): `SVGFEMergeElement.d.ts`, `SVGFEMergeElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 818`** (2 nodes): `SVGFEMergeNodeElement.d.ts`, `SVGFEMergeNodeElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 819`** (2 nodes): `SVGFEMorphologyElement.d.ts`, `SVGFEMorphologyElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 820`** (2 nodes): `SVGFEOffsetElement.d.ts`, `SVGFEOffsetElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 821`** (2 nodes): `SVGFEPointLightElement.d.ts`, `SVGFEPointLightElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 822`** (2 nodes): `SVGFESpecularLightingElement.d.ts`, `SVGFESpecularLightingElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 823`** (2 nodes): `SVGFESpotLightElement.d.ts`, `SVGFESpotLightElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 824`** (2 nodes): `SVGFETileElement.d.ts`, `SVGFETileElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 825`** (2 nodes): `SVGFETurbulenceElement.d.ts`, `SVGFETurbulenceElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 826`** (2 nodes): `SVGFilterElement.d.ts`, `SVGFilterElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 827`** (2 nodes): `SVGForeignObjectElement.d.ts`, `SVGForeignObjectElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 828`** (2 nodes): `SVGGElement.d.ts`, `SVGGElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 829`** (2 nodes): `SVGGElement.ts`, `SVGGElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 830`** (2 nodes): `SVGGeometryElement.d.ts`, `SVGGeometryElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 831`** (2 nodes): `SVGGradientElement.d.ts`, `SVGGradientElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 832`** (2 nodes): `SVGGraphicsElement.d.ts`, `SVGGraphicsElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 833`** (2 nodes): `SVGImageElement.d.ts`, `SVGImageElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 834`** (2 nodes): `SVGLineElement.d.ts`, `SVGLineElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 835`** (2 nodes): `SVGLinearGradientElement.d.ts`, `SVGLinearGradientElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 836`** (2 nodes): `SVGMPathElement.d.ts`, `SVGMPathElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 837`** (2 nodes): `SVGMarkerElement.d.ts`, `SVGMarkerElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 838`** (2 nodes): `SVGMaskElement.d.ts`, `SVGMaskElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 839`** (2 nodes): `SVGMetadataElement.d.ts`, `SVGMetadataElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 840`** (2 nodes): `SVGMetadataElement.ts`, `SVGMetadataElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 841`** (2 nodes): `SVGPathElement.d.ts`, `SVGPathElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 842`** (2 nodes): `SVGPathElement.ts`, `SVGPathElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 843`** (2 nodes): `SVGPatternElement.d.ts`, `SVGPatternElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 844`** (2 nodes): `SVGPolygonElement.d.ts`, `SVGPolygonElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 845`** (2 nodes): `SVGPolylineElement.d.ts`, `SVGPolylineElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 846`** (2 nodes): `SVGRadialGradientElement.d.ts`, `SVGRadialGradientElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 847`** (2 nodes): `SVGRectElement.d.ts`, `SVGRectElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 848`** (2 nodes): `SVGScriptElement.d.ts`, `SVGScriptElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 849`** (2 nodes): `SVGSetElement.d.ts`, `SVGSetElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 850`** (2 nodes): `SVGSetElement.ts`, `SVGSetElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 851`** (2 nodes): `SVGStopElement.d.ts`, `SVGStopElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 852`** (2 nodes): `SVGStyleElement.d.ts`, `SVGStyleElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 853`** (2 nodes): `SVGSVGElement.d.ts`, `SVGSVGElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 854`** (2 nodes): `SVGSwitchElement.d.ts`, `SVGSwitchElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 855`** (2 nodes): `SVGSwitchElement.ts`, `SVGSwitchElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 856`** (2 nodes): `SVGSymbolElement.d.ts`, `SVGSymbolElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 857`** (2 nodes): `SVGSymbolElement.ts`, `SVGSymbolElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 858`** (2 nodes): `SVGTSpanElement.d.ts`, `SVGTSpanElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 859`** (2 nodes): `SVGTSpanElement.ts`, `SVGTSpanElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 860`** (2 nodes): `SVGTextContentElement.d.ts`, `SVGTextContentElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 861`** (2 nodes): `SVGTextElement.d.ts`, `SVGTextElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 862`** (2 nodes): `SVGTextElement.ts`, `SVGTextElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 863`** (2 nodes): `SVGTextPathElement.d.ts`, `SVGTextPathElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 864`** (2 nodes): `SVGTextPositioningElement.d.ts`, `SVGTextPositioningElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 865`** (2 nodes): `SVGTitleElement.d.ts`, `SVGTitleElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 866`** (2 nodes): `SVGTitleElement.ts`, `SVGTitleElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 867`** (2 nodes): `SVGUseElement.d.ts`, `SVGUseElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 868`** (2 nodes): `SVGViewElement.d.ts`, `SVGViewElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 869`** (2 nodes): `SVGViewElement.ts`, `SVGViewElement`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 870`** (2 nodes): `Text.d.ts`, `Text`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 871`** (2 nodes): `XMLDocument.d.ts`, `XMLDocument`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 872`** (2 nodes): `XMLDocument.ts`, `XMLDocument`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 873`** (2 nodes): `Permissions.d.ts`, `Permissions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 874`** (2 nodes): `PermissionStatus.d.ts`, `PermissionStatus`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 875`** (2 nodes): `QuerySelector.d.ts`, `QuerySelector`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 876`** (2 nodes): `SelectorItem.d.ts`, `SelectorItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 877`** (2 nodes): `SelectorParser.d.ts`, `SelectorParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 878`** (2 nodes): `range.d.ts`, `Range`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 879`** (2 nodes): `RangeUtility.d.ts`, `RangeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 880`** (2 nodes): `ResizeObserver.d.ts`, `ResizeObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 881`** (2 nodes): `Screen.d.ts`, `Screen`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 882`** (2 nodes): `Screen.ts`, `Screen`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 883`** (2 nodes): `ScreenDetailed.d.ts`, `ScreenDetailed`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 884`** (2 nodes): `ScreenDetailed.ts`, `ScreenDetailed`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 885`** (2 nodes): `ScreenDetails.d.ts`, `ScreenDetails`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 886`** (2 nodes): `Selection.d.ts`, `Selection`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 887`** (2 nodes): `SVGAngle.d.ts`, `SVGAngle`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 888`** (2 nodes): `SVGAnimatedAngle.d.ts`, `SVGAnimatedAngle`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 889`** (2 nodes): `SVGAnimatedBoolean.d.ts`, `SVGAnimatedBoolean`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 890`** (2 nodes): `SVGAnimatedEnumeration.d.ts`, `SVGAnimatedEnumeration`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 891`** (2 nodes): `SVGAnimatedInteger.d.ts`, `SVGAnimatedInteger`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 892`** (2 nodes): `SVGAnimatedLength.d.ts`, `SVGAnimatedLength`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 893`** (2 nodes): `SVGAnimatedLengthList.d.ts`, `SVGAnimatedLengthList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 894`** (2 nodes): `SVGAnimatedNumber.d.ts`, `SVGAnimatedNumber`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 895`** (2 nodes): `SVGAnimatedNumberList.d.ts`, `SVGAnimatedNumberList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 896`** (2 nodes): `SVGAnimatedPreserveAspectRatio.d.ts`, `SVGAnimatedPreserveAspectRatio`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 897`** (2 nodes): `SVGAnimatedRect.d.ts`, `SVGAnimatedRect`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 898`** (2 nodes): `SVGAnimatedString.d.ts`, `SVGAnimatedString`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 899`** (2 nodes): `SVGAnimatedTransformList.d.ts`, `SVGAnimatedTransformList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 900`** (2 nodes): `SVGLength.d.ts`, `SVGLength`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 901`** (2 nodes): `SVGLengthList.d.ts`, `SVGLengthList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 902`** (2 nodes): `SVGMatrix.d.ts`, `SVGMatrix`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 903`** (2 nodes): `SVGNumber.d.ts`, `SVGNumber`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 904`** (2 nodes): `SVGNumberList.d.ts`, `SVGNumberList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 905`** (2 nodes): `SVGPoint.d.ts`, `SVGPoint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 906`** (2 nodes): `SVGPointList.d.ts`, `SVGPointList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 907`** (2 nodes): `SVGPreserveAspectRatio.d.ts`, `SVGPreserveAspectRatio`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 908`** (2 nodes): `SVGRect.d.ts`, `SVGRect`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 909`** (2 nodes): `SVGStringList.d.ts`, `SVGStringList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 910`** (2 nodes): `SVGTransform.d.ts`, `SVGTransform`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 911`** (2 nodes): `SVGTransformList.d.ts`, `SVGTransformList`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 912`** (2 nodes): `SVGUnitTypes.d.ts`, `SVGUnitTypes`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 913`** (2 nodes): `NodeIterator.d.ts`, `NodeIterator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 914`** (2 nodes): `TreeWalker.d.ts`, `TreeWalker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 915`** (2 nodes): `AttributeUtility.d.ts`, `AttributeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 916`** (2 nodes): `ClassMethodBinder.d.ts`, `ClassMethodBinder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 917`** (2 nodes): `StringUtility.d.ts`, `StringUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 918`** (2 nodes): `XMLEncodeUtility.d.ts`, `XMLEncodeUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 919`** (2 nodes): `ValidityState.d.ts`, `ValidityState`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 920`** (2 nodes): `WebSocket.d.ts`, `WebSocket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 921`** (2 nodes): `CrossOriginBrowserWindow.d.ts`, `CrossOriginBrowserWindow`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 922`** (2 nodes): `DetachedWindowAPI.d.ts`, `DetachedWindowAPI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 923`** (2 nodes): `GlobalWindow.d.ts`, `GlobalWindow`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 924`** (2 nodes): `Window.d.ts`, `Window`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 925`** (2 nodes): `WindowBrowserContext.d.ts`, `WindowBrowserContext`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 926`** (2 nodes): `WindowContextClassExtender.d.ts`, `WindowContextClassExtender`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 927`** (2 nodes): `WindowPageOpenUtility.d.ts`, `WindowPageOpenUtility`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 928`** (2 nodes): `XMLHttpRequest.d.ts`, `XMLHttpRequest`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 929`** (2 nodes): `XMLHttpRequestEventTarget.d.ts`, `XMLHttpRequestEventTarget`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 930`** (2 nodes): `XMLHttpRequestResponseDataParser.d.ts`, `XMLHttpRequestResponseDataParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 931`** (2 nodes): `XMLHttpRequestUpload.d.ts`, `XMLHttpRequestUpload`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 932`** (2 nodes): `XMLHttpRequestUpload.ts`, `XMLHttpRequestUpload`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 933`** (2 nodes): `XMLParser.d.ts`, `XMLParser`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 934`** (2 nodes): `XMLSerializer.d.ts`, `XMLSerializer`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 935`** (2 nodes): `backo2.js`, `Backoff()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 936`** (2 nodes): `manager.d.ts`, `Manager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 937`** (2 nodes): `on.js`, `on()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 938`** (2 nodes): `socket.d.ts`, `Socket`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 939`** (2 nodes): `_commonjsHelpers.D26ty3Ew.js`, `getDefaultExportFromCjs()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 940`** (2 nodes): `coverage.CTzCuANN.js`, `resolveCoverageProviderModule()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 941`** (2 nodes): `evaluatedModules.d.BxJ5omdx.d.ts`, `VitestEvaluatedModules`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 942`** (2 nodes): `init-threads.D3eCsY76.js`, `workerInit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 943`** (2 nodes): `traces.d.402V_yFI.d.ts`, `Traces`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 944`** (2 nodes): `snapshot.d.ts`, `VitestNodeSnapshotEnvironment`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 945`** (2 nodes): `createActor.d.ts`, `Actor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 946`** (2 nodes): `TestModel.d.ts`, `TestModel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 947`** (2 nodes): `SimulatedClock.d.ts`, `SimulatedClock`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 948`** (2 nodes): `StateMachine.d.ts`, `StateMachine`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 949`** (2 nodes): `StateNode.d.ts`, `StateNode`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 950`** (2 nodes): `markdown-chat.data.ts`, `message()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 951`** (2 nodes): `report-server.ts`, `startPostedReportServer()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 952`** (1 nodes): `private.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 953`** (1 nodes): `strict.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 954`** (1 nodes): `buffer.buffer.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 955`** (1 nodes): `buffer.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 956`** (1 nodes): `iterators.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 957`** (1 nodes): `console.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 958`** (1 nodes): `constants.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 959`** (1 nodes): `globals.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 960`** (1 nodes): `globals.typedarray.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 961`** (1 nodes): `inspector.generated.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 962`** (1 nodes): `os.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 963`** (1 nodes): `posix.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 964`** (1 nodes): `win32.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 965`** (1 nodes): `path.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 966`** (1 nodes): `process.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 967`** (1 nodes): `punycode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 968`** (1 nodes): `querystring.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 969`** (1 nodes): `sea.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 970`** (1 nodes): `consumers.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 971`** (1 nodes): `web.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 972`** (1 nodes): `timers.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 973`** (1 nodes): `trace_events.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 974`** (1 nodes): `float16array.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 975`** (1 nodes): `types.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 976`** (1 nodes): `encoding.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 977`** (1 nodes): `importMeta.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 978`** (1 nodes): `messaging.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 979`** (1 nodes): `performance.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 980`** (1 nodes): `streams.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 981`** (1 nodes): `main.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 982`** (1 nodes): `DefaultBrowserSettings.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 983`** (1 nodes): `DefaultBrowserSettings.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 984`** (1 nodes): `BrowserErrorCaptureEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 985`** (1 nodes): `BrowserErrorCaptureEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 986`** (1 nodes): `BrowserNavigationCrossOriginPolicyEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 987`** (1 nodes): `BrowserNavigationCrossOriginPolicyEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 988`** (1 nodes): `IBrowser.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 989`** (1 nodes): `IBrowser.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 990`** (1 nodes): `IBrowserContext.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 991`** (1 nodes): `IBrowserContext.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 992`** (1 nodes): `IBrowserFrame.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 993`** (1 nodes): `IBrowserFrame.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 994`** (1 nodes): `IBrowserPage.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 995`** (1 nodes): `IBrowserPage.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 996`** (1 nodes): `IBrowserPageViewport.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 997`** (1 nodes): `IBrowserPageViewport.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 998`** (1 nodes): `IBrowserSettings.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 999`** (1 nodes): `IBrowserSettings.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1000`** (1 nodes): `IGoToOptions.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1001`** (1 nodes): `IGoToOptions.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1002`** (1 nodes): `IOptionalBrowserPageViewport.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1003`** (1 nodes): `IOptionalBrowserPageViewport.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1004`** (1 nodes): `IOptionalBrowserSettings.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1005`** (1 nodes): `IOptionalBrowserSettings.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1006`** (1 nodes): `IReloadOptions.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1007`** (1 nodes): `IReloadOptions.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1008`** (1 nodes): `HTMLElementConfig.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1009`** (1 nodes): `HTMLElementConfig.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1010`** (1 nodes): `HTMLElementConfigContentModelEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1011`** (1 nodes): `HTMLElementConfigContentModelEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1012`** (1 nodes): `IHTMLElementTagNameMap.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1013`** (1 nodes): `IHTMLElementTagNameMap.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1014`** (1 nodes): `ISVGElementTagNameMap.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1015`** (1 nodes): `ISVGElementTagNameMap.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1016`** (1 nodes): `NamespaceURI.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1017`** (1 nodes): `NamespaceURI.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1018`** (1 nodes): `SVGElementConfig.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1019`** (1 nodes): `SVGElementConfig.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1020`** (1 nodes): `VirtualConsoleLogLevelEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1021`** (1 nodes): `VirtualConsoleLogLevelEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1022`** (1 nodes): `VirtualConsoleLogTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1023`** (1 nodes): `VirtualConsoleLogTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1024`** (1 nodes): `IConsole.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1025`** (1 nodes): `IConsole.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1026`** (1 nodes): `IVirtualConsoleLogEntry.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1027`** (1 nodes): `IVirtualConsoleLogEntry.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1028`** (1 nodes): `IVirtualConsoleLogGroup.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1029`** (1 nodes): `IVirtualConsoleLogGroup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1030`** (1 nodes): `IVirtualConsolePrinter.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1031`** (1 nodes): `IVirtualConsolePrinter.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1032`** (1 nodes): `DefaultCookie.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1033`** (1 nodes): `DefaultCookie.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1034`** (1 nodes): `CookieSameSiteEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1035`** (1 nodes): `CookieSameSiteEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1036`** (1 nodes): `ICookie.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1037`** (1 nodes): `ICookie.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1038`** (1 nodes): `ICookieContainer.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1039`** (1 nodes): `ICookieContainer.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1040`** (1 nodes): `IOptionalCookie.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1041`** (1 nodes): `IOptionalCookie.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1042`** (1 nodes): `CSSRule.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1043`** (1 nodes): `CSSRuleTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1044`** (1 nodes): `CSSRuleTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1045`** (1 nodes): `CSSUnits.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1046`** (1 nodes): `CSSUnits.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1047`** (1 nodes): `CSSStyleDeclarationElementDefaultCSS.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1048`** (1 nodes): `CSSStyleDeclarationElementDefaultCSS.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1049`** (1 nodes): `CSSStyleDeclarationElementInheritedProperties.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1050`** (1 nodes): `CSSStyleDeclarationElementInheritedProperties.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1051`** (1 nodes): `CSSStyleDeclarationElementMeasurementProperties.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1052`** (1 nodes): `CSSStyleDeclarationElementMeasurementProperties.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1053`** (1 nodes): `ICSSStyleDeclarationPropertyValue.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1054`** (1 nodes): `ICSSStyleDeclarationPropertyValue.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1055`** (1 nodes): `CSSConditionRule.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1056`** (1 nodes): `CSSGroupingRule.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1057`** (1 nodes): `ICustomElementDefinition.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1058`** (1 nodes): `ICustomElementDefinition.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1059`** (1 nodes): `IDOMMatrixCompatibleObject.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1060`** (1 nodes): `IDOMMatrixCompatibleObject.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1061`** (1 nodes): `IDOMMatrixJSON.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1062`** (1 nodes): `IDOMMatrixJSON.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1063`** (1 nodes): `TDOMMatrix2DArray.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1064`** (1 nodes): `TDOMMatrix2DArray.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1065`** (1 nodes): `TDOMMatrix3DArray.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1066`** (1 nodes): `TDOMMatrix3DArray.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1067`** (1 nodes): `TDOMMatrixInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1068`** (1 nodes): `TDOMMatrixInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1069`** (1 nodes): `IDOMPointInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1070`** (1 nodes): `IDOMPointInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1071`** (1 nodes): `IDOMRectInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1072`** (1 nodes): `IDOMRectInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1073`** (1 nodes): `EventPhaseEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1074`** (1 nodes): `EventPhaseEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1075`** (1 nodes): `IAnimationEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1076`** (1 nodes): `IAnimationEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1077`** (1 nodes): `IClipboardEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1078`** (1 nodes): `IClipboardEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1079`** (1 nodes): `ICloseEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1080`** (1 nodes): `ICloseEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1081`** (1 nodes): `ICustomEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1082`** (1 nodes): `ICustomEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1083`** (1 nodes): `IErrorEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1084`** (1 nodes): `IErrorEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1085`** (1 nodes): `IFocusEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1086`** (1 nodes): `IFocusEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1087`** (1 nodes): `IHashChangeEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1088`** (1 nodes): `IHashChangeEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1089`** (1 nodes): `IInputEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1090`** (1 nodes): `IInputEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1091`** (1 nodes): `IKeyboardEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1092`** (1 nodes): `IKeyboardEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1093`** (1 nodes): `IMediaQueryListEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1094`** (1 nodes): `IMediaQueryListEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1095`** (1 nodes): `IMediaQueryListInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1096`** (1 nodes): `IMediaQueryListInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1097`** (1 nodes): `IMessageEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1098`** (1 nodes): `IMessageEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1099`** (1 nodes): `IMouseEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1100`** (1 nodes): `IMouseEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1101`** (1 nodes): `IPointerEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1102`** (1 nodes): `IPointerEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1103`** (1 nodes): `IPopStateEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1104`** (1 nodes): `IPopStateEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1105`** (1 nodes): `IProgressEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1106`** (1 nodes): `IProgressEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1107`** (1 nodes): `IStorageEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1108`** (1 nodes): `IStorageEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1109`** (1 nodes): `ISubmitEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1110`** (1 nodes): `ISubmitEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1111`** (1 nodes): `ITouchEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1112`** (1 nodes): `ITouchEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1113`** (1 nodes): `IWheelEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1114`** (1 nodes): `IWheelEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1115`** (1 nodes): `IEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1116`** (1 nodes): `IEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1117`** (1 nodes): `IEventListenerOptions.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1118`** (1 nodes): `IEventListenerOptions.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1119`** (1 nodes): `ITouchInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1120`** (1 nodes): `ITouchInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1121`** (1 nodes): `IUIEventInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1122`** (1 nodes): `IUIEventInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1123`** (1 nodes): `MessagePort.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1124`** (1 nodes): `TEventListener.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1125`** (1 nodes): `TEventListener.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1126`** (1 nodes): `TEventListenerFunction.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1127`** (1 nodes): `TEventListenerFunction.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1128`** (1 nodes): `TEventListenerObject.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1129`** (1 nodes): `TEventListenerObject.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1130`** (1 nodes): `DOMExceptionNameEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1131`** (1 nodes): `DOMExceptionNameEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1132`** (1 nodes): `ICacheablePreflightRequest.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1133`** (1 nodes): `ICacheablePreflightRequest.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1134`** (1 nodes): `ICacheablePreflightResponse.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1135`** (1 nodes): `ICacheablePreflightResponse.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1136`** (1 nodes): `ICachedPreflightResponse.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1137`** (1 nodes): `ICachedPreflightResponse.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1138`** (1 nodes): `IPreflightResponseCache.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1139`** (1 nodes): `IPreflightResponseCache.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1140`** (1 nodes): `CachedResponseStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1141`** (1 nodes): `CachedResponseStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1142`** (1 nodes): `ICacheableRequest.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1143`** (1 nodes): `ICacheableRequest.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1144`** (1 nodes): `ICacheableResponse.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1145`** (1 nodes): `ICacheableResponse.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1146`** (1 nodes): `ICachedResponse.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1147`** (1 nodes): `ICachedResponse.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1148`** (1 nodes): `IResponseCache.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1149`** (1 nodes): `IResponseCache.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1150`** (1 nodes): `IResponseCacheFileSystem.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1151`** (1 nodes): `IResponseCacheFileSystem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1152`** (1 nodes): `FetchHTTPSCertificate.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1153`** (1 nodes): `FetchHTTPSCertificate.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1154`** (1 nodes): `IFetchInterceptor.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1155`** (1 nodes): `IFetchInterceptor.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1156`** (1 nodes): `IFetchRequestHeaders.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1157`** (1 nodes): `IFetchRequestHeaders.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1158`** (1 nodes): `IRequestInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1159`** (1 nodes): `IRequestInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1160`** (1 nodes): `IResourceFetchResponse.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1161`** (1 nodes): `IResourceFetchResponse.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1162`** (1 nodes): `IResponseInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1163`** (1 nodes): `IResponseInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1164`** (1 nodes): `ISyncResponse.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1165`** (1 nodes): `ISyncResponse.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1166`** (1 nodes): `IVirtualServer.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1167`** (1 nodes): `IVirtualServer.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1168`** (1 nodes): `THeadersInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1169`** (1 nodes): `THeadersInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1170`** (1 nodes): `TRequestCredentials.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1171`** (1 nodes): `TRequestCredentials.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1172`** (1 nodes): `TRequestInfo.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1173`** (1 nodes): `TRequestInfo.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1174`** (1 nodes): `TRequestMode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1175`** (1 nodes): `TRequestMode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1176`** (1 nodes): `TRequestRedirect.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1177`** (1 nodes): `TRequestRedirect.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1178`** (1 nodes): `TRequestReferrerPolicy.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1179`** (1 nodes): `TRequestReferrerPolicy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1180`** (1 nodes): `FileReaderEventTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1181`** (1 nodes): `FileReaderEventTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1182`** (1 nodes): `FileReaderFormatEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1183`** (1 nodes): `FileReaderFormatEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1184`** (1 nodes): `FileReaderReadyStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1185`** (1 nodes): `FileReaderReadyStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1186`** (1 nodes): `HistoryScrollRestorationEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1187`** (1 nodes): `HistoryScrollRestorationEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1188`** (1 nodes): `IHistoryItem.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1189`** (1 nodes): `IHistoryItem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1190`** (1 nodes): `IIntersectionObserverInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1191`** (1 nodes): `IIntersectionObserverInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1192`** (1 nodes): `IJavaScriptCompiledResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1193`** (1 nodes): `IJavaScriptCompiledResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1194`** (1 nodes): `IMediaQueryRange.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1195`** (1 nodes): `IMediaQueryRange.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1196`** (1 nodes): `IMediaQueryRule.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1197`** (1 nodes): `IMediaQueryRule.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1198`** (1 nodes): `MediaQueryTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1199`** (1 nodes): `MediaQueryTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1200`** (1 nodes): `ECMAScriptModuleEvaluateStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1201`** (1 nodes): `ECMAScriptModuleEvaluateStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1202`** (1 nodes): `IECMAScriptModuleCachedResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1203`** (1 nodes): `IECMAScriptModuleCachedResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1204`** (1 nodes): `IECMAScriptModuleCompiledResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1205`** (1 nodes): `IECMAScriptModuleCompiledResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1206`** (1 nodes): `IECMAScriptModuleImport.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1207`** (1 nodes): `IECMAScriptModuleImport.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1208`** (1 nodes): `IECMAScriptModuleInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1209`** (1 nodes): `IECMAScriptModuleInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1210`** (1 nodes): `IModule.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1211`** (1 nodes): `IModule.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1212`** (1 nodes): `IModuleImportMap.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1213`** (1 nodes): `IModuleImportMap.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1214`** (1 nodes): `IModuleImportMapRule.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1215`** (1 nodes): `IModuleImportMapRule.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1216`** (1 nodes): `IModuleImportMapScope.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1217`** (1 nodes): `IModuleImportMapScope.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1218`** (1 nodes): `IResolveNodeModules.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1219`** (1 nodes): `IResolveNodeModules.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1220`** (1 nodes): `IMutationListener.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1221`** (1 nodes): `IMutationListener.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1222`** (1 nodes): `IMutationObserverInit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1223`** (1 nodes): `IMutationObserverInit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1224`** (1 nodes): `MutationTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1225`** (1 nodes): `MutationTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1226`** (1 nodes): `CharacterData.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1227`** (1 nodes): `IChildNode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1228`** (1 nodes): `IChildNode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1229`** (1 nodes): `INonDocumentTypeChildNode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1230`** (1 nodes): `INonDocumentTypeChildNode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1231`** (1 nodes): `DocumentReadyStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1232`** (1 nodes): `DocumentReadyStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1233`** (1 nodes): `VisibilityStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1234`** (1 nodes): `VisibilityStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1235`** (1 nodes): `THTMLCollectionListener.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1236`** (1 nodes): `THTMLCollectionListener.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1237`** (1 nodes): `TNamedNodeMapListener.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1238`** (1 nodes): `TNamedNodeMapListener.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1239`** (1 nodes): `THTMLFormControlElement.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1240`** (1 nodes): `THTMLFormControlElement.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1241`** (1 nodes): `IHTMLHyperlinkElement.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1242`** (1 nodes): `IHTMLHyperlinkElement.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1243`** (1 nodes): `HTMLInputElementSelectionDirectionEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1244`** (1 nodes): `HTMLInputElementSelectionDirectionEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1245`** (1 nodes): `HTMLInputElementSelectionModeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1246`** (1 nodes): `HTMLInputElementSelectionModeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1247`** (1 nodes): `IMediaTrackCapabilities.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1248`** (1 nodes): `IMediaTrackCapabilities.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1249`** (1 nodes): `IMediaTrackSettings.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1250`** (1 nodes): `IMediaTrackSettings.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1251`** (1 nodes): `TextTrackCue.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1252`** (1 nodes): `TextTrackKindEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1253`** (1 nodes): `TextTrackKindEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1254`** (1 nodes): `ICachedComputedStyleResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1255`** (1 nodes): `ICachedComputedStyleResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1256`** (1 nodes): `ICachedElementByIdResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1257`** (1 nodes): `ICachedElementByIdResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1258`** (1 nodes): `ICachedElementByTagNameResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1259`** (1 nodes): `ICachedElementByTagNameResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1260`** (1 nodes): `ICachedElementsByTagNameResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1261`** (1 nodes): `ICachedElementsByTagNameResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1262`** (1 nodes): `ICachedMatchesResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1263`** (1 nodes): `ICachedMatchesResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1264`** (1 nodes): `ICachedQuerySelectorAllResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1265`** (1 nodes): `ICachedQuerySelectorAllResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1266`** (1 nodes): `ICachedQuerySelectorResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1267`** (1 nodes): `ICachedQuerySelectorResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1268`** (1 nodes): `ICachedResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1269`** (1 nodes): `ICachedResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1270`** (1 nodes): `ICachedStyleResult.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1271`** (1 nodes): `ICachedStyleResult.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1272`** (1 nodes): `NodeDocumentPositionEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1273`** (1 nodes): `NodeDocumentPositionEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1274`** (1 nodes): `NodeTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1275`** (1 nodes): `NodeTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1276`** (1 nodes): `TNodeListListener.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1277`** (1 nodes): `TNodeListListener.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1278`** (1 nodes): `IParentNode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1279`** (1 nodes): `IParentNode.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1280`** (1 nodes): `PermissionNameEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1281`** (1 nodes): `PermissionNameEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1282`** (1 nodes): `PropertySymbol.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1283`** (1 nodes): `PropertySymbol.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1284`** (1 nodes): `ISelectorAttribute.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1285`** (1 nodes): `ISelectorAttribute.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1286`** (1 nodes): `ISelectorMatch.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1287`** (1 nodes): `ISelectorMatch.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1288`** (1 nodes): `ISelectorPseudo.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1289`** (1 nodes): `ISelectorPseudo.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1290`** (1 nodes): `SelectorCombinatorEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1291`** (1 nodes): `SelectorCombinatorEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1292`** (1 nodes): `IRangeBoundaryPoint.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1293`** (1 nodes): `IRangeBoundaryPoint.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1294`** (1 nodes): `RangeHowEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1295`** (1 nodes): `RangeHowEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1296`** (1 nodes): `SelectionDirectionEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1297`** (1 nodes): `SelectionDirectionEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1298`** (1 nodes): `SVGAngleTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1299`** (1 nodes): `SVGAngleTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1300`** (1 nodes): `SVGLengthTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1301`** (1 nodes): `SVGLengthTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1302`** (1 nodes): `SVGPreserveAspectRatioAlignEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1303`** (1 nodes): `SVGPreserveAspectRatioAlignEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1304`** (1 nodes): `SVGPreserveAspectRatioMeetOrSliceEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1305`** (1 nodes): `SVGPreserveAspectRatioMeetOrSliceEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1306`** (1 nodes): `SVGTransformTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1307`** (1 nodes): `SVGTransformTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1308`** (1 nodes): `NodeFilter.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1309`** (1 nodes): `NodeFilter.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1310`** (1 nodes): `NodeFilterMask.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1311`** (1 nodes): `NodeFilterMask.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1312`** (1 nodes): `TNodeFilter.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1313`** (1 nodes): `TNodeFilter.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1314`** (1 nodes): `version.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1315`** (1 nodes): `version.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1316`** (1 nodes): `WebSocketReadyStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1317`** (1 nodes): `WebSocketReadyStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1318`** (1 nodes): `INodeJSGlobal.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1319`** (1 nodes): `INodeJSGlobal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1320`** (1 nodes): `IOptionalTimerLoopsLimit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1321`** (1 nodes): `IOptionalTimerLoopsLimit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1322`** (1 nodes): `IScrollToOptions.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1323`** (1 nodes): `IScrollToOptions.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1324`** (1 nodes): `ITimerLoopsLimit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1325`** (1 nodes): `ITimerLoopsLimit.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1326`** (1 nodes): `VMGlobalPropertyScript.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1327`** (1 nodes): `VMGlobalPropertyScript.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1328`** (1 nodes): `XMLHttpRequestReadyStateEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1329`** (1 nodes): `XMLHttpRequestReadyStateEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1330`** (1 nodes): `XMLHttpResponseTypeEnum.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1331`** (1 nodes): `XMLHttpResponseTypeEnum.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1332`** (1 nodes): `async-directive.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1333`** (1 nodes): `async-directive.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1334`** (1 nodes): `custom-element.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1335`** (1 nodes): `custom-element.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1336`** (1 nodes): `event-options.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1337`** (1 nodes): `event-options.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1338`** (1 nodes): `property.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1339`** (1 nodes): `property.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1340`** (1 nodes): `query-all.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1341`** (1 nodes): `query-all.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1342`** (1 nodes): `query-assigned-elements.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1343`** (1 nodes): `query-assigned-elements.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1344`** (1 nodes): `query-assigned-nodes.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1345`** (1 nodes): `query-assigned-nodes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1346`** (1 nodes): `query-async.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1347`** (1 nodes): `query-async.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1348`** (1 nodes): `query.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1349`** (1 nodes): `query.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1350`** (1 nodes): `State.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1351`** (1 nodes): `state.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1352`** (1 nodes): `decorators.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1353`** (1 nodes): `decorators.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1354`** (1 nodes): `directive-helpers.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1355`** (1 nodes): `directive-helpers.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1356`** (1 nodes): `directive.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1357`** (1 nodes): `directive.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1358`** (1 nodes): `async-append.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1359`** (1 nodes): `async-append.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1360`** (1 nodes): `async-replace.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1361`** (1 nodes): `async-replace.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1362`** (1 nodes): `cache.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1363`** (1 nodes): `cache.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1364`** (1 nodes): `choose.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1365`** (1 nodes): `choose.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1366`** (1 nodes): `class-map.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1367`** (1 nodes): `class-map.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1368`** (1 nodes): `guard.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1369`** (1 nodes): `guard.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1370`** (1 nodes): `if-defined.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1371`** (1 nodes): `if-defined.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1372`** (1 nodes): `join.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1373`** (1 nodes): `join.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1374`** (1 nodes): `keyed.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1375`** (1 nodes): `keyed.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1376`** (1 nodes): `live.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1377`** (1 nodes): `live.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1378`** (1 nodes): `map.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1379`** (1 nodes): `map.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1380`** (1 nodes): `ref.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1381`** (1 nodes): `ref.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1382`** (1 nodes): `repeat.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1383`** (1 nodes): `repeat.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1384`** (1 nodes): `style-map.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1385`** (1 nodes): `style-map.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1386`** (1 nodes): `template-content.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1387`** (1 nodes): `template-content.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1388`** (1 nodes): `unsafe-html.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1389`** (1 nodes): `unsafe-html.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1390`** (1 nodes): `unsafe-mathml.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1391`** (1 nodes): `unsafe-mathml.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1392`** (1 nodes): `unsafe-svg.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1393`** (1 nodes): `unsafe-svg.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1394`** (1 nodes): `until.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1395`** (1 nodes): `until.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1396`** (1 nodes): `when.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1397`** (1 nodes): `when.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1398`** (1 nodes): `html.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1399`** (1 nodes): `html.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1400`** (1 nodes): `index.all.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1401`** (1 nodes): `index.all.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1402`** (1 nodes): `polyfill-support.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1403`** (1 nodes): `polyfill-support.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1404`** (1 nodes): `static-html.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1405`** (1 nodes): `static-html.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1406`** (1 nodes): `browser-entrypoint.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1407`** (1 nodes): `browser-entrypoint.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1408`** (1 nodes): `backo2.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1409`** (1 nodes): `on.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1410`** (1 nodes): `lib.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1411`** (1 nodes): `lib.decorators.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1412`** (1 nodes): `lib.decorators.legacy.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1413`** (1 nodes): `lib.dom.asynciterable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1414`** (1 nodes): `lib.dom.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1415`** (1 nodes): `lib.dom.iterable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1416`** (1 nodes): `lib.es2015.collection.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1417`** (1 nodes): `lib.es2015.core.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1418`** (1 nodes): `lib.es2015.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1419`** (1 nodes): `lib.es2015.generator.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1420`** (1 nodes): `lib.es2015.iterable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1421`** (1 nodes): `lib.es2015.promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1422`** (1 nodes): `lib.es2015.proxy.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1423`** (1 nodes): `lib.es2015.reflect.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1424`** (1 nodes): `lib.es2015.symbol.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1425`** (1 nodes): `lib.es2015.symbol.wellknown.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1426`** (1 nodes): `lib.es2016.array.include.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1427`** (1 nodes): `lib.es2016.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1428`** (1 nodes): `lib.es2016.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1429`** (1 nodes): `lib.es2016.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1430`** (1 nodes): `lib.es2017.arraybuffer.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1431`** (1 nodes): `lib.es2017.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1432`** (1 nodes): `lib.es2017.date.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1433`** (1 nodes): `lib.es2017.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1434`** (1 nodes): `lib.es2017.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1435`** (1 nodes): `lib.es2017.object.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1436`** (1 nodes): `lib.es2017.sharedmemory.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1437`** (1 nodes): `lib.es2017.string.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1438`** (1 nodes): `lib.es2017.typedarrays.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1439`** (1 nodes): `lib.es2018.asyncgenerator.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1440`** (1 nodes): `lib.es2018.asynciterable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1441`** (1 nodes): `lib.es2018.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1442`** (1 nodes): `lib.es2018.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1443`** (1 nodes): `lib.es2018.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1444`** (1 nodes): `lib.es2018.promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1445`** (1 nodes): `lib.es2018.regexp.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1446`** (1 nodes): `lib.es2019.array.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1447`** (1 nodes): `lib.es2019.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1448`** (1 nodes): `lib.es2019.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1449`** (1 nodes): `lib.es2019.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1450`** (1 nodes): `lib.es2019.object.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1451`** (1 nodes): `lib.es2019.string.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1452`** (1 nodes): `lib.es2019.symbol.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1453`** (1 nodes): `lib.es2020.bigint.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1454`** (1 nodes): `lib.es2020.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1455`** (1 nodes): `lib.es2020.date.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1456`** (1 nodes): `lib.es2020.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1457`** (1 nodes): `lib.es2020.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1458`** (1 nodes): `lib.es2020.number.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1459`** (1 nodes): `lib.es2020.promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1460`** (1 nodes): `lib.es2020.sharedmemory.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1461`** (1 nodes): `lib.es2020.string.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1462`** (1 nodes): `lib.es2020.symbol.wellknown.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1463`** (1 nodes): `lib.es2021.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1464`** (1 nodes): `lib.es2021.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1465`** (1 nodes): `lib.es2021.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1466`** (1 nodes): `lib.es2021.promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1467`** (1 nodes): `lib.es2021.string.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1468`** (1 nodes): `lib.es2021.weakref.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1469`** (1 nodes): `lib.es2022.array.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1470`** (1 nodes): `lib.es2022.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1471`** (1 nodes): `lib.es2022.error.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1472`** (1 nodes): `lib.es2022.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1473`** (1 nodes): `lib.es2022.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1474`** (1 nodes): `lib.es2022.object.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1475`** (1 nodes): `lib.es2022.regexp.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1476`** (1 nodes): `lib.es2022.string.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1477`** (1 nodes): `lib.es2023.array.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1478`** (1 nodes): `lib.es2023.collection.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1479`** (1 nodes): `lib.es2023.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1480`** (1 nodes): `lib.es2023.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1481`** (1 nodes): `lib.es2023.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1482`** (1 nodes): `lib.es2024.arraybuffer.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1483`** (1 nodes): `lib.es2024.collection.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1484`** (1 nodes): `lib.es2024.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1485`** (1 nodes): `lib.es2024.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1486`** (1 nodes): `lib.es2024.object.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1487`** (1 nodes): `lib.es2024.promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1488`** (1 nodes): `lib.es2024.regexp.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1489`** (1 nodes): `lib.es2024.sharedmemory.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1490`** (1 nodes): `lib.es2024.string.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1491`** (1 nodes): `lib.es2025.collection.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1492`** (1 nodes): `lib.es2025.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1493`** (1 nodes): `lib.es2025.float16.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1494`** (1 nodes): `lib.es2025.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1495`** (1 nodes): `lib.es2025.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1496`** (1 nodes): `lib.es2025.iterator.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1497`** (1 nodes): `lib.es2025.promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1498`** (1 nodes): `lib.es2025.regexp.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1499`** (1 nodes): `lib.es5.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1500`** (1 nodes): `lib.es6.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1501`** (1 nodes): `lib.esnext.array.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1502`** (1 nodes): `lib.esnext.collection.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1503`** (1 nodes): `lib.esnext.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1504`** (1 nodes): `lib.esnext.date.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1505`** (1 nodes): `lib.esnext.decorators.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1506`** (1 nodes): `lib.esnext.disposable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1507`** (1 nodes): `lib.esnext.error.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1508`** (1 nodes): `lib.esnext.full.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1509`** (1 nodes): `lib.esnext.intl.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1510`** (1 nodes): `lib.esnext.sharedmemory.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1511`** (1 nodes): `lib.esnext.temporal.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1512`** (1 nodes): `lib.esnext.typedarrays.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1513`** (1 nodes): `lib.webworker.asynciterable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1514`** (1 nodes): `lib.webworker.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1515`** (1 nodes): `lib.webworker.importscripts.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1516`** (1 nodes): `lib.webworker.iterable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1517`** (1 nodes): `tsserverlibrary.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1518`** (1 nodes): `tsserverlibrary.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1519`** (1 nodes): `watchGuard.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1520`** (1 nodes): `context.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1521`** (1 nodes): `context.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1522`** (1 nodes): `benchmark.d.DAaHLpsq.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1523`** (1 nodes): `browser.d.C0zGu1u9.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1524`** (1 nodes): `constants.CPYnjOGj.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1525`** (1 nodes): `coverage.d.BZtK59WP.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1526`** (1 nodes): `defaults.9aQKnqFk.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1527`** (1 nodes): `env.D4Lgay0q.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1528`** (1 nodes): `environment.d.CrsxCzP1.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1529`** (1 nodes): `index.4L3g53iW.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1530`** (1 nodes): `plugin.d.BssAumYw.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1531`** (1 nodes): `suite.d.udJtyAgw.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1532`** (1 nodes): `worker.d.CckNUvI5.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1533`** (1 nodes): `coverage.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1534`** (1 nodes): `environments.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1535`** (1 nodes): `environments.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1536`** (1 nodes): `runtime.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1537`** (1 nodes): `runtime.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1538`** (1 nodes): `suite.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1539`** (1 nodes): `suite.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1540`** (1 nodes): `vmForks.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1541`** (1 nodes): `vmThreads.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1542`** (1 nodes): `import-meta.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1543`** (1 nodes): `jsdom.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1544`** (1 nodes): `mocker.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1545`** (1 nodes): `optional-runtime-types.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1546`** (1 nodes): `optional-types.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1547`** (1 nodes): `xstate-actions.cjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1548`** (1 nodes): `xstate-actions.cjs.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1549`** (1 nodes): `xstate-actions.development.cjs.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1550`** (1 nodes): `xstate-actions.development.esm.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1551`** (1 nodes): `xstate-actions.esm.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1552`** (1 nodes): `xstate-actors.cjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1553`** (1 nodes): `xstate-dev.cjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1554`** (1 nodes): `assign.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1555`** (1 nodes): `cancel.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1556`** (1 nodes): `emit.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1557`** (1 nodes): `enqueueActions.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1558`** (1 nodes): `log.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1559`** (1 nodes): `raise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1560`** (1 nodes): `send.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1561`** (1 nodes): `spawnChild.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1562`** (1 nodes): `stopChild.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1563`** (1 nodes): `actions.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1564`** (1 nodes): `callback.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1565`** (1 nodes): `observable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1566`** (1 nodes): `promise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1567`** (1 nodes): `transition.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1568`** (1 nodes): `createMachine.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1569`** (1 nodes): `getNextSnapshot.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1570`** (1 nodes): `adjacency.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1571`** (1 nodes): `graph.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1572`** (1 nodes): `pathFromEvents.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1573`** (1 nodes): `pathGenerators.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1574`** (1 nodes): `shortestPaths.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1575`** (1 nodes): `simplePaths.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1576`** (1 nodes): `guards.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1577`** (1 nodes): `inspection.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1578`** (1 nodes): `setup.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1579`** (1 nodes): `spawn.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1580`** (1 nodes): `stateUtils.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1581`** (1 nodes): `symbolObservable.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1582`** (1 nodes): `system.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1583`** (1 nodes): `toPromise.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1584`** (1 nodes): `utils.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1585`** (1 nodes): `waitFor.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1586`** (1 nodes): `xstate.cjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1587`** (1 nodes): `xstate-graph.cjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1588`** (1 nodes): `xstate-guards.cjs.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1589`** (1 nodes): `xstate-guards.cjs.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1590`** (1 nodes): `xstate-guards.development.cjs.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1591`** (1 nodes): `xstate-guards.development.esm.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1592`** (1 nodes): `xstate-guards.esm.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1593`** (1 nodes): `聊天壳首页与控制台集成测试`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1594`** (1 nodes): `frontend/存储.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1595`** (1 nodes): `frontend/房间内核.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1596`** (1 nodes): `frontend/房间实时编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1597`** (1 nodes): `frontend/房间恢复编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1598`** (1 nodes): `frontend/房间消息窗.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1599`** (1 nodes): `frontend/房间滚动器.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1600`** (1 nodes): `frontend/视图.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1601`** (1 nodes): `frontend/阅读推进编排.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1602`** (1 nodes): `lib.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1603`** (1 nodes): `src/后台外壳.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1604`** (1 nodes): `src/外壳.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1605`** (1 nodes): `src/实时外壳.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1606`** (1 nodes): `src/房间外壳.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1607`** (1 nodes): `src/用例.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1608`** (1 nodes): `src/适配.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1609`** (1 nodes): `mime_types_generated.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1610`** (1 nodes): `up.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1611`** (1 nodes): `dynamic-layout-text.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1612`** (1 nodes): `justification-comparison.data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1613`** (1 nodes): `svg.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1614`** (1 nodes): `gatsby-check.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1615`** (1 nodes): `gatsby-sweep.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1616`** (1 nodes): `test-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 1617`** (1 nodes): `text-modules.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `非成员不能通过events接口拉取房间增量()` connect `Community 9` to `Community 4`, `Community 22`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Why does `Document` connect `Community 12` to `Community 7`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Are the 249 inferred relationships involving `push()` (e.g. with `zipWith()` and `intersperse()`) actually correct?**
  _`push()` has 249 INFERRED edges - model-reasoned connections that need verification._
- **Are the 225 inferred relationships involving `assert()` (e.g. with `first()` and `last()`) actually correct?**
  _`assert()` has 225 INFERRED edges - model-reasoned connections that need verification._
- **Are the 189 inferred relationships involving `map()` (e.g. with `push()` and `indicesOf()`) actually correct?**
  _`map()` has 189 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AssertionError`, `AsyncResource`, `AsyncLocalStorage` to the rest of the system?**
  _626 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0 - nodes in this community are weakly interconnected._