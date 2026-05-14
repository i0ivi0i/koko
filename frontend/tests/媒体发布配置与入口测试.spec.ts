import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import {
Uppy,
创建场景,
大视频高吞吐阈值字节数,
媒体Tus单请求体分块字节数,
媒体Tus文件并发上限,
媒体Tus重试延迟毫秒数组,
媒体单条消息附件上限,
构造媒体Tus传输选项,
模拟浏览器Webp编码,
type 媒体上传Meta,
type 媒体上传响应体,
} from "./媒体发布测试支撑";

describe("媒体发布器 / 配置与统一入口", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    模拟浏览器Webp编码();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认 Tus 参数保持显式并发与重试策略", () => {
    expect(媒体Tus文件并发上限).toBe(8);
    expect(媒体单条消息附件上限).toBe(9);
    expect(大视频高吞吐阈值字节数).toBe(32 * 1024 * 1024);
    expect(媒体Tus重试延迟毫秒数组).toEqual([0, 1000, 3000, 5000]);
  });
  it("large-video 恢复 parallelUploads 时必须同时声明 partial metadata", () => {
    const transportOptions = 构造媒体Tus传输选项({
      tusEndpoint: "http://storage.local/files",
      profile: "large-video",
      /**
       * 这里继续锁住 Concatenation 的最小契约：
       * - `parallelUploads` 只是 transport 优化开关，不是业务锚点；
       * - partial upload 必须显式带回 attachment/session，否则 Tus hook 无法知道这些分片属于谁；
       * - 所以这条测试专门防回归“只开并行、不补 metadataForPartialUploads”的假高吞吐。
       */
      attachmentId: "att-large-video",
      uploadSessionId: "upload-session-1",
    }) as {
      parallelUploads?: number;
      chunkSize: number;
      metadataForPartialUploads?: Record<string, string>;
      uploadDataDuringCreation: boolean;
      addRequestId: boolean;
    };

    expect(transportOptions.parallelUploads).toBe(4);
    expect(transportOptions.metadataForPartialUploads).toEqual(
      expect.objectContaining({
        attachment_id: "att-large-video",
        upload_session_id: "upload-session-1",
      }),
    );
    expect(transportOptions.chunkSize).toBe(媒体Tus单请求体分块字节数);
    expect(transportOptions.uploadDataDuringCreation).toBe(false);
    expect(transportOptions.addRequestId).toBe(true);
  });
  it("默认 Tus 传输也必须显式限制单请求体大小，禁止误撞 Cloudflare 免费代理 100 MB 上限", () => {
    const transportOptions = 构造媒体Tus传输选项({
      tusEndpoint: "http://storage.local/files",
      profile: "default",
    }) as {
      chunkSize: number;
      uploadDataDuringCreation: boolean;
      removeFingerprintOnSuccess: boolean;
    };

    expect(transportOptions.chunkSize).toBe(媒体Tus单请求体分块字节数);
    expect(transportOptions.uploadDataDuringCreation).toBe(false);
    expect(transportOptions.removeFingerprintOnSuccess).toBe(true);
  });
  it("Tus 断点存储不再依赖 localStorage 配额，避免满配额时把上传打断", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => {
        throw new DOMException("localStorage disabled", "QuotaExceededError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("localStorage quota", "QuotaExceededError");
      }),
      removeItem: vi.fn(),
      key: vi.fn(),
      length: 0,
    });
    const transportOptions = 构造媒体Tus传输选项({
      tusEndpoint: "http://storage.local/files",
      profile: "default",
    }) as {
      urlStorage: {
        addUpload(
          fingerprint: string,
          upload: {
            size: number;
            metadata: Record<string, string>;
            creationTime: string;
            uploadUrl: string;
          }
        ): Promise<string>;
        findUploadsByFingerprint(fingerprint: string): Promise<
          Array<{
            metadata: Record<string, string>;
            uploadUrl: string | null;
            urlStorageKey: string;
          }>
        >;
        removeUpload(urlStorageKey: string): Promise<void>;
      };
    };

    const urlStorageKey = await transportOptions.urlStorage.addUpload("fingerprint-1", {
      size: 124203405,
      metadata: { attachment_id: "att-quota-safe" },
      creationTime: new Date(0).toString(),
      uploadUrl: "http://storage.local/files/upload-1",
    });
    const uploads = await transportOptions.urlStorage.findUploadsByFingerprint("fingerprint-1");

    expect(urlStorageKey).toContain("koko-tus::fingerprint-1::");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      metadata: { attachment_id: "att-quota-safe" },
      uploadUrl: "http://storage.local/files/upload-1",
      urlStorageKey,
    });

    await transportOptions.urlStorage.removeUpload(urlStorageKey);
    await expect(
      transportOptions.urlStorage.findUploadsByFingerprint("fingerprint-1")
    ).resolves.toEqual([]);
  });
  it("Uppy 本地文件会忽略传入 id，只有 relativePath 变化才会改变内部 file.id", () => {
    const uppy = new Uppy<媒体上传Meta, 媒体上传响应体>();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "same.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });

    const firstId = uppy.addFile({
      id: "att-first",
      name: sourceFile.name,
      type: sourceFile.type,
      data: sourceFile,
      meta: { attachment_id: "att-first" },
    });
    uppy.removeFile(firstId);
    const secondId = uppy.addFile({
      id: "att-second",
      name: sourceFile.name,
      type: sourceFile.type,
      data: sourceFile,
      meta: { attachment_id: "att-second" },
    });
    expect(secondId).toBe(firstId);

    uppy.removeFile(secondId);
    const thirdId = uppy.addFile({
      id: "att-third",
      name: sourceFile.name,
      type: sourceFile.type,
      data: sourceFile,
      meta: {
        attachment_id: "att-third",
        relativePath: "att-third",
      },
    });
    expect(thirdId).not.toBe(secondId);
  });
  it("统一媒体入口会按文件逐个识别图片和视频，再进入同一条上传主链", async () => {
    const 场景 = 创建场景();
    const imageFile = new File([new Uint8Array([1, 2, 3])], "mixed.jpg", {
      type: "",
    });
    const videoFile = new File([new Uint8Array([4, 5, 6])], "mixed.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([imageFile, videoFile]);

    expect(场景.prepareMediaUpload.mock.calls).toEqual([
      [
        "image",
        "s-test",
        expect.objectContaining({ name: "canonical.webp", type: "image/webp" }),
        {
          source_hash: "a".repeat(64),
          source_byte_size: 3,
          source_file_name: "mixed.jpg",
        },
      ],
      [
        "video",
        "s-test",
        videoFile,
        {
          source_hash: "a".repeat(64),
          source_byte_size: 3,
          source_file_name: "mixed.mp4",
        },
      ],
    ]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        kind: "image",
        status: "transporting",
      }),
      expect.objectContaining({
        localId: "att-mixed.mp4",
        kind: "video",
        status: "transporting",
      }),
    ]);
  });
  it("统一媒体入口批量处理多文件时会在批次之间让出主线程，避免连续重任务长时间卡住页面", async () => {
    const 场景 = 创建场景();
    // 3 个文件 → 2 批（2+1），批次之间让出 1 次
    const files = [
      new File([new Uint8Array([1, 2, 3])], "first.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([4, 5, 6])], "second.mp4", { type: "video/mp4" }),
      new File([new Uint8Array([7, 8, 9])], "third.jpg", { type: "image/jpeg" }),
    ];

    await 场景.发布器.处理选择媒体文件(files);

    // 第一批（2个文件）不让出，第二批（1个文件）前让出 1 次
    expect(场景.yieldToMainThread).toHaveBeenCalledTimes(1);
  });
  it("统一媒体入口会在进入上传主链前按单条消息附件上限截断超量选择", async () => {
    const 场景 = 创建场景();
    const files = Array.from(
      { length: 12 },
      (_, index) =>
        new File([new Uint8Array([index + 1])], `batch-${index + 1}.mp4`, {
          type: "video/mp4",
        })
    );

    await 场景.发布器.处理选择媒体文件(files);

    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(9);
    expect(场景.默认上传器.addFileCalls).toHaveLength(9);
    expect(场景.drafts.readDrafts()).toHaveLength(9);
  });
  it("统一媒体入口会把已有草稿计入单条消息附件上限，避免重复选择挤爆发送区", async () => {
    const 场景 = 创建场景();
    for (let index = 0; index < 8; index += 1) {
      场景.drafts.writeDraft({
        localId: `existing-${index + 1}`,
        kind: "video",
        attachmentId: `existing-${index + 1}`,
        previewUrl: "",
        width: 1280,
        height: 720,
        status: "ready",
        fileName: `existing-${index + 1}.mp4`,
        errorCode: "",
        sourceFile: null,
      });
    }
    const files = Array.from(
      { length: 3 },
      (_, index) =>
        new File([new Uint8Array([index + 1])], `extra-${index + 1}.jpg`, {
          type: "image/jpeg",
        })
    );

    await 场景.发布器.处理选择媒体文件(files);

    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(1);
    expect(场景.默认上传器.addFileCalls).toHaveLength(1);
    expect(场景.drafts.readDrafts()).toHaveLength(9);
  });
  it("统一媒体入口遇到不支持文件时不会误进 prepare/upload 主链", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "blocked.pdf", {
      type: "application/pdf",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.prepareMediaUpload).not.toHaveBeenCalled();
    expect(场景.默认上传器.addFileCalls).toEqual([]);
    expect(场景.drafts.readDrafts()).toEqual([]);
  });

  it("选择多个文件时以有限并发批处理，最大并发度为 2", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const 场景 = 创建场景({
      calculateSourceHash: async (file: File) => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 20));
        concurrentCount--;
        return {
          source_hash: "c".repeat(64),
          source_byte_size: file.size,
          source_file_name: file.name,
        };
      },
    });

    const files = [
      new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2])], "b.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([3])], "c.jpg", { type: "image/jpeg" }),
    ];
    await 场景.发布器.处理选择媒体文件(files);

    // 3 个文件应分成 2 批（2+1），最大并发度 = 2
    expect(maxConcurrent).toBe(2);
    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(3);
  });
});
