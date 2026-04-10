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

  it("纯文本发送会发 create_message，而不是旧的 send_text_message", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
      messageInput: "hello text",
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
      sendMessage(): Promise<void>;
    };

    编排.ensureRealtimeSocket("s-test");
    await 编排.sendMessage();

    expect(场景.transport.socket.sentEvents.at(-1)).toMatchObject({
      event: "create_message",
      payload: {
        room_id: "r-test",
        text: "hello text",
        attachment_ids: [],
      },
    });
  });

  it("带图片附件发送时不会插入本地伪权威消息，只会上送 create_message", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 3,
      messageInput: "带图消息",
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
    const 状态 = 场景.读取状态() as ReturnType<typeof 场景.读取状态> & {
      composerImageDrafts?: Array<{ attachmentId: string; status: string }>;
    };
    状态.composerImageDrafts = [
      {
        localId: "draft-1",
        kind: "image",
        attachmentId: "att-1",
        previewUrl: "https://example.com/thumb.png",
        width: 120,
        height: 90,
        status: "ready",
        fileName: "demo.png",
        errorCode: "",
      },
    ];
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
      sendMessage(): Promise<void>;
    };

    编排.ensureRealtimeSocket("s-test");
    await 编排.sendMessage();

    expect(场景.transport.socket.sentEvents.at(-1)).toMatchObject({
      event: "create_message",
      payload: {
        room_id: "r-test",
        text: "带图消息",
        attachment_ids: ["att-1"],
      },
    });
    expect(场景.读取状态().messages.map((message) => message.message_id)).toEqual(["m-1"]);
    expect(
      场景
        .读取状态()
        .messages.every((message) => !message.message_id.startsWith("local-"))
    ).toBe(true);
  });

  it("存在 uploading 图片草稿时不会上送 create_message", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 3,
      messageInput: "还在上传",
    });
    场景.读取状态().composerImageDrafts = [
      {
        localId: "draft-uploading",
        kind: "image",
        attachmentId: "",
        previewUrl: "blob:http://test.local/draft-uploading",
        width: 120,
        height: 90,
        status: "uploading",
        fileName: "uploading.png",
        errorCode: "",
      },
    ];
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
      sendMessage(): Promise<void>;
    };

    编排.ensureRealtimeSocket("s-test");
    await 编排.sendMessage();

    expect(场景.transport.socket.sentEvents).toEqual([]);
  });
});


