import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncode,
} from "mediabunny";

export type 视频预处理策略 =
  | "passthrough"
  | "mediabunny_remux"
  | "mediabunny_webcodecs_transcode";

export type 视频预处理结果 = {
  file: File;
  strategy: 视频预处理策略;
  // 预处理器可以顺手返回已读出的展示元数据；没有返回时发布器再走统一 metadata reader。
  width?: number;
  height?: number;
  previewUrl?: string | null;
};

export type 视频预处理依赖 = {
  可直通(file: File): Promise<boolean>;
  Mediabunny可无损整理(file: File): Promise<boolean>;
  使用Mediabunny无损整理(file: File): Promise<视频预处理结果>;
  Mediabunny与WebCodecs可转码(file: File): Promise<boolean>;
  使用Mediabunny与WebCodecs转码(file: File): Promise<视频预处理结果>;
};

type Mediabunny转换选项 = {
  forceTranscode: boolean;
  strategy: Exclude<视频预处理策略, "passthrough">;
};

function 文件看起来是Mp4(file: File): boolean {
  return file.type.trim().toLowerCase() === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

async function 读取Mp4主Brand(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(4, 12).arrayBuffer());
  if (bytes.length < 8) {
    return null;
  }
  const box = String.fromCharCode(...bytes.slice(0, 4));
  if (box !== "ftyp") {
    return null;
  }
  return String.fromCharCode(...bytes.slice(4, 8));
}

/**
 * 检测 moov box 是否在文件前 1MB 内（fast-start 友好）。
 * WebTorrent 播放需要 moov 靠前，否则需要整文件下载后才能播放。
 */
async function moov在文件前部(file: File): Promise<boolean> {
  const scanLimit = Math.min(file.size, 1024 * 1024);
  const bytes = new Uint8Array(await file.slice(0, scanLimit).arrayBuffer());
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, offset, 8);
    const size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4),
      view.getUint8(5),
      view.getUint8(6),
      view.getUint8(7)
    );
    if (type === "moov") {
      return true;
    }
    if (size < 8) break;
    offset += size;
  }
  return false;
}

async function 文件可作为后端CanonicalMp4直通(file: File): Promise<boolean> {
  if (!文件看起来是Mp4(file)) {
    return false;
  }
  const brand = await 读取Mp4主Brand(file);
  if (brand === "qt  ") {
    return false;
  }
  // moov 必须靠前（fast-start），否则 WebTorrent 流式播放无法秒开
  return moov在文件前部(file);
}

async function 默认可直通(file: File): Promise<boolean> {
  if (!(await 文件可作为后端CanonicalMp4直通(file))) {
    return false;
  }
  if (typeof document === "undefined") {
    return true;
  }
  const probe = document.createElement("video");
  const mimeType = file.type.trim() || "video/mp4";
  return probe.canPlayType(mimeType) !== "";
}

async function 默认Mediabunny可无损整理(file: File): Promise<boolean> {
  // Mediabunny 是 canonical 视频预制的主轮子；非直通视频先尝试只改容器/元数据位置，
  // 失败才进入真正转码，避免在客户端无意义地消耗 CPU/GPU 和电量。
  return !(await 文件可作为后端CanonicalMp4直通(file));
}

async function 默认Mediabunny与WebCodecs可转码(): Promise<boolean> {
  try {
    const [canEncodeVideo, canEncodeAudio] = await Promise.all([
      canEncode("avc"),
      canEncode("aac"),
    ]);
    return canEncodeVideo && canEncodeAudio;
  } catch {
    return false;
  }
}

async function 使用Mediabunny转换到Mp4(
  file: File,
  options: Mediabunny转换选项
): Promise<视频预处理结果> {
  const target = new BufferTarget();
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const conversion = await Conversion.init({
    input,
    output,
    showWarnings: false,
    video: {
      allowRotationMetadata: true,
      forceTranscode: options.forceTranscode,
      ...(options.forceTranscode
        ? {
            codec: "avc" as const,
            bitrate: QUALITY_HIGH,
            hardwareAcceleration: "prefer-hardware" as const,
          }
        : {}),
    },
    audio: {
      forceTranscode: options.forceTranscode,
      ...(options.forceTranscode ? { codec: "aac" as const, bitrate: QUALITY_HIGH } : {}),
    },
  });
  if (!conversion.isValid) {
    throw new Error("media_preprocess_failed");
  }
  await conversion.execute();
  if (!target.buffer) {
    throw new Error("media_preprocess_failed");
  }
  return {
    file: new File([target.buffer], "canonical.mp4", {
      type: "video/mp4",
      lastModified: file.lastModified,
    }),
    strategy: options.strategy,
  };
}

function 默认视频预处理依赖(): 视频预处理依赖 {
  return {
    可直通: 默认可直通,
    Mediabunny可无损整理: 默认Mediabunny可无损整理,
    使用Mediabunny无损整理: (file) =>
      使用Mediabunny转换到Mp4(file, {
        forceTranscode: false,
        strategy: "mediabunny_remux",
      }),
    Mediabunny与WebCodecs可转码: 默认Mediabunny与WebCodecs可转码,
    使用Mediabunny与WebCodecs转码: (file) =>
      使用Mediabunny转换到Mp4(file, {
        forceTranscode: true,
        strategy: "mediabunny_webcodecs_transcode",
      }),
  };
}

export async function 预处理待上传视频文件(
  file: File,
  overrides: Partial<视频预处理依赖> = {}
): Promise<视频预处理结果> {
  const deps = { ...默认视频预处理依赖(), ...overrides };
  const startMs = performance.now();
  if (await deps.可直通(file)) {
    const elapsedMs = Math.round(performance.now() - startMs);
    console.info("[koko:video-preprocess]", {
      inputBytes: file.size,
      outputBytes: file.size,
      strategy: "passthrough",
      elapsedMs,
    });
    return { file, strategy: "passthrough" };
  }
  if (await deps.Mediabunny可无损整理(file)) {
    const result = await deps.使用Mediabunny无损整理(file);
    const elapsedMs = Math.round(performance.now() - startMs);
    console.info("[koko:video-preprocess]", {
      inputBytes: file.size,
      outputBytes: result.file.size,
      strategy: "mediabunny_remux",
      elapsedMs,
      memoryPeakEstimateMiB: Math.round(result.file.size / 1048576),
    });
    return result;
  }
  if (await deps.Mediabunny与WebCodecs可转码(file)) {
    const result = await deps.使用Mediabunny与WebCodecs转码(file);
    const elapsedMs = Math.round(performance.now() - startMs);
    console.info("[koko:video-preprocess]", {
      inputBytes: file.size,
      outputBytes: result.file.size,
      strategy: "mediabunny_webcodecs_transcode",
      elapsedMs,
      memoryPeakEstimateMiB: Math.round(result.file.size / 1048576),
    });
    return result;
  }
  throw new Error("media_preprocess_failed");
}
