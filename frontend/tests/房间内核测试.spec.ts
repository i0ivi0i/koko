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

  it("刷新恢复时会先进入恢复中，拿到快照后再进入房间就绪", async () => {
    const { 创建房间内核 } = await import("../房间内核");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-restore",
    });

    expect(房间内核.getSnapshot().value).toBe("恢复中");

    (房间内核 as { send(event: unknown): void }).send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-restore",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 5,
    });

    const 当前快照 = 房间内核.getSnapshot();

    expect(当前快照.value).toBe("房间就绪");
    expect(当前快照.context.roomId).toBe("r-restore");
    expect((当前快照.context as { roomDisplayTitle?: string }).roomDisplayTitle).toBe("ROOM01");
  });

  it("权威事件推进后会刷新最新事件位置，避免重连时从旧锚点续接", async () => {
    const { 创建房间内核 } = await import("../房间内核");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-restore",
    });
    (房间内核 as { send(event: unknown): void }).send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-restore",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 5,
    });

    (房间内核 as { send(event: unknown): void }).send({
      type: "LATEST_EVENT_ADVANCED",
      latestEventPosition: 9,
    });

    expect((房间内核.getSnapshot().context as { latestEventPosition?: number }).latestEventPosition).toBe(9);
  });
});
