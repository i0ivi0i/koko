import { beforeEach,describe,expect,it,vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));

import { 创建前端传输 } from "../平台/传输";
import type { 匿名身份快照 } from "../聊天共享/契约";

const 创建测试传输 = () => 创建前端传输("http://localhost:3000");

describe("传输 / 会话与房间链路", () => {
  beforeEach(() => {
    ioSpy.mockClear();
    vi.restoreAllMocks();
  });

  it("socket连接配置只显式声明当前可安全启用的连接策略", () => {
    const transport = 创建测试传输();

    transport.createSocket("s-auth");

    expect(ioSpy).toHaveBeenCalledWith("http://localhost:3000", {
      transports: ["websocket"],
      reconnection: true,
      autoConnect: true,
      auth: { session_id: "s-auth" },
    });
  });
  it("运行时策略切到挂起时会暂停现有 socket，恢复后再继续连接", () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    ioSpy.mockReturnValue({
      connect,
      disconnect,
    } as never);
    const transport = 创建测试传输();
    const realtimeTransport = transport as typeof transport & {
      接收运行时策略(policy: {
        intent: "resume" | "suspend";
        reconnection: boolean;
        reason: "active" | "background" | "page_hidden";
      }): void;
      读取运行时策略(): {
        intent: "resume" | "suspend";
        reconnection: boolean;
        reason: "active" | "background" | "page_hidden";
      };
      释放Socket(socket: unknown): void;
    };

    const socket = transport.createSocket("s-auth");
    realtimeTransport.接收运行时策略({
      intent: "suspend",
      reconnection: false,
      reason: "page_hidden",
    });
    realtimeTransport.接收运行时策略({
      intent: "resume",
      reconnection: true,
      reason: "active",
    });
    realtimeTransport.释放Socket(socket);

    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(realtimeTransport.读取运行时策略()).toEqual({
      intent: "resume",
      reconnection: true,
      reason: "active",
    });
  });
  it("bootstrap_anonymous_identity returns only the public alias snapshot", () => {
    const snapshot: 匿名身份快照 = {
      display_alias: "暴躁的企鹅",
    };

    expect(snapshot.display_alias).toBe("暴躁的企鹅");
    expect("anonymous_identity_id" in snapshot).toBe(false);
  });
  it("以 device_anonymous_token 调用 bootstrap_anonymous_identity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          display_alias: "暴躁的企鹅",
          session_id: "s-1",
          pow_required: false,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();

    const result = await transport.bootstrapAnonymousIdentity("device-token-1");

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:3000/api/session/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_anonymous_token: "device-token-1" }),
    });
    expect(result.display_alias).toBe("暴躁的企鹅");
    expect(result.session_id).toBe("s-1");
    expect(result.pow_required).toBe(false);
    expect(transport.读取运行时策略?.()).toEqual(
      expect.objectContaining({ powRequired: false })
    );
    transport.接收运行时策略?.({
      intent: "suspend",
      reconnection: false,
      reason: "background",
    });
    expect(transport.读取运行时策略?.()).toEqual(
      expect.objectContaining({
        intent: "suspend",
        powRequired: false,
      })
    );
    expect("anonymous_identity_id" in result).toBe(false);
  });
  it("loadRoomEvents 会把 session_id 和 from 一起编码进 query string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          room_id: "r-1",
          latest_event_position: 7,
          events: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();

    await transport.loadRoomEvents("r-1", "s-1", 6);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/rooms/r-1/events?session_id=s-1&from=6",
      { headers: {} }
    );
  });
  it("loadRoomSnapshot 会返回阅读锚点相关字段", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          room_id: "r-1",
          latest_event_position: 9,
          last_read_event_position: 4,
          first_unread_event_position: 5,
          snapshot_messages: [],
          has_more_before: true,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();

    const snapshot = await transport.loadRoomSnapshot("r-1", "s-1");

    expect(snapshot.last_read_event_position).toBe(4);
    expect(snapshot.first_unread_event_position).toBe(5);
    expect(snapshot.snapshot_messages).toEqual([]);
    expect(snapshot.has_more_before).toBe(true);
  });
  it("loadRoomSnapshot 会把视频附件 preview_asset.still_url 收口成绝对地址", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          room_id: "r-1",
          latest_event_position: 9,
          last_read_event_position: 4,
          first_unread_event_position: 5,
          has_more_before: false,
          snapshot_messages: [
            {
              type: "message_created",
              room_id: "r-1",
              message_id: "m-1",
              client_message_id: "c-1",
              sender_session_id: "s-1",
              sender_display_alias: "暴躁的企鹅",
              text: "",
              body: "",
              event_position: 9,
              attachments: [
                {
                  kind: "video",
                  attachment_id: "att-snapshot-video-1",
                  width: 1080,
                  height: 1920,
                  preview_asset: {
                    still_url:
                      "/api/attachments/att-snapshot-video-1/content?session_id=s-1&variant=thumbnail",
                  },
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();

    const snapshot = await transport.loadRoomSnapshot("r-1", "s-1");
    const attachment = snapshot.snapshot_messages[0]?.attachments?.[0] as
      | { preview_asset?: { still_url?: string } }
      | undefined;

    expect(attachment?.preview_asset?.still_url).toBe(
      "http://localhost:3000/api/attachments/att-snapshot-video-1/content?session_id=s-1&variant=thumbnail"
    );
  });
  it("updateRoomReadAnchor 会以 POST 发送 session_id 和 last_read_event_position", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const transport = 创建测试传输();

    await transport.updateRoomReadAnchor("r-1", "s-1", 7);

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:3000/api/rooms/r-1/read-anchor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "s-1",
        last_read_event_position: 7,
      }),
    });
  });
  it("loadRoomHistory 会把 session_id before_event_position limit 编码进 query string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          room_id: "r-1",
          messages: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();

    await transport.loadRoomHistory("r-1", "s-1", 12, 55);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/rooms/r-1/history?session_id=s-1&before_event_position=12&limit=55",
      { headers: {} }
    );
  });
});
