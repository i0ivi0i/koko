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

  it("HttpRealtime传输 不再暴露 uploadImageAttachment", () => {
    const transport = new HttpRealtime传输("http://localhost:3000") as unknown as Record<
      string,
      unknown
    >;

    expect("uploadImageAttachment" in transport).toBe(false);
  });

  it("prepareImageUpload 会向新的 prepare 路由请求上传参数", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-prepared-1",
          upload_method: "PUT",
          upload_url: "http://storage.local/test-bucket/images/att-prepared-1/original?sig=1",
          upload_headers: { "content-type": "image/jpeg" },
          expires_at: "2026-04-10T12:00:00Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", {
      type: "image/jpeg",
    });

    const result = await (
      transport as unknown as {
        prepareImageUpload(sessionId: string, file: File): Promise<{
          attachment_id: string;
          upload_method: string;
          upload_url: string;
          upload_headers: Record<string, string>;
          expires_at: string;
        }>;
      }
    ).prepareImageUpload("s-1", file);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/image/prepare",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.attachment_id).toBe("att-prepared-1");
    expect(result.upload_method).toBe("PUT");
  });

  it("completeImageUpload 会调用新的 complete 路由并返回 ready 附件快照", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-ready-1",
          kind: "image",
          mime_type: "image/png",
          byte_size: 68,
          width: 1,
          height: 1,
          status: "ready",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const result = await (
      transport as unknown as {
        completeImageUpload(sessionId: string, attachmentId: string): Promise<{
          attachment_id: string;
          status: string;
        }>;
      }
    ).completeImageUpload("s-1", "att-ready-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/att-ready-1/complete",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.attachment_id).toBe("att-ready-1");
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
