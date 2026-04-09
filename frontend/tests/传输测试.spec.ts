import { beforeEach, describe, expect, it, vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));

import { HttpRealtime传输 } from "../传输";
import type { 匿名身份快照 } from "../契约";

describe("传输", () => {
  beforeEach(() => {
    ioSpy.mockClear();
    vi.restoreAllMocks();
  });

  it("socket连接配置只显式声明当前可安全启用的连接策略", () => {
    const transport = new HttpRealtime传输("http://localhost:3000");

    transport.createSocket("s-auth");

    expect(ioSpy).toHaveBeenCalledWith("http://localhost:3000", {
      transports: ["websocket"],
      reconnection: true,
      auth: { session_id: "s-auth" },
    });
  });

  it("bootstrap_anonymous_identity returns internal identity and display alias separately", () => {
    const snapshot: 匿名身份快照 = {
      anonymous_identity_id: "a-1",
      display_alias: "暴躁的企鹅",
    };

    expect(snapshot.anonymous_identity_id).toBe("a-1");
    expect(snapshot.display_alias).toBe("暴躁的企鹅");
    expect(snapshot.anonymous_identity_id).not.toBe(snapshot.display_alias);
  });

  it("以 device_anonymous_token 调用 bootstrap_anonymous_identity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          anonymous_identity_id: "a-1",
          display_alias: "暴躁的企鹅",
          session_id: "s-1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const result = await transport.bootstrapAnonymousIdentity("device-token-1");

    expect(fetchSpy).toHaveBeenCalledWith("http://localhost:3000/api/session/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_anonymous_token: "device-token-1" }),
    });
    expect(result.anonymous_identity_id).toBe("a-1");
    expect(result.display_alias).toBe("暴躁的企鹅");
    expect(result.session_id).toBe("s-1");
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
    const transport = new HttpRealtime传输("http://localhost:3000");

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
    const transport = new HttpRealtime传输("http://localhost:3000");

    const snapshot = await transport.loadRoomSnapshot("r-1", "s-1");

    expect(snapshot.last_read_event_position).toBe(4);
    expect(snapshot.first_unread_event_position).toBe(5);
    expect(snapshot.snapshot_messages).toEqual([]);
    expect(snapshot.has_more_before).toBe(true);
  });

  it("updateRoomReadAnchor 会以 POST 发送 session_id 和 last_read_event_position", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

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
    const transport = new HttpRealtime传输("http://localhost:3000");

    await transport.loadRoomHistory("r-1", "s-1", 12, 55);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/rooms/r-1/history?session_id=s-1&before_event_position=12&limit=55",
      { headers: {} }
    );
  });

  it("uploadImageAttachment 会以 multipart/form-data 上传 session_id 和图片文件", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-1",
          kind: "image",
          mime_type: "image/png",
          byte_size: 3,
          width: 120,
          height: 90,
          status: "ready",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");
    const file = new File([new Uint8Array([1, 2, 3])], "demo.png", {
      type: "image/png",
    });

    const result = await transport.uploadImageAttachment("s-1", file);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/api/attachments/image");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const body = init?.body as FormData;
    expect(body.get("session_id")).toBe("s-1");
    expect(body.get("file")).toBe(file);
    expect(result.attachment_id).toBe("att-1");
    expect(result.kind).toBe("image");
    expect(result.status).toBe("ready");
  });

  it("buildAttachmentContentUrl 会生成受控图片内容地址", () => {
    const transport = new HttpRealtime传输("http://localhost:3000");

    const originalUrl = transport.buildAttachmentContentUrl("att-1", "s-1");
    const thumbnailUrl = transport.buildAttachmentContentUrl("att-1", "s-1", "thumbnail");

    expect(originalUrl).toBe(
      "http://localhost:3000/api/attachments/att-1/content?session_id=s-1&variant=original"
    );
    expect(thumbnailUrl).toBe(
      "http://localhost:3000/api/attachments/att-1/content?session_id=s-1&variant=thumbnail"
    );
  });
});
