import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach,describe,expect,it,vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));

import { 创建前端传输 } from "../平台/传输";

const 创建测试传输 = () => 创建前端传输("http://localhost:3000");

describe("传输 / 媒体上传与复用", () => {
  beforeEach(() => {
    ioSpy.mockClear();
    vi.restoreAllMocks();
  });

  it("前端传输组合根 不再暴露 uploadImageAttachment", () => {
    const transport = 创建测试传输() as unknown as Record<
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
    const transport = 创建测试传输();
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
    const transport = 创建测试传输();
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
  it("prepareMediaUpload 会把原始 source_hash 作为预处理前身份一并提交", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-source-prepare-1",
          upload_method: "tus",
          tus_endpoint: "/files",
          tus_headers: { Authorization: "Bearer source-upload-token" },
          tus_metadata: {
            attachment_id: "att-source-prepare-1",
            file_name: "canonical.webp",
            mime_type: "image/webp",
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
    const transport = 创建测试传输();
    const file = new File([new Uint8Array([9, 8, 7])], "canonical.webp", {
      type: "image/webp",
    });
    const sourceHash = "a".repeat(64);

    await transport.prepareMediaUpload("image", "s-1", file, {
      source_hash: sourceHash,
      source_byte_size: 3,
      source_file_name: "raw.jpg",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/image/prepare",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "s-1",
          file_name: "canonical.webp",
          mime_type: "image/webp",
          byte_size: 3,
          source_hash: sourceHash,
          source_byte_size: 3,
          source_file_name: "raw.jpg",
        }),
      })
    );
  });
  it("reuseMediaBySourceHash 会调用受目标房间发送权限约束的 source_hash 复用路由并解析 ready 附件", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "reused",
          attachment: {
            attachment_id: "att-source-hit-1",
            kind: "video",
            mime_type: "video/mp4",
            byte_size: 2048,
            width: 1280,
            height: 720,
            status: "ready",
            media_asset: {
              asset_id: "att-source-hit-1",
              content_hash: "hash-source-hit-1",
              kind: "file_video",
              variants: {
                canonical: {
                  id: "canonical",
                  mime_type: "video/mp4",
                  url: "/api/attachments/att-source-hit-1/content?session_id=s-1&variant=original",
                  width: 1280,
                  height: 720,
                },
              },
              distribution: {
                swarm_id: "swarm-hash-source-hit-1",
                announce_urls: ["/api/swarm/announce"],
                web_seed_url:
                  "/api/attachments/att-source-hit-1/content?session_id=s-1&variant=original",
                join_ticket: null,
                ticket_expires_at: null,
                survival_mode: "server_assisted",
              },
              origin: {
                original_url:
                  "/api/attachments/att-source-hit-1/content?session_id=s-1&variant=original",
                expires_at_epoch_seconds: 1775942400,
                available: true,
                role: "cold_backup_only",
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();
    const sourceHash = "b".repeat(64);

    const result = await transport.reuseMediaBySourceHash("video", {
      session_id: "s-1",
      room_id: "r-1",
      source_hash: sourceHash,
      source_byte_size: 2048,
      source_file_name: "clip.mp4",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/video/source-dedupe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "s-1",
          room_id: "r-1",
          source_hash: sourceHash,
          source_byte_size: 2048,
          source_file_name: "clip.mp4",
        }),
      })
    );
    expect(result.status).toBe("reused");
    if (result.status === "reused") {
      expect(result.attachment.media_asset).toEqual(
        expect.objectContaining({
          asset_id: "att-source-hit-1",
          variants: {
            canonical: null,
          },
        })
      );
    }
  });
  it("契约禁止把 room_id 描述成 source_hash 的唯一搜索范围", () => {
    const source = readFileSync(resolve(process.cwd(), "聊天共享/契约.ts"), "utf8");

    expect(source).toContain("room_id 是目标房间发送裁决锚点");
    expect(source).not.toContain("只能在当前会话可见的房间事实内查询命中");
  });
  it("forwardMediaAttachment 会调用媒体转发路由且不提交 source_hash 或原文件字节", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            type: "message_created",
            room_id: "target-room",
            message_id: "m-forward-1",
            client_message_id: "c-forward-1",
            sender_session_id: "s-1",
            sender_display_alias: "暴躁的企鹅",
            text: "转发",
            attachments: [
              {
                kind: "image",
                attachment_id: "att-forward-1",
                width: 1,
                height: 1,
              },
            ],
            event_position: 12,
          },
          attachment: {
            attachment_id: "att-forward-1",
            kind: "image",
            mime_type: "image/webp",
            byte_size: 88,
            width: 1,
            height: 1,
            status: "ready",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const transport = 创建测试传输();

    await transport.forwardMediaAttachment("image", {
      session_id: "s-1",
      target_room_id: "target-room",
      source_attachment_id: "att-source-1",
      client_message_id: "c-forward-1",
      text: "转发",
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/image/forward",
      expect.objectContaining({ method: "POST" })
    );
    expect(body).toEqual({
      session_id: "s-1",
      target_room_id: "target-room",
      source_attachment_id: "att-source-1",
      client_message_id: "c-forward-1",
      text: "转发",
    });
    expect(body.source_hash).toBeUndefined();
    expect(body.source_byte_size).toBeUndefined();
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
            distribution: {
              swarm_id: "swarm-hash-att-ready-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url:
                "/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
              join_ticket: null,
              ticket_expires_at: null,
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
    const transport = 创建测试传输();

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
        canonical: null,
      },
      distribution: {
        swarm_id: "swarm-hash-att-ready-1",
        announce_urls: ["ws://localhost:3000/api/swarm/announce"],
        web_seed_url:
          "http://localhost:3000/api/attachments/att-ready-1/content?session_id=s-1&variant=original",
        join_ticket: null,
        ticket_expires_at: null,
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
    const transport = 创建测试传输();

    await transport.abandonMediaUpload("s-1", "att-old-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/att-old-1/abandon",
      expect.objectContaining({ method: "POST" })
    );
  });
});
