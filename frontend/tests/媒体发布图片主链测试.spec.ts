import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { 创建传输错误,创建场景,模拟浏览器Webp编码 } from "./媒体发布测试支撑";

describe("媒体发布器 / 图片主链", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    模拟浏览器Webp编码();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("选图后会先 prepare 再写入 transporting 草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.jpg", {
      type: "image/jpeg",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.prepareMediaUpload).toHaveBeenCalledWith(
      "image",
      "s-test",
      expect.objectContaining({ name: "canonical.webp", type: "image/webp" }),
      {
        source_hash: "a".repeat(64),
        source_byte_size: 3,
        source_file_name: "picked.jpg",
      }
    );
    expect(场景.默认上传器.addFileCalls).toEqual([
      expect.objectContaining({
        id: "att-canonical.webp",
        name: "canonical.webp",
        meta: expect.objectContaining({
          upload_method: "tus",
          tus_endpoint: "http://storage.local/files",
          attachment_id: "att-canonical.webp",
          upload_session_id: "upl-canonical.webp",
          relativePath: "att-canonical.webp",
          file_name: "canonical.webp",
          mime_type: "image/webp",
          byte_size: "3",
        }),
      }),
    ]);
    expect(场景.createUploaderCalls).toEqual([
      {
        tusEndpoint: "http://storage.local/files",
        profile: "default",
        attachmentId: "att-canonical.webp",
        uploadSessionId: "upl-canonical.webp",
      },
    ]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        kind: "image",
        attachmentId: "att-canonical.webp",
        status: "transporting",
      }),
    ]);
  });
  it("upload-success 后草稿会先进入 processing，再等 complete 成功后才会 ready", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "complete-ok.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);
    let 完成上传!: (value: Awaited<ReturnType<typeof 场景.completeMediaUpload>>) => void;
    场景.completeMediaUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          完成上传 = resolve;
        })
    );

    const 上传成功任务 = 场景.默认上传器.触发上传成功("att-canonical.webp");

    await vi.waitFor(() => {
      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-canonical.webp",
          status: "processing",
        }),
      ]);
    });

    完成上传({
      attachment_id: "att-canonical.webp",
      kind: "image",
      mime_type: "image/jpeg",
      byte_size: 3,
      width: 120,
      height: 90,
      status: "ready",
    });
    await 上传成功任务;

    expect(场景.completeMediaUpload).toHaveBeenCalledWith("s-test", "att-canonical.webp");
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        kind: "image",
        attachmentId: "att-canonical.webp",
        status: "ready",
        width: 120,
        height: 90,
      }),
    ]);
  });
  it("complete 失败时会把草稿收口成 failed", async () => {
    const 场景 = 创建场景();
    场景.completeMediaUpload.mockRejectedValueOnce(
      创建传输错误(500, "system_error", "system_error")
    );
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "complete-failed.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);

    await 场景.默认上传器.触发上传成功("att-canonical.webp");

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        status: "failed",
        errorCode: "system_error",
      }),
    ]);
  });
  it("upload-error 会把 transporting / processing 草稿收口成 failed", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "xhr-error.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);

    await 场景.默认上传器.触发上传错误(
      "att-canonical.webp",
      { message: "Upload error" },
      {
        status: 401,
        responseText: JSON.stringify({
          code: "invalid_session",
          message: "会话无效",
        }),
        readyState: 4,
        responseURL: "http://storage.local/xhr-error.jpg",
      }
    );

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        attachmentId: "att-canonical.webp",
        status: "failed",
        errorCode: "invalid_session",
      }),
    ]);
  });
});

