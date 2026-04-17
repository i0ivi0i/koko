export const 可选择视频文件类型 = ["video/*"] as const;

/**
 * 这里必须和 Rust 外壳里的 `视频` 上传上限保持一致。
 * 前端先拦一次，目的是让明显超限的大文件在本地就被拒绝，
 * 避免用户先白白上传很久，最后才在后端 / sidecar 被 413 打回来。
 *
 * 当前阶段产品裁决已经从 50MB 提到 200MB：
 * 1. 50MB 对真实群聊视频太保守；
 * 2. 这层只负责“前端先拦”，不拥有最终业务真相；
 * 3. 真正成立的前提仍然是前后端与 Tus sidecar 的门禁一起同步。
 */
export const 视频附件上传上限字节数 = 200 * 1024 * 1024;

export type 视频文件元数据 = {
  width: number;
  height: number;
  durationSeconds: number;
  previewUrl: string | null;
};

type 视频元数据依赖 = {
  createObjectUrl?: (file: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  createProbeElement?: () => HTMLVideoElement;
  createCanvasElement?: () => HTMLCanvasElement;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  timeoutMs?: number;
};

const 默认视频元数据探测超时毫秒 = 10_000;

const 读取预览采样时间 = (durationSeconds: number): number => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  /**
   * 很多手机视频在 0 秒只有黑场或还没解码出有效画面。
   * 发送侧预览图默认往后采一个轻量时间点，避免把黑帧固化成消息封面。
   */
  const 可用末尾 = Math.max(durationSeconds - 0.1, 0);
  if (可用末尾 <= 0.2) {
    return 0;
  }
  return Math.min(Math.max(durationSeconds * 0.1, 0.35), 1.5, 可用末尾);
};

export function 解析视频元数据失败代码(error: unknown): string {
  const normalizedMessage =
    error instanceof Error ? error.message.trim().toLowerCase() : String(error ?? "").trim().toLowerCase();
  if (
    normalizedMessage.includes("notsupportederror") ||
    normalizedMessage.includes("not supported") ||
    normalizedMessage.includes("unsupported")
  ) {
    return "attachment_type_not_allowed";
  }
  return "attachment_upload_failed";
}

/**
 * 视频元数据探测只负责把浏览器可读到的稳定事实提炼出来，
 * 不在这里做上传、播放、locator 或任何壳层状态推进。
 */
export async function 读取视频文件元数据(
  file: File,
  deps: 视频元数据依赖 = {}
): Promise<视频文件元数据> {
  const createObjectUrl = deps.createObjectUrl ?? URL.createObjectURL;
  const revokeObjectUrl = deps.revokeObjectUrl ?? URL.revokeObjectURL;
  const createProbeElement =
    deps.createProbeElement ?? (() => document.createElement("video") as HTMLVideoElement);
  const createCanvasElement =
    deps.createCanvasElement ?? (() => document.createElement("canvas") as HTMLCanvasElement);
  const scheduleTimeout = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const cancelTimeout = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? 默认视频元数据探测超时毫秒;
  const objectUrl = createObjectUrl(file);
  const probe = createProbeElement();
  probe.preload = "auto";
  probe.muted = true;
  probe.playsInline = true;
  const 最小元数据ReadyState =
    typeof HTMLMediaElement === "undefined"
      ? 1
      : HTMLMediaElement.HAVE_METADATA;
  const 最小当前帧ReadyState =
    typeof HTMLMediaElement === "undefined"
      ? 2
      : HTMLMediaElement.HAVE_CURRENT_DATA;

  return await new Promise<视频文件元数据>((resolve, reject) => {
    let settled = false;
    let 等待Seek完成 = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const 生成静态预览图 = (): string | null => {
      if (probe.videoWidth <= 0 || probe.videoHeight <= 0) {
        return null;
      }
      let canvas: HTMLCanvasElement;
      try {
        canvas = createCanvasElement();
      } catch {
        return null;
      }
      canvas.width = probe.videoWidth;
      canvas.height = probe.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }
      try {
        context.drawImage(probe, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.82);
      } catch {
        return null;
      }
    };

    const cleanup = (): void => {
      if (timeoutHandle) {
        cancelTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      probe.onloadedmetadata = null;
      probe.onloadeddata = null;
      probe.onseeked = null;
      probe.onerror = null;
      probe.src = "";
      revokeObjectUrl(objectUrl);
    };

    const finishWithError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const 完成探测 = (): void => {
      if (
        settled ||
        (typeof probe.readyState === "number" && probe.readyState < 最小元数据ReadyState)
      ) {
        return;
      }
      settled = true;
      const result = {
        width: probe.videoWidth,
        height: probe.videoHeight,
        durationSeconds: probe.duration,
        previewUrl: 生成静态预览图(),
      };
      cleanup();
      resolve(result);
    };

    const 尝试采样预览帧 = (): void => {
      if (
        settled ||
        等待Seek完成 ||
        (typeof probe.readyState === "number" && probe.readyState < 最小当前帧ReadyState)
      ) {
        return;
      }
      const sampleTime = 读取预览采样时间(probe.duration);
      if (sampleTime <= 0 || typeof probe.currentTime !== "number") {
        完成探测();
        return;
      }
      if (Math.abs(probe.currentTime - sampleTime) < 0.05) {
        完成探测();
        return;
      }
      try {
        等待Seek完成 = true;
        probe.currentTime = sampleTime;
      } catch {
        等待Seek完成 = false;
        完成探测();
      }
    };

    probe.onloadedmetadata = () => {
      if (
        settled ||
        (typeof probe.readyState === "number" && probe.readyState < 最小元数据ReadyState)
      ) {
        return;
      }
      if (
        typeof probe.readyState === "number" &&
        probe.readyState >= 最小当前帧ReadyState
      ) {
        尝试采样预览帧();
      }
    };
    probe.onloadeddata = () => {
      尝试采样预览帧();
    };
    probe.onseeked = () => {
      if (!等待Seek完成) {
        return;
      }
      等待Seek完成 = false;
      完成探测();
    };
    probe.onerror = () => {
      const code = 解析视频元数据失败代码(new Error("NotSupportedError"));
      finishWithError(new Error(code));
    };
    timeoutHandle = scheduleTimeout(() => {
      finishWithError(new Error("attachment_upload_failed"));
    }, timeoutMs);
    probe.src = objectUrl;
    probe.load?.();
  });
}
