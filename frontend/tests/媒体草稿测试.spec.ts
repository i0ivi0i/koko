import { describe, expect, it } from "vitest";
import {
  写入媒体草稿,
  更新媒体草稿状态,
  提取可发送媒体附件标识,
  移除媒体草稿,
  type 媒体附件草稿,
} from "../媒体/媒体草稿";

function 创建草稿(patch: Partial<媒体附件草稿> = {}): 媒体附件草稿 {
  return {
    localId: "draft-1",
    kind: "image",
    attachmentId: "att-1",
    previewUrl: "blob:http://test.local/draft-1",
    width: 120,
    height: 90,
    status: "ready",
    fileName: "draft-1.png",
    errorCode: "",
    sourceFile: null,
    ...patch,
  };
}

describe("媒体草稿", () => {
  it("提取可发送媒体附件标识 在空列表时返回空数组", () => {
    expect(提取可发送媒体附件标识([])).toEqual([]);
  });

  it("pending-first: transporting 有 attachmentId 时允许发送", () => {
    const drafts = [创建草稿({ status: "transporting" })];

    expect(提取可发送媒体附件标识(drafts)).toEqual(["att-1"]);
  });

  it("pending-first: processing 有 attachmentId 时允许发送", () => {
    const drafts = [创建草稿({ status: "processing" })];

    expect(提取可发送媒体附件标识(drafts)).toEqual(["att-1"]);
  });

  it("pending-first: transporting 无 attachmentId 时仍阻止发送", () => {
    const drafts = [创建草稿({ status: "transporting", attachmentId: "" })];

    expect(提取可发送媒体附件标识(drafts)).toBeNull();
  });

  it("pending-first: failed 草稿阻止发送", () => {
    const drafts = [创建草稿({ status: "failed" })];

    expect(提取可发送媒体附件标识(drafts)).toBeNull();
  });

  it("提取可发送媒体附件标识 遇到 attachmentId 为空时返回 null", () => {
    const drafts = [创建草稿({ attachmentId: "" })];

    expect(提取可发送媒体附件标识(drafts)).toBeNull();
  });

  it("写入媒体草稿 在同 localId 覆盖时会返回旧预览地址供壳层回收", () => {
    const current = [创建草稿()];

    const result = 写入媒体草稿(current, 创建草稿({ previewUrl: "blob:http://test.local/next" }));

    expect(result.草稿列表).toEqual([创建草稿({ previewUrl: "blob:http://test.local/next" })]);
    expect(result.需要回收的预览地址).toEqual(["blob:http://test.local/draft-1"]);
  });

  it("更新媒体草稿状态 在 previewUrl 改变时会返回旧预览地址", () => {
    const current = [创建草稿()];

    const result = 更新媒体草稿状态(current, "draft-1", {
      previewUrl: "blob:http://test.local/updated",
      status: "failed",
      errorCode: "attachment_upload_failed",
    });

    expect(result.草稿列表).toEqual([
      创建草稿({
        previewUrl: "blob:http://test.local/updated",
        status: "failed",
        errorCode: "attachment_upload_failed",
      }),
    ]);
    expect(result.需要回收的预览地址).toEqual(["blob:http://test.local/draft-1"]);
  });

  it("移除媒体草稿 会返回被移除草稿的预览地址", () => {
    const current = [创建草稿(), 创建草稿({ localId: "draft-2", attachmentId: "att-2" })];

    const result = 移除媒体草稿(current, "draft-1");

    expect(result.草稿列表).toEqual([创建草稿({ localId: "draft-2", attachmentId: "att-2" })]);
    expect(result.需要回收的预览地址).toEqual(["blob:http://test.local/draft-1"]);
  });
});
