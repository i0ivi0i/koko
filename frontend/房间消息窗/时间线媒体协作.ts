import type { 信息流视频预算投影 } from "../媒体/信息流视频预算.js";
import type { 消息视频自动播候选 } from "../媒体/消息视频自动播编排.js";
import type { 媒体播放结果, 媒体播放位置 } from "../媒体/媒体播放.js";
import type { 媒体会话信号 } from "../媒体/媒体会话.js";
import type { 媒体查看器打开请求, 媒体查看器项目 } from "../媒体/媒体查看器.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import type { 消息虚拟项 } from "./消息虚拟列表.js";
import {
  读取即将渲染的时间线视频附件,
  读取允许渲染真实预览视频附件集合,
} from "./媒体窗口.js";
import type { 聊天列表展示项, 消息展示项 } from "./视图.js";

type 时间线视频附件 = Extract<消息展示项["attachments"][number], { kind: "video" }>;
type 就绪时间线视频预览 = Extract<视频预览状态, { phase: "ready" }>;

type 时间线视频表面期望输入 = {
  root: HTMLElement;
  items: 聊天列表展示项[];
  virtualItems: 消息虚拟项[];
  inlineAutoplayOwnerAttachmentId: string | null;
  最近退场Owner附件Id: string | null;
  时间线隐藏接管附件Id: string | null;
  自动播候选可见条目: Map<string, 消息视频自动播候选>;
  inlineAutoplayPositionByAttachmentId: Record<string, 媒体播放位置>;
  mediaPlaybackByAttachmentId: Record<string, 媒体播放结果>;
  读取时间线视频已就绪首帧预览源: (attachmentId: string) => string | null;
  读取时间线视频首帧是否就绪: (attachmentId: string, src: string | null) => boolean;
  读取时间线视频运行时预览: (attachmentId: string) => 就绪时间线视频预览 | null;
  读取时间线视频首帧预览源: (
    attachment: 时间线视频附件,
    playback: 媒体播放结果 | null,
    input: {
      有静态封面: boolean;
      有运行时预览: boolean;
    }
  ) => string | null;
  读取时间线视频预算投影: (
    attachment: 时间线视频附件,
    previewVideoSrcCandidate: string | null
  ) => 信息流视频预算投影;
  读取保存续帧是否允许承接时间线预览底板: (input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
    playbackTimelineVideoSrc: string | null;
    savedTimelineFrameSrc: string | null;
  }) => boolean;
  读取时间线现有预览视频是否可继续显示: (
    attachmentId: string,
    src: string | null
  ) => boolean;
  读取时间线预览视频是否允许渲染: (
    budget: 信息流视频预算投影,
    input: {
      hasExistingSameSourcePreviewFrame?: boolean;
      hasKnownReadyPreviewFrame?: boolean;
      previewVideoSrc: string | null;
      shouldReuseSavedTimelineFrameAsPreview: boolean;
    }
  ) => boolean;
};

type 时间线退场底板同步输入 = {
  root: HTMLElement;
  attachmentId: string;
  自动播位置上报记录: Map<string, { src: string; currentTime: number }>;
  读取视频当前播放源: (video: HTMLVideoElement) => string | null;
  归一化时间线视频播放源: (src: string | null) => string | null;
  标记时间线视频首帧已就绪: (attachmentId: string, src: string | null) => void;
  捕获时间线自动播冻结帧: (attachmentId: string, video: HTMLVideoElement) => void;
  广播自动播播放位置: (
    attachmentId: string,
    video: HTMLVideoElement,
    force?: boolean,
    allowReleasedOwner?: boolean
  ) => void;
};

type 打开房间媒体查看器输入 = {
  dispatcher: HTMLElement;
  triggerEvent: Event;
  startAttachmentId: string;
  items: 媒体查看器项目[];
};

type 广播房间媒体会话信号输入 = {
  dispatcher: HTMLElement;
  attachmentId: string;
  signal: 媒体会话信号;
};

/**
 * 时间线媒体表面期望只回答“下一拍哪些 preview/canonical 表面还应该活着”。
 * 这里故意把 DOM 查询、预算投影和 owner/缓存读口压进一个边界协作函数：
 * 1. 基类继续拥有状态与投影读口，但不再自己亲自扫描下一拍 DOM；
 * 2. 真正复杂的是“同一附件在 preview/canonical/冻结帧/已就绪首帧之间如何承接”，
 *    这属于壳层协作，不该继续塞在继承基类的方法表里；
 * 3. 一旦后续再拆消息窗，调用方只要继续提供这些最小依赖，协作逻辑就能整体搬走。
 */
export const 读取时间线视频表面期望 = (
  input: 时间线视频表面期望输入
): {
  previewVideoSrcByAttachmentId: Map<string, string>;
  canonicalVideoSrcByAttachmentId: Map<string, string>;
} => {
  const 可渲染真实预览视频附件 = 读取允许渲染真实预览视频附件集合({
    items: input.items,
    virtualItems: input.virtualItems,
    inlineAutoplayOwnerAttachmentId: input.inlineAutoplayOwnerAttachmentId,
    最近退场Owner附件Id: input.最近退场Owner附件Id,
    自动播候选可见条目: input.自动播候选可见条目,
    inlineAutoplayPositionByAttachmentId: input.inlineAutoplayPositionByAttachmentId,
    读取时间线视频已就绪首帧预览源: input.读取时间线视频已就绪首帧预览源,
  });
  const previewVideoSrcByAttachmentId = new Map<string, string>();
  const canonicalVideoSrcByAttachmentId = new Map<string, string>();
  for (const attachment of 读取即将渲染的时间线视频附件({
    items: input.items,
    virtualItems: input.virtualItems,
    inlineAutoplayOwnerAttachmentId: input.inlineAutoplayOwnerAttachmentId,
    最近退场Owner附件Id: input.最近退场Owner附件Id,
    自动播候选可见条目: input.自动播候选可见条目,
    时间线隐藏接管附件Id: input.时间线隐藏接管附件Id,
    dom视频附件标识: Array.from(
      input.root.querySelectorAll<HTMLElement>(
        "video.message-video-preview[data-attachment-id]," +
          ".message-video-canonical-host[data-attachment-id]," +
          ".message-video-canonical-stage-host[data-attachment-id]"
      ),
      (video) => video.dataset.attachmentId
    ),
  })) {
    const playback = input.mediaPlaybackByAttachmentId[attachment.attachmentId] ?? null;
    const runtimePreview = input.读取时间线视频运行时预览(attachment.attachmentId);
    const hasSourcePoster = Boolean(playback?.thumbnailUrl ?? attachment.posterSrc);
    const hasRuntimePreview = Boolean(runtimePreview);
    const playbackTimelineVideoSrc = input.读取时间线视频首帧预览源(attachment, playback, {
      有静态封面: hasSourcePoster,
      有运行时预览: hasRuntimePreview,
    });
    const savedTimelineFrame =
      input.inlineAutoplayPositionByAttachmentId[attachment.attachmentId] ?? null;
    const savedTimelineFrameSrc = savedTimelineFrame?.src ?? null;
    const knownReadyTimelineFrameSrc = input.读取时间线视频已就绪首帧预览源(
      attachment.attachmentId
    );
    const shouldReuseSavedTimelineFrameAsPreview =
      input.读取保存续帧是否允许承接时间线预览底板({
        attachmentId: attachment.attachmentId,
        playback,
        playbackTimelineVideoSrc,
        savedTimelineFrameSrc,
      });
    const timelinePreviewVideoSrcCandidate =
      playbackTimelineVideoSrc ??
      (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
      knownReadyTimelineFrameSrc;
    const budget = input.读取时间线视频预算投影(
      attachment,
      timelinePreviewVideoSrcCandidate
    );
    const timelinePreviewVideoSrc =
      budget.previewVideoSrc ??
      (shouldReuseSavedTimelineFrameAsPreview ? savedTimelineFrameSrc : null) ??
      knownReadyTimelineFrameSrc;
    const hasKnownReadyPreviewFrame = input.读取时间线视频首帧是否就绪(
      attachment.attachmentId,
      timelinePreviewVideoSrc
    );
    const hasExistingSameSourcePreviewFrame = input.读取时间线现有预览视频是否可继续显示(
      attachment.attachmentId,
      timelinePreviewVideoSrc
    );
    if (
      input.读取时间线预览视频是否允许渲染(budget, {
        hasExistingSameSourcePreviewFrame,
        hasKnownReadyPreviewFrame,
        previewVideoSrc: timelinePreviewVideoSrc,
        shouldReuseSavedTimelineFrameAsPreview,
      }) &&
      timelinePreviewVideoSrc &&
      (可渲染真实预览视频附件.has(attachment.attachmentId) ||
        hasExistingSameSourcePreviewFrame ||
        hasKnownReadyPreviewFrame)
    ) {
      previewVideoSrcByAttachmentId.set(attachment.attachmentId, timelinePreviewVideoSrc);
    }
    if (budget.allowInlineCanonical && budget.canonicalVideoSrc) {
      canonicalVideoSrcByAttachmentId.set(attachment.attachmentId, budget.canonicalVideoSrc);
    }
  }
  return {
    previewVideoSrcByAttachmentId,
    canonicalVideoSrcByAttachmentId,
  };
};

/**
 * owner 退场这一拍最容易出现“唯一播放器刚撤、preview 底板还停在更旧帧”的视觉撕裂。
 * 协作函数统一收口这里的桥接步骤：
 * 1. 先只认 canonical player 当前这颗真实视频；
 * 2. 把它的 ready-src 与冻结帧写回缓存 owner；
 * 3. 必要时补刷一次本地位置桥；
 * 4. 只有 preview 与 canonical 同源时，才允许把 preview 对齐到最后一帧。
 */
export const 同步时间线退场Owner底板预览 = (input: 时间线退场底板同步输入): void => {
  const previewVideo = input.root.querySelector<HTMLVideoElement>(
    `video.message-video-preview[data-attachment-id="${input.attachmentId}"]:not([data-canonical-player="true"])`
  );
  const canonicalVideo = input.root.querySelector<HTMLVideoElement>(
    `video.message-video-preview[data-attachment-id="${input.attachmentId}"][data-canonical-player="true"]`
  );
  if (!canonicalVideo) {
    return;
  }
  const canonicalSrc = input.读取视频当前播放源(canonicalVideo);
  const normalizedCanonicalSrc = input.归一化时间线视频播放源(canonicalSrc);
  if (!normalizedCanonicalSrc) {
    return;
  }
  const localBridge = input.自动播位置上报记录.get(input.attachmentId);
  const normalizedLocalBridgeSrc = input.归一化时间线视频播放源(localBridge?.src ?? null);
  const hasNewerLocalBridge =
    Boolean(localBridge) &&
    normalizedLocalBridgeSrc === normalizedCanonicalSrc &&
    Number.isFinite(localBridge?.currentTime) &&
    (localBridge?.currentTime ?? 0) > canonicalVideo.currentTime + 0.25;
  const targetCurrentTime = hasNewerLocalBridge
    ? (localBridge?.currentTime ?? canonicalVideo.currentTime)
    : canonicalVideo.currentTime;

  input.标记时间线视频首帧已就绪(input.attachmentId, canonicalSrc);
  input.捕获时间线自动播冻结帧(input.attachmentId, canonicalVideo);
  if (!hasNewerLocalBridge) {
    input.广播自动播播放位置(input.attachmentId, canonicalVideo, true, true);
  }
  if (!previewVideo) {
    return;
  }
  const previewSrc = input.读取视频当前播放源(previewVideo);
  const normalizedPreviewSrc = input.归一化时间线视频播放源(previewSrc);
  if (normalizedCanonicalSrc !== normalizedPreviewSrc) {
    return;
  }
  if (Math.abs(previewVideo.currentTime - targetCurrentTime) < 0.25) {
    return;
  }
  try {
    previewVideo.currentTime = targetCurrentTime;
  } catch {
    // preview 底板自己还没完全稳定时，恢复位置桥会在后续 owner 重新挂接时再补一次。
  }
};

/**
 * 消息窗时间线卡片只负责抛出“打开查看器”意图，不自己拥有查看器状态机。
 * 这里统一处理事件拦截与 CustomEvent 形状，避免每个渲染位点再各写一份。
 */
export const 请求打开房间媒体查看器 = (input: 打开房间媒体查看器输入): void => {
  input.triggerEvent.preventDefault();
  input.triggerEvent.stopPropagation();
  if (!input.items.some((item) => item.attachmentId === input.startAttachmentId)) {
    return;
  }
  input.dispatcher.dispatchEvent(
    new CustomEvent<媒体查看器打开请求>("room-open-media-viewer", {
      detail: {
        startAttachmentId: input.startAttachmentId,
        items: input.items,
      },
      bubbles: true,
      composed: true,
    })
  );
};

/**
 * `video/img` 回抛出来的只是浏览器层运行时信号。
 * 这里统一包成消息窗外层事件，继续让媒体会话 owner 决定恢复、等待和降级。
 */
export const 广播房间媒体会话信号 = (input: 广播房间媒体会话信号输入): void => {
  input.dispatcher.dispatchEvent(
    new CustomEvent<{ attachmentId: string; signal: 媒体会话信号 }>(
      "room-media-session-signal",
      {
        detail: {
          attachmentId: input.attachmentId,
          signal: input.signal,
        },
        bubbles: true,
        composed: true,
      }
    )
  );
};
