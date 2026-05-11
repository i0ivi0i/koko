import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import type {
  媒体附件上传结果,
  媒体SourceHash复用结果,
  媒体SourceHash信息,
  媒体种类,
} from "../聊天共享/契约.js";
import type { 媒体附件草稿 } from "./媒体草稿.js";
import {
  创建本地图片预览地址 as 创建本地媒体预览地址,
  准备待上传图片文件,
  可选择图片文件类型,
} from "./图片预处理.js";
import {
  可选择视频文件类型,
  读取视频文件元数据,
  视频附件上传上限字节数,
} from "./视频元数据.js";
import { 预处理待上传视频文件 } from "./视频预处理.js";
import {
  解析传输错误代码,
} from "./媒体诊断.js";
import {
  创建媒体Tus断点UrlStorage,
  type 媒体Tus断点UrlStorage,
} from "./媒体Tus断点存储.js";
import {
  确保媒体上传器,
  type 媒体上传事件接线依赖,
} from "./媒体发布上传事件协作.js";
import {
  创建失败草稿标识,
  默认文件名,
  默认计算源文件SourceHash,
  构造SourceHash复用请求,
  构造媒体上传Meta,
  读取媒体Tus请求头,
  读取媒体上传上限,
  读取媒体上传档位,
  识别待上传媒体种类,
  type 媒体发布器依赖,
} from "./媒体发布基础语义.js";

export { 大视频高吞吐阈值字节数 } from "./媒体发布基础语义.js";

export type 媒体上传Meta = {
  session_id?: string;
  attachment_id?: string;
  upload_session_id?: string;
  attachment_kind?: 媒体种类;
  /**
   * 这是只给 Uppy 本地文件标识使用的内部字段：
   * Uppy 对浏览器本地文件会忽略我们传入的 `id`，转而用 `name/type/size/lastModified/meta.relativePath`
   * 生成自己的 `file.id`。Tus 又会把这个 `file.id` 当作 resumable fingerprint。
   *
   * 如果这里不把 prepare 生成的 attachment_id 喂进去，同一物理文件在新一轮 prepare 后
   * 仍可能撞上旧 fingerprint，直接复用旧 upload URL，最终导致新 attachment 永远等不到
   * 对应的 post-finish 回执。
   *
   * 该字段不会进入 Tus metadata，因为 allowedMetaFields 已明确把它排除在 transport 契约外。
   */
  relativePath?: string;
  upload_method?: "tus";
  tus_endpoint?: string;
  tus_headers_json?: string;
  file_name?: string;
  mime_type?: string;
  byte_size?: string;
  preview_width?: number;
  preview_height?: number;
  /**
   * 本地静态预览图只服务浏览器发送区体验：
   * - 它不会进入 Tus metadata；
   * - 不属于后端业务真相；
   * - 只是把“发送前不要再挂第二颗 `<video>`”收口成一张静态封面。
   */
  local_preview_url?: string;
};

export type 媒体上传响应体 = Record<string, unknown>;

export type 媒体上传文件 = {
  id: string;
  name?: string | undefined;
  type?: string | undefined;
  data?: unknown;
  meta?: 媒体上传Meta | undefined;
};

export interface 媒体上传器 {
  addFile(input: {
    id: string;
    name: string;
    type?: string;
    data: File;
    meta?: 媒体上传Meta;
  }): string;
  getFile(id: string): 媒体上传文件 | undefined;
  removeFile(id: string): void;
  retryUpload(id: string): Promise<void>;
  cancelAll(): void;
  destroy(): void;
  on(event: string, handler: (...args: Array<any>) => void | Promise<void>): void;
}

/**
 * 文件级并发针对“同时有多少个文件在传”。
 * 这里继续往吞吐侧再推一档，但仍然保留最后一道边界，不让 9 个文件一次性全放飞。
 */
export const 媒体Tus文件并发上限 = 8;

/**
 * 单条消息最多承载 9 个媒体附件。
 * 这个上限必须在进入 prepare / Tus 主链前先裁决：
 * - Uppy 的 `maxNumberOfFiles` 只能约束单个 uploader 队列，不能理解当前发送草稿已经占了几个槽；
 * - 如果让超量文件先进上传链再失败，失败草稿会把输入区撑爆，直接挤占消息流滚动预算；
 * - 所以入口层先按当前草稿数截断，超出的文件不生成第二套失败态。
 */
export const 媒体单条消息附件上限 = 9;

/**
 * `parallelUploads` 只针对单个大视频生效。
 * 这里先保守固定为 4：
 * 1. 与官方文档建议一致，避免把浏览器公共连接池一把打满；
 * 2. 后端这期只刚接通 concatenation，先留一档可观察、可回退的默认值；
 * 3. 真要继续往上推，必须以后续压测结果为准，不能靠拍脑袋。
 */
export const 大视频单文件并行分片数 = 4;

/**
 * 重试节奏也显式导出，避免未来升级 Uppy/Tus 后默默吃到默认值漂移。
 * `0` 表示第一次失败立即重试一次，后续退避保持克制，既给慢网恢复机会，也不把失败放大成请求风暴。
 */
export const 媒体Tus重试延迟毫秒数组 = [0, 1000, 3000, 5000] as const;

/**
 * 这里必须显式限制单请求体大小，而不能继续吃 tus-js-client 的 Infinity 默认值：
 * 1. 官方文档明确说 `chunkSize` 默认是 Infinity，等于允许单个 PATCH/POST 一把把整文件送出去；
 * 2. 只有在代理/服务端存在请求体上限时，才应该手动设定 `chunkSize`；
 * 3. Cloudflare 免费代理公开链路的单请求体上限是 100 MB，所以这里故意收口到 32 MiB，
 *    给请求头、重试和后续实现调整都留出安全余量，禁止把“大文件也能直接一把上传”误宣传成已成立事实。
 */
export const 媒体Tus单请求体分块字节数 = 32 * 1024 * 1024;

/**
 * 视频本地预制通常会在极短时间内结束。
 * 这里给“处理中草稿”加一个很短的显示门槛，避免快路径里出现一闪而过的临时方框。
 */
const 视频预制草稿显示延迟毫秒 = 180;

export type 媒体Tus上传档位 = "default" | "large-video";

export type 媒体上传器创建参数 = {
  tusEndpoint: string;
  profile: 媒体Tus上传档位;
  attachmentId?: string;
  uploadSessionId?: string;
};

type 媒体Tus传输选项 = {
  endpoint: string;
  limit: number;
  retryDelays: number[];
  chunkSize: number;
  uploadDataDuringCreation: boolean;
  addRequestId: boolean;
  removeFingerprintOnSuccess: boolean;
  urlStorage: 媒体Tus断点UrlStorage;
  parallelUploads?: number;
  metadataForPartialUploads?: Record<string, string>;
};

/**
 * Tus Concatenation 的关键约束：
 * 1. final upload 用普通 `metadata`；
 * 2. partial uploads 不会自动继承 final metadata，必须显式给 `metadataForPartialUploads`；
 * 3. 所以 large-video 不能只开 `parallelUploads`，而必须把 attachment/session 锚点一起带进去。
 */
export function 构造媒体Tus传输选项(
  input: 媒体上传器创建参数,
): 媒体Tus传输选项 {
  const transportOptions = {
    endpoint: input.tusEndpoint,
    limit: 媒体Tus文件并发上限,
    retryDelays: [...媒体Tus重试延迟毫秒数组],
    chunkSize: 媒体Tus单请求体分块字节数,
    uploadDataDuringCreation: false,
    addRequestId: true,
    removeFingerprintOnSuccess: true,
    urlStorage: 创建媒体Tus断点UrlStorage(),
  };
  if (input.profile === "large-video") {
    return {
      ...transportOptions,
      parallelUploads: 大视频单文件并行分片数,
      metadataForPartialUploads: {
        attachment_id: input.attachmentId ?? "",
        upload_session_id: input.uploadSessionId ?? "",
      },
    };
  }
  return transportOptions;
}

/**
 * 统一入口下可能出现“用户选到非媒体文件”的情况。
 *
 * 当前草稿模型只承认 `image | video` 两种真实媒体种类，
 * 所以这里不能为了报错方便就硬塞一个假的 unknown 草稿。
 * 在新增通用附件能力前，这类输入只做显式诊断并中止主链，
 * 避免 prepare/upload/complete 收到不成立的媒体事实。
 */
function 记录不支持媒体文件(sourceFile: File): void {
  console.warn("[koko:media-upload:reject]", {
    fileName: sourceFile.name,
    fileType: sourceFile.type,
    fileByteSize: sourceFile.size,
    errorCode: "attachment_type_not_allowed",
  });
}

/**
 * 生产环境继续直接复用 Uppy + Tus。
 * 这里的职责只有“把媒体文件稳定送进 prepare -> tus -> complete 主链”，
 * 不再额外长第二套私有上传器。
 */
function 创建默认媒体上传器(input: 媒体上传器创建参数): 媒体上传器 {
  const tusOptions = 构造媒体Tus传输选项(input);
  return new Uppy<媒体上传Meta, 媒体上传响应体>({
    autoProceed: true,
    allowMultipleUploadBatches: true,
    restrictions: {
      maxNumberOfFiles: 媒体单条消息附件上限,
      allowedFileTypes: [...可选择图片文件类型, ...可选择视频文件类型],
      maxFileSize: 视频附件上传上限字节数,
    },
  }).use(Tus, {
    ...tusOptions,
    /**
     * Tus sidecar 只需要业务最小元数据，不应该把 session_id、预览尺寸这类壳层字段也透传进去。
     * 这里显式收口 allowedMetaFields，避免 transport sidecar 反向长成业务真相持有者。
     */
    allowedMetaFields: ["attachment_id", "upload_session_id", "file_name", "mime_type", "byte_size"],
    headers: (file) => 读取媒体Tus请求头((file.meta ?? {}) as 媒体上传Meta),
  }) as unknown as 媒体上传器;
}

async function 默认让出主线程(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

type 媒体SourceHash协作依赖 = {
  calculateSourceHash(file: File): Promise<媒体SourceHash信息>;
  getCurrentRoomId?: (() => string | null) | undefined;
  reuseMediaBySourceHash?: 媒体发布器依赖["reuseMediaBySourceHash"] | undefined;
  getSessionId(): string;
  createPreviewUrl(file: Blob | null): string;
  writeDraft: 媒体发布器依赖["writeDraft"];
};

/**
 * source_hash 协作只拥有“上传前加速层”：
 * 1. 计算源文件身份；
 * 2. 在目标房间做一次受权限约束的 ready 资产复用预检；
 * 3. 命中后把 ready 草稿直接写回发送区。
 *
 * 它不碰 prepare / Tus / complete，也不碰 restart/continue 恢复。
 */
async function 计算源文件SourceHash(
  deps: 媒体SourceHash协作依赖,
  file: File
): Promise<媒体SourceHash信息 | null> {
  try {
    return await deps.calculateSourceHash(file);
  } catch (error: unknown) {
    /**
     * source_hash 是上传前加速层，不是“没有它就不能上传”的业务真相。
     * 计算失败时继续走原 prepare/upload/complete 主链，后端 content_hash 仍会在上传后收口分发身份。
     */
    console.warn("[koko:media-source-hash:error]", {
      fileName: file.name,
      fileByteSize: file.size,
      errorCode: 解析传输错误代码(error, "source_hash_failed"),
    });
    return null;
  }
}

async function 预检SourceHash媒体复用(
  deps: 媒体SourceHash协作依赖,
  kind: 媒体种类,
  sourceHash: 媒体SourceHash信息 | null
): Promise<媒体SourceHash复用结果> {
  const roomId = deps.getCurrentRoomId?.()?.trim() ?? "";
  if (!sourceHash || !roomId || !deps.reuseMediaBySourceHash) {
    return { status: "miss" };
  }
  try {
    return await deps.reuseMediaBySourceHash(
      kind,
      构造SourceHash复用请求({
        sessionId: deps.getSessionId(),
        roomId,
        sourceHash,
      })
    );
  } catch (error: unknown) {
    /**
     * 复用预检失败不能变成上传硬失败：
     * - 会话/权限真相仍会在后续 prepare 再裁一次；
     * - 这里降级为 miss，避免一次去重探测故障卡住真实发送。
     */
    console.warn("[koko:media-source-hash:dedupe-error]", {
      roomId,
      kind,
      sourceHash: sourceHash.source_hash,
      errorCode: 解析传输错误代码(error, "source_hash_dedupe_failed"),
    });
    return { status: "miss" };
  }
}

function 写入SourceHash命中草稿(
  deps: Pick<媒体SourceHash协作依赖, "createPreviewUrl" | "writeDraft">,
  ready: 媒体附件上传结果,
  sourceFile: File
): void {
  deps.writeDraft({
    localId: ready.attachment_id,
    kind: ready.kind,
    attachmentId: ready.attachment_id,
    // 命中复用时不会再解码视频取本地 poster；视频草稿用占位符，避免把 video Blob 塞进 <img>。
    previewUrl: ready.kind === "video" ? "" : deps.createPreviewUrl(sourceFile),
    width: ready.width,
    height: ready.height,
    status: "ready",
    fileName: sourceFile.name || 默认文件名(ready.kind),
    errorCode: "",
    sourceFile,
  });
}

type 媒体失败草稿恢复依赖 = {
  读取媒体草稿(localId: string): 媒体附件草稿 | undefined;
  读取草稿所属上传器(localId: string): 媒体上传器 | null;
  getSessionId(): string;
  abandonMediaUpload: 媒体发布器依赖["abandonMediaUpload"];
  prepareMediaUpload: 媒体发布器依赖["prepareMediaUpload"];
  updateDraft: 媒体发布器依赖["updateDraft"];
  removeDraft: 媒体发布器依赖["removeDraft"];
  草稿上传器键表: Map<string, string>;
  读取或创建上传器(
    input: 媒体上传器创建参数
  ): { key: string; uploader: 媒体上传器 };
  sourceHash协作依赖: 媒体SourceHash协作依赖;
};

/**
 * 失败草稿恢复只回答两件事：
 * 1. `resume` 如何在同一 upload 语义内继续；
 * 2. `restart` 如何显式 abandon 旧上传后重开一轮 prepare。
 *
 * 它不参与 added/success/error/stalled 事件接线，也不参与 source_hash 预检命中写草稿。
 */
async function 继续失败草稿上传(
  deps: 媒体失败草稿恢复依赖,
  localId: string
): Promise<void> {
  const draft = deps.读取媒体草稿(localId);
  if (!draft) {
    return;
  }
  const currentUploader = deps.读取草稿所属上传器(localId);
  deps.updateDraft(localId, {
    status: "transporting",
    errorCode: "",
  });
  if (!currentUploader || !currentUploader.getFile(localId)) {
    deps.updateDraft(localId, {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    return;
  }
  void currentUploader.retryUpload(localId).catch((error: unknown) => {
    deps.updateDraft(localId, {
      status: "failed",
      errorCode: 解析传输错误代码(error),
    });
  });
}

async function 重新开始失败草稿上传(
  deps: 媒体失败草稿恢复依赖,
  localId: string
): Promise<void> {
  const draft = deps.读取媒体草稿(localId);
  if (!draft) {
    return;
  }
  const currentUploader = deps.读取草稿所属上传器(localId);
  const attachmentId = draft.attachmentId.trim();
  if (attachmentId) {
    try {
      /**
       * restart 的第一步必须是显式 abandon 旧上传：
       * - 让后端留下 abandoned 事实；
       * - 让迟到的 post-finish/complete 不会复活旧附件；
       * - 为后续临时文件清理创造权威锚点。
       */
      await deps.abandonMediaUpload(deps.getSessionId(), attachmentId);
    } catch (error: unknown) {
      deps.updateDraft(localId, {
        status: "failed",
        errorCode: 解析传输错误代码(error),
      });
      return;
    }
  }
  if (currentUploader?.getFile(localId)) {
    currentUploader.removeFile(localId);
  }
  deps.草稿上传器键表.delete(localId);
  deps.updateDraft(localId, {
    attachmentId: "",
    status: "transporting",
    errorCode: "",
  });
  if (!draft.sourceFile) {
    deps.updateDraft(localId, {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    return;
  }
  try {
    const sourceHash = await 计算源文件SourceHash(deps.sourceHash协作依赖, draft.sourceFile);
    const prepared = await deps.prepareMediaUpload(
      draft.kind,
      deps.getSessionId(),
      draft.sourceFile,
      sourceHash ?? undefined
    );
    const uploaderInput: 媒体上传器创建参数 = {
      tusEndpoint: prepared.tus_endpoint,
      profile: 读取媒体上传档位(draft.kind, draft.sourceFile),
      attachmentId: prepared.attachment_id,
      uploadSessionId: prepared.upload_session_id,
    };
    const { key: uploaderKey, uploader: nextUploader } = deps.读取或创建上传器(uploaderInput);
    const nextLocalId = nextUploader.addFile({
      id: localId,
      name: draft.fileName,
      type: draft.sourceFile.type,
      data: draft.sourceFile,
      meta: 构造媒体上传Meta({
        sessionId: deps.getSessionId(),
        kind: draft.kind,
        prepared,
        previewWidth: draft.width,
        previewHeight: draft.height,
      }),
    });
    deps.草稿上传器键表.set(nextLocalId, uploaderKey);
    /**
     * 真正的 Uppy 本地文件 id 由它自己根据文件属性和 meta.relativePath 生成，
     * 不保证等于我们传给 addFile 的 `id`。如果 restart 后还把旧草稿留着，
     * 就会同时留下“旧失败草稿 + 新上传草稿”两条活路径。
     */
    if (nextLocalId !== localId) {
      deps.草稿上传器键表.delete(localId);
      deps.removeDraft(localId);
    }
  } catch (error: unknown) {
    deps.updateDraft(localId, {
      status: "failed",
      errorCode: 解析传输错误代码(error),
    });
  }
}

export function 创建媒体发布器(deps: 媒体发布器依赖) {
  const createUploader = deps.createUploader ?? 创建默认媒体上传器;
  const readVideoMetadata = deps.readVideoMetadata ?? 读取视频文件元数据;
  const preprocessVideo = deps.preprocessVideo ?? 预处理待上传视频文件;
  const createPreviewUrl = deps.createPreviewUrl ?? 创建本地媒体预览地址;
  const yieldToMainThread = deps.yieldToMainThread ?? 默认让出主线程;
  const calculateSourceHash = deps.calculateSourceHash ?? 默认计算源文件SourceHash;
  const 上传器表 = new Map<string, 媒体上传器>();
  const 草稿上传器键表 = new Map<string, string>();

  const 读取媒体草稿 = (localId: string): 媒体附件草稿 | undefined =>
    deps.readDrafts().find((item) => item.localId === localId);

  const 读取草稿所属上传器 = (localId: string): 媒体上传器 | null => {
    const uploaderKey = 草稿上传器键表.get(localId);
    if (!uploaderKey) {
      return null;
    }
    return 上传器表.get(uploaderKey) ?? null;
  };

  const 上传事件接线依赖: 媒体上传事件接线依赖 = {
    读取媒体草稿,
    读取草稿所属上传器,
    createUploader,
    completeMediaUpload: deps.completeMediaUpload,
    getSessionId: deps.getSessionId,
    createPreviewUrl,
    writeDraft: deps.writeDraft,
    updateDraft: deps.updateDraft,
    removeDraft: deps.removeDraft,
    上传器表,
    草稿上传器键表,
    ...(deps.预取媒体定位 ? { 预取媒体定位: deps.预取媒体定位 } : {}),
  };

  const 读取或创建上传器 = (
    input: 媒体上传器创建参数
  ): { key: string; uploader: 媒体上传器 } => 确保媒体上传器(上传事件接线依赖, input);

  /**
   * 各类媒体在进入 Uppy 之前先完成自己最小的本地预处理：
   * - 图片负责 MIME 补全与 HEIC/HEIF 转码；
   * - 视频负责浏览器可读性探测和基础元数据读取。
   *
   * 这样共核编排只消费“已经可以进入上传主链的稳定文件”，
   * 不把图片/视频差异直接塞进后续上传状态机。
   */
  const 准备待上传媒体文件 = async (
    kind: 媒体种类,
    sourceFile: File
  ): Promise<{ file: File; width: number; height: number; previewUrl?: string | null }> => {
    if (kind === "video") {
      const preprocessed = await preprocessVideo(sourceFile);
      const metadata =
        typeof preprocessed.width === "number" && typeof preprocessed.height === "number"
          ? {
              width: preprocessed.width,
              height: preprocessed.height,
              previewUrl: preprocessed.previewUrl ?? null,
            }
          : await readVideoMetadata(preprocessed.file);
      return {
        file: preprocessed.file,
        width: metadata.width,
        height: metadata.height,
        previewUrl: metadata.previewUrl ?? null,
      };
    }
    const normalizedFile = await 准备待上传图片文件(sourceFile);
    return {
      file: normalizedFile,
      width: 0,
      height: 0,
    };
  };

  const 写入超限失败草稿 = (kind: 媒体种类, file: File): void => {
    deps.writeDraft({
      localId: 创建失败草稿标识(kind, "too-large", file),
      kind,
      attachmentId: "",
      previewUrl: createPreviewUrl(file),
      width: 0,
      height: 0,
      status: "failed",
      fileName: file.name,
      errorCode: "attachment_too_large",
      sourceFile: file,
    });
  };

  const 写入视频预制等待草稿 = (file: File): string => {
    const localId = 创建失败草稿标识("video", "preprocessing", file);
    deps.writeDraft({
      localId,
      kind: "video",
      attachmentId: "",
      // 预制等待态不使用视频 Blob 直连 `<img>`，避免无效解码导致的草稿闪烁占位。
      previewUrl: "",
      width: 0,
      height: 0,
      status: "processing",
      fileName: file.name,
      errorCode: "",
      sourceFile: file,
    });
    return localId;
  };

  const SourceHash协作依赖: 媒体SourceHash协作依赖 = {
    calculateSourceHash,
    getCurrentRoomId: deps.getCurrentRoomId,
    reuseMediaBySourceHash: deps.reuseMediaBySourceHash,
    getSessionId: deps.getSessionId,
    createPreviewUrl: (file: Blob | null) => createPreviewUrl(file),
    writeDraft: deps.writeDraft,
  };

  const 处理选择同类媒体文件 = async (
    kind: 媒体种类,
    files: Iterable<File>
  ): Promise<void> => {
    const selectedFiles = Array.from(files);
    if (selectedFiles.length === 0) {
      return;
    }
    const maxFileSize = 读取媒体上传上限(kind);
    for (const sourceFile of selectedFiles) {
      if (sourceFile.size > maxFileSize) {
        写入超限失败草稿(kind, sourceFile);
        continue;
      }
      let preprocessingDraftId = "";
      const 确保视频预制草稿 = (): string => {
        if (!preprocessingDraftId) {
          preprocessingDraftId = 写入视频预制等待草稿(sourceFile);
        }
        return preprocessingDraftId;
      };
      const preprocessingDraftDelayTimer =
        kind === "video"
          ? globalThis.setTimeout(() => {
              确保视频预制草稿();
            }, 视频预制草稿显示延迟毫秒)
          : null;
      const preprocessingWaitTimer =
        kind === "video"
          ? globalThis.setTimeout(() => {
              // 超过 15 分钟只是提醒用户仍在本地预制；它不是失败，也绝不能触发 prepare。
              deps.updateDraft(确保视频预制草稿(), {
                status: "processing",
                errorCode: "media_preprocess_waiting",
              });
            }, 15 * 60 * 1000)
          : null;
      try {
        const sourceHash = await 计算源文件SourceHash(SourceHash协作依赖, sourceFile);
        const reuseResult = await 预检SourceHash媒体复用(SourceHash协作依赖, kind, sourceHash);
        if (reuseResult.status === "reused") {
          if (preprocessingDraftDelayTimer) {
            globalThis.clearTimeout(preprocessingDraftDelayTimer);
          }
          if (preprocessingWaitTimer) {
            globalThis.clearTimeout(preprocessingWaitTimer);
          }
          if (preprocessingDraftId) {
            deps.removeDraft(preprocessingDraftId);
          }
          写入SourceHash命中草稿(SourceHash协作依赖, reuseResult.attachment, sourceFile);
          continue;
        }
        const preparedFile = await 准备待上传媒体文件(kind, sourceFile);
        if (preprocessingDraftDelayTimer) {
          globalThis.clearTimeout(preprocessingDraftDelayTimer);
        }
        if (preprocessingWaitTimer) {
          globalThis.clearTimeout(preprocessingWaitTimer);
        }
        if (preparedFile.file.size > maxFileSize) {
          if (preprocessingDraftId) {
            deps.updateDraft(preprocessingDraftId, {
              status: "failed",
              errorCode: "attachment_too_large",
              sourceFile: preparedFile.file,
              fileName: preparedFile.file.name,
            });
          } else {
            写入超限失败草稿(kind, preparedFile.file);
          }
          continue;
        }
        const prepared = await deps.prepareMediaUpload(
          kind,
          deps.getSessionId(),
          preparedFile.file,
          sourceHash ?? undefined
        );
        const uploaderInput: 媒体上传器创建参数 = {
          tusEndpoint: prepared.tus_endpoint,
          profile: 读取媒体上传档位(kind, preparedFile.file),
          attachmentId: prepared.attachment_id,
          uploadSessionId: prepared.upload_session_id,
        };
        const { key: uploaderKey, uploader: currentUploader } = 读取或创建上传器(uploaderInput);
        const nextLocalId = currentUploader.addFile({
          // 让 prepared 生成的 attachment_id 直接成为上传文件主键，
          // 可以保证 prepare / tus / complete / 草稿日志 全部围绕一条真相关联。
          id: prepared.attachment_id,
          name: preparedFile.file.name,
          type: preparedFile.file.type,
          data: preparedFile.file,
          meta: 构造媒体上传Meta({
            sessionId: deps.getSessionId(),
            kind,
            prepared,
            previewWidth: preparedFile.width,
            previewHeight: preparedFile.height,
            ...(preparedFile.previewUrl ? { localPreviewUrl: preparedFile.previewUrl } : {}),
          }),
        });
        草稿上传器键表.set(nextLocalId, uploaderKey);
        if (preprocessingDraftId) {
          deps.removeDraft(preprocessingDraftId);
        }
      } catch (error: unknown) {
        if (preprocessingDraftDelayTimer) {
          globalThis.clearTimeout(preprocessingDraftDelayTimer);
        }
        if (preprocessingWaitTimer) {
          globalThis.clearTimeout(preprocessingWaitTimer);
        }
        const failedPatch = {
          kind,
          attachmentId: "",
          previewUrl: createPreviewUrl(sourceFile),
          width: 0,
          height: 0,
          status: "failed" as const,
          fileName: sourceFile.name,
          errorCode: 解析传输错误代码(error),
          sourceFile,
        };
        if (preprocessingDraftId) {
          deps.updateDraft(preprocessingDraftId, failedPatch);
        } else {
          deps.writeDraft({
            localId: 创建失败草稿标识(kind, "rejected", sourceFile),
            ...failedPatch,
          });
        }
      }
    }
  };

  const 失败草稿恢复依赖: 媒体失败草稿恢复依赖 = {
    读取媒体草稿,
    读取草稿所属上传器,
    getSessionId: deps.getSessionId,
    abandonMediaUpload: deps.abandonMediaUpload,
    prepareMediaUpload: deps.prepareMediaUpload,
    updateDraft: deps.updateDraft,
    removeDraft: deps.removeDraft,
    草稿上传器键表,
    读取或创建上传器,
    sourceHash协作依赖: SourceHash协作依赖,
  };

  return {
    处理选择媒体文件: async (files: Iterable<File>): Promise<void> => {
      const selectedFiles = Array.from(files);
      if (selectedFiles.length === 0) {
        return;
      }
      const remainingSlots = Math.max(0, 媒体单条消息附件上限 - deps.readDrafts().length);
      if (remainingSlots <= 0) {
        console.warn("[koko:media-upload:reject]", {
          selectedCount: selectedFiles.length,
          maxDraftCount: 媒体单条消息附件上限,
          errorCode: "attachment_count_limit_exceeded",
        });
        return;
      }
      const acceptedFiles = selectedFiles.slice(0, remainingSlots);
      if (acceptedFiles.length < selectedFiles.length) {
        console.warn("[koko:media-upload:reject]", {
          selectedCount: selectedFiles.length,
          acceptedCount: acceptedFiles.length,
          maxDraftCount: 媒体单条消息附件上限,
          errorCode: "attachment_count_limit_exceeded",
        });
      }
      for (const [index, sourceFile] of acceptedFiles.entries()) {
        /**
         * 某些移动浏览器在连续处理多张图/多个视频时，系统 picker 返回后马上进入一串重任务，
         * 容易让页面长时间失去响应。这里在批量文件之间主动让出一次主线程，
         * 让浏览器有机会先完成一轮绘制和交互回收。
         */
        if (index > 0) {
          await yieldToMainThread();
        }
        const kind = 识别待上传媒体种类(sourceFile);
        if (!kind) {
          记录不支持媒体文件(sourceFile);
          continue;
        }
        await 处理选择同类媒体文件(kind, [sourceFile]);
      }
    },

    移除草稿(localId: string): void {
      const uploader = 读取草稿所属上传器(localId);
      uploader?.removeFile(localId);
      if (!uploader?.getFile(localId)) {
        草稿上传器键表.delete(localId);
        deps.removeDraft(localId);
      }
    },

    async 继续上传草稿(localId: string): Promise<void> {
      await 继续失败草稿上传(失败草稿恢复依赖, localId);
    },

    async 重新上传草稿(localId: string): Promise<void> {
      await 重新开始失败草稿上传(失败草稿恢复依赖, localId);
    },

    清空(): void {
      for (const uploader of 上传器表.values()) {
        uploader.cancelAll();
      }
      草稿上传器键表.clear();
      deps.clearDrafts();
    },

    销毁(): void {
      this.清空();
      for (const uploader of 上传器表.values()) {
        uploader.destroy();
      }
      上传器表.clear();
    },
  };
}
