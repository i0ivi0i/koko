// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  创建传输错误,
  创建实时编排测试场景,
  读取房间实时编排工厂,
} from "./common/聊天测试支架";
describe("房间实时编排", () => {
  it("旧房间实时编排文件必须退成实时应用门面", () => {
    const source = readFileSync(resolve(process.cwd(), "房间实时编排.ts"), "utf8");

    expect(source).toContain('from "./实时/应用.js"');
    expect(source).toContain("创建实时应用");
    expect(source).not.toContain("let realtimeSocket");
    expect(source).not.toContain("function ensureRealtimeSocket");
  });

  it("socket 回调不会直接宣布 reconnecting，而是先回灌给 realtime owner", () => {
    const source = readFileSync(resolve(process.cwd(), "实时/应用.ts"), "utf8");

    expect(source).toContain("接收实时会话事实");
    expect(source).not.toContain('type: "RECONNECTING_STARTED"');
    expect(source).not.toContain("function 读取实时状态()");
    expect(source).not.toContain("function 写入实时状态(");
    expect(source).not.toContain("function 接收时间线事实(");
  });

  it("只依赖聊天 realtime 窄接口，而不再声明完整前端传输端口", () => {
    const source = readFileSync(resolve(process.cwd(), "实时/应用.ts"), "utf8");

    expect(source).toContain('from "../聊天共享/适配/聊天实时连接端口.js"');
    expect(source).not.toContain("type 前端传输端口");
  });

  it("会把 connect_error 和 control_result 翻译委托给 实时控制面协作", () => {
    const source = readFileSync(resolve(process.cwd(), "实时/应用.ts"), "utf8");

    expect(source).toContain('from "../聊天实时/壳层/实时控制面协作.js"');
    expect(source).toContain("处理连接错误(");
    expect(source).toContain("处理实时控制面结果(");
    expect(source).not.toContain("async function handleConnectError");
    expect(source).not.toContain("async function handleControlResult");
  });

  it("会把离线补发登记与重放委托给 待补发消息协作", () => {
    const source = readFileSync(resolve(process.cwd(), "实时/应用.ts"), "utf8");

    expect(source).toContain('from "../聊天实时/壳层/待补发消息协作.js"');
    expect(source).toContain("登记待补发创建消息(");
    expect(source).toContain("重放待补发创建消息(");
    expect(source).not.toContain("dedupeKey: clientMessageId");
    expect(source).not.toContain("const payload = task.payload as");
  });

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
    expect(场景.realtimeSessionEvents).toContainEqual({
      type: "SOCKET_DISCONNECTED",
      code: "invalid_session",
    });
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

    expect(场景.realtimeSessionEvents).toContainEqual({
      type: "SUBSCRIPTION_ESTABLISHED",
      latestEventPosition: 5,
    });
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
          text: "已有消息",
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
          text: "已有消息",
          event_position: 1,
        },
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-2",
          client_message_id: "c-2",
          sender_session_id: "s-test",
          sender_display_alias: "暴躁的企鹅",
          text: "新增消息",
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

  it("实时通道不可用时会登记待补发任务，并请求后台补发同步", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
      messageInput: "offline draft",
    });
    const 待补发任务: Array<Record<string, unknown>> = [];
    const 同步请求标识: string[] = [];
    const 编排 = 创建房间实时编排({
      ...场景.deps,
      登记待补发任务: async (task: Record<string, unknown>) => {
        待补发任务.push(task);
        return true;
      },
      请求后台补发同步: async (tag: string) => {
        同步请求标识.push(tag);
        return true;
      },
      读取当前时间: () => 100,
    }) as {
      sendMessage(): Promise<void>;
    };

    // 不建立 realtime socket，模拟页面离线 / socket 未就绪场景。
    await 编排.sendMessage();

    expect(场景.transport.socket.sentEvents).toEqual([]);
    expect(待补发任务).toEqual([
      expect.objectContaining({
        kind: "create_message",
        createdAt: 100,
        retryAt: 100,
      }),
    ]);
    expect(同步请求标识).toEqual(["koko-queue-main"]);
    expect(场景.读取状态().messageInput).toBe("");
  });

  it("排空离线任务时会走当前 realtime 通道重放 create_message", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
      重放待补发任务(task: {
        id: string;
        kind: "create_message";
        payload: unknown;
        createdAt: number;
        retryAt: number;
      }): Promise<"done" | "retry">;
    };

    编排.ensureRealtimeSocket("s-test");
    const result = await 编排.重放待补发任务({
      id: "offline-c-1",
      kind: "create_message",
      payload: {
        roomId: "r-test",
        clientMessageId: "c-1",
        text: "retry hello",
        attachmentIds: [],
      },
      createdAt: 1,
      retryAt: 1,
    });

    expect(result).toBe("done");
    expect(场景.transport.socket.sentEvents.at(-1)).toMatchObject({
      event: "create_message",
      payload: {
        room_id: "r-test",
        client_message_id: "c-1",
        text: "retry hello",
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
          text: "已有消息",
          event_position: 1,
        },
      ],
    });
    const 状态 = 场景.读取状态() as ReturnType<typeof 场景.读取状态> & {
      composerMediaDrafts?: Array<{ attachmentId: string; status: string }>;
    };
    状态.composerMediaDrafts = [
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

  it("ready 视频草稿会被提取成 attachment_ids", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 3,
      messageInput: "带视频消息",
    });
    (
      场景.读取状态() as ReturnType<typeof 场景.读取状态> & {
        composerMediaDrafts?: Array<{
          localId: string;
          kind: "video";
          attachmentId: string;
          previewUrl: string;
          width: number;
          height: number;
          status: string;
          fileName: string;
          errorCode: string;
        }>;
      }
    ).composerMediaDrafts = [
      {
        localId: "draft-video-1",
        kind: "video",
        attachmentId: "att-video-1",
        previewUrl: "blob:http://test.local/draft-video-1",
        width: 1280,
        height: 720,
        status: "ready",
        fileName: "demo.mp4",
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
        text: "带视频消息",
        attachment_ids: ["att-video-1"],
      },
    });
  });

  it("存在 transporting 图片草稿时不会上送 create_message", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 3,
      messageInput: "还在上传",
    });
    场景.读取状态().composerMediaDrafts = [
      {
        localId: "draft-uploading",
        kind: "image",
        attachmentId: "",
        previewUrl: "blob:http://test.local/draft-uploading",
        width: 120,
        height: 90,
        status: "transporting",
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

  it("存在 transporting 视频草稿时不会上送 create_message", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 3,
      messageInput: "视频还在上传",
    });
    (
      场景.读取状态() as ReturnType<typeof 场景.读取状态> & {
        composerMediaDrafts?: Array<{
          localId: string;
          kind: "video";
          attachmentId: string;
          previewUrl: string;
          width: number;
          height: number;
          status: string;
          fileName: string;
          errorCode: string;
        }>;
      }
    ).composerMediaDrafts = [
      {
        localId: "draft-video-uploading",
        kind: "video",
        attachmentId: "",
        previewUrl: "blob:http://test.local/draft-video-uploading",
        width: 1280,
        height: 720,
        status: "transporting",
        fileName: "uploading.mp4",
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


