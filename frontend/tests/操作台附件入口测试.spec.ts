import { describe, expect, it, vi } from "vitest";
import { 创建操作台附件入口编排 } from "../操作台/附件入口/index.js";

describe("操作台附件入口编排", () => {
  it("即使存在 showPicker，统一附件入口也继续走隐藏 input.click 主路径", () => {
    const click = vi.fn();
    const showPicker = vi.fn();
    const 编排 = 创建操作台附件入口编排({
      auxSlot: {
        visible: true,
        disabled: false,
      },
      获取统一媒体文件输入: () =>
        ({
          click,
          showPicker,
        }) as unknown as HTMLInputElement,
      处理选择媒体文件: vi.fn(),
    });

    编排.执行默认附件能力();

    expect(showPicker).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("辅助槽不可见或被禁用时，不会误触发统一媒体 input", () => {
    const click = vi.fn();
    const 编排 = 创建操作台附件入口编排({
      auxSlot: {
        visible: false,
        disabled: true,
      },
      获取统一媒体文件输入: () =>
        ({
          click,
        }) as unknown as HTMLInputElement,
      处理选择媒体文件: vi.fn(),
    });

    编排.执行默认附件能力();

    expect(click).not.toHaveBeenCalled();
  });

  it("统一媒体文件变更时会转交选中文件并清空 input 值", async () => {
    const 处理选择媒体文件 = vi.fn().mockResolvedValue(undefined);
    const sourceFile = new File([new Uint8Array([1, 2, 3])], "selected.jpg", {
      type: "image/jpeg",
    });
    const 编排 = 创建操作台附件入口编排({
      auxSlot: {
        visible: true,
        disabled: false,
      },
      获取统一媒体文件输入: () => null,
      处理选择媒体文件,
    });
    const input = {
      files: [sourceFile],
      value: "selected",
    };

    await 编排.处理统一媒体文件变更({
      currentTarget: input,
    } as unknown as Event);

    expect(处理选择媒体文件).toHaveBeenCalledWith([sourceFile]);
    expect(input.value).toBe("");
  });
});
