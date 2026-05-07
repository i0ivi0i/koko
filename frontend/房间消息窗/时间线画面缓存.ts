import type { 媒体播放位置 } from "../媒体/媒体播放.js";
import { 视频地址属于旧流媒体清单 } from "../媒体/媒体播放.js";
import type { 视频预览状态 } from "../媒体/视频预览.js";
import {
  从视频捕获时间线冻结帧,
  type 时间线自动播冻结帧,
} from "./视频桥接帧.js";
import type { 聊天列表展示项 } from "./视图.js";

const 时间线自动播冻结帧最大边长 = 480;
const 时间线自动播冻结帧允许时间偏差秒 = 2.5;
const 时间线自动播冻结帧预热最小位移秒 = 1.5;
const 时间线自动播冻结帧无续播位置保活毫秒 = 4_000;

interface 时间线画面缓存Owner依赖 {
  读取视频当前播放源: (video: HTMLVideoElement) => string | null;
  归一化时间线视频播放源: (src: string | null) => string | null;
  读取预览状态: (attachmentId: string) => 视频预览状态 | null;
  请求刷新: () => void;
}

const 读取当前视频附件标识 = (items: 聊天列表展示项[]): Set<string> => {
  const attachmentIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "message") {
      continue;
    }
    for (const attachment of item.attachments) {
      if (attachment.kind === "video") {
        attachmentIds.add(attachment.attachmentId);
      }
    }
  }
  return attachmentIds;
};

const 删除已退场附件 = <T>(
  cache: Map<string, T>,
  当前视频附件: Set<string>,
  dispose?: (value: T) => void
): void => {
  for (const attachmentId of cache.keys()) {
    if (!当前视频附件.has(attachmentId)) {
      const value = cache.get(attachmentId);
      if (value && dispose) {
        dispose(value);
      }
      cache.delete(attachmentId);
    }
  }
};

/**
 * 时间线画面缓存 owner 只保存“已经从真实视频确认过的画面事实”。
 *
 * 它不拥有播放器、不改媒体字节来源，也不替代 runtime snapshot：
 * 1. 首帧缓存只记录附件和同源 src，避免无 poster 视频反复黑闪；
 * 2. 冻结帧只来自刚播放过的同一颗 video，用来承接 owner 退场瞬间；
 * 3. 消息窗只把浏览器信号交给这里，渲染时读取投影结果。
 */
export class 时间线画面缓存Owner {
  private readonly 时间线视频首帧就绪源 = new Map<string, string>();
  private readonly 时间线自动播冻结帧 = new Map<string, 时间线自动播冻结帧>();
  private readonly 时间线自动播冻结帧导出中 = new Map<string, string>();

  constructor(private readonly 依赖: 时间线画面缓存Owner依赖) {}

  清空(): void {
    this.时间线视频首帧就绪源.clear();
    for (const frame of this.时间线自动播冻结帧.values()) {
      frame.dispose();
    }
    this.时间线自动播冻结帧.clear();
    this.时间线自动播冻结帧导出中.clear();
  }

  同步当前视频附件(items: 聊天列表展示项[]): Set<string> {
    const 当前视频附件 = 读取当前视频附件标识(items);
    删除已退场附件(this.时间线视频首帧就绪源, 当前视频附件);
    删除已退场附件(this.时间线自动播冻结帧, 当前视频附件, (frame) =>
      frame.dispose()
    );
    删除已退场附件(this.时间线自动播冻结帧导出中, 当前视频附件);
    return 当前视频附件;
  }

  读取首帧是否就绪(attachmentId: string, src: string | null): boolean {
    const normalizedSrc = this.依赖.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return false;
    }
    return this.时间线视频首帧就绪源.get(attachmentId) === normalizedSrc;
  }

  读取已就绪首帧预览源(attachmentId: string): string | null {
    const previewState = this.依赖.读取预览状态(attachmentId);
    if (previewState?.phase === "missing_source") {
      return null;
    }
    const src = this.时间线视频首帧就绪源.get(attachmentId) ?? null;
    if (!src || 视频地址属于旧流媒体清单(src)) {
      return null;
    }
    return src;
  }

  标记首帧已就绪(attachmentId: string, src: string | null): void {
    const normalizedSrc = this.依赖.归一化时间线视频播放源(src);
    if (!normalizedSrc) {
      return;
    }
    if (this.时间线视频首帧就绪源.get(attachmentId) === normalizedSrc) {
      /**
       * 同源缓存已命中时仍刷新一次，因为当前 DOM 可能刚从虚拟卸载后重新拿到首帧。
       * 这次刷新让遮挡层按“当前节点已出帧”退场，而不是沿用旧节点的视觉状态。
       */
      this.依赖.请求刷新();
      return;
    }
    this.时间线视频首帧就绪源.set(attachmentId, normalizedSrc);
    this.依赖.请求刷新();
  }

  读取自动播冻结帧(
    attachmentId: string,
    src: string | null,
    position: 媒体播放位置 | null
  ): 时间线自动播冻结帧 | null {
    const frame = this.时间线自动播冻结帧.get(attachmentId) ?? null;
    const normalizedExpectedSrc = this.依赖.归一化时间线视频播放源(src);
    const normalizedFrameSrc = this.依赖.归一化时间线视频播放源(frame?.src ?? null);
    if (
      !frame ||
      !normalizedExpectedSrc ||
      !normalizedFrameSrc ||
      normalizedExpectedSrc !== normalizedFrameSrc ||
      !frame.bitmap
    ) {
      return null;
    }
    if (!position) {
      /**
       * 顶部向下滑入自动播 owner 时，业务上常常还没有稳定的续播位置快照：
       * 1. 但同源、刚刚捕获过的冻结帧本身已经是可信的“上一张真实像素”；
       * 2. 这时若强行要求 position 才给读，底板会先被判空，新的 preview/canonical 又还没真正出帧；
       * 3. 这里允许最近一次同源冻结帧短暂续命，只承担 continuity surface，不冒充真实播放位置。
       */
      return Number.isFinite(frame.updatedAt) &&
          Date.now() - frame.updatedAt <= 时间线自动播冻结帧无续播位置保活毫秒
        ? frame
        : null;
    }
    if (
      Math.abs(frame.currentTime - position.currentTime) >
      时间线自动播冻结帧允许时间偏差秒
    ) {
      return null;
    }
    return frame;
  }

  捕获自动播冻结帧(
    attachmentId: string,
    video: HTMLVideoElement,
    options: { 预热已合成帧?: boolean; 立即提交?: boolean } = {}
  ): void {
    const 初始源 = this.依赖.读取视频当前播放源(video);
    const 初始时间 = video.currentTime;
    const captureKey =
      初始源 && Number.isFinite(初始时间)
        ? `${初始源}\u0000${Math.round(初始时间 * 2) / 2}\u0000${options.预热已合成帧 ? "warm" : "now"}`
        : null;
    const 执行捕获 = (): void => {
      const src = this.依赖.读取视频当前播放源(video);
      const currentTime = video.currentTime;
      if (
        !attachmentId ||
        !src ||
        !Number.isFinite(currentTime) ||
        currentTime < 0 ||
        video.readyState < video.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0
      ) {
        return;
      }
      const previousFrame = this.时间线自动播冻结帧.get(attachmentId);
      const 最小位移阈值 = options.预热已合成帧
        ? 时间线自动播冻结帧预热最小位移秒
        : 0.5;
      if (
        previousFrame?.src === src &&
        Math.abs(previousFrame.currentTime - currentTime) < 最小位移阈值
      ) {
        return;
      }
      const nextFrame = 从视频捕获时间线冻结帧(video, 时间线自动播冻结帧最大边长);
      if (!nextFrame) {
        return;
      }
      try {
        const latestFrame = this.时间线自动播冻结帧.get(attachmentId);
        if (
          latestFrame?.src === src &&
          Math.abs(latestFrame.currentTime - currentTime) < 0.5 &&
          latestFrame.width === nextFrame.width &&
          latestFrame.height === nextFrame.height
        ) {
          nextFrame.dispose();
          return;
        }
        latestFrame?.dispose();
        this.时间线自动播冻结帧.set(attachmentId, nextFrame);
        this.依赖.请求刷新();
      } finally {
        if (captureKey && this.时间线自动播冻结帧导出中.get(attachmentId) === captureKey) {
          this.时间线自动播冻结帧导出中.delete(attachmentId);
        }
      }
    };

    /**
     * 预热路径不抓“可能还没真正显示出去的 currentTime”，而是尽量等 compositor 确认一帧已提交：
     * 1. 这样旧 owner 退场时，缓存里的最后一眼更接近用户刚刚真的看到的画面；
     * 2. `requestVideoFrameCallback()` 不可用时，再回退到当前同步抓帧路径；
     * 3. 真正退场那次 force/released capture 仍保持立即执行，避免 paused 后等不到回调。
     */
    if (
      options.预热已合成帧 &&
      captureKey &&
      typeof video.requestVideoFrameCallback === "function" &&
      !video.paused
    ) {
      if (this.时间线自动播冻结帧导出中.get(attachmentId) === captureKey) {
        return;
      }
      this.时间线自动播冻结帧导出中.set(attachmentId, captureKey);
      video.requestVideoFrameCallback(() => {
        执行捕获();
      });
      return;
    }

    执行捕获();
  }
}
