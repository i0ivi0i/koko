// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  读取媒体发送任务恢复记录,
  保存媒体草稿到本地存储,
  保存媒体发送任务恢复记录,
} from "../媒体/媒体草稿持久化";
import type { 媒体上传文件 } from "../媒体/媒体发布";
import { 创建播放会话草稿发布 } from "../媒体/播放会话/草稿发布";
import type { 媒体附件草稿 } from "../媒体/媒体草稿";
import { 创建场景, 模拟浏览器Webp编码 } from "./媒体发布测试支撑";

describe("媒体发布器 / 刷新恢复", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    模拟浏览器Webp编码();
  });

  it("刷新后恢复 transporting 草稿但没有上传器 owner 时必须变成失败态", () => {
    保存媒体草稿到本地存储([
      {
        localId: "att-lost-owner",
        kind: "image",
        attachmentId: "att-lost-owner",
        width: 800,
        height: 600,
        status: "transporting",
        fileName: "lost.jpg",
        errorCode: "",
      },
    ]);
    const 场景 = 创建场景();

    场景.发布器.恢复未完成草稿();

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-lost-owner",
        attachmentId: "att-lost-owner",
        status: "failed",
        errorCode: "attachment_upload_interrupted",
        sourceFile: null,
      }),
    ]);
  });

  it("有恢复记录且后端返回 resumable 时会重建 uploader 等待 Golden Retriever restored 后继续上传", async () => {
    保存媒体草稿到本地存储([
      {
        localId: "att-restore",
        kind: "image",
        attachmentId: "att-restore",
        width: 800,
        height: 600,
        status: "transporting",
        fileName: "restore.jpg",
        errorCode: "",
      },
    ]);
    保存媒体发送任务恢复记录([
      {
        localId: "att-restore",
        roomId: "room-1",
        attachmentId: "att-restore",
        uploadSessionId: "upl-restore",
        kind: "image",
        fileName: "restore.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
        sourceHash: "a".repeat(64),
        sourceByteSize: 3,
        sourceFileName: "restore.jpg",
        width: 800,
        height: 600,
        uploadProfile: "default",
        status: "transporting",
        createdAtMs: 1,
        expiresAt: "2026-05-18T09:30:00Z",
      },
    ]);
    const resumeMediaUpload = vi.fn(async () => ({
      status: "resumable" as const,
      attachment_id: "att-restore",
      upload_session_id: "upl-restore",
      upload_method: "tus" as const,
      tus_endpoint: "http://storage.local/files",
      tus_headers: { Authorization: "Bearer renewed" },
      tus_metadata: {
        attachment_id: "att-restore",
        upload_session_id: "upl-restore",
        file_name: "restore.jpg",
        mime_type: "image/jpeg",
        byte_size: "3",
      },
      expires_at: "2026-05-18T09:30:00Z",
    }));
    const 场景 = 创建场景({ resumeMediaUpload });

    场景.发布器.恢复未完成草稿();

    await vi.waitFor(() => {
      expect(场景.createUploaderCalls).toEqual([
        expect.objectContaining({
          tusEndpoint: "http://storage.local/files",
          profile: "default",
          attachmentId: "att-restore",
          uploadSessionId: "upl-restore",
        }),
      ]);
    });
    场景.默认上传器.注入恢复文件({
      id: "att-restore",
      name: "restore.jpg",
      type: "image/jpeg",
      data: new File([new Uint8Array([1, 2, 3])], "restore.jpg", { type: "image/jpeg" }),
      meta: {
        attachment_id: "att-restore",
        upload_session_id: "upl-restore",
        attachment_kind: "image",
        relativePath: "att-restore",
      },
    });
    await 场景.默认上传器.触发恢复完成();

    expect(resumeMediaUpload).toHaveBeenCalledWith("s-test", "att-restore", "upl-restore");
    expect(场景.默认上传器.uploadCalls).toHaveLength(1);
  });

  it("后端恢复结果已 completed 时会直接恢复 ready 草稿", async () => {
    保存媒体发送任务恢复记录([
      {
        localId: "att-ready",
        roomId: "room-1",
        attachmentId: "att-ready",
        uploadSessionId: "upl-ready",
        kind: "image",
        fileName: "ready.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
        width: 120,
        height: 90,
        uploadProfile: "default",
        status: "processing",
        createdAtMs: 1,
        expiresAt: "2026-05-18T09:30:00Z",
      },
    ]);
    const 场景 = 创建场景({
      resumeMediaUpload: vi.fn(async () => ({
        status: "completed" as const,
        attachment: {
          attachment_id: "att-ready",
          kind: "image" as const,
          mime_type: "image/jpeg",
          byte_size: 3,
          width: 120,
          height: 90,
          status: "ready" as const,
        },
      })),
    });

    场景.发布器.恢复未完成草稿();

    await vi.waitFor(() => {
      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-ready",
          attachmentId: "att-ready",
          status: "ready",
        }),
      ]);
    });
  });

  it("播放会话草稿发布会把 transport.resumeMediaUpload 传给媒体发布器恢复入口", async () => {
    保存媒体草稿到本地存储([
      {
        localId: "att-app-restore",
        kind: "image",
        attachmentId: "att-app-restore",
        width: 120,
        height: 90,
        status: "transporting",
        fileName: "restore.jpg",
        errorCode: "",
      },
    ]);
    保存媒体发送任务恢复记录([
      {
        localId: "att-app-restore",
        roomId: "room-1",
        attachmentId: "att-app-restore",
        uploadSessionId: "upl-app-restore",
        kind: "image",
        fileName: "restore.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
        width: 120,
        height: 90,
        uploadProfile: "default",
        status: "processing",
        createdAtMs: 1,
        expiresAt: "2026-05-18T10:00:00Z",
      },
    ]);
    let drafts: 媒体附件草稿[] = [];
    const resumeMediaUpload = vi.fn(async () => ({
      status: "completed" as const,
      attachment: {
        attachment_id: "att-app-restore",
        kind: "image" as const,
        mime_type: "image/jpeg",
        byte_size: 3,
        width: 120,
        height: 90,
        status: "ready" as const,
      },
    }));
    const 草稿发布 = 创建播放会话草稿发布({
      transport: () => ({
        reuseMediaBySourceHash: vi.fn(async () => ({ status: "miss" as const })),
        prepareMediaUpload: vi.fn(async () => {
          throw new Error("unused");
        }),
        abandonMediaUpload: vi.fn(async () => undefined),
        completeMediaUpload: vi.fn(async () => {
          throw new Error("unused");
        }),
        resumeMediaUpload,
      }),
      读取会话编号: () => "s-test",
      读取当前房间标识: () => "room-1",
      读取草稿: () => drafts,
      写入草稿列表: (next) => {
        drafts = next;
      },
      回收媒体草稿预览地址: vi.fn(),
    });

    草稿发布.创建媒体发布器().恢复未完成草稿();

    await vi.waitFor(() => {
      expect(resumeMediaUpload).toHaveBeenCalledWith(
        "s-test",
        "att-app-restore",
        "upl-app-restore"
      );
      expect(drafts[0]).toMatchObject({
        localId: "att-app-restore",
        status: "ready",
        errorCode: "",
      });
    });
  });

  it("Golden Retriever restored 但没有恢复出文件时会进入需要重新选择", async () => {
    保存媒体草稿到本地存储([
      {
        localId: "att-ghost",
        kind: "image",
        attachmentId: "att-ghost",
        width: 120,
        height: 90,
        status: "transporting",
        fileName: "ghost.jpg",
        errorCode: "",
      },
    ]);
    保存媒体发送任务恢复记录([
      {
        localId: "att-ghost",
        roomId: "room-1",
        attachmentId: "att-ghost",
        uploadSessionId: "upl-ghost",
        kind: "image",
        fileName: "ghost.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
        width: 120,
        height: 90,
        uploadProfile: "default",
        status: "transporting",
        createdAtMs: 1,
        expiresAt: "2026-05-18T09:30:00Z",
      },
    ]);
    const 场景 = 创建场景({
      resumeMediaUpload: vi.fn(async () => ({
        status: "resumable" as const,
        attachment_id: "att-ghost",
        upload_session_id: "upl-ghost",
        upload_method: "tus" as const,
        tus_endpoint: "http://storage.local/files",
        tus_headers: { Authorization: "Bearer renewed" },
        tus_metadata: {
          attachment_id: "att-ghost",
          upload_session_id: "upl-ghost",
          file_name: "ghost.jpg",
          mime_type: "image/jpeg",
          byte_size: "3",
        },
        expires_at: "2026-05-18T09:30:00Z",
      })),
    });

    场景.发布器.恢复未完成草稿();
    await vi.waitFor(() => expect(场景.createUploaderCalls).toHaveLength(1));
    await 场景.默认上传器.触发恢复完成();

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-ghost",
        status: "failed",
        errorCode: "attachment_file_needs_reselect",
      }),
    ]);
  });

  it("Golden Retriever 只恢复 ghost file 时不能继续 upload，必须进入需要重新选择", async () => {
    保存媒体草稿到本地存储([
      {
        localId: "att-ghost-file",
        kind: "image",
        attachmentId: "att-ghost-file",
        width: 120,
        height: 90,
        status: "transporting",
        fileName: "ghost.jpg",
        errorCode: "",
      },
    ]);
    保存媒体发送任务恢复记录([
      {
        localId: "att-ghost-file",
        roomId: "room-1",
        attachmentId: "att-ghost-file",
        uploadSessionId: "upl-ghost-file",
        kind: "image",
        fileName: "ghost.jpg",
        mimeType: "image/jpeg",
        byteSize: 3,
        width: 120,
        height: 90,
        uploadProfile: "default",
        status: "transporting",
        createdAtMs: 1,
        expiresAt: "2026-05-18T10:00:00Z",
      },
    ]);
    const 场景 = 创建场景({
      resumeMediaUpload: vi.fn(async () => ({
        status: "resumable" as const,
        attachment_id: "att-ghost-file",
        upload_session_id: "upl-ghost-file",
        upload_method: "tus" as const,
        tus_endpoint: "http://storage.local/files",
        tus_headers: { Authorization: "Bearer renewed" },
        tus_metadata: {
          attachment_id: "att-ghost-file",
          upload_session_id: "upl-ghost-file",
          file_name: "ghost.jpg",
          mime_type: "image/jpeg",
          byte_size: "3",
        },
        expires_at: "2026-05-18T10:00:00Z",
      })),
    });

    场景.发布器.恢复未完成草稿();
    await vi.waitFor(() => expect(场景.createUploaderCalls).toHaveLength(1));
    场景.默认上传器.注入恢复文件({
      id: "att-ghost-file",
      name: "ghost.jpg",
      type: "image/jpeg",
      data: undefined,
      isGhost: true,
      meta: {
        attachment_id: "att-ghost-file",
        upload_session_id: "upl-ghost-file",
        attachment_kind: "image",
      },
    } as unknown as 媒体上传文件);
    await 场景.默认上传器.触发恢复完成();

    expect(场景.默认上传器.uploadCalls).toHaveLength(0);
    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-ghost-file",
        status: "failed",
        errorCode: "attachment_file_needs_reselect",
      }),
    ]);
  });

  it("large-video 可恢复记录若后端未完成且没有本地文件 owner，会进入需要重新选择", async () => {
    保存媒体草稿到本地存储([
      {
        localId: "att-large-video",
        kind: "video",
        attachmentId: "att-large-video",
        width: 1920,
        height: 1080,
        status: "transporting",
        fileName: "large.mp4",
        errorCode: "",
      },
    ]);
    保存媒体发送任务恢复记录([
      {
        localId: "att-large-video",
        roomId: "room-1",
        attachmentId: "att-large-video",
        uploadSessionId: "upl-large-video",
        kind: "video",
        fileName: "large.mp4",
        mimeType: "video/mp4",
        byteSize: 128 * 1024 * 1024,
        width: 1920,
        height: 1080,
        uploadProfile: "large-video",
        status: "transporting",
        createdAtMs: 1,
        expiresAt: "2026-05-18T10:00:00Z",
      },
    ]);
    const 场景 = 创建场景({
      resumeMediaUpload: vi.fn(async () => ({
        status: "resumable" as const,
        attachment_id: "att-large-video",
        upload_session_id: "upl-large-video",
        upload_method: "tus" as const,
        tus_endpoint: "http://storage.local/files",
        tus_headers: { Authorization: "Bearer renewed" },
        tus_metadata: {
          attachment_id: "att-large-video",
          upload_session_id: "upl-large-video",
          file_name: "large.mp4",
          mime_type: "video/mp4",
          byte_size: String(128 * 1024 * 1024),
        },
        expires_at: "2026-05-18T10:00:00Z",
      })),
    });

    场景.发布器.恢复未完成草稿();
    await vi.waitFor(() => expect(场景.createUploaderCalls).toHaveLength(1));
    await 场景.大视频上传器.触发恢复完成();

    expect(场景.drafts.readDrafts()).toEqual([
      expect.objectContaining({
        localId: "att-large-video",
        status: "failed",
        errorCode: "attachment_file_needs_reselect",
      }),
    ]);
  });

  it("large-video 后端已 completed 时刷新恢复直接进入 ready", async () => {
    保存媒体发送任务恢复记录([
      {
        localId: "att-large-ready",
        roomId: "room-1",
        attachmentId: "att-large-ready",
        uploadSessionId: "upl-large-ready",
        kind: "video",
        fileName: "large-ready.mp4",
        mimeType: "video/mp4",
        byteSize: 128 * 1024 * 1024,
        width: 1920,
        height: 1080,
        uploadProfile: "large-video",
        status: "processing",
        createdAtMs: 1,
        expiresAt: "2026-05-18T10:00:00Z",
      },
    ]);
    const 场景 = 创建场景({
      resumeMediaUpload: vi.fn(async () => ({
        status: "completed" as const,
        attachment: {
          attachment_id: "att-large-ready",
          kind: "video" as const,
          mime_type: "video/mp4",
          byte_size: 128 * 1024 * 1024,
          width: 1920,
          height: 1080,
          status: "ready" as const,
        },
      })),
    });

    场景.发布器.恢复未完成草稿();

    await vi.waitFor(() => {
      expect(场景.drafts.readDrafts()).toEqual([
        expect.objectContaining({
          localId: "att-large-ready",
          attachmentId: "att-large-ready",
          status: "ready",
        }),
      ]);
    });
  });

  it("上传传输失败时会把恢复记录标成 failed，避免刷新后按 transporting 误恢复", async () => {
    const 场景 = 创建场景();
    await 场景.发布器.处理选择媒体文件([
      new File([new Uint8Array([1, 2, 3])], "transport-error.jpg", {
        type: "image/jpeg",
      }),
    ]);

    await 场景.默认上传器.触发上传错误("att-canonical.webp", {
      message: "network down",
    });

    expect(场景.drafts.readDrafts()[0]).toMatchObject({
      status: "failed",
    });
    expect(读取媒体发送任务恢复记录()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        status: "failed",
      }),
    ]);
  });

  it("complete 失败时会把恢复记录标成 failed，避免刷新后按 transporting 误恢复", async () => {
    const 场景 = 创建场景();
    场景.completeMediaUpload.mockRejectedValueOnce(new Error("complete failed"));
    await 场景.发布器.处理选择媒体文件([
      new File([new Uint8Array([1, 2, 3])], "complete-error.jpg", {
        type: "image/jpeg",
      }),
    ]);

    await 场景.默认上传器.触发上传成功("att-canonical.webp");

    expect(场景.drafts.readDrafts()[0]).toMatchObject({
      status: "failed",
    });
    expect(读取媒体发送任务恢复记录()).toEqual([
      expect.objectContaining({
        localId: "att-canonical.webp",
        status: "failed",
      }),
    ]);
  });
});
