import { 判定播放连续性表面 } from "../媒体/视频可见槽位协议.js";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import type { 信息流视频预算投影 } from "../媒体/信息流视频预算.js";
import type { 时间线自动播冻结帧 } from "./视频桥接帧.js";
import { 标记当前预览视频已出首帧 } from "./视频首帧桥接.js";
import { 渲染时间线视频表面卡片 } from "./视频附件表面渲染.js";
import type { 消息展示项 } from "./视图.js";

export type 时间线视频附件 = Extract<
  消息展示项["attachments"][number],
  { kind: "video" }
>;

export type 视频附件渲染宿主 = {
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
  最近退场Owner附件Id: string | null;
  时间线隐藏接管附件Id: string | null;
  读取时间线视频预览状态(attachmentId: string): 视频预览状态 | null;
  读取时间线视频运行时预览(attachmentId: string): Extract<视频预览状态, { phase: "ready" }> | null;
  读取时间线视频已知封面源(attachmentId: string): string | null;
  读取时间线视频封面地址(attachment: 时间线视频附件, playback: 媒体播放结果 | null): string;
  读取时间线视频首帧预览源(
    attachment: 时间线视频附件,
    playback: 媒体播放结果 | null,
    input: { 有静态封面: boolean; 有运行时预览: boolean }
  ): string | null;
  读取保存续帧是否允许承接时间线预览底板(input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
    playbackTimelineVideoSrc: string | null;
    savedTimelineFrameSrc: string | null;
  }): boolean;
  读取时间线视频已就绪首帧预览源(attachmentId: string): string | null;
  读取时间线视频预算投影(
    attachment: 时间线视频附件,
    previewVideoSrcCandidate: string | null
  ): 信息流视频预算投影;
  读取时间线唯一播放器是否可见接管就绪(attachmentId: string, src: string | null): boolean;
  读取时间线唯一播放器可见宿主是否已出帧(attachmentId: string, src: string | null): boolean;
  读取自动播恢复位置(attachmentId: string, src: string | null): 媒体播放位置 | null;
  读取时间线现有预览视频是否可继续显示(attachmentId: string, src: string | null): boolean;
  读取时间线现有预览帧证据(
    attachmentId: string,
    src: string | null
  ): { src: string; currentTime: number } | null;
  读取时间线自动播冻结帧(
    attachmentId: string,
    src: string | null,
    position: 媒体播放位置 | null
  ): 时间线自动播冻结帧 | null;
  捕获时间线自动播冻结帧(
    attachmentId: string,
    video: HTMLVideoElement,
    options?: { 预热已合成帧?: boolean; 立即提交?: boolean }
  ): void;
  读取时间线视频首帧是否就绪(attachmentId: string, src: string | null): boolean;
  归一化时间线视频播放源(src: string | null): string | null;
  读取时间线预览视频是否允许渲染(
    budget: 信息流视频预算投影,
    input: {
      hasExistingSameSourcePreviewFrame?: boolean;
      hasFrozenTimelineFrame?: boolean;
      hasKnownReadyPreviewFrame?: boolean;
      previewVideoSrc: string | null;
      shouldReuseSavedTimelineFrameAsPreview: boolean;
    }
  ): boolean;
  恢复时间线自动播播放位置(
    attachmentId: string,
    video: HTMLVideoElement,
    input?: { allowPreviewFrame?: boolean }
  ): void;
  标记时间线视频首帧已就绪(attachmentId: string, src: string | null): void;
  标记视频封面加载失败(attachmentId: string, event: Event): void;
  广播媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  阻止时间线媒体预览原生菜单(event: Event): void;
  打开媒体查看器(event: Event, startAttachmentId: string): void;
};

export const 渲染视频附件 = (
  context: 视频附件渲染宿主,
  input: {
    attachment: 时间线视频附件;
    playback: 媒体播放结果 | null;
    attachmentCardStyle: string;
    可渲染真实预览视频附件: Set<string>;
    渲染媒体提示(attachmentId: string, playback: 媒体播放结果 | null): unknown;
  }
) => {
  const { attachment, playback } = input;
  const previewState = context.读取时间线视频预览状态(attachment.attachmentId);
  const isPreviewMissingSource = previewState?.phase === "missing_source";
  const runtimePreview = context.读取时间线视频运行时预览(attachment.attachmentId);
  const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
  const hasRuntimePreview = Boolean(runtimePreview);
  const hasStablePreviewPosterSurface =
    hasSourcePoster || hasRuntimePreview ||
    Boolean(context.读取时间线视频已知封面源(attachment.attachmentId));
  /**
   * 可见槽位里的静态 bridge 必须优先吃“最新、最贴近真实画面”的投影：
   * 1. runtime preview 来自同一附件字节已经真实解出的帧，比上传后长期不变的 poster/still 更新鲜；
   * 2. 如果这里继续优先露旧 poster，用户快滑进入自动播时看到的就会是“旧封面 -> 黑一拍 -> 真视频”；
   * 3. 因此只要 runtime preview 已经 ready，就让它盖过静态 poster，直到 canonical 自己提交可见帧。
   *
   * 注意这不是第二媒体真相：
   * - runtime preview 只是唯一正式视频链导出的静态桥接帧；
   * - 真正的 live owner 仍然只有同一颗 canonical Video.js player。
   */
  const previewPosterSrc =
    runtimePreview?.src ??
    context.读取时间线视频已知封面源(attachment.attachmentId) ??
    context.读取时间线视频封面地址(attachment, playback);
  const playbackTimelineVideoSrc = context.读取时间线视频首帧预览源(
    attachment,
    playback,
    {
      有静态封面: hasSourcePoster,
      有运行时预览: hasRuntimePreview,
    }
  );
  const savedTimelineFrame =
    context.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
  /** owner 刚滑出视口时，保存续帧只准承接同源画面，不准长第二条读取链。 */
  const savedTimelineFrameSrc = savedTimelineFrame?.src ?? null;
  const knownReadyTimelineFrameSrc = context.读取时间线视频已就绪首帧预览源(attachment.attachmentId);
  const shouldReuseSavedTimelineFrameAsPreview =
    context.读取保存续帧是否允许承接时间线预览底板({
      attachmentId: attachment.attachmentId,
      playback,
      playbackTimelineVideoSrc,
      savedTimelineFrameSrc,
    });
  const timelinePreviewVideoSrcCandidate =
    playbackTimelineVideoSrc ??
    (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
    knownReadyTimelineFrameSrc;
  const videoBudget = context.读取时间线视频预算投影(attachment, timelinePreviewVideoSrcCandidate);
  const ownerCanonicalVideoSrc = videoBudget.canonicalVideoSrc;
  /**
   * preview missing_source 只说明"预览抓帧超时未拿到字节"，
   * 不代表 swarm 字节永远不会到——WebTorrent peer 发现和 ICE 协商
   * 在实时路径下通常需要 10-30 秒。
   * canonical 挂上后浏览器自己等字节推进 readyState，由 shouldRevealCanonicalHost 门控揭帘。
   */
  const shouldRenderInlineVideo =
    videoBudget.allowInlineCanonical &&
    Boolean(ownerCanonicalVideoSrc);
  /** 时间线先吃统一预算，再用同源续帧/已就绪首帧做本地连续性桥。 */
  const timelinePreviewVideoSrc =
    videoBudget.previewVideoSrc ??
    /**
     * 新 owner 刚刚接管时，`inlineAutoplayPlayback` 往往比通用 playback 更早落到当前卡片：
     * 1. 如果 preview 还坚持只等通用 playback，卡片会先退成默认 poster/黑壳；
     * 2. 这里允许 preview bridge 直接复用同一条正式 canonical src，只承担揭帘前的同源连续性；
     * 3. live player 仍然只有那颗全局唯一 canonical，preview 只是它的同源 bridge。
     */
    (shouldRenderInlineVideo ? ownerCanonicalVideoSrc : null) ??
    (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
    knownReadyTimelineFrameSrc;
  const previewVideoSrc = timelinePreviewVideoSrc;
  const restorableTimelineFrame = context.读取自动播恢复位置(
    attachment.attachmentId,
    previewVideoSrc
  );
  const isRecentOwnerContinuityBridge =
    attachment.attachmentId === context.最近退场Owner附件Id;
  const isRetiringReleasedOwner =
    isRecentOwnerContinuityBridge &&
    context.inlineAutoplayOwnerAttachmentId !== attachment.attachmentId;
  const previewFrameEvidence = context.读取时间线现有预览帧证据(
    attachment.attachmentId,
    previewVideoSrc
  );
  const hasExistingSameSourcePreviewFrame =
    context.读取时间线现有预览视频是否可继续显示(
      attachment.attachmentId,
      previewVideoSrc
    );
  const frozenTimelineFrame = context.读取时间线自动播冻结帧(
    attachment.attachmentId,
    previewVideoSrc ?? ownerCanonicalVideoSrc ?? savedTimelineFrameSrc,
    restorableTimelineFrame
  );
  const hasFrozenTimelineFrame = Boolean(frozenTimelineFrame);
  const hasKnownReadyPreviewFrame = context.读取时间线视频首帧是否就绪(
    attachment.attachmentId,
    previewVideoSrc
  );
  const hasCurrentDomPreviewFrame = hasExistingSameSourcePreviewFrame;
  const normalizedPreviewVideoSrc = context.归一化时间线视频播放源(previewVideoSrc);
  const normalizedSavedTimelineFrameSrc =
    context.归一化时间线视频播放源(savedTimelineFrameSrc);
  const hasVisibleCanonicalCommittedFrame = context.读取时间线唯一播放器可见宿主是否已出帧(
    attachment.attachmentId,
    ownerCanonicalVideoSrc
  );
  const shouldRevealCanonicalHost =
    shouldRenderInlineVideo && hasVisibleCanonicalCommittedFrame;
  const coldPathStableSurface =
    hasFrozenTimelineFrame
      ? "frozen_frame"
      : hasCurrentDomPreviewFrame
        ? "preview_frame"
        : hasStablePreviewPosterSurface
          ? "placeholder"
          : "none";
  const hasCurrentCanonicalRevealReady =
    context.读取时间线唯一播放器是否可见接管就绪(
      attachment.attachmentId,
      ownerCanonicalVideoSrc
    );
  const hasSameSourceSavedTimelineFrame = Boolean(
    normalizedPreviewVideoSrc &&
      normalizedSavedTimelineFrameSrc &&
      normalizedPreviewVideoSrc === normalizedSavedTimelineFrameSrc
  );
  const playbackContinuityDecision = 判定播放连续性表面({
    attachmentId: attachment.attachmentId,
    ownerAttachmentId: context.inlineAutoplayOwnerAttachmentId,
    surface: "timeline",
    source: { src: previewVideoSrc ?? ownerCanonicalVideoSrc },
    savedPosition: savedTimelineFrame,
    dom: {
      previewReadyState: hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame ? 2 : 0,
      canonicalReadyState: shouldRevealCanonicalHost ? 3 : 0,
      previewCommitted: hasExistingSameSourcePreviewFrame,
      canonicalCommitted: hasVisibleCanonicalCommittedFrame,
      sourceMatches:
        hasSameSourceSavedTimelineFrame ||
        hasExistingSameSourcePreviewFrame ||
        hasFrozenTimelineFrame ||
        hasCurrentCanonicalRevealReady,
    },
    host: {
      exists: true,
      /**
       * 这里必须区分“历史上曾经 ready 过”和“当前这颗 DOM canonical 真的已经 ready”：
       * 1. 历史缓存只能说明同一 src 以前揭过帘，不能说明这一轮重新挂回卡片后仍有可见像素；
       * 2. 如果把旧缓存继续当 stable frame，poster 会被提前撤掉，用户就会看到 covered canonical 黑壳闪一下；
       * 3. 因而 render/protocol 只认当前 DOM 的严格 ready 事实，不再把历史缓存冒充现态。
       */
      hasStableFrame:
        hasExistingSameSourcePreviewFrame ||
        hasFrozenTimelineFrame ||
        shouldReuseSavedTimelineFrameAsPreview ||
        hasCurrentCanonicalRevealReady,
    },
    frameEvidence: frozenTimelineFrame
      ? {
          kind: "frozen_frame",
          src: frozenTimelineFrame.src,
          currentTime: frozenTimelineFrame.currentTime,
        }
      : previewFrameEvidence
        ? {
            kind: "preview_dom",
            src: previewFrameEvidence.src,
            currentTime: previewFrameEvidence.currentTime,
          }
      : { kind: "none" },
    intent: {
      viewerOpen: false,
      fullscreen: false,
      retiringOwner: isRetiringReleasedOwner,
    },
    coldPath: {
      coldFirstExposure:
        shouldRenderInlineVideo &&
        context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
        !hasVisibleCanonicalCommittedFrame,
      stableSurface: coldPathStableSurface,
    },
  });
  const shouldPreferRetiringOwnerPreviewSurface =
    isRetiringReleasedOwner &&
    playbackContinuityDecision.kind === "retiring_hold_frame";
  /**
   * “有 saved position / 允许复用 saved src” 只代表后续该往哪条会话 seek，
   * 不代表眼前已经握有一张能挡住黑壳的像素表面。
   * 这里必须只认真正已经存在于 DOM/bridge 里的连续性表面。
   */
  const hasActualContinuityBridgeSurface =
    hasCurrentDomPreviewFrame || hasFrozenTimelineFrame || hasCurrentCanonicalRevealReady;
  /**
   * 当前 owner 只有保存续播点、但还没有任何真实 bridge surface 时：
   * 1. saved src 只是“将来要对齐到哪”，不是当前可见像素；
   * 2. 这时继续 suppress poster，就会暴露 covered canonical 黑壳；
   * 3. 因而需要单独保住 poster，直到 preview/frozen/live 其中之一真的成立。
   */
  const shouldKeepPosterDuringSavedPositionOwnerWarmup =
    shouldRenderInlineVideo &&
    context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
    shouldReuseSavedTimelineFrameAsPreview &&
    !hasActualContinuityBridgeSurface &&
    !isRetiringReleasedOwner;
  const shouldShowTimelinePlayIndicator =
    !shouldRenderInlineVideo && !isRecentOwnerContinuityBridge &&
    !shouldReuseSavedTimelineFrameAsPreview && !hasSameSourceSavedTimelineFrame && !restorableTimelineFrame &&
    !hasExistingSameSourcePreviewFrame && !hasFrozenTimelineFrame && !hasKnownReadyPreviewFrame;
  /** 旧 owner 退场时只允许在“无 playback + 无 formal source”的极窄兜底里短暂复用旧 preview bridge。 */
  const shouldRenderReleasedOwnerPreviewVideo =
    Boolean(previewVideoSrc) &&
    isRetiringReleasedOwner &&
    !playback &&
    videoBudget.formalByteSource === "none" &&
    shouldReuseSavedTimelineFrameAsPreview &&
    !hasFrozenTimelineFrame;
  const shouldKeepExistingPreviewDomForRetiringOwner =
    shouldPreferRetiringOwnerPreviewSurface && hasExistingSameSourcePreviewFrame;
  const shouldForceOwnerBridgePreview =
    shouldRenderInlineVideo &&
    !isPreviewMissingSource &&
    Boolean(previewVideoSrc) &&
    previewVideoSrc === ownerCanonicalVideoSrc &&
    !hasCurrentDomPreviewFrame &&
    !hasFrozenTimelineFrame;
  const shouldRenderPreviewVideoByBudget = (Boolean(previewVideoSrc) && context.读取时间线预览视频是否允许渲染(videoBudget, {
    hasExistingSameSourcePreviewFrame,
    hasFrozenTimelineFrame,
    hasKnownReadyPreviewFrame,
    previewVideoSrc,
    shouldReuseSavedTimelineFrameAsPreview,
  }) && (input.可渲染真实预览视频附件.has(attachment.attachmentId) ||
      hasExistingSameSourcePreviewFrame || hasFrozenTimelineFrame || hasKnownReadyPreviewFrame)) ||
    shouldForceOwnerBridgePreview ||
    shouldRenderReleasedOwnerPreviewVideo;
  /**
   * 冷路径首轮曝光时，如果协议已经裁决“当前可见槽位应该继续是 placeholder”，
   * 就绝不能先长一颗尚未 committed 的 preview `<video>`：
   * 1. 否则会出现 `preview + canonical` 同时挂着，但 preview `readyState=0` 的黑底壳；
   * 2. 真实浏览器里这一拍正是用户看到“黑一下再开始播”的来源；
   * 3. 因而 placeholder 只能让给已提交帧，不让给还没出像素的 `<video>` 节点。
   */
  const shouldSuppressColdPlaceholderPreviewVideo =
    playbackContinuityDecision.visibleSurface === "placeholder" &&
    playbackContinuityDecision.kind === "hidden_handoff" &&
    hasStablePreviewPosterSurface &&
    !hasCurrentCanonicalRevealReady &&
    (!shouldReuseSavedTimelineFrameAsPreview || shouldKeepPosterDuringSavedPositionOwnerWarmup) &&
    !hasCurrentDomPreviewFrame &&
    !hasFrozenTimelineFrame &&
    !shouldRenderReleasedOwnerPreviewVideo;
  const shouldSuppressPosterBackedOwnerWarmupPreview =
    shouldRenderInlineVideo &&
    hasStablePreviewPosterSurface &&
    !hasCurrentCanonicalRevealReady &&
    !shouldRevealCanonicalHost &&
    (!shouldReuseSavedTimelineFrameAsPreview || shouldKeepPosterDuringSavedPositionOwnerWarmup) &&
    !hasCurrentDomPreviewFrame &&
    !hasFrozenTimelineFrame &&
    !shouldRenderReleasedOwnerPreviewVideo &&
    !isRetiringReleasedOwner;
  /** preview 还没追上续播点时，不能先把错误时间点露给用户。 */
  const shouldSuppressWrongTimePreviewVideo = shouldRenderInlineVideo &&
    playbackContinuityDecision.kind === "hidden_handoff" &&
    Boolean(restorableTimelineFrame) &&
    !hasCurrentDomPreviewFrame &&
    !hasFrozenTimelineFrame &&
    !hasStablePreviewPosterSurface &&
    !shouldReuseSavedTimelineFrameAsPreview &&
    !shouldRenderReleasedOwnerPreviewVideo;
  const shouldShowFirstFrameGuard = (shouldRenderPreviewVideoByBudget || shouldSuppressColdPlaceholderPreviewVideo) &&
    !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame && !hasStablePreviewPosterSurface;
  const hasReadyPreviewSurface = hasStablePreviewPosterSurface || hasCurrentDomPreviewFrame || hasFrozenTimelineFrame;
  const shouldUseHiddenStageCover = shouldRenderInlineVideo && (hasReadyPreviewSurface || hasKnownReadyPreviewFrame) &&
    !shouldRevealCanonicalHost && (context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId ||
      context.时间线隐藏接管附件Id === attachment.attachmentId || hasCurrentCanonicalRevealReady || shouldReuseSavedTimelineFrameAsPreview);
  const shouldStageWarmupGuardedOwnerCanonical = shouldRenderInlineVideo && !shouldRevealCanonicalHost && shouldShowFirstFrameGuard;
  const shouldStageWarmupColdInitialOwnerCanonical = shouldRenderInlineVideo && !shouldRevealCanonicalHost && !playback &&
    context.inlineAutoplayOwnerAttachmentId === attachment.attachmentId &&
    context.时间线隐藏接管附件Id !== attachment.attachmentId &&
    !hasCurrentCanonicalRevealReady && !hasStablePreviewPosterSurface &&
    !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame && !hasKnownReadyPreviewFrame &&
    !shouldReuseSavedTimelineFrameAsPreview;
  const shouldRenderStageHost =
    !shouldRevealCanonicalHost &&
    !shouldUseHiddenStageCover &&
    (shouldStageWarmupGuardedOwnerCanonical || shouldStageWarmupColdInitialOwnerCanonical);
  const shouldRenderVisibleCanonicalHost =
    shouldRenderInlineVideo &&
    !shouldPreferRetiringOwnerPreviewSurface &&
    (shouldRevealCanonicalHost || shouldUseHiddenStageCover);
  const shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup =
    shouldRenderVisibleCanonicalHost && !hasVisibleCanonicalCommittedFrame &&
    (hasCurrentDomPreviewFrame || hasFrozenTimelineFrame || shouldReuseSavedTimelineFrameAsPreview || hasStablePreviewPosterSurface);
  /**
   * handoff 期间只允许一个 bridge surface 占着可见槽位：
   * 1. 一旦已经有同源冻结帧，它比 live preview 更稳，因为不会再被 seek / readyState 波动拖着抖；
   * 2. visible canonical 这时仍在后台追 source/time，不该和 preview/frozen 一起争可见位；
   * 3. 因而过渡期固定优先 frozen frame，preview 退回“冷态/稳态预览”职责。
   */
  const shouldPreferFrozenBridgeOverPreview =
    hasFrozenTimelineFrame &&
    (playbackContinuityDecision.kind === "hidden_handoff" ||
      playbackContinuityDecision.kind === "hold_frame" ||
      playbackContinuityDecision.kind === "retiring_hold_frame" ||
      isRetiringReleasedOwner ||
      (shouldRenderInlineVideo && !shouldRevealCanonicalHost));
  const shouldSuppressPosterBackedWarmupPreviewVideo = shouldUseHiddenStageCover && hasStablePreviewPosterSurface &&
    !hasCurrentDomPreviewFrame && !hasFrozenTimelineFrame && !hasKnownReadyPreviewFrame;
  const shouldRenderPreviewVideo = shouldRenderPreviewVideoByBudget &&
    !shouldPreferFrozenBridgeOverPreview &&
    !shouldSuppressColdPlaceholderPreviewVideo &&
    !shouldSuppressPosterBackedOwnerWarmupPreview &&
    !shouldSuppressPosterBackedWarmupPreviewVideo &&
    !shouldSuppressWrongTimePreviewVideo &&
    (!shouldRenderVisibleCanonicalHost || shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup) &&
    (!isRecentOwnerContinuityBridge || shouldRenderReleasedOwnerPreviewVideo || shouldKeepExistingPreviewDomForRetiringOwner);
  const shouldRenderFrozenTimelineFrame =
    hasFrozenTimelineFrame &&
    (shouldPreferFrozenBridgeOverPreview ||
      (!hasCurrentDomPreviewFrame &&
        (!shouldRenderInlineVideo ||
          !shouldRevealCanonicalHost ||
          shouldKeepStablePreviewSurfaceDuringVisibleCanonicalWarmup)));
  /**
   * 有封面就渲染 poster。z-index 栈（poster:0 < video:1 < frozen:2 < canonical:3）
   * 物理保证上层有像素时自然遮住 poster，无需显式压制逻辑。
   * 这取代了之前 ~45 行的 shouldSuppressPosterForContinuity /
   * shouldRenderCanonicalLoadingPosterCover / shouldRenderRetiringOwnerFrozenFramePosterSafetyNet /
   * shouldKeepCanonicalCoverDuringGuardedPreviewWarmup 组合条件。
   */
  const shouldRenderPreviewPosterSurface = hasStablePreviewPosterSurface;
  const previewVideoPoster =
    !shouldPreferRetiringOwnerPreviewSurface &&
    !hasFrozenTimelineFrame &&
    !hasCurrentDomPreviewFrame &&
    hasStablePreviewPosterSurface
      ? previewPosterSrc
      : undefined;
  return 渲染时间线视频表面卡片({
    attachment,
    attachmentCardStyle: input.attachmentCardStyle,
    budgetTier: videoBudget.tier,
    budgetReason: videoBudget.reason,
    formalByteSource: videoBudget.formalByteSource,
    previewPosterSrc,
    previewVideoSrc,
    normalizedPreviewVideoSrc,
    ownerCanonicalVideoSrc,
    previewVideoPoster,
    frozenTimelineFrame,
    shouldRenderPreviewVideo,
    shouldRenderPreviewPosterSurface,
    shouldRenderFrozenTimelineFrame,
    shouldRenderVisibleCanonicalHost,
    shouldRevealCanonicalHost,
    shouldRenderStageHost,
    shouldRenderInlineVideo,
    shouldShowFirstFrameGuard,
    hasCurrentDomPreviewFrame,
    shouldShowTimelinePlayIndicator,
    renderMediaHint: input.渲染媒体提示(attachment.attachmentId, playback),
    操作: {
      恢复预览位置(video) {
        context.恢复时间线自动播播放位置(attachment.attachmentId, video, {
          allowPreviewFrame: Boolean(restorableTimelineFrame),
        });
      },
      标记预览视频已出首帧(video) {
        标记当前预览视频已出首帧(context, attachment.attachmentId, video);
      },
      处理封面加载失败(event) {
        context.标记视频封面加载失败(attachment.attachmentId, event);
      },
      阻止原生菜单(event) {
        context.阻止时间线媒体预览原生菜单(event);
      },
      打开查看器(event) {
        context.打开媒体查看器(event, attachment.attachmentId);
      },
    },
  });
};
