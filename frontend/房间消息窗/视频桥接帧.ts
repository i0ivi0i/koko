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
