import { afterEach, describe, expect, it, vi } from "vitest";

type 插件调用 = {
  plugin: unknown;
  options: Record<string, unknown>;
};

const 捕获 = vi.hoisted(() => ({
  useCalls: [] as 插件调用[],
}));

vi.mock("@uppy/tus", () => ({
  default: function TusPlugin() {},
}));

vi.mock("@uppy/golden-retriever", () => ({
  default: function GoldenRetrieverPlugin() {},
}));

vi.mock("@uppy/core", () => ({
  default: class FakeUppy {
    use(plugin: unknown, options: Record<string, unknown>): this {
      捕获.useCalls.push({ plugin, options });
      return this;
    }

    on(): void {}

    addFile(input: { id: string }): string {
      return input.id;
    }

    getFile(): undefined {
      return undefined;
    }

    removeFile(): void {}

    async retryUpload(): Promise<void> {}

    getFiles(): [] {
      return [];
    }

    async upload(): Promise<unknown> {
      return { successful: [], failed: [] };
    }

    cancelAll(): void {}

    destroy(): void {}
  },
}));

describe("媒体发布器 / Golden Retriever 配置", () => {
  afterEach(() => {
    捕获.useCalls.length = 0;
    vi.resetModules();
  });

  it("默认上传器必须启用 Golden Retriever Service Worker 文件缓存，避免大附件刷新后恢复成幽灵文件", async () => {
    const { 创建媒体发布器 } = await import("../媒体/媒体发布");
    const drafts: unknown[] = [];
    const 发布器 = 创建媒体发布器({
      getSessionId: () => "s-test",
      prepareMediaUpload: vi.fn(async (_kind, _sessionId, file: File) => ({
        attachment_id: `att-${file.name}`,
        upload_session_id: `upl-${file.name}`,
        upload_method: "tus" as const,
        tus_endpoint: "http://storage.local/files",
        tus_headers: {},
        tus_metadata: {
          attachment_id: `att-${file.name}`,
          upload_session_id: `upl-${file.name}`,
          file_name: file.name,
          mime_type: file.type,
          byte_size: String(file.size),
        },
        expires_at: "2026-05-15T00:00:00Z",
      })),
      completeMediaUpload: vi.fn(),
      abandonMediaUpload: vi.fn(),
      readDrafts: () => drafts as never[],
      writeDraft: vi.fn((draft) => {
        drafts.push(draft);
      }),
      updateDraft: vi.fn(),
      removeDraft: vi.fn(),
      clearDrafts: vi.fn(() => {
        drafts.length = 0;
      }),
      readVideoMetadata: vi.fn(async () => ({
        width: 1280,
        height: 720,
      })),
      preprocessVideo: vi.fn(async (file: File) => ({ file, strategy: "passthrough" as const })),
      calculateSourceHash: vi.fn(async (file: File) => ({
        source_hash: "a".repeat(64),
        source_byte_size: file.size,
        source_file_name: file.name,
      })),
      createPreviewUrl: () => "",
      yieldToMainThread: vi.fn(async () => {}),
    });

    await 发布器.处理选择媒体文件([
      new File([new Uint8Array([1, 2, 3])], "large.mp4", {
        type: "video/mp4",
      }),
    ]);

    const goldenRetrieverCall = 捕获.useCalls.find(
      (call) => typeof call.plugin === "function" && call.plugin.name === "GoldenRetrieverPlugin",
    );

    expect(goldenRetrieverCall?.options).toEqual(
      expect.objectContaining({
        expires: 24 * 60 * 60 * 1000,
        serviceWorker: true,
      }),
    );
  });

  it("large-video 上传器禁用 Golden Retriever，避免 parallelUploads 内部 partial sub-upload 恢复时 progress undefined 崩溃", async () => {
    const { 创建媒体发布器, 大视频高吞吐阈值字节数 } = await import("../媒体/媒体发布");
    const drafts: unknown[] = [];
    const largeVideoFile = new File([new Uint8Array([1, 2, 3])], "big.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(largeVideoFile, "size", {
      configurable: true,
      value: 大视频高吞吐阈值字节数,
    });
    const 发布器 = 创建媒体发布器({
      getSessionId: () => "s-test",
      prepareMediaUpload: vi.fn(async (_kind, _sessionId, file: File) => ({
        attachment_id: `att-${file.name}`,
        upload_session_id: `upl-${file.name}`,
        upload_method: "tus" as const,
        tus_endpoint: "http://storage.local/files",
        tus_headers: {},
        tus_metadata: {
          attachment_id: `att-${file.name}`,
          upload_session_id: `upl-${file.name}`,
          file_name: file.name,
          mime_type: file.type,
          byte_size: String(file.size),
        },
        expires_at: "2026-05-15T00:00:00Z",
      })),
      completeMediaUpload: vi.fn(),
      abandonMediaUpload: vi.fn(),
      readDrafts: () => drafts as never[],
      writeDraft: vi.fn((draft) => {
        drafts.push(draft);
      }),
      updateDraft: vi.fn(),
      removeDraft: vi.fn(),
      clearDrafts: vi.fn(() => {
        drafts.length = 0;
      }),
      readVideoMetadata: vi.fn(async () => ({
        width: 1920,
        height: 1080,
      })),
      preprocessVideo: vi.fn(async (file: File) => ({ file, strategy: "passthrough" as const })),
      calculateSourceHash: vi.fn(async (file: File) => ({
        source_hash: "b".repeat(64),
        source_byte_size: file.size,
        source_file_name: file.name,
      })),
      createPreviewUrl: () => "",
      yieldToMainThread: vi.fn(async () => {}),
    });

    await 发布器.处理选择媒体文件([largeVideoFile]);

    const goldenRetrieverCalls = 捕获.useCalls.filter(
      (call) => typeof call.plugin === "function" && call.plugin.name === "GoldenRetrieverPlugin",
    );
    expect(goldenRetrieverCalls).toHaveLength(0);
  });
});
