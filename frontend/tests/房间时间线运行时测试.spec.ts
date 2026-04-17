// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

describe("房间时间线运行时", () => {
  it("快照、历史页和 realtime 追加会按同一 reducer 排序去重", async () => {
    const { 创建房间时间线Actor } = await import("../房间时间线运行时");

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
          body: "三",
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
          body: "一",
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
          body: "二",
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
          body: "四",
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
    const { 创建房间时间线Actor } = await import("../房间时间线运行时");

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
          body: "旧",
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
          body: "旧",
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
          body: "新",
          attachments: [],
          event_position: 2,
        },
      ],
    });

    const snapshot = actor.getSnapshot().context;

    expect(snapshot.messages.map((message) => message.message_id)).toEqual(["m-1", "m-2"]);
  });

  it("latestEventPosition 只会前进，不会被旧页或旧增量回退", async () => {
    const { 创建房间时间线Actor } = await import("../房间时间线运行时");

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
          body: "更早消息",
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
    const { 创建房间时间线Actor } = await import("../房间时间线运行时");

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
          body: "三",
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
