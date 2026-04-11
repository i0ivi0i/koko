import { describe, expect, it } from "vitest";
import {
  创建附件能力注册表,
  type 统一媒体文件选择配置,
} from "../操作台/附件入口/index.js";
import { 可选择图片文件类型, 可选择视频文件类型 } from "../媒体/index.js";

function 读取媒体文件选择类型集合(
  配置: 统一媒体文件选择配置
): string[] {
  return 配置.accept
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

describe("附件能力注册表", () => {
  it("当前只注册一个直达媒体能力，避免壳层重新长回图片/视频双入口", () => {
    const 注册表 = 创建附件能力注册表();

    expect(注册表.默认能力标识).toBe("media");
    expect(注册表.能力列表).toEqual([
      expect.objectContaining({
        id: "media",
        triggerStrategy: "direct",
        ariaLabel: "选择图片或视频",
      }),
    ]);
  });

  it("统一媒体文件选择配置会收口图片和视频类型，并保持多选开启", () => {
    const 注册表 = 创建附件能力注册表();
    const 文件类型集合 = 读取媒体文件选择类型集合(注册表.统一媒体文件选择配置);

    expect(注册表.统一媒体文件选择配置).toEqual(
      expect.objectContaining({
        buttonId: "composerMediaPickerBtn",
        inputId: "composerMediaFileInput",
        multiple: true,
      })
    );
    expect(文件类型集合).toEqual(
      expect.arrayContaining([...可选择图片文件类型, ...可选择视频文件类型])
    );
  });
});
