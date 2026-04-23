import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("HttpRealtime传输 会把 socket 生命周期与运行时策略委托给 实时连接适配", () => {
    const source = readFileSync(resolve(process.cwd(), "传输.ts"), "utf8");

    expect(source).toContain('from "./聊天实时/适配/实时连接适配.js"');
    expect(source).toContain("private readonly 实时连接");
    expect(source).toContain("return this.实时连接.createSocket(sessionId);");
    expect(source).toContain("this.实时连接.接收运行时策略(policy);");
    expect(source).toContain("return this.实时连接.读取运行时策略();");
    expect(source).toContain("this.实时连接.释放Socket(socket);");
    expect(source).not.toContain("private 当前运行时策略");
    expect(source).not.toContain("private readonly 活跃Socket表");
  });

  it("HttpRealtime传输 会把房间主链 HTTP 调用委托给 房间HTTP接口", () => {
    const source = readFileSync(resolve(process.cwd(), "传输.ts"), "utf8");

    expect(source).toContain('from "./聊天恢复/适配/房间HTTP接口.js"');
    expect(source).toContain("private readonly 房间HTTP接口");
    expect(source).toContain("return this.房间HTTP接口.bootstrapAnonymousIdentity(deviceToken);");
    expect(source).toContain("return this.房间HTTP接口.joinOrCreateRoom(sessionId, roomCode);");
    expect(source).toContain("return this.房间HTTP接口.loadRoomSnapshot(roomId, sessionId);");
    expect(source).toContain("return this.房间HTTP接口.updateRoomReadAnchor(");
    expect(source).toContain("return this.房间HTTP接口.loadRoomEvents(roomId, sessionId, from);");
    expect(source).toContain("return this.房间HTTP接口.loadRoomHistory(");
  });

  it("HttpRealtime传输 会把 media 与 admin HTTP 适配拆回各自接口，只保留组合根职责", () => {
    const source = readFileSync(resolve(process.cwd(), "传输.ts"), "utf8");

    expect(source).toContain('from "./媒体/适配/媒体HTTP接口.js"');
    expect(source).toContain('from "./操作台/适配/后台HTTP接口.js"');
    expect(source).toContain("private readonly 媒体HTTP接口");
    expect(source).toContain("private readonly 后台HTTP接口");
    expect(source).toContain("return this.媒体HTTP接口.prepareMediaUpload(kind, sessionId, file);");
    expect(source).toContain("return this.媒体HTTP接口.abandonMediaUpload(sessionId, attachmentId);");
    expect(source).toContain("return this.媒体HTTP接口.completeMediaUpload(sessionId, attachmentId);");
    expect(source).toContain("return this.媒体HTTP接口.loadMediaLocator(sessionId, attachmentId);");
    expect(source).toContain("return this.后台HTTP接口.loadAdminOverview(token);");
    expect(source).toContain("return this.后台HTTP接口.adminLogin(username, password);");
    expect(source).toContain("return this.后台HTTP接口.adminRooms(token);");
    expect(source).toContain("return this.后台HTTP接口.adminRoomDetail(token, roomId);");
    expect(source).not.toContain("private 解析流媒体资产(");
    expect(source).not.toContain("private 解析Blob媒体资产(");
  });

  it("HttpRealtime传输 会把聊天房间/realtime/media/admin 显式投影成窄接口，而不是让所有调用者都抱住巨型端口", () => {
    const source = readFileSync(resolve(process.cwd(), "传输.ts"), "utf8");

    expect(source).toContain('from "./聊天共享/适配/聊天房间传输端口.js"');
    expect(source).toContain('from "./聊天共享/适配/聊天实时连接端口.js"');
    expect(source).toContain("export interface 媒体传输端口");
    expect(source).toContain("export interface 后台查询传输端口");
    expect(source).toContain("export interface 后台会话传输端口");
    expect(source).not.toContain("export const 投影聊天房间传输端口");
    expect(source).not.toContain("export const 投影聊天实时连接端口");
    expect(source).not.toContain("export const 投影媒体传输端口");
    expect(source).not.toContain("export const 投影后台查询传输端口");
    expect(source).not.toContain("export const 投影后台会话传输端口");
  });

  it("聊天 realtime / 房间恢复 / 后台 admin / 媒体定位 当前已经只消费各自需要的 transport 子表面", () => {
    const realtimeSource = readFileSync(resolve(process.cwd(), "房间实时编排.ts"), "utf8");
    const recoverySource = readFileSync(resolve(process.cwd(), "房间恢复编排.ts"), "utf8");
    const readSource = readFileSync(resolve(process.cwd(), "阅读推进编排.ts"), "utf8");
    const mediaSource = readFileSync(resolve(process.cwd(), "聊天媒体编排.ts"), "utf8");
    const adminQuerySource = readFileSync(resolve(process.cwd(), "后台查询编排.ts"), "utf8");
    const adminSessionSource = readFileSync(resolve(process.cwd(), "后台会话编排.ts"), "utf8");

    expect(realtimeSource).toContain("deps.transport.createSocket(sessionId)");
    expect(realtimeSource).toContain("deps.transport.释放Socket?.(realtimeSocket);");
    expect(realtimeSource).not.toContain("deps.transport.loadRoomSnapshot");
    expect(realtimeSource).not.toContain("deps.transport.adminLogin");

    expect(recoverySource).toContain("deps.transport.bootstrapAnonymousIdentity(deviceAnonymousToken)");
    expect(recoverySource).toContain("deps.transport.joinOrCreateRoom(sessionId, roomCode)");
    expect(recoverySource).toContain("deps.transport.loadRoomSnapshot(roomId, sessionId)");
    expect(recoverySource).not.toContain("deps.transport.adminRooms");
    expect(recoverySource).not.toContain("deps.transport.prepareMediaUpload");

    expect(readSource).toContain(
      "deps.transport.updateRoomReadAnchor(state.roomId, state.sessionId, nextPosition)"
    );
    expect(readSource).toContain(
      "deps.transport.loadRoomHistory(state.roomId, sessionId, oldestMessage.event_position, 55)"
    );
    expect(readSource).not.toContain("deps.transport.createSocket");

    expect(mediaSource).toContain("deps.transport().loadMediaLocator(sessionId, attachmentId)");
    expect(mediaSource).toContain("deps.transport().prepareMediaUpload(kind, sessionId, file)");
    expect(mediaSource).toContain("deps.transport().buildAttachmentContentUrl(");
    expect(mediaSource).not.toContain("deps.transport().adminLogin");
    expect(mediaSource).not.toContain("deps.transport().joinOrCreateRoom");

    expect(adminQuerySource).toContain("transport.loadAdminOverview(token)");
    expect(adminQuerySource).toContain("transport.adminRooms(token)");
    expect(adminQuerySource).toContain("transport.adminRoomDetail(token, roomId)");
    expect(adminQuerySource).not.toContain("transport.loadRoomSnapshot");

    expect(adminSessionSource).toContain("transport.adminLogin(state.username, state.password)");
    expect(adminSessionSource).not.toContain("transport.loadAdminOverview");
  });

  it("socket连接配置只显式声明当前可安全启用的连接策略", () => {
    const transport = new HttpRealtime传输("http://localhost:3000");

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
    const transport = new HttpRealtime传输("http://localhost:3000");

    const socket = transport.createSocket("s-auth");
    transport.接收运行时策略({
      intent: "suspend",
      reconnection: false,
      reason: "page_hidden",
    });
    transport.接收运行时策略({
      intent: "resume",
      reconnection: true,
      reason: "active",
    });
    transport.释放Socket(socket);

    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(transport.读取运行时策略()).toEqual({
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
    expect(result.display_alias).toBe("暴躁的企鹅");
    expect(result.session_id).toBe("s-1");
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
    const transport = new HttpRealtime传输("http://localhost:3000");

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

  it("prepareMediaUpload 会按媒体种类请求新的 prepare 路由", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-prepared-1",
          upload_method: "tus",
          tus_endpoint: "http://storage.local/files",
          tus_headers: { Authorization: "Bearer upload-token-1" },
          tus_metadata: {
            attachment_id: "att-prepared-1",
            file_name: "photo.jpg",
            mime_type: "image/jpeg",
            byte_size: "3",
          },
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
        prepareMediaUpload(kind: "image" | "video", sessionId: string, file: File): Promise<{
          attachment_id: string;
          upload_method: string;
          tus_endpoint: string;
          tus_headers: Record<string, string>;
          tus_metadata: Record<string, string>;
          expires_at: string;
        }>;
      }
    ).prepareMediaUpload("image", "s-1", file);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/image/prepare",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.attachment_id).toBe("att-prepared-1");
    expect(result.upload_method).toBe("tus");
  });

  it("prepareMediaUpload 会把后端返回的相对 tus_endpoint 收口成绝对地址", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-prepared-local-1",
          upload_method: "tus",
          tus_endpoint: "/files",
          tus_headers: { Authorization: "Bearer upload-token-local" },
          tus_metadata: {
            attachment_id: "att-prepared-local-1",
            file_name: "clip.mp4",
            mime_type: "video/mp4",
            byte_size: "3",
          },
          expires_at: "2026-04-10T12:00:00Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");
    const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
      type: "video/mp4",
    });

    const result = await transport.prepareMediaUpload("video", "s-1", file);

    expect(result.tus_endpoint).toBe("http://localhost:3000/files");
    expect(result.tus_headers).toEqual({ Authorization: "Bearer upload-token-local" });
    expect(result.tus_metadata).toEqual({
      attachment_id: "att-prepared-local-1",
      file_name: "clip.mp4",
      mime_type: "video/mp4",
      byte_size: "3",
    });
  });

  it("completeMediaUpload 会按 file_video 解析新单文件视频主链", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-ready-1",
          kind: "video",
          mime_type: "video/mp4",
          byte_size: 2048,
          width: 1080,
          height: 1920,
          status: "ready",
          media_asset: {
            asset_id: "att-ready-1",
            content_hash: "hash-att-ready-1",
            kind: "file_video",
            variants: {
              canonical: {
                id: "canonical",
                mime_type: "video/mp4",
                url: "/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
                width: 1080,
                height: 1920,
              },
            },
            manifest: null,
            lifecycle: null,
            distribution: {
              swarm_id: "swarm-hash-att-ready-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url:
                "/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
              join_ticket: null,
              survival_mode: "server_assisted",
            },
            origin: {
              original_url:
                "/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
              expires_at_epoch_seconds: 1775942400,
              available: true,
              role: "cold_backup_only",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const result = await transport.completeMediaUpload("s-1", "att-ready-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/att-ready-1/complete",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.attachment_id).toBe("att-ready-1");
    expect(result.status).toBe("ready");
    expect(result.media_asset).toEqual({
      asset_id: "att-ready-1",
      content_hash: "hash-att-ready-1",
      kind: "file_video",
      variants: {
        canonical: {
          id: "canonical",
          mime_type: "video/mp4",
          url: "http://localhost:3000/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
          width: 1080,
          height: 1920,
        },
      },
      manifest: null,
      lifecycle: null,
      distribution: {
        swarm_id: "swarm-hash-att-ready-1",
        announce_urls: ["http://localhost:3000/api/swarm/announce"],
        web_seed_url:
          "http://localhost:3000/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
        join_ticket: null,
        survival_mode: "server_assisted",
      },
      origin: {
        original_url:
          "http://localhost:3000/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
        expires_at_epoch_seconds: 1775942400,
        available: true,
        role: "cold_backup_only",
      },
    });
  });

  it("abandonMediaUpload 会调用显式放弃旧上传的新路由", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-old-1",
          status: "abandoned",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    await transport.abandonMediaUpload("s-1", "att-old-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/att-old-1/abandon",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("loadMediaLocator 会把受控相对地址收口成绝对媒体地址", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-locator-1",
          kind: "video",
          status: "ready",
          original_url: "/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
          thumbnail_url: "/api/attachments/att-locator-1/content?session_id=s-1&variant=thumbnail",
          preview_asset: {
            still_url:
              "/api/attachments/att-locator-1/content?session_id=s-1&variant=thumbnail",
          },
          distribution: {
            content_id: "content_att-locator-1",
            content_hash: "hash-att-locator-1",
            swarm_id: "swarm-hash-att-locator-1",
            web_seed_until: "1775942400",
            torrent_url: "/api/media/att-locator-1/torrent?session_id=s-1",
            torrent_info_hash: "torrent-info-hash-1",
            announce_urls: ["/api/swarm/announce"],
            web_seed_url:
              "/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
            join_ticket: null,
            ticket_expires_at: null,
            availability: "available" as const,
            media_state: {
              code: "MEDIA_READY" as const,
              retry_after_ms: null,
            },
          },
          streaming_asset: {
            asset_id: "att-locator-1",
            content_hash: "hash-att-locator-1",
            kind: "streaming_video",
            manifest: {
              hls_master_url: null,
              dash_mpd_url: null,
            },
            distribution: {
              swarm_id: "swarm-hash-att-locator-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url:
                "/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
              join_ticket: null,
            },
            origin: {
              original_url:
                "/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
              expires_at_epoch_seconds: 1775942400,
              available: true,
              role: "cold_backup_only",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const locator = await transport.loadMediaLocator("s-1", "att-locator-1");

    expect(locator).toEqual({
      attachment_id: "att-locator-1",
      kind: "video",
      status: "ready",
      original_url:
        "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
      thumbnail_url:
        "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=thumbnail",
      preview_asset: {
        still_url:
          "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=thumbnail",
      },
      distribution: {
        content_id: "content_att-locator-1",
        content_hash: "hash-att-locator-1",
        swarm_id: "swarm-hash-att-locator-1",
        web_seed_until: "1775942400",
        torrent_url: "http://localhost:3000/api/media/att-locator-1/torrent?session_id=s-1",
        torrent_info_hash: "torrent-info-hash-1",
        announce_urls: ["http://localhost:3000/api/swarm/announce"],
        web_seed_url:
          "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
        join_ticket: null,
        ticket_expires_at: null,
        availability: "available" as const,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
      },
      file_asset: null,
      streaming_asset: {
        asset_id: "att-locator-1",
        content_hash: "hash-att-locator-1",
        kind: "streaming_video",
        manifest: {
          hls_master_url: null,
          dash_mpd_url: null,
        },
        distribution: {
          swarm_id: "swarm-hash-att-locator-1",
          announce_urls: ["http://localhost:3000/api/swarm/announce"],
          web_seed_url:
            "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
          join_ticket: null,
        },
        origin: {
          original_url:
            "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only",
        },
      },
      blob_asset: null,
    });
  });

  it("loadMediaLocator 与 complete 响应会把 streaming 生命周期和 survival_mode 收口进共享契约", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment_id: "att-ready-2",
            kind: "video",
            mime_type: "video/mp4",
            byte_size: 2048,
            width: 1080,
            height: 1920,
            status: "ready",
            media_asset: {
              asset_id: "att-ready-2",
              content_hash: "hash-att-ready-2",
              kind: "streaming_video",
              manifest: {
                hls_master_url: "/api/media/att-ready-2/stream/hls/master.m3u8?session_id=s-1",
                dash_mpd_url: null,
              },
              lifecycle: {
                streaming_expires_at: "1775942400",
                streaming_deleted_at: null,
              },
              distribution: {
                swarm_id: "swarm-hash-att-ready-2",
                announce_urls: ["/api/swarm/announce"],
                web_seed_url:
                  "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
                join_ticket: null,
                survival_mode: "peer_only_after_expiry",
              },
              origin: {
                original_url:
                  "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
                expires_at_epoch_seconds: 1775942400,
                available: true,
                role: "cold_backup_only",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment_id: "att-ready-2",
            kind: "video",
            status: "ready",
            original_url: "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
            thumbnail_url: "/api/attachments/att-ready-2/content?session_id=s-1&variant=thumbnail",
            preview_asset: {
              still_url:
                "/api/attachments/att-ready-2/content?session_id=s-1&variant=thumbnail",
            },
            distribution: {
              content_id: "content_att-ready-2",
              content_hash: "hash-att-ready-2",
              swarm_id: "swarm-hash-att-ready-2",
              web_seed_until: "1775942400",
              torrent_url: "/api/media/att-ready-2/torrent?session_id=s-1",
              torrent_info_hash: "torrent-info-hash-2",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url: null,
              join_ticket: null,
              ticket_expires_at: null,
              availability: "available",
              survival_mode: "peer_only_after_expiry",
            },
            streaming_asset: {
              asset_id: "att-ready-2",
              content_hash: "hash-att-ready-2",
              kind: "streaming_video",
              manifest: {
                hls_master_url: "/api/media/att-ready-2/stream/hls/master.m3u8?session_id=s-1",
                dash_mpd_url: null,
              },
              lifecycle: {
                streaming_expires_at: "1775942400",
                streaming_deleted_at: null,
              },
              distribution: {
                swarm_id: "swarm-hash-att-ready-2",
                announce_urls: ["/api/swarm/announce"],
                web_seed_url: null,
                join_ticket: null,
                survival_mode: "peer_only_after_expiry",
              },
              origin: {
                original_url:
                  "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
                expires_at_epoch_seconds: 1775942400,
                available: false,
                role: "cold_backup_only",
              },
            },
            blob_asset: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const ready = await transport.completeMediaUpload("s-1", "att-ready-2");
    const locator = await transport.loadMediaLocator("s-1", "att-ready-2");

    const readyAsset = ready.media_asset as
      | {
          lifecycle?: {
            streaming_expires_at: string | null;
            streaming_deleted_at: string | null;
          };
          distribution: { survival_mode?: string };
        }
      | null
      | undefined;
    const locatorAsset = locator.streaming_asset as
      | {
          lifecycle?: {
            streaming_expires_at: string | null;
            streaming_deleted_at: string | null;
          };
          distribution: { survival_mode?: string; web_seed_url?: string | null };
        }
      | null
      | undefined;

    expect(readyAsset?.lifecycle?.streaming_expires_at).toBe("1775942400");
    expect(readyAsset?.lifecycle?.streaming_deleted_at).toBeNull();
    expect(readyAsset?.distribution.survival_mode).toBe("peer_only_after_expiry");
    expect(locator.distribution?.survival_mode).toBe("peer_only_after_expiry");
    expect(locator.distribution?.web_seed_url).toBeNull();
    expect(locatorAsset?.lifecycle?.streaming_expires_at).toBe("1775942400");
    expect(locatorAsset?.distribution.survival_mode).toBe("peer_only_after_expiry");
    expect(locatorAsset?.distribution.web_seed_url).toBeNull();
  });

  it("loadMediaLocator 会把 partial_peer 触发的 connecting 语义稳定透传给前端", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-connecting-peer-1",
          kind: "video",
          status: "ready",
          original_url:
            "/api/attachments/att-connecting-peer-1/content?session_id=s-1&variant=original",
          thumbnail_url:
            "/api/attachments/att-connecting-peer-1/content?session_id=s-1&variant=thumbnail",
          preview_asset: null,
          distribution: {
            content_id: "content_att-connecting-peer-1",
            content_hash: "hash-att-connecting-peer-1",
            swarm_id: "swarm-hash-att-connecting-peer-1",
            web_seed_until: "1775942400",
            torrent_url: "/api/media/att-connecting-peer-1/torrent?session_id=s-1",
            torrent_info_hash: "torrent-info-hash-connecting-peer-1",
            announce_urls: ["/api/swarm/announce"],
            web_seed_url: null,
            join_ticket: null,
            ticket_expires_at: null,
            availability: "pending",
            media_state: {
              code: "MEDIA_CONNECTING_TO_PEERS",
              retry_after_ms: 2000,
            },
            survival_mode: "peer_only_after_expiry",
          },
          streaming_asset: null,
          file_asset: {
            asset_id: "att-connecting-peer-1",
            content_hash: "hash-att-connecting-peer-1",
            kind: "single_file_video",
            variants: {
              canonical: {
                id: "canonical",
                mime_type: "video/mp4",
                url: "/api/attachments/att-connecting-peer-1/content?session_id=s-1&variant=original",
                width: 1280,
                height: 720,
              },
            },
            origin: {
              original_url:
                "/api/attachments/att-connecting-peer-1/content?session_id=s-1&variant=original",
              expires_at_epoch_seconds: 1775942400,
              available: false,
              role: "cold_backup_only",
            },
            distribution: {
              swarm_id: "swarm-hash-att-connecting-peer-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url: null,
              join_ticket: null,
              survival_mode: "peer_only_after_expiry",
            },
          },
          blob_asset: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = new HttpRealtime传输("http://localhost:3000");

    const locator = await transport.loadMediaLocator("s-1", "att-connecting-peer-1");

    expect(locator.distribution?.media_state).toEqual({
      code: "MEDIA_CONNECTING_TO_PEERS",
      retry_after_ms: 2000,
    });
    expect(locator.file_asset?.distribution?.survival_mode).toBe("peer_only_after_expiry");
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
