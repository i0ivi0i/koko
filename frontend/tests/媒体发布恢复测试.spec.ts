// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  保存媒体草稿到本地存储,
  保存媒体发送任务恢复记录,
} from "../媒体/媒体草稿持久化";
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
});
