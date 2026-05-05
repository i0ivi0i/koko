import { beforeEach,describe,expect,it,vi } from "vitest";

const { ioSpy } = vi.hoisted(() => ({
  ioSpy: vi.fn(() => ({}) as never),
}));

vi.mock("socket.io-client", () => ({
  io: ioSpy,
}));

import { 创建前端传输 } from "../平台/传输";

const 创建测试传输 = () => 创建前端传输("http://localhost:3000");
const 创建HTTPS测试传输 = () => 创建前端传输("https://localhost");

describe("传输 / 媒体定位与地址收口", () => {
  beforeEach(() => {
    ioSpy.mockClear();
    vi.restoreAllMocks();
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
            media_state: {
              code: "MEDIA_READY" as const,
              retry_after_ms: null,
            },
          },
          file_asset: {
            asset_id: "att-locator-1",
            content_hash: "hash-att-locator-1",
            kind: "file_video",
            variants: {
              canonical: {
                id: "canonical",
                mime_type: "video/mp4",
                url: "/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
                width: 1280,
                height: 720,
              },
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
    const transport = 创建测试传输();

    const locator = await transport.loadMediaLocator("s-1", "att-locator-1");

    expect(locator).toEqual({
      attachment_id: "att-locator-1",
      kind: "video",
          status: "ready",
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
        announce_urls: ["ws://localhost:3000/api/swarm/announce"],
        web_seed_url:
          "http://localhost:3000/api/attachments/att-locator-1/content?session_id=s-1&variant=original",
        presence_url: null,
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
      },
      file_asset: {
        asset_id: "att-locator-1",
        content_hash: "hash-att-locator-1",
        kind: "file_video",
        variants: {
          canonical: null,
        },
        distribution: {
          swarm_id: "swarm-hash-att-locator-1",
          announce_urls: ["ws://localhost:3000/api/swarm/announce"],
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
  it("loadMediaLocator 会把同源与 https announce 收口成浏览器可用的 wss tracker 地址", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-locator-https-1",
          kind: "video",
          status: "ready",
          thumbnail_url: null,
          preview_asset: null,
          distribution: {
            content_id: "content_att-locator-https-1",
            content_hash: "hash-att-locator-https-1",
            swarm_id: "swarm-hash-att-locator-https-1",
            web_seed_until: "1775942400",
            torrent_url: "/api/media/att-locator-https-1/torrent?session_id=s-1",
            torrent_info_hash: "torrent-info-hash-https-1",
            announce_urls: [
              "/api/swarm/announce",
              "https://tracker.koko.local/announce",
              "wss://tracker-2.koko.local/announce",
            ],
            web_seed_url: null,
            join_ticket: null,
            ticket_expires_at: null,
            media_state: {
              code: "MEDIA_READY" as const,
              retry_after_ms: null,
            },
          },
          file_asset: null,
          blob_asset: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建HTTPS测试传输();

    const locator = await transport.loadMediaLocator("s-1", "att-locator-https-1");

    expect(locator.distribution?.announce_urls).toEqual([
      "wss://localhost/api/swarm/announce",
      "wss://tracker.koko.local/announce",
      "wss://tracker-2.koko.local/announce",
    ]);
    expect(locator.distribution?.torrent_url).toBe(
      "https://localhost/api/media/att-locator-https-1/torrent?session_id=s-1"
    );
  });
  it("loadMediaLocator 会把 abort signal 透传给 locator fetch，允许上层真正取消旧请求", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-locator-signal-1",
          kind: "video",
          status: "ready",
          thumbnail_url: null,
          preview_asset: null,
          distribution: null,
          file_asset: null,
          blob_asset: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const transport = 创建测试传输();
    const controller = new AbortController();

    await transport.loadMediaLocator("s-1", "att-locator-signal-1", controller.signal);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/media/att-locator-signal-1/locator?session_id=s-1",
      {
        headers: {},
        signal: controller.signal,
      }
    );
  });
  it("loadMediaLocator 与 complete 响应会把单文件视频与 survival_mode 收口进共享契约", async () => {
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
              kind: "file_video",
              variants: {
                canonical: {
                  id: "canonical",
                  mime_type: "video/mp4",
                  url: "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
                  width: 1080,
                  height: 1920,
                },
              },
              distribution: {
                swarm_id: "swarm-hash-att-ready-2",
                announce_urls: ["/api/swarm/announce"],
                web_seed_url:
                  "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
                join_ticket: null,
                ticket_expires_at: null,
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
              media_state: {
                code: "MEDIA_READY" as const,
                retry_after_ms: null,
              },
              survival_mode: "peer_only_after_expiry",
            },
            file_asset: {
              asset_id: "att-ready-2",
              content_hash: "hash-att-ready-2",
              kind: "file_video",
              variants: {
                canonical: {
                  id: "canonical",
                  mime_type: "video/mp4",
                  url: "/api/attachments/att-ready-2/content?session_id=s-1&variant=original",
                  width: 1080,
                  height: 1920,
                },
              },
              distribution: {
                swarm_id: "swarm-hash-att-ready-2",
                announce_urls: ["/api/swarm/announce"],
                web_seed_url: null,
                join_ticket: null,
                ticket_expires_at: null,
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
    const transport = 创建测试传输();

    const ready = await transport.completeMediaUpload("s-1", "att-ready-2");
    const locator = await transport.loadMediaLocator("s-1", "att-ready-2");

    const readyAsset = ready.media_asset as
      | {
          kind?: string;
          variants?: {
            canonical?: {
              url?: string;
            } | null;
          };
          distribution: { survival_mode?: string };
        }
      | null
      | undefined;
    const locatorAsset = locator.file_asset as
      | {
          kind?: string;
          variants?: {
            canonical?: {
              url?: string;
            } | null;
          };
          distribution: { survival_mode?: string; web_seed_url?: string | null };
        }
      | null
      | undefined;

    expect(readyAsset?.kind).toBe("file_video");
    expect(readyAsset?.variants?.canonical ?? null).toBeNull();
    expect(readyAsset?.distribution.survival_mode).toBe("peer_only_after_expiry");
    expect(locator.distribution?.survival_mode).toBe("peer_only_after_expiry");
    expect(locator.distribution?.web_seed_url).toBeNull();
    expect(locatorAsset?.kind).toBe("file_video");
    expect(locatorAsset?.variants?.canonical ?? null).toBeNull();
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
            media_state: {
              code: "MEDIA_CONNECTING_TO_PEERS",
              retry_after_ms: 2000,
            },
            survival_mode: "peer_only_after_expiry",
          },
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
              ticket_expires_at: null,
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
    const transport = 创建测试传输();

    const locator = await transport.loadMediaLocator("s-1", "att-connecting-peer-1");

    expect(locator.distribution?.media_state).toEqual({
      code: "MEDIA_CONNECTING_TO_PEERS",
      retry_after_ms: 2000,
    });
    expect(locator.file_asset?.distribution?.survival_mode).toBe("peer_only_after_expiry");
  });
  it("buildAttachmentContentUrl 会生成受控图片内容地址", () => {
    const transport = 创建测试传输();

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
