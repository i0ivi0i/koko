// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  保存媒体草稿到本地存储,
  从本地存储恢复媒体草稿,
  清除本地存储媒体草稿,
  type 可持久化媒体草稿,
} from "../媒体/媒体草稿持久化.js";

describe("媒体草稿持久化", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("保存后可以恢复草稿列表", () => {
    const drafts: 可持久化媒体草稿[] = [
      {
        localId: "draft-1",
        kind: "image",
        attachmentId: "att-001",
        width: 800,
        height: 600,
        status: "ready",
        fileName: "photo.jpg",
        errorCode: "",
      },
    ];
    保存媒体草稿到本地存储(drafts);
    const restored = 从本地存储恢复媒体草稿();
    expect(restored).toEqual(drafts);
  });

  it("空草稿列表清除 localStorage 条目", () => {
    localStorage.setItem("koko_media_drafts", "old");
    保存媒体草稿到本地存储([]);
    expect(localStorage.getItem("koko_media_drafts")).toBeNull();
  });

  it("localStorage 内容损坏时返回空数组", () => {
    localStorage.setItem("koko_media_drafts", "{NOT_JSON!!!");
    expect(从本地存储恢复媒体草稿()).toEqual([]);
  });

  it("localStorage 内容不是数组时返回空数组", () => {
    localStorage.setItem("koko_media_drafts", '"string"');
    expect(从本地存储恢复媒体草稿()).toEqual([]);
  });

  it("清除后返回空数组", () => {
    保存媒体草稿到本地存储([{
      localId: "x", kind: "video", attachmentId: "a",
      width: 1, height: 1, status: "ready",
      fileName: "v.mp4", errorCode: "",
    }]);
    清除本地存储媒体草稿();
    expect(从本地存储恢复媒体草稿()).toEqual([]);
  });

  it("过滤掉缺少 localId 的无效条目", () => {
    localStorage.setItem("koko_media_drafts", JSON.stringify([
      { kind: "image" },
      { localId: "ok", kind: "image", attachmentId: "", width: 0, height: 0, status: "ready", fileName: "a.jpg", errorCode: "" },
    ]));
    const result = 从本地存储恢复媒体草稿();
    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe("ok");
  });

  it("不存储 sourceFile 和 previewUrl", () => {
    保存媒体草稿到本地存储([{
      localId: "d1", kind: "image", attachmentId: "a1",
      width: 100, height: 100, status: "ready",
      fileName: "img.png", errorCode: "",
    }]);
    const raw = JSON.parse(localStorage.getItem("koko_media_drafts")!);
    expect(raw[0]).not.toHaveProperty("sourceFile");
    expect(raw[0]).not.toHaveProperty("previewUrl");
  });

  it("多个草稿保存和恢复顺序一致", () => {
    const drafts: 可持久化媒体草稿[] = [
      { localId: "a", kind: "image", attachmentId: "1", width: 0, height: 0, status: "ready", fileName: "a.jpg", errorCode: "" },
      { localId: "b", kind: "video", attachmentId: "2", width: 1920, height: 1080, status: "transporting", fileName: "b.mp4", errorCode: "" },
    ];
    保存媒体草稿到本地存储(drafts);
    expect(从本地存储恢复媒体草稿()).toEqual(drafts);
  });
});
