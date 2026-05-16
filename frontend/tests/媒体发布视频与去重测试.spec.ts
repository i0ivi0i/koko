import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import {
创建场景,
创建指定大小文件,
大视频高吞吐阈值字节数,
模拟浏览器Webp编码,
type 媒体附件草稿,
} from "./媒体发布测试支撑";

describe("媒体发布器 / 视频与去重主链", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    模拟浏览器Webp编码();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("选视频后会先走媒体 prepare 再写入 transporting 视频草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "picked.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.prepareMediaUpload).toHaveBeenCalledWith("video", "s-test", sourceFile, {
      source_hash: "a".repeat(64),
      source_byte_size: 3,
      source_file_name: "picked.mp4",
    });
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-picked.mp4",
        kind: "video",
        attachmentId: "att-picked.mp4",
        status: "transporting",
        previewUrl: "blob:poster-picked.mp4",
        width: 1280,
        height: 720,
      }),
    ]);
  });
  it("source_hash 命中会直接写 ready 草稿并跳过 prepare 和 Uppy 上传（预处理因并行已启动但结果被丢弃）", async () => {
    const preprocessVideo = vi.fn(async (file: File) => ({ file }));
    const reuseMediaBySourceHash = vi.fn(async () => ({
      status: "reused" as const,
      attachment: {
        attachment_id: "att-source-hit-video",
        kind: "video" as const,
        mime_type: "video/mp4",
        byte_size: 2048,
        width: 1920,
        height: 1080,
        status: "ready" as const,
      },
    }));
    const 场景 = 创建场景({
      getCurrentRoomId: () => "r-test",
      preprocessVideo,
      reuseMediaBySourceHash,
    });
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "hit.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.calculateSourceHash).toHaveBeenCalledWith(sourceFile);
    expect(reuseMediaBySourceHash).toHaveBeenCalledWith("video", {
      session_id: "s-test",
      room_id: "r-test",
      source_hash: "a".repeat(64),
      source_byte_size: 3,
      source_file_name: "hit.mp4",
    });
    // 并行化后预处理会与哈希同时启动，复用命中时预处理结果被丢弃（直通场景零开销）
    expect(preprocessVideo).toHaveBeenCalledWith(sourceFile);
    // 关键断言：复用命中后 prepare 和 Uppy 上传都不走
    expect(场景.prepareMediaUpload).not.toHaveBeenCalled();
    expect(场景.默认上传器.addFileCalls).toEqual([]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-source-hit-video",
        kind: "video",
        attachmentId: "att-source-hit-video",
        previewUrl: "",
        width: 1920,
        height: 1080,
        status: "ready",
        sourceFile,
      }),
    ]);
  });
  it("source_hash 未命中会继续预处理上传并把原文件身份透传给 prepare", async () => {
    const 场景 = 创建场景({
      getCurrentRoomId: () => "r-test",
    });
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "miss.jpg", {
      type: "image/jpeg",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    expect(场景.reuseMediaBySourceHash).toHaveBeenCalledWith("image", {
      session_id: "s-test",
      room_id: "r-test",
      source_hash: "a".repeat(64),
      source_byte_size: 3,
      source_file_name: "miss.jpg",
    });
    expect(场景.prepareMediaUpload).toHaveBeenCalledWith(
      "image",
      "s-test",
      expect.objectContaining({ name: "canonical.webp", type: "image/webp" }),
      {
        source_hash: "a".repeat(64),
        source_byte_size: 3,
        source_file_name: "miss.jpg",
      }
    );
    expect(场景.默认上传器.addFileCalls).toHaveLength(1);
  });
  it("视频预制很快完成时不会写入瞬时预制占位草稿", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "quick.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);

    const preprocessingDraft = 场景.writeDraft.mock.calls
      .map(([draft]) => draft as 媒体附件草稿)
      .find((draft) => draft.localId.startsWith("preprocessing-video-"));
    expect(preprocessingDraft).toBeUndefined();
  });
  it("视频预制失败时不会触发 prepareMediaUpload", async () => {
    const 场景 = 创建场景({
      preprocessVideo: vi.fn(async () => {
        throw new Error("media_preprocess_failed");
      }),
    });
    const source = 创建指定大小文件("bad.mov", "video/quicktime", 1024);

    await 场景.发布器.处理选择媒体文件([source]);

    expect(场景.prepareMediaUpload).not.toHaveBeenCalled();
    expect(场景.drafts.readDrafts()[0]?.status).toBe("failed");
    expect(场景.drafts.readDrafts()[0]?.errorCode).toBe("media_preprocess_failed");
  });
  it("预制超过15分钟仅进入提醒态，不自动发送半成品", async () => {
    vi.useFakeTimers();
    const 场景 = 创建场景({
      preprocessVideo: vi.fn(() => new Promise<{ file: File }>(() => {})),
    });
    const source = 创建指定大小文件("long.mp4", "video/mp4", 1024);

    const pending = 场景.发布器.处理选择媒体文件([source]);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(场景.prepareMediaUpload).not.toHaveBeenCalled();
    expect(场景.drafts.readDrafts()[0]?.status).toBe("processing");
    expect(场景.drafts.readDrafts()[0]?.errorCode).toBe("media_preprocess_waiting");
    void pending;
    vi.useRealTimers();
  });
  it("大视频会走高吞吐 uploader profile，小文件继续走默认 profile", async () => {
    const 场景 = 创建场景();
    const imageFile = new File([new Uint8Array([1, 2, 3])], "small.jpg", {
      type: "image/jpeg",
    });
    const smallVideo = new File([new Uint8Array([1, 2, 3])], "small.mp4", {
      type: "video/mp4",
    });
    const largeVideo = 创建指定大小文件(
      "large.mp4",
      "video/mp4",
      大视频高吞吐阈值字节数
    );

    await 场景.发布器.处理选择媒体文件([imageFile, smallVideo, largeVideo]);

    // 并行批处理下 uploader 创建顺序取决于各文件预处理速度，只验证集合
    expect(场景.createUploaderCalls).toEqual(expect.arrayContaining([
      {
        tusEndpoint: "http://storage.local/files",
        profile: "default",
        attachmentId: expect.stringMatching(/att-(canonical\.webp|small\.mp4)/),
        uploadSessionId: expect.stringMatching(/upl-(canonical\.webp|small\.mp4)/),
      },
      {
        tusEndpoint: "http://storage.local/files",
        profile: "large-video",
        attachmentId: "att-large.mp4",
        uploadSessionId: "upl-large.mp4",
      },
    ]));
    expect(场景.默认上传器.addFileCalls.map((item) => item.id)).toEqual(
      expect.arrayContaining(["att-canonical.webp", "att-small.mp4"]),
    );
    expect(场景.默认上传器.addFileCalls.map((item) => item.id).sort()).toEqual([
      "att-canonical.webp",
      "att-small.mp4",
    ]);
    expect(场景.大视频上传器.addFileCalls.map((item) => item.id)).toEqual([
      "att-large.mp4",
    ]);
  });
  it("视频 upload-success 后 complete 成功，草稿会变成 ready 视频", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });

    await 场景.发布器.处理选择媒体文件([sourceFile]);
    await 场景.默认上传器.触发上传成功("att-clip.mp4");

    expect(场景.completeMediaUpload).toHaveBeenCalledWith("s-test", "att-clip.mp4");
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-clip.mp4",
        kind: "video",
        attachmentId: "att-clip.mp4",
        status: "ready",
        width: 1280,
        height: 720,
      }),
    ]);
  });
  it("upload-stalled 不会移除仍在 Tus 回调中的上传文件", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "stalled.jpg", {
      type: "image/jpeg",
    });
    await 场景.发布器.处理选择媒体文件([sourceFile]);

    await 场景.默认上传器.触发上传停滞("att-canonical.webp");

    expect(场景.默认上传器.removeFileCalls).toEqual([]);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        attachmentId: "att-canonical.webp",
        status: "transporting",
        errorCode: "",
      }),
    ]);
  });
  it("没有 upload-progress 时不会再被本地 watchdog 误杀", async () => {
    const 场景 = 创建场景();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "slow.mp4", {
      type: "video/mp4",
    });
    vi.useFakeTimers();
    try {
      await 场景.发布器.处理选择媒体文件([sourceFile]);
      await vi.advanceTimersByTimeAsync(16_000);

      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-slow.mp4",
          status: "transporting",
        }),
      ]);
      expect(场景.默认上传器.removeFileCalls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("视频上传时哈希计算与预处理并行执行而非串行等待", async () => {
    const callOrder: string[] = [];

    const 场景 = 创建场景({
      calculateSourceHash: async (file: File) => {
        callOrder.push("hash-start");
        await new Promise((r) => setTimeout(r, 30));
        callOrder.push("hash-end");
        return {
          source_hash: "b".repeat(64),
          source_byte_size: file.size,
          source_file_name: file.name,
        };
      },
      preprocessVideo: async (file: File) => {
        callOrder.push("preprocess-start");
        await new Promise((r) => setTimeout(r, 30));
        callOrder.push("preprocess-end");
        return { file, width: 1920, height: 1080 };
      },
    });

    const videoFile = new File([new Uint8Array([1, 2, 3])], "parallel.mp4", {
      type: "video/mp4",
    });
    await 场景.发布器.处理选择媒体文件([videoFile]);

    // 并行：preprocess-start 出现在 hash-end 之前
    // 串行：preprocess-start 出现在 hash-end 之后
    const preprocessStartIdx = callOrder.indexOf("preprocess-start");
    const hashEndIdx = callOrder.indexOf("hash-end");
    expect(preprocessStartIdx).toBeGreaterThan(-1);
    expect(hashEndIdx).toBeGreaterThan(-1);
    expect(preprocessStartIdx).toBeLessThan(hashEndIdx);
  });
});
