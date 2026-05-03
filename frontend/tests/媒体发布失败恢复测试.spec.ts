import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { 创建场景,模拟浏览器Webp编码 } from "./媒体发布测试支撑";

describe("媒体发布器 / 失败恢复", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    模拟浏览器Webp编码();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("重试失败草稿时若底层上传器分配了新 localId，不会留下旧草稿幽灵副本", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "retry.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    场景.drafts.updateDraft("att-canonical.webp", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    场景.默认上传器.静默丢弃文件("att-canonical.webp");
    场景.prepareMediaUpload.mockResolvedValueOnce({
      attachment_id: "att-retry-second",
      upload_session_id: "upl-retry-second",
      upload_method: "tus" as const,
      tus_endpoint: "http://storage.local/files",
      tus_headers: { Authorization: "Bearer media-upload-token" },
      tus_metadata: {
        attachment_id: "att-retry-second",
        upload_session_id: "upl-retry-second",
        file_name: sourceFile.name,
        mime_type: sourceFile.type,
        byte_size: String(sourceFile.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    });
    场景.默认上传器.nextAddFileReturnedId = "uppy-retry-second-local-id";

    await (
      场景.发布器 as unknown as {
        重新上传草稿(localId: string): Promise<void>;
      }
    ).重新上传草稿("att-canonical.webp");

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "uppy-retry-second-local-id",
        attachmentId: "att-retry-second",
        status: "transporting",
        errorCode: "",
      }),
    ]);
  });
  it("继续上传失败草稿时会复用旧 attachmentId，不会重新 prepare", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "resume.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    场景.drafts.updateDraft("att-canonical.webp", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });

    await (
      场景.发布器 as unknown as {
        继续上传草稿(localId: string): Promise<void>;
      }
    ).继续上传草稿("att-canonical.webp");

    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(1);
    expect(场景.默认上传器.retryUploadCalls).toEqual(["att-canonical.webp"]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        attachmentId: "att-canonical.webp",
        status: "transporting",
      }),
    ]);
  });
  it("重新上传失败草稿时会明确走新一轮 prepare 并拿到新的 attachmentId", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "restart.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    场景.drafts.updateDraft("att-canonical.webp", {
      status: "failed",
      errorCode: "attachment_upload_failed",
    });
    场景.默认上传器.静默丢弃文件("att-canonical.webp");
    场景.prepareMediaUpload.mockResolvedValueOnce({
      attachment_id: "att-restart-second",
      upload_session_id: "upl-restart-second",
      upload_method: "tus" as const,
      tus_endpoint: "http://storage.local/files",
      tus_headers: { Authorization: "Bearer media-upload-token" },
      tus_metadata: {
        attachment_id: "att-restart-second",
        upload_session_id: "upl-restart-second",
        file_name: sourceFile.name,
        mime_type: sourceFile.type,
        byte_size: String(sourceFile.size),
      },
      expires_at: "2026-04-10T12:00:00Z",
    });

    await (
      场景.发布器 as unknown as {
        重新上传草稿(localId: string): Promise<void>;
      }
    ).重新上传草稿("att-canonical.webp");

    expect(场景.abandonMediaUpload).toHaveBeenCalledWith("s-test", "att-canonical.webp");
    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(2);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        attachmentId: "att-restart-second",
        status: "transporting",
        errorCode: "",
      }),
    ]);
  });
  it("重新上传附件占位失败草稿时，若旧 attachmentId 为空则不会伪造 abandon 调用", async () => {
    const 场景 = 创建场景();
    场景.drafts.writeDraft({
      localId: "failed-no-attachment",
      kind: "image",
      attachmentId: "",
      previewUrl: "blob:no-attachment",
      width: 0,
      height: 0,
      status: "failed",
      fileName: "fallback.jpg",
      errorCode: "attachment_upload_failed",
      sourceFile: new File([new Uint8Array([1, 2, 3])], "fallback.jpg", {
        type: "image/jpeg",
      }),
    });

    await (
      场景.发布器 as unknown as {
        重新上传草稿(localId: string): Promise<void>;
      }
    ).重新上传草稿("failed-no-attachment");

    expect(场景.abandonMediaUpload).not.toHaveBeenCalled();
    expect(场景.prepareMediaUpload).toHaveBeenCalledTimes(1);
  });
});

