import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("页面骨架", () => {
  it("会锁定 html/body 为全屏深色壳层，不允许整页滚动", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8");

    expect(html).toContain("html,");
    expect(html).toContain("body");
    expect(html).toContain("margin: 0");
    expect(html).toContain("height: 100%");
    expect(html).toContain("overflow: hidden");
    expect(html).toContain("background: #171312");
  });
});
