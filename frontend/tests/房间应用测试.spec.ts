import { describe, expect, it, vi } from "vitest";

import {
  处理历史房间进房请求,
  处理房间号输入变更,
  处理进房请求,
} from "../房间/应用.js";

describe("房间应用", () => {
  it("进房请求会裁剪显式房间号后再触发 join", async () => {
    const 写入房间号输入 = vi.fn();
    const 触发进房 = vi.fn().mockResolvedValue(undefined);

    await 处理进房请求({
      roomCode: "  1234b  ",
      写入房间号输入,
      触发进房,
    });

    expect(写入房间号输入).toHaveBeenCalledWith("1234b");
    expect(触发进房).toHaveBeenCalledTimes(1);
  });

  it("历史房间进房遇到空白短码时会直接拒绝，不再把脏值交给恢复编排", async () => {
    const 写入房间号输入 = vi.fn();
    const 触发进房 = vi.fn().mockResolvedValue(undefined);

    await 处理历史房间进房请求({
      roomCode: "   ",
      写入房间号输入,
      触发进房,
    });

    expect(写入房间号输入).not.toHaveBeenCalled();
    expect(触发进房).not.toHaveBeenCalled();
  });

  it("房间号输入变化只负责写入输入框 owner，不越层触发 join", () => {
    const 写入房间号输入 = vi.fn();

    处理房间号输入变更({
      value: "ROOM01",
      写入房间号输入,
    });

    expect(写入房间号输入).toHaveBeenCalledWith("ROOM01");
  });
});
