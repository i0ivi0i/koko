// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("房间内核", () => {
  it("房间运行时 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = 读取前端源码("房间/运行时.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const realtimeSource = 读取前端源码("实时/应用.ts");
    const recoverySource = 读取前端源码("恢复/应用.ts");
    const recoveryShellSource = 读取前端源码("恢复/壳层/房间恢复编排.ts");
    const testHarnessSource = 读取前端源码("tests/common/聊天测试支架.ts");
    const roomScenarioSupportSource = 读取前端源码("tests/common/房间场景支撑.ts");

    expect(existsSync(resolve(process.cwd(), "房间内核.ts"))).toBe(false);
    expect(ownerSource).toContain("const 房间编排机 = createMachine(");
    expect(ownerSource).toContain("export function 创建房间内核()");
    expect(ownerSource).toContain("export function 派生房间壳外观(");
    expect(kernelSource).toContain('from "../房间/运行时.js"');
    expect(kernelSource).not.toContain('from "./房间内核.js"');
    expect(realtimeSource).toContain('from "../房间/运行时.js"');
    expect(realtimeSource).not.toContain('from "../房间内核.js"');
    expect(recoverySource).toContain('from "../房间/运行时.js"');
    expect(recoverySource).not.toContain('from "../房间内核.js"');
    expect(recoveryShellSource).toContain('from "../../房间/运行时.js"');
    expect(recoveryShellSource).not.toContain('from "../../房间内核.js"');
    expect(roomScenarioSupportSource).toContain('from "../../房间/运行时"');
    expect(roomScenarioSupportSource).not.toContain('from "../../房间内核"');
    expect(testHarnessSource).not.toContain('from "../../房间内核"');
  });

  it("不再承载视口真相字段和事件", () => {
    const source = readFileSync(resolve(process.cwd(), "房间/运行时.ts"), "utf8");

    expect(source).not.toContain("viewportMode");
    expect(source).not.toContain("candidateReadAnchorPosition");
    expect(source).not.toContain("hasUnreadNewerMessages");
    expect(source).not.toContain('type: "VIEWPORT_OBSERVED"');
    expect(source).not.toContain('type: "USER_JUMPED_TO_LATEST"');
    expect(source).not.toContain('type: "INITIAL_SETTLE_COMPLETED"');
  });

  it("bootstrap 成功且没有待恢复房间时，会从引导中进入大厅中", async () => {
    const { 创建房间内核 } = await import("../房间/运行时");

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
    const { 创建房间内核 } = await import("../房间/运行时");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-restore",
    });

    expect(房间内核.getSnapshot().value).toBe("恢复中");

    房间内核.send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-restore",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 5,
    });

    const 当前快照 = 房间内核.getSnapshot();

    expect(当前快照.value).toBe("房间就绪");
    expect(当前快照.context.roomId).toBe("r-restore");
    expect(当前快照.context.roomDisplayTitle).toBe("ROOM01");
  });

  it("权威事件推进后会刷新最新事件位置，避免重连时从旧锚点续接", async () => {
    const { 创建房间内核 } = await import("../房间/运行时");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-restore",
    });
    房间内核.send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-restore",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 5,
    });

    房间内核.send({
      type: "LATEST_EVENT_ADVANCED",
      latestEventPosition: 9,
    });

    expect(房间内核.getSnapshot().context.latestEventPosition).toBe(9);
  });

  it("恢复失败但要求保留房间可见时，会进入可重试失败且保留房间基线", async () => {
    const { 创建房间内核, 派生房间壳外观 } = await import("../房间/运行时");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-restore",
    });
    房间内核.send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-restore",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 8,
    });
    房间内核.send({
      type: "RECOVERY_FAILED",
      code: "socket_timeout",
      keepRoomVisible: true,
      roomInvalidated: false,
    });

    const 当前外观 = 派生房间壳外观(房间内核.getSnapshot());

    expect(当前外观.recoveryState).toBe("retryable_failure");
    expect(当前外观.roomId).toBe("r-restore");
    expect(当前外观.latestEventPosition).toBe(8);
    expect(当前外观.lastRecoveryErrorCode).toBe("socket_timeout");
    expect("viewportMode" in 当前外观).toBe(false);
  });

  it("恢复硬失效且不再保留房间时，会退出房间并回到空闲首页", async () => {
    const { 创建房间内核, 派生房间壳外观 } = await import("../房间/运行时");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-stale",
    });
    房间内核.send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-stale",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 8,
    });
    房间内核.send({
      type: "RECOVERY_FAILED",
      code: "room_not_found",
      keepRoomVisible: false,
      roomInvalidated: true,
    });

    const 当前快照 = 房间内核.getSnapshot();
    const 当前外观 = 派生房间壳外观(当前快照);

    expect(当前快照.value).toBe("已离房");
    expect(当前外观.recoveryState).toBe("idle");
    expect(当前外观.roomId).toBe("");
    expect(当前外观.roomDisplayTitle).toBe("");
    expect(当前外观.latestEventPosition).toBe(0);
    expect(当前外观.lastRecoveryErrorCode).toBe("");
  });

  it("恢复临时失败但没有可显示房间时，仍保留可重试失败语义", async () => {
    const { 创建房间内核, 派生房间壳外观 } = await import("../房间/运行时");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-retry",
    });
    房间内核.send({
      type: "RECOVERY_FAILED",
      code: "system_error",
      keepRoomVisible: false,
      roomInvalidated: false,
    });

    const 当前外观 = 派生房间壳外观(房间内核.getSnapshot());

    expect(房间内核.getSnapshot().value).toBe("可重试失败");
    expect(当前外观.recoveryState).toBe("retryable_failure");
    expect(当前外观.roomId).toBe("");
    expect(当前外观.lastRecoveryErrorCode).toBe("system_error");
  });

  it("软离房后会清空当前房间，但保留当前会话身份", async () => {
    const { 创建房间内核, 派生房间壳外观 } = await import("../房间/运行时");

    const 房间内核 = 创建房间内核();

    房间内核.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s-test",
      displayAlias: "暴躁的企鹅",
      roomId: "r-restore",
    });
    房间内核.send({
      type: "SNAPSHOT_LOADED",
      roomId: "r-restore",
      roomDisplayTitle: "ROOM01",
      latestEventPosition: 8,
    });
    房间内核.send({
      type: "SOFT_LEAVE_REQUESTED",
    });

    const 当前外观 = 派生房间壳外观(房间内核.getSnapshot());

    expect(房间内核.getSnapshot().value).toBe("已离房");
    expect(当前外观.sessionId).toBe("s-test");
    expect(当前外观.displayAlias).toBe("暴躁的企鹅");
    expect(当前外观.roomId).toBe("");
    expect(当前外观.roomDisplayTitle).toBe("");
    expect(当前外观.latestEventPosition).toBe(0);
  });
});
