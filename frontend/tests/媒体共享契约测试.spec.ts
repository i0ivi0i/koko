import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRealtime传输 } from "../传输";

describe("媒体共享契约", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadMediaLocator 只把多壳共享字段暴露给 Web，不把页面流程字段写回 streaming_asset", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-shared-video-1",
          kind: "video",
          status: "ready",
          original_url:
            "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
          thumbnail_url:
            "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=thumbnail",
          preview_asset: {
            still_url:
              "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=thumbnail",
          },
          distribution: {
            content_id: "content_att-shared-video-1",
            content_hash: "hash-att-shared-video-1",
            swarm_id: "swarm-hash-att-shared-video-1",
            web_seed_until: "1775942400",
            torrent_url: "/api/media/att-shared-video-1/torrent?session_id=s-1",
            torrent_info_hash: "torrent-info-hash-shared-video-1",
            announce_urls: ["/api/swarm/announce"],
            web_seed_url:
              "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
            presence_url: "/api/media/att-shared-video-1/presence?session_id=s-1",
            join_ticket: null,
            ticket_expires_at: null,
            availability: "available" as const,
          },
          streaming_asset: {
            asset_id: "att-shared-video-1",
            content_hash: "hash-att-shared-video-1",
            kind: "streaming_video" as const,
            manifest: {
              hls_master_url: "/api/media/att-shared-video-1/stream/hls/master.m3u8?session_id=s-1",
              dash_mpd_url: "/api/media/att-shared-video-1/stream/dash/stream.mpd?session_id=s-1",
            },
            distribution: {
              swarm_id: "swarm-hash-att-shared-video-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url:
                "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
              join_ticket: null,
            },
            origin: {
              original_url:
                "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
              expires_at_epoch_seconds: 1775942400,
              available: true,
              role: "cold_backup_only" as const,
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

    const locator = await transport.loadMediaLocator("s-1", "att-shared-video-1");

    expect("panelMode" in locator).toBe(false);
    expect(
      "toast_text" in
        (locator.streaming_asset as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      "presence_url" in
        (locator.streaming_asset?.distribution as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      "drawerOpen" in
        (locator.streaming_asset?.distribution as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      (locator as unknown as { preview_asset?: { still_url?: string } }).preview_asset
    ).toEqual({
      still_url:
        "http://localhost:3000/api/attachments/att-shared-video-1/content?session_id=s-1&variant=thumbnail",
    });
    expect(
      "panelMode" in
        (((locator as unknown as { preview_asset?: Record<string, unknown> })
          .preview_asset ?? {}) as Record<string, unknown>)
    ).toBe(false);
    expect(locator.streaming_asset?.distribution).toEqual({
      swarm_id: "swarm-hash-att-shared-video-1",
      announce_urls: ["http://localhost:3000/api/swarm/announce"],
      web_seed_url:
        "http://localhost:3000/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
      join_ticket: null,
    });
  });

  it("completeMediaUpload 返回的 blob_asset 仍然是多壳中性表面，不夹带 Web presenter 字段", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment_id: "att-shared-image-1",
          kind: "image",
          mime_type: "image/png",
          byte_size: 68,
          width: 1200,
          height: 800,
          status: "ready",
          media_asset: {
            asset_id: "att-shared-image-1",
            content_hash: "hash-att-shared-image-1",
            kind: "blob_image",
            preview: {
              id: "preview",
              mime_type: "image/webp",
              url: "/api/media/att-shared-image-1/blob/preview.webp",
              width: 320,
              height: 213,
            },
            full: {
              id: "full",
              mime_type: "image/webp",
              url: "/api/media/att-shared-image-1/blob/full.webp",
              width: 1200,
              height: 800,
            },
            original: {
              id: "original",
              mime_type: "image/png",
              url: "/api/media/att-shared-image-1/blob/original.png",
              width: 1200,
              height: 800,
            },
            distribution: {
              swarm_id: "swarm-hash-att-shared-image-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url: "/api/media/att-shared-image-1/blob/original.png",
              join_ticket: null,
            },
            origin: {
              original_url:
                "/api/attachments/att-shared-image-1/content?session_id=s-1&variant=original",
              expires_at_epoch_seconds: 1775942400,
              available: true,
              role: "cold_backup_only" as const,
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

    const result = await transport.completeMediaUpload("s-1", "att-shared-image-1");

    expect(result.media_asset?.kind).toBe("blob_image");
    expect(
      "viewmodel" in (result.media_asset as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      "panelMode" in (result.media_asset as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(result.media_asset).toEqual({
      asset_id: "att-shared-image-1",
      content_hash: "hash-att-shared-image-1",
      kind: "blob_image",
      preview: {
        id: "preview",
        mime_type: "image/webp",
        url: "http://localhost:3000/api/media/att-shared-image-1/blob/preview.webp",
        width: 320,
        height: 213,
      },
      full: {
        id: "full",
        mime_type: "image/webp",
        url: "http://localhost:3000/api/media/att-shared-image-1/blob/full.webp",
        width: 1200,
        height: 800,
      },
      original: {
        id: "original",
        mime_type: "image/png",
        url: "http://localhost:3000/api/media/att-shared-image-1/blob/original.png",
        width: 1200,
        height: 800,
      },
      distribution: {
        swarm_id: "swarm-hash-att-shared-image-1",
        announce_urls: ["http://localhost:3000/api/swarm/announce"],
        web_seed_url: "http://localhost:3000/api/media/att-shared-image-1/blob/original.png",
        join_ticket: null,
      },
      origin: {
        original_url:
          "http://localhost:3000/api/attachments/att-shared-image-1/content?session_id=s-1&variant=original",
        expires_at_epoch_seconds: 1775942400,
        available: true,
        role: "cold_backup_only",
      },
    });
  });
});
