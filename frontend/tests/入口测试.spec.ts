// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../聊天壳.js", () => ({}));
vi.mock("../后台壳.js", () => ({}));

const 启动平台 = vi.fn();

vi.mock("../平台/index.js", () => ({
  获取默认浏览器应用平台: () => ({
    启动: 启动平台,
  }),
}));

describe("前端入口", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    启动平台.mockReset();
  });

  it("入口会通过浏览器应用平台统一启动运行时，而不是自己直调浏览器 API", async () => {
    await import("../入口");

    expect(启动平台).toHaveBeenCalledTimes(1);
  });
});
