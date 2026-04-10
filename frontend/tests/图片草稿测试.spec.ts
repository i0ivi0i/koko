import { describe, expect, it } from "vitest";
import {
  写入图片草稿,
  更新图片草稿状态,
  提取可发送图片附件标识,
  移除图片草稿,
  type 图片附件草稿,
} from "../图像/图片草稿";

function 创建草稿(patch: Partial<图片附件草稿> = {}): 图片附件草稿 {
  return {
    localId: "draft-1",
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

describe("图片草稿", () => {
  it("提取可发送图片附件标识 在空列表时返回空数组", () => {
    expect(提取可发送图片附件标识([])).toEqual([]);
  });

  it("提取可发送图片附件标识 遇到未 ready 草稿时返回 null", () => {
    const drafts = [创建草稿({ status: "uploading" })];

    expect(提取可发送图片附件标识(drafts)).toBeNull();
  });

  it("提取可发送图片附件标识 遇到 attachmentId 为空时返回 null", () => {
    const drafts = [创建草稿({ attachmentId: "" })];

    expect(提取可发送图片附件标识(drafts)).toBeNull();
  });

  it("写入图片草稿 在同 localId 覆盖时会返回旧预览地址供壳层回收", () => {
    const current = [创建草稿()];

    const result = 写入图片草稿(current, 创建草稿({ previewUrl: "blob:http://test.local/next" }));

    expect(result.草稿列表).toEqual([创建草稿({ previewUrl: "blob:http://test.local/next" })]);
    expect(result.需要回收的预览地址).toEqual(["blob:http://test.local/draft-1"]);
  });

  it("更新图片草稿状态 在 previewUrl 改变时会返回旧预览地址", () => {
    const current = [创建草稿()];

    const result = 更新图片草稿状态(current, "draft-1", {
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

  it("移除图片草稿 会返回被移除草稿的预览地址", () => {
    const current = [创建草稿(), 创建草稿({ localId: "draft-2", attachmentId: "att-2" })];

    const result = 移除图片草稿(current, "draft-1");

    expect(result.草稿列表).toEqual([创建草稿({ localId: "draft-2", attachmentId: "att-2" })]);
    expect(result.需要回收的预览地址).toEqual(["blob:http://test.local/draft-1"]);
  });
});
