import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { 创建前端传输 } from "../平台/传输";

const 创建测试传输 = () => 创建前端传输("http://localhost:3000");

describe("媒体共享契约", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loadMediaLocator 只把多壳共享字段暴露给 Web，不把页面流程字段写回 file_asset", async () => {
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
            media_state: {
              code: "MEDIA_READY",
              retry_after_ms: null,
            },
            survival_mode: "server_assisted",
          },
          file_asset: {
            asset_id: "att-shared-video-1",
            content_hash: "hash-att-shared-video-1",
            kind: "file_video" as const,
            variants: {
              canonical: {
                id: "canonical",
                mime_type: "video/mp4",
                url: "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
                width: 1280,
                height: 720,
              },
            },
            distribution: {
              swarm_id: "swarm-hash-att-shared-video-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url:
                "/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
              join_ticket: null,
              ticket_expires_at: null,
              survival_mode: "server_assisted",
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
    const transport = 创建测试传输();

    const locator = await transport.loadMediaLocator("s-1", "att-shared-video-1");

    expect("panelMode" in locator).toBe(false);
    expect(
      "toast_text" in
        (locator.file_asset as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      "presence_url" in
        (locator.file_asset?.distribution as unknown as Record<string, unknown>)
    ).toBe(false);
    expect(
      "drawerOpen" in
        (locator.file_asset?.distribution as unknown as Record<string, unknown>)
    ).toBe(false);
    expect("original_url" in (locator as unknown as Record<string, unknown>)).toBe(false);
    expect(
      (locator as unknown as { preview_asset?: { still_url?: string } }).preview_asset
    ).toEqual({
      still_url:
        "http://localhost:3000/api/attachments/att-shared-video-1/content?session_id=s-1&variant=thumbnail",
    });
    expect((locator as { distribution?: unknown }).distribution).toEqual({
      content_id: "content_att-shared-video-1",
      content_hash: "hash-att-shared-video-1",
      swarm_id: "swarm-hash-att-shared-video-1",
      web_seed_until: "1775942400",
      torrent_url: "http://localhost:3000/api/media/att-shared-video-1/torrent?session_id=s-1",
      torrent_info_hash: "torrent-info-hash-shared-video-1",
      announce_urls: ["ws://localhost:3000/api/swarm/announce"],
      web_seed_url:
        "http://localhost:3000/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
      presence_url: "http://localhost:3000/api/media/att-shared-video-1/presence?session_id=s-1",
      join_ticket: null,
      ticket_expires_at: null,
      media_state: {
        code: "MEDIA_READY",
        retry_after_ms: null,
      },
      survival_mode: "server_assisted",
    });
    expect(
      "panelMode" in
        (((locator as unknown as { preview_asset?: Record<string, unknown> })
          .preview_asset ?? {}) as Record<string, unknown>)
    ).toBe(false);
    expect(locator.file_asset).toEqual({
      asset_id: "att-shared-video-1",
      content_hash: "hash-att-shared-video-1",
      kind: "file_video",
      variants: {
        canonical: null,
      },
      distribution: {
        swarm_id: "swarm-hash-att-shared-video-1",
        announce_urls: ["ws://localhost:3000/api/swarm/announce"],
        web_seed_url:
          "http://localhost:3000/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
        join_ticket: null,
        ticket_expires_at: null,
        survival_mode: "server_assisted",
      },
      origin: {
        original_url:
          "http://localhost:3000/api/attachments/att-shared-video-1/content?session_id=s-1&variant=original",
        expires_at_epoch_seconds: 1775942400,
        available: true,
        role: "cold_backup_only",
      },
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
            variants: {
              canonical: {
                id: "canonical",
                mime_type: "image/webp",
                url: "/api/attachments/att-shared-image-1/content?session_id=s-1&variant=original",
                width: 1200,
                height: 800,
              },
            },
            distribution: {
              swarm_id: "swarm-hash-att-shared-image-1",
              announce_urls: ["/api/swarm/announce"],
              web_seed_url:
                "/api/attachments/att-shared-image-1/content?session_id=s-1&variant=original",
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
    const transport = 创建测试传输();

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
      variants: {
        canonical: {
          id: "canonical",
          mime_type: "image/webp",
          url: "http://localhost:3000/api/attachments/att-shared-image-1/content?session_id=s-1&variant=original",
          width: 1200,
          height: 800,
        },
      },
      distribution: {
        swarm_id: "swarm-hash-att-shared-image-1",
        announce_urls: ["ws://localhost:3000/api/swarm/announce"],
        web_seed_url:
          "http://localhost:3000/api/attachments/att-shared-image-1/content?session_id=s-1&variant=original",
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
    expect("preview" in ((result.media_asset ?? {}) as Record<string, unknown>)).toBe(false);
    expect("full" in ((result.media_asset ?? {}) as Record<string, unknown>)).toBe(false);
    expect("original" in ((result.media_asset ?? {}) as Record<string, unknown>)).toBe(false);
  });

  it("共享契约实现不应继续出现迁移期旧表面叙事", () => {
    const source = readFileSync(new URL("../../src/共享/契约基础.rs", import.meta.url), "utf-8");
    expect(source).not.toMatch(/迁移期.*表面/);
    expect(source.includes("流媒体视频")).toBe(false);
    expect(source.includes("流媒体音频")).toBe(false);
    expect(source.includes("媒体清单描述")).toBe(false);
  });

  it("前端共享契约与依赖清单不再保留第二链空壳", () => {
    const contractSource = readFileSync(new URL("../聊天共享/契约.ts", import.meta.url), "utf-8");
    const packageSource = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    const entrySource = readFileSync(new URL("../入口.ts", import.meta.url), "utf-8");

    expect(existsSync(new URL("../契约.ts", import.meta.url))).toBe(false);
    expect(contractSource.includes("streaming_asset")).toBe(false);
    expect(contractSource.includes("streaming_video")).toBe(false);
    expect(contractSource.includes("hls_master_url")).toBe(false);
    expect(contractSource.includes("dash_mpd_url")).toBe(false);
    expect(contractSource.includes("manifest: null")).toBe(false);
    expect(contractSource.includes("lifecycle: null")).toBe(false);
    expect(packageSource.includes('"hls.js"')).toBe(false);
    expect(packageSource.includes('"p2p-media-loader-hlsjs"')).toBe(false);
    expect(packageSource.includes('"workbox-range-requests"')).toBe(false);
    expect(packageSource.includes('"@videojs/html"')).toBe(false);
    expect(entrySource.includes("@videojs/html/video/skin.css")).toBe(false);
  });

  it("仓库清理后不再保留死模块、跟踪日志和未完成计划态", () => {
    expect(existsSync(new URL("../../src/房间外壳.rs", import.meta.url))).toBe(false);
    const shellSource = readFileSync(new URL("../../src/房间/外壳.rs", import.meta.url), "utf-8");
    const 旧计划路径 = new URL(
      "../../docs/superpowers/plans/2026-04-28-唯一WebTorrent万人群聊零崩溃零闪烁执行计划.md",
      import.meta.url
    );
    const 当前计划路径 = new URL(
      "../../docs/superpowers/plans/2026-05-05-纯WebTorrent主链收尾清理执行计划.md",
      import.meta.url
    );
    expect(shellSource.includes("mod 流媒体打包迁移测试 {}")).toBe(false);
    expect(existsSync(new URL("../../tmp/launcher.out.log", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../tmp/launcher.err.log", import.meta.url))).toBe(false);
    expect(existsSync(旧计划路径)).toBe(false);
    expect(existsSync(当前计划路径)).toBe(true);
  });
});
