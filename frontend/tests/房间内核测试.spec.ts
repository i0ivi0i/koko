// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

describe("房间内核", () => {
  it("bootstrap 成功且没有待恢复房间时，会从引导中进入大厅中", async () => {
    const { 创建房间内核 } = await import("../房间内核");

    const 房间内核 = 创建房间内核();

    expect(房间内核.getSnapshot().value).toBe("引导中");

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "",
    });

    expect(房间内核.getSnapshot().value).toBe("大厅中");
  });
});
