import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  创建本地图片预览地址,
  准备待上传图片文件,
  可选择图片文件类型,
  图片附件上传上限字节数,
  推导图片Mime类型,
} from "../媒体/图片预处理";

const heic2anyMock = vi.fn();

vi.mock("heic2any", () => ({
  default: heic2anyMock,
}));

describe("图片预处理", () => {
  beforeEach(() => {
    heic2anyMock.mockReset();
  });

  it("推导图片Mime类型 会在原始 MIME 为空时回退到扩展名", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "fallback.png", {
      type: "",
    });

    expect(推导图片Mime类型(file)).toBe("image/png");
  });

  it("准备待上传图片文件 遇到非图片时抛 attachment_type_not_allowed", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "note.txt", {
      type: "text/plain",
    });

    await expect(准备待上传图片文件(file)).rejects.toThrow("attachment_type_not_allowed");
  });

  it("准备待上传图片文件 会把 HEIC 转成标准 jpeg", async () => {
    heic2anyMock.mockResolvedValue(
      new Blob([new Uint8Array([9, 8, 7])], { type: "image/jpeg" })
    );
    const file = new File([new Uint8Array([1, 2, 3])], "mobile.heic", {
      type: "image/heic",
    });

    const normalized = await 准备待上传图片文件(file);

    expect(heic2anyMock).toHaveBeenCalledWith({
      blob: file,
      toType: "image/jpeg",
    });
    expect(normalized.name).toBe("mobile.jpg");
    expect(normalized.type).toBe("image/jpeg");
  });

  it("创建本地图片预览地址 在没有 blob 时返回空串", () => {
    expect(创建本地图片预览地址(null)).toBe("");
  });

  it("导出的上传上限和 accept 类型保持稳定", () => {
    expect(图片附件上传上限字节数).toBe(10 * 1024 * 1024);
    expect(可选择图片文件类型).toEqual(["image/*", ".heic", ".heif", ".heics", ".heifs"]);
  });
});
