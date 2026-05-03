// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const 读取前端源码 = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("房间时间线运行时", () => {
  it("时间线运行时 owner 直连生效，旧根入口已经删除", () => {
    const ownerSource = 读取前端源码("时间线/运行时.ts");
    const kernelSource = 读取前端源码("总装/聊天应用内核.ts");
    const realtimeSource = 读取前端源码("实时/应用.ts");
    const recoverySource = 读取前端源码("恢复/应用.ts");
    const recoveryShellSource = 读取前端源码("恢复/壳层/房间恢复编排.ts");
    const readProgressSource = 读取前端源码("房间/壳层/阅读推进.ts");
    const testHarnessSource = 读取前端源码("tests/common/聊天测试支架.ts");
    const roomScenarioSupportSource = 读取前端源码("tests/common/房间场景支撑.ts");

    expect(existsSync(resolve(process.cwd(), "房间时间线运行时.ts"))).toBe(false);
    expect(ownerSource).toContain("const 房间时间线机 = createMachine(");
    expect(ownerSource).toContain("export function 创建房间时间线Actor()");
    expect(kernelSource).toContain('from "../时间线/运行时.js"');
    expect(kernelSource).not.toContain('from "./房间时间线运行时.js"');
    expect(realtimeSource).toContain('from "../时间线/运行时.js"');
    expect(realtimeSource).not.toContain('from "../房间时间线运行时.js"');
    expect(recoverySource).toContain('from "../时间线/运行时.js"');
    expect(recoverySource).not.toContain('from "../房间时间线运行时.js"');
    expect(recoveryShellSource).toContain('from "../../时间线/运行时.js"');
    expect(recoveryShellSource).not.toContain('from "../../房间时间线运行时.js"');
    expect(readProgressSource).toContain('from "../../时间线/运行时.js"');
    expect(readProgressSource).not.toContain('from "../../房间时间线运行时.js"');
    expect(roomScenarioSupportSource).toContain('from "../../时间线/运行时"');
    expect(roomScenarioSupportSource).not.toContain('from "../../房间时间线运行时"');
    expect(testHarnessSource).not.toContain('from "../../房间时间线运行时"');
  });

  it("快照、历史页和 realtime 追加会按同一 reducer 排序去重", async () => {
    const { 创建房间时间线Actor } = await import("../时间线/运行时");

    const actor = 创建房间时间线Actor();

    actor.send({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      latestEventPosition: 3,
      hasMoreBefore: true,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-3",
          client_message_id: "c-3",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "三",
          attachments: [],
          event_position: 3,
        },
      ],
    });
    actor.send({
      type: "HISTORY_PAGE_APPENDED",
      hasMoreBefore: false,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "一",
          attachments: [],
          event_position: 1,
        },
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-2",
          client_message_id: "c-2",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "二",
          attachments: [],
          event_position: 2,
        },
      ],
    });
    actor.send({
      type: "REALTIME_EVENTS_RECEIVED",
      latestEventPosition: 4,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-4",
          client_message_id: "c-4",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "四",
          attachments: [],
          event_position: 4,
        },
      ],
    });

    const snapshot = actor.getSnapshot().context;

    expect(snapshot.messages.map((message) => message.event_position)).toEqual([1, 2, 3, 4]);
    expect(snapshot.hasMoreBefore).toBe(false);
    expect(snapshot.latestEventPosition).toBe(4);
  });

  it("重复事件不会因为 snapshot 和 realtime 并流而插出双份消息", async () => {
    const { 创建房间时间线Actor } = await import("../时间线/运行时");

    const actor = 创建房间时间线Actor();

    actor.send({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      latestEventPosition: 2,
      hasMoreBefore: true,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "旧",
          attachments: [],
          event_position: 1,
        },
      ],
    });
    actor.send({
      type: "REALTIME_EVENTS_RECEIVED",
      latestEventPosition: 2,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1-realtime",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "旧",
          attachments: [],
          event_position: 1,
        },
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-2",
          client_message_id: "c-2",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "新",
          attachments: [],
          event_position: 2,
        },
      ],
    });

    const snapshot = actor.getSnapshot().context;

    expect(snapshot.messages.map((message) => message.message_id)).toEqual(["m-1", "m-2"]);
  });

  it("latestEventPosition 只会前进，不会被旧页或旧增量回退", async () => {
    const { 创建房间时间线Actor } = await import("../时间线/运行时");

    const actor = 创建房间时间线Actor();

    actor.send({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      latestEventPosition: 8,
      hasMoreBefore: true,
      messages: [],
    });
    actor.send({
      type: "HISTORY_PAGE_APPENDED",
      hasMoreBefore: true,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-3",
          client_message_id: "c-3",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "更早消息",
          attachments: [],
          event_position: 3,
        },
      ],
    });
    actor.send({
      type: "REALTIME_EVENTS_RECEIVED",
      latestEventPosition: 7,
      messages: [],
    });

    expect(actor.getSnapshot().context.latestEventPosition).toBe(8);
  });

  it("软重置会清空当前房间时间线事实", async () => {
    const { 创建房间时间线Actor } = await import("../时间线/运行时");

    const actor = 创建房间时间线Actor();

    actor.send({
      type: "AUTHORITATIVE_SNAPSHOT_LOADED",
      latestEventPosition: 3,
      hasMoreBefore: true,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-3",
          client_message_id: "c-3",
          sender_session_id: "s-peer",
          sender_display_alias: "冷静的水獭",
          text: "三",
          attachments: [],
          event_position: 3,
        },
      ],
    });
    actor.send({ type: "ROOM_SOFT_RESET" });

    expect(actor.getSnapshot().context).toMatchObject({
      messages: [],
      latestEventPosition: 0,
      hasMoreBefore: false,
    });
  });
});
