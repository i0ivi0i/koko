export const 可选择视频文件类型 = ["video/*"] as const;

/**
 * 这里必须和 Rust 外壳里的 `视频` 上传上限保持一致。
 * 前端先拦一次，可以避免大文件在本地白传一轮才被后端拒绝。
 */
export const 视频附件上传上限字节数 = 50 * 1024 * 1024;

export type 视频文件元数据 = {
  width: number;
  height: number;
  durationSeconds: number;
};

type 视频元数据依赖 = {
  createObjectUrl?: (file: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  createProbeElement?: () => HTMLVideoElement;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  timeoutMs?: number;
};

const 默认视频元数据探测超时毫秒 = 10_000;

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
  const scheduleTimeout = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const cancelTimeout = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? 默认视频元数据探测超时毫秒;
  const objectUrl = createObjectUrl(file);
  const probe = createProbeElement();
  probe.preload = "metadata";

  return await new Promise<视频文件元数据>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeoutHandle) {
        cancelTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      probe.onloadedmetadata = null;
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

    probe.onloadedmetadata = () => {
      if (settled) {
        return;
      }
      settled = true;
      const result = {
        width: probe.videoWidth,
        height: probe.videoHeight,
        durationSeconds: probe.duration,
      };
      cleanup();
      resolve(result);
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
