export type 时间线自动播冻结帧画面 = HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

export type 时间线自动播冻结帧 = {
  src: string;
  currentTime: number;
  bitmap: 时间线自动播冻结帧画面;
  width: number;
  height: number;
  updatedAt: number;
  dispose(): void;
};

const 关闭桥接画面 = (bitmap: 时间线自动播冻结帧画面): void => {
  if ("close" in bitmap && typeof bitmap.close === "function") {
    bitmap.close();
  }
};

const 读取缩放尺寸 = (
  video: HTMLVideoElement,
  最大边长: number
): { width: number; height: number } => {
  const scale = Math.min(1, 最大边长 / Math.max(video.videoWidth, video.videoHeight));
  return {
    width: Math.max(1, Math.round(video.videoWidth * scale)),
    height: Math.max(1, Math.round(video.videoHeight * scale)),
  };
};

export const 从视频捕获时间线冻结帧 = (
  video: HTMLVideoElement,
  最大边长: number
): 时间线自动播冻结帧 | null => {
  const src = video.currentSrc || video.getAttribute("src");
  if (
    !src ||
    !Number.isFinite(video.currentTime) ||
    video.currentTime < 0 ||
    video.readyState < video.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return null;
  }

  const { width, height } = 读取缩放尺寸(video, 最大边长);

  /**
   * 这里只保留“同一正式视频当前这一帧的内存投影”：
   * 1. 不再把 bridge 编码成 webp data URL，也不再走 blob/FileReader；
   * 2. `ImageBitmap / OffscreenCanvas / HTMLCanvasElement` 都是浏览器认可的可绘制画面源；
   * 3. 这样 bridge 仍然只是同一条正式视频的一帧，不会再膨胀成第二张图片资产真相。
   */
  if (typeof OffscreenCanvas === "function") {
    const offscreen = new OffscreenCanvas(width, height);
    const context = offscreen.getContext("2d");
    if (!context || typeof context.drawImage !== "function") {
      return null;
    }
    context.drawImage(video, 0, 0, width, height);
    if (typeof offscreen.transferToImageBitmap === "function") {
      const bitmap = offscreen.transferToImageBitmap();
      return {
        src,
        currentTime: video.currentTime,
        bitmap,
        width,
        height,
        updatedAt: Date.now(),
        dispose: () => 关闭桥接画面(bitmap),
      };
    }
    return {
      src,
      currentTime: video.currentTime,
      bitmap: offscreen,
      width,
      height,
      updatedAt: Date.now(),
      dispose: () => undefined,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || typeof context.drawImage !== "function") {
    return null;
  }
  context.drawImage(video, 0, 0, width, height);
  return {
    src,
    currentTime: video.currentTime,
    bitmap: canvas,
    width,
    height,
    updatedAt: Date.now(),
    dispose: () => undefined,
  };
};

export const 绘制时间线冻结帧到画布 = (
  frame: 时间线自动播冻结帧,
  canvas: HTMLCanvasElement
): void => {
  if (canvas.width !== frame.width) {
    canvas.width = frame.width;
  }
  if (canvas.height !== frame.height) {
    canvas.height = frame.height;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.clearRect(0, 0, frame.width, frame.height);
  try {
    context.drawImage(frame.bitmap, 0, 0, frame.width, frame.height);
  } catch {
    // bitmap 可能已被 dispose（ImageBitmap.close）或 context lost；
    // 此时 canvas 保持透明，底层 poster 安全网会兜住卡片视觉。
  }
};

/**
 * 已挂载守卫的 canvas 与其当前冻结帧引用。
 * WeakMap 保证 canvas 被 GC 时条目自动清理，无泄漏风险。
 * 监听器读 WeakMap 中的最新帧引用，而非闭包捕获的旧帧——
 * 解决 Lit 复用同一 canvas 但冻结帧已换代时的陈旧重绘问题。
 */
const 冻结帧守卫表 = new WeakMap<HTMLCanvasElement, 时间线自动播冻结帧>();

/**
 * 为 canvas 挂载 GPU context loss 自愈守卫。
 * 全屏进退、标签页切换、内存压力等场景下浏览器可能重置 GPU 上下文，
 * 导致 canvas 2D 渲染面被清空为透明像素。
 *
 * 兼容性说明：contextlost/contextrestored 在 Chrome 99+、Firefox 125+ 支持，
 * Safari 不支持。Safari 上的黑闪由 overlay 延迟移除（Phase 2）兜住。
 */
export const 挂载冻结帧画布守卫 = (
  canvas: HTMLCanvasElement,
  frame: 时间线自动播冻结帧
): void => {
  const 已有守卫 = 冻结帧守卫表.has(canvas);
  冻结帧守卫表.set(canvas, frame);
  if (已有守卫) {
    return;
  }
  canvas.addEventListener("contextlost", (e: Event) => {
    e.preventDefault();
  });
  canvas.addEventListener("contextrestored", () => {
    const 当前帧 = 冻结帧守卫表.get(canvas);
    if (!当前帧) {
      return;
    }
    绘制时间线冻结帧到画布(当前帧, canvas);
  });
};
