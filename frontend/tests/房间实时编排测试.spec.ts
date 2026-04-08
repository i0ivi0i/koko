// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  创建传输错误,
  创建实时编排测试场景,
  读取房间实时编排工厂,
} from "./common/聊天测试支架";
describe("房间实时编排", () => {
  it("connect_error invalid_session 只上报 transport 异常，不自己刷新会话", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
    };

    编排.ensureRealtimeSocket("s-test");
    场景.transport.socket.trigger("connect_error", 创建传输错误(401, "invalid_session"));

    expect(场景.transportErrors).toEqual([{ kind: "invalid_session" }]);
    expect(场景.transport.bootstrapTokens).toEqual([]);
    expect(场景.recoveryFailures).toEqual([]);
  });

  it("control_result subscribed 会推进订阅建立事件", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
      subscribeRoom(from: number): void;
    };

    场景.transport.socket.subscribeResults = [
      {
        kind: "subscribed",
        latest_event_position: 5,
      },
    ];
    编排.ensureRealtimeSocket("s-test");
    编排.subscribeRoom(1);

    expect(场景.读取状态().latestEventPosition).toBe(5);
    expect(场景.读取状态().recoveryState).toBe("idle");
  });

  it("权威事件并入时会保持 message_id 去重", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          body: "已有消息",
          event_position: 1,
        },
      ],
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
    };

    编排.ensureRealtimeSocket("s-test");
    场景.transport.socket.trigger("room_events", {
      latest_event_position: 3,
      events: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-1",
          client_message_id: "c-1-dup",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          body: "已有消息",
          event_position: 1,
        },
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-2",
          client_message_id: "c-2",
          sender_session_id: "s-test",
          sender_display_alias: "暴躁的企鹅",
          body: "新增消息",
          event_position: 2,
        },
      ],
    });

    expect(场景.读取状态().messages.map((message) => message.message_id)).toEqual(["m-1", "m-2"]);
  });
});


