// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  创建传输错误,
  创建实时编排测试场景,
  读取房间实时编排工厂,
} from "./common/聊天测试支架";
describe("房间实时编排", () => {
  it("实时应用 owner 直接提供房间实时编排旧命名收口，旧根入口已删除", () => {
    const source = readFileSync(resolve(process.cwd(), "实时/应用.ts"), "utf8");

    expect(existsSync(resolve(process.cwd(), "房间实时编排.ts"))).toBe(false);
    expect(source).toContain("export const 创建房间实时编排 = 创建实时应用;");
    expect(source).toContain("export type 房间实时编排依赖 = 实时应用依赖;");
    expect(source).toContain("export type 房间实时编排端口 = 实时应用端口;");
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
    // 模拟服务端拒绝：active=false 才会触发处理连接错误
    场景.transport.socket.active = false;
    场景.transport.socket.trigger("connect_error", 创建传输错误(401, "invalid_session"));

    expect(场景.transportErrors).toEqual([{ kind: "invalid_session", keepRoomVisible: true }]);
    expect(场景.realtimeSessionEvents).toContainEqual({
      type: "SOCKET_DISCONNECTED",
      code: "invalid_session",
    });
    expect(场景.transport.bootstrapTokens).toEqual([]);
    expect(场景.recoveryFailures).toEqual([]);
  });

  it("运行时挂起导致的 socket disconnect 会标记为 runtime_suspend", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const transport = 场景.transport as typeof 场景.transport & {
      读取Socket运行时挂起状态?(socket: unknown): boolean;
    };
    transport.读取Socket运行时挂起状态 = () => true;
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
    };

    编排.ensureRealtimeSocket("s-test");
    场景.transport.socket.trigger("disconnect", "io client disconnect");

    expect(场景.realtimeSessionEvents).toContainEqual({
      type: "SOCKET_DISCONNECTED",
      code: "io client disconnect",
      source: "runtime_suspend",
    });
  });

  it("普通 socket disconnect 会标记为 temporary_transport", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
    };

    编排.ensureRealtimeSocket("s-test");
    场景.transport.socket.trigger("disconnect", "transport close");

    expect(场景.realtimeSessionEvents).toContainEqual({
      type: "SOCKET_DISCONNECTED",
      code: "transport close",
      source: "temporary_transport",
    });
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

  it("附件ready升级事件会在更新时间线后触发升级副作用", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
      messages: [
        {
          type: "message_created",
          room_id: "r-test",
          message_id: "m-video",
          client_message_id: "c-video",
          sender_session_id: "s-other",
          sender_display_alias: "冷静的水獭",
          text: "",
          event_position: 1,
          attachments: [
            {
              kind: "video",
              attachment_id: "att-video",
              width: 1920,
              height: 1080,
              status: "processing",
            },
          ],
        },
      ],
    });
    const 接收附件升级后副作用 = vi.fn();
    const 编排 = 创建房间实时编排({
      ...场景.deps,
      接收附件升级后副作用,
    }) as {
      ensureRealtimeSocket(sessionId: string): void;
    };

    编排.ensureRealtimeSocket("s-test");
    场景.transport.socket.trigger("room_event", {
      type: "attachment_status_changed",
      room_id: "r-test",
      message_id: "m-video",
      attachment_id: "att-video",
      status: "ready",
      event_position: 2,
      attachment: {
        kind: "video",
        attachment_id: "att-video",
        width: 1920,
        height: 1080,
        status: "ready",
        has_preview_asset: false,
        distribution_hint: {
          content_hash: "hash-att-video",
          swarm_id: "swarm-att-video",
          torrent_info_hash: "ih-att-video",
          web_seed_until: 9999999999,
          join_ticket: "test-ticket",
          announce_urls: ["wss://tracker.example.test/announce"],
          torrent_url: "/api/media/att-video/torrent?ticket=test-ticket",
          web_seed_url: null,
          ice_servers: [],
        },
      },
    });

    expect(场景.读取状态().messages[0]?.attachments?.[0]).toMatchObject({
      attachment_id: "att-video",
      status: "ready",
      distribution_hint: expect.objectContaining({
        join_ticket: "test-ticket",
        announce_urls: ["wss://tracker.example.test/announce"],
      }),
    });
    expect(接收附件升级后副作用).toHaveBeenCalledTimes(1);
    expect(接收附件升级后副作用).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "attachment_status_changed",
        attachment_id: "att-video",
        status: "ready",
      })
    );
  });

  it("powRequired=false 时建连不请求 PoW token", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 获取PowToken = vi.fn(async () => "should-not-be-used");
    const createSocket = vi.spyOn(场景.transport, "createSocket");
    场景.transport.获取PowToken = 获取PowToken;
    场景.transport.读取运行时策略 = () => ({
      intent: "resume",
      reconnection: true,
      reason: "active",
      powRequired: false,
    });
    const 编排 = 创建房间实时编排({
      ...场景.deps,
    }) as {
      ensureRealtimeSocket(sessionId: string): Promise<void>;
    };

    await 编排.ensureRealtimeSocket("s-test");

    expect(获取PowToken).not.toHaveBeenCalled();
    expect(createSocket).toHaveBeenCalledWith("s-test", undefined);
  });

  it("powRequired=true 时建连会带 PoW token", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 获取PowToken = vi.fn(async () => "pow-token-1");
    const createSocket = vi.spyOn(场景.transport, "createSocket");
    场景.transport.获取PowToken = 获取PowToken;
    场景.transport.读取运行时策略 = () => ({
      intent: "resume",
      reconnection: true,
      reason: "active",
      powRequired: true,
    });
    const 编排 = 创建房间实时编排({
      ...场景.deps,
    }) as {
      ensureRealtimeSocket(sessionId: string): Promise<void>;
    };

    await 编排.ensureRealtimeSocket("s-test");

    expect(获取PowToken).toHaveBeenCalledTimes(1);
    expect(createSocket).toHaveBeenCalledWith("s-test", "pow-token-1");
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

  it("ensureRealtimeSocket 在 socket.connected=false 时应释放旧 socket 并重建", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): Promise<void>;
    };

    // 第一次建连
    await 编排.ensureRealtimeSocket("s-test");
    expect(场景.transport.socketSessionIds).toHaveLength(1);

    // 模拟 socket 已断开（connected=false），如后台超时被服务端踢掉
    场景.transport.socket.connected = false;

    // 再次 ensure：应释放旧 socket 并创建新 socket
    await 编排.ensureRealtimeSocket("s-test");
    expect(场景.transport.释放Socket调用次数).toBe(1);
    expect(场景.transport.socketSessionIds).toHaveLength(2);
  });

  it("connect_error 且 socket.active=false 时应升级到 Transport 异常", async () => {
    const 创建房间实时编排 = await 读取房间实时编排工厂();
    const 场景 = 创建实时编排测试场景({
      roomId: "r-test",
      latestEventPosition: 1,
    });
    const 编排 = 创建房间实时编排(场景.deps) as {
      ensureRealtimeSocket(sessionId: string): void;
    };

    编排.ensureRealtimeSocket("s-test");
    // 模拟服务端拒绝（非 invalid_session），socket.active=false
    场景.transport.socket.active = false;
    场景.transport.socket.trigger("connect_error", 创建传输错误(500, "system_error"));

    // 应上报 Transport 异常（走 session refresh 路径）
    expect(场景.transportErrors.length).toBeGreaterThan(0);
    expect(场景.realtimeSessionEvents).toContainEqual(
      expect.objectContaining({ type: "SOCKET_DISCONNECTED", code: "system_error" })
    );
  });
});

describe("createSocket reconnection 硬编码", () => {
  it("实时连接适配 createSocket 始终传 reconnection:true，不受运行时策略影响", () => {
    const source = readFileSync(
      resolve(process.cwd(), "聊天实时/适配/实时连接适配.ts"),
      "utf8"
    );
    // createSocket 方法体中必须硬编码 reconnection: true，
    // 而不是引用 this.当前运行时策略.reconnection
    const createSocketBody = source.slice(
      source.indexOf("createSocket("),
      source.indexOf("}", source.indexOf("createSocket(") + 200) + 1
    );
    expect(createSocketBody).toContain("reconnection: true");
    expect(createSocketBody).not.toContain("this.当前运行时策略.reconnection");
  });
});

describe("session refresh 门闩", () => {
  it("sessionRefreshInProgress 为 true 时 处理实时会话变化 不触发重订阅", async () => {
    const { 聊天应用编排协调器 } = await import("../应用根/聊天应用编排协调器.js");

    let ensureSocketCalled = false;
    const mockDeps = {
      创建恢复编排依赖: () => ({}),
      创建实时编排依赖: () => ({}),
      创建阅读推进依赖: () => ({}),
    };
    const coordinator = new 聊天应用编排协调器(mockDeps as any);

    // 替换 ensureRealtimeSocket 以检测是否被调用
    (coordinator as any).读取实时编排 = () => ({
      ensureRealtimeSocket: async () => { ensureSocketCalled = true; },
      subscribeRoom: () => { ensureSocketCalled = true; },
    });

    // 模拟 needsResubscribe 变为 true 的快照对
    const before = { context: { needsResubscribe: false, roomId: "r1", sessionId: "s1", latestEventPosition: 5, backgroundDrainPending: false } };
    const after = { context: { needsResubscribe: true, roomId: "r1", sessionId: "s1", latestEventPosition: 5, backgroundDrainPending: false } };

    // 设置 session refresh 门闩
    coordinator.标记SessionRefresh进行中(true);
    await coordinator.处理实时会话变化(before as any, after as any);

    // 断言：不应触发 ensureRealtimeSocket/subscribeRoom
    expect(ensureSocketCalled).toBe(false);
  });
});

describe("房间编排机超时退出", () => {
  it("重连中状态收到 RECONNECT_TIMEOUT 应转入可重试失败", async () => {
    const { 创建房间内核 } = await import("../房间/运行时.js");
    const actor = 创建房间内核();

    // 推进到"重连中"：引导成功 → 恢复中 → RECONNECTING_STARTED → 重连中
    actor.send({
      type: "BOOTSTRAP_SUCCEEDED",
      sessionId: "s1",
      displayAlias: "user1",
      roomId: "r1",
    });
    actor.send({ type: "RECONNECTING_STARTED", code: "transport_close" });
    expect(actor.getSnapshot().value).toBe("重连中");

    // 发送超时事件
    actor.send({ type: "RECONNECT_TIMEOUT" } as any);
    expect(actor.getSnapshot().value).toBe("可重试失败");
    expect(actor.getSnapshot().context.lastRecoveryErrorCode).toBe("reconnect_timeout");
  });

  it("重连超时看门狗：进入重连中 15s 后自动派发 RECONNECT_TIMEOUT", async () => {
    vi.useFakeTimers();
    try {
      const { 创建房间内核 } = await import("../房间/运行时.js");
      const { 创建重连超时看门狗 } = await import("../房间/重连超时看门狗.js");
      const actor = 创建房间内核();
      const watchdog = 创建重连超时看门狗(actor, { timeoutMs: 15_000 });

      // 引导 → 恢复中
      actor.send({
        type: "BOOTSTRAP_SUCCEEDED",
        sessionId: "s1",
        displayAlias: "user1",
        roomId: "r1",
      });
      // 进入重连中 → 看门狗应启动
      actor.send({ type: "RECONNECTING_STARTED", code: "transport_close" });
      watchdog.进入重连中();
      expect(actor.getSnapshot().value).toBe("重连中");

      // 14s 后仍在重连中
      vi.advanceTimersByTime(14_000);
      expect(actor.getSnapshot().value).toBe("重连中");

      // 15s 后应自动转入可重试失败
      vi.advanceTimersByTime(1_000);
      expect(actor.getSnapshot().value).toBe("可重试失败");
      expect(actor.getSnapshot().context.lastRecoveryErrorCode).toBe("reconnect_timeout");

      watchdog.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("重连中恢复成功时看门狗应清除计时器", async () => {
    vi.useFakeTimers();
    try {
      const { 创建房间内核 } = await import("../房间/运行时.js");
      const { 创建重连超时看门狗 } = await import("../房间/重连超时看门狗.js");
      const actor = 创建房间内核();
      const watchdog = 创建重连超时看门狗(actor, { timeoutMs: 15_000 });

      actor.send({
        type: "BOOTSTRAP_SUCCEEDED",
        sessionId: "s1",
        displayAlias: "user1",
        roomId: "r1",
      });
      actor.send({ type: "RECONNECTING_STARTED", code: "transport_close" });
      watchdog.进入重连中();

      // 5s 后恢复成功
      vi.advanceTimersByTime(5_000);
      actor.send({
        type: "SUBSCRIPTION_ESTABLISHED",
        latestEventPosition: 10,
      });
      watchdog.离开重连中();

      // 继续推进到 15s，不应该再触发超时
      vi.advanceTimersByTime(10_000);
      expect(actor.getSnapshot().value).toBe("在线会话中");

      watchdog.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("session refresh 进行中时看门狗续等而非触发超时", async () => {
    vi.useFakeTimers();
    try {
      const { 创建房间内核 } = await import("../房间/运行时.js");
      const { 创建重连超时看门狗 } = await import("../房间/重连超时看门狗.js");
      const actor = 创建房间内核();
      let refreshing = true;
      const watchdog = 创建重连超时看门狗(actor, {
        timeoutMs: 15_000,
        是否在刷新会话: () => refreshing,
      });

      actor.send({
        type: "BOOTSTRAP_SUCCEEDED",
        sessionId: "s1",
        displayAlias: "user1",
        roomId: "r1",
      });
      actor.send({ type: "RECONNECTING_STARTED", code: "transport_close" });
      watchdog.进入重连中();

      // 第一轮 15s 到期 — session refresh 进行中，应续等
      vi.advanceTimersByTime(15_000);
      expect(actor.getSnapshot().value).toBe("重连中");

      // 第二轮中途 session refresh 完成
      vi.advanceTimersByTime(5_000);
      refreshing = false;

      // 剩余 10s 到期 — 此时才真正触发 RECONNECT_TIMEOUT
      vi.advanceTimersByTime(10_000);
      expect(actor.getSnapshot().value).toBe("可重试失败");

      watchdog.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
