import {
  从视频探针导出静态预览图,
  读取预览采样时间,
} from "./视频元数据.js";

export type 视频预览来源 = "embedded_hint" | "early_frame" | "rvfc" | "none";

export type 视频预览命中 = {
  objectUrl: string;
  width: number | null;
  height: number | null;
};

export type 视频预览派生结果 = {
  objectUrl: string | null;
  source: 视频预览来源;
  width: number | null;
  height: number | null;
};

export type 视频预览状态 =
  | {
      phase: "ready";
      src: string;
      source: "cache" | Exclude<视频预览来源, "none">;
    }
  | {
      phase: "loading";
    }
  | {
      phase: "missing_source";
    }
  | {
      phase: "idle";
    };

type 视频预览输入 = {
  attachmentId: string;
  contentHash: string;
  embeddedHint: 视频预览命中 | null;
  canDecode?: () => Promise<boolean>;
  deriveEarlyFrame: () => Promise<视频预览命中 | null>;
  captureDecodedFrame: () => Promise<视频预览命中 | null>;
};

type 媒体源视频预览输入 = {
  src: string;
  createProbeElement?: () => HTMLVideoElement;
  createCanvasElement?: () => HTMLCanvasElement;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  timeoutMs?: number;
};

const 默认视频预览超时毫秒 = 10_000;
const 默认RVFC兜底等待毫秒 = 160;
const 最小元数据ReadyState =
  typeof HTMLMediaElement === "undefined" ? 1 : HTMLMediaElement.HAVE_METADATA;
const 最小当前帧ReadyState =
  typeof HTMLMediaElement === "undefined" ? 2 : HTMLMediaElement.HAVE_CURRENT_DATA;

const 返回命中结果 = (
  hit: 视频预览命中,
  source: Exclude<视频预览来源, "none">
): 视频预览派生结果 => ({
  objectUrl: hit.objectUrl,
  source,
  width: hit.width,
  height: hit.height,
});

/**
 * 预览派生优先级要收口成一个稳定原语：
 * 1. 先吃 cache / embedded hint；
 * 2. 再尝试早期关键帧；
 * 3. 最后才用已解码首帧补一刀；
 * 4. 如果当前根本没有 source bytes，就明确返回 `none`。
 */
export async function 派生视频预览(
  input: 视频预览输入
): Promise<视频预览派生结果> {
  if (input.embeddedHint?.objectUrl) {
    return 返回命中结果(input.embeddedHint, "embedded_hint");
  }
  const canDecode = await (input.canDecode?.() ?? Promise.resolve(true));
  if (!canDecode) {
    return {
      objectUrl: null,
      source: "none",
      width: null,
      height: null,
    };
  }
  const earlyFrame = await input.deriveEarlyFrame();
  if (earlyFrame?.objectUrl) {
    return 返回命中结果(earlyFrame, "early_frame");
  }
  const rvfcFrame = await input.captureDecodedFrame();
  if (rvfcFrame?.objectUrl) {
    return 返回命中结果(rvfcFrame, "rvfc");
  }
  return {
    objectUrl: null,
    source: "none",
    width: null,
    height: null,
  };
}

/**
 * 对单一 canonical 媒体源做轻量抓帧：
 * 1. 优先复用共享的采样时间与 canvas 导出逻辑；
 * 2. 已支持 `requestVideoFrameCallback()` 时，等待 compositor 确认首帧后再截图；
 * 3. 这条链只回答“能不能从同一文件当前已拿到的字节里得到 preview”，不拥有播放真相。
 */
export async function 从媒体源抓取视频预览(
  input: 媒体源视频预览输入
): Promise<视频预览派生结果> {
  const createProbeElement =
    input.createProbeElement ?? (() => document.createElement("video"));
  const scheduleTimeout = input.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const cancelTimeout = input.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const timeoutMs = input.timeoutMs ?? 默认视频预览超时毫秒;
  const probe = createProbeElement();
  probe.preload = "auto";
  probe.muted = true;
  probe.playsInline = true;

  return await new Promise<视频预览派生结果>((resolve) => {
    let settled = false;
    let 等待Seek完成 = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let rvfc兜底定时器: ReturnType<typeof setTimeout> | null = null;
    let rvfc请求序号 = 0;

    const 取消RVFC兜底 = (): void => {
      if (!rvfc兜底定时器) {
        return;
      }
      cancelTimeout(rvfc兜底定时器);
      rvfc兜底定时器 = null;
    };

    const cleanup = (): void => {
      if (timeoutHandle) {
        cancelTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      取消RVFC兜底();
      probe.onloadedmetadata = null;
      probe.onloadeddata = null;
      probe.onseeked = null;
      probe.onerror = null;
      probe.src = "";
    };

    const finish = (result: 视频预览派生结果): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const 导出当前帧 = (source: Exclude<视频预览来源, "none">): void => {
      const objectUrl = 从视频探针导出静态预览图(probe, {
        ...(input.createCanvasElement
          ? {
              createCanvasElement: input.createCanvasElement,
            }
          : {}),
      });
      if (!objectUrl) {
        finish({
          objectUrl: null,
          source: "none",
          width: null,
          height: null,
        });
        return;
      }
      finish({
        objectUrl,
        source,
        width: probe.videoWidth || null,
        height: probe.videoHeight || null,
      });
    };

    const 请求已解码帧截图 = (): void => {
      if (
        typeof probe.requestVideoFrameCallback === "function" &&
        typeof probe.readyState === "number" &&
        probe.readyState >= 最小当前帧ReadyState
      ) {
        const 当前请求序号 = ++rvfc请求序号;
        /**
         * 某些设备/浏览器会出现这种状态：
         * 1. 已经 loadeddata，当前帧可画；
         * 2. requestVideoFrameCallback 注册成功，但在暂停态长期不回调；
         * 3. 旧逻辑会一直等到总超时，最后误判为 missing_source。
         *
         * 这里增加一个短兜底窗口：若 RVFC 迟迟不回调，就直接抓当前帧，
         * 保证“有字节即可出预览”，避免时间线黑框。
         */
        取消RVFC兜底();
        rvfc兜底定时器 = scheduleTimeout(() => {
          if (settled || 当前请求序号 !== rvfc请求序号) {
            return;
          }
          rvfc兜底定时器 = null;
          导出当前帧("early_frame");
        }, Math.min(默认RVFC兜底等待毫秒, Math.max(32, Math.floor(timeoutMs / 3))));
        probe.requestVideoFrameCallback(() => {
          if (settled || 当前请求序号 !== rvfc请求序号) {
            return;
          }
          取消RVFC兜底();
          导出当前帧("rvfc");
        });
        return;
      }
      导出当前帧("early_frame");
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
        请求已解码帧截图();
        return;
      }
      if (Math.abs(probe.currentTime - sampleTime) < 0.05) {
        请求已解码帧截图();
        return;
      }
      try {
        等待Seek完成 = true;
        probe.currentTime = sampleTime;
      } catch {
        等待Seek完成 = false;
        请求已解码帧截图();
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
      请求已解码帧截图();
    };
    probe.onerror = () => {
      finish({
        objectUrl: null,
        source: "none",
        width: null,
        height: null,
      });
    };
    timeoutHandle = scheduleTimeout(() => {
      finish({
        objectUrl: null,
        source: "none",
        width: null,
        height: null,
      });
    }, timeoutMs);
    probe.src = input.src;
    probe.load?.();
  });
}
