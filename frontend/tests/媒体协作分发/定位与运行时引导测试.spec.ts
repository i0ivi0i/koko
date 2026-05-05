import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { 媒体定位结果 } from "../../聊天共享/契约.js";
import {
  获取或创建协作分发浏览器运行时,
  读取可用协作分发片段,
  读取协作分发定位片段,
  type WebTorrent浏览器客户端,
} from "../../媒体/媒体协作分发";
import { 创建资产协作分发运行时 } from "../../媒体/资产协作分发运行时.js";
import { 准备好的定位结果, 注册媒体协作分发测试基线 } from "./测试支撑";

describe("媒体协作分发 / 定位与运行时引导", () => {
  注册媒体协作分发测试基线();
  it("会从 locator 中读出稳定的协作分发片段", () => {
    const distribution = 读取协作分发定位片段({
      attachment_id: "att-1",
      kind: "video",
      status: "ready",
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-1",
        content_hash: "hash-1",
        swarm_id: "swarm-hash-1",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-1",
        torrent_info_hash: "torrent-info-hash-1",
        announce_urls: ["wss://tracker.media.local/announce"],
        web_seed_url: "http://media.local/web-seed-1",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
    });

    expect(distribution).toEqual({
      content_id: "content_att-1",
      content_hash: "hash-1",
      swarm_id: "swarm-hash-1",
      web_seed_until: "1775942400",
      torrent_url: "http://media.local/torrent-1",
      torrent_info_hash: "torrent-info-hash-1",
      announce_urls: ["wss://tracker.media.local/announce"],
      web_seed_url: "http://media.local/web-seed-1",
      join_ticket: null,
      ticket_expires_at: null,
      media_state: {
        code: "MEDIA_READY" as const,
        retry_after_ms: null,
      },
      survival_mode: "server_assisted" as const,
    });
  });

  it("locator 没有协作分发片段时返回 null", () => {
    const distribution = 读取协作分发定位片段({
      attachment_id: "att-2",
      kind: "image",
      status: "ready",
      thumbnail_url: "http://media.local/thumb-2",
      distribution: null,
    });

    expect(distribution).toBeNull();
  });

  it("media_state 显示无在线种子时，不会把分发片段误判成可用主链", () => {
    const locator = 准备好的定位结果("att-no-seed");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.media_state = {
      code: "MEDIA_NO_ONLINE_SEED",
      retry_after_ms: 15000,
    };

    const distribution = 读取可用协作分发片段(locator);

    expect(distribution).toBeNull();
  });

  it("media_state 显示连接群友时，仍允许继续进入同一 swarm 会话", () => {
    const locator = 准备好的定位结果("att-connecting");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.media_state = {
      code: "MEDIA_CONNECTING_TO_PEERS",
      retry_after_ms: 2000,
    };

    const distribution = 读取可用协作分发片段(locator);

    expect(distribution).not.toBeNull();
    expect(distribution?.torrent_info_hash).toBe("torrent-info-hash-att-connecting");
  });

  it("presence_url 相对地址只会基于协作分发表面的 web_seed_url 解析", () => {
    const locator = {
      attachment_id: "att-presence-base",
      kind: "video" as const,
      status: "ready" as const,
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-presence-base",
        content_hash: "hash-att-presence-base",
        swarm_id: "swarm-att-presence-base",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-att-presence-base",
        torrent_info_hash: "torrent-info-hash-att-presence-base",
        announce_urls: ["ws://127.0.0.1:7072"],
        web_seed_url: "http://media.local/web-seed-att-presence-base",
        presence_url: "/api/media/att-presence-base/presence?session_id=s-test",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "server_assisted" as const,
      },
      file_asset: {
        asset_id: "att-presence-base",
        content_hash: "hash-att-presence-base",
        kind: "file_video" as const,
        variants: {
          canonical: {
            id: "canonical",
            url: "http://media.local/canonical-att-presence-base.mp4",
            mime_type: "video/mp4",
            width: 1280,
            height: 720,
          },
        },
        distribution: {
          swarm_id: "swarm-att-presence-base",
          announce_urls: ["ws://127.0.0.1:7072"],
          web_seed_url: "http://media.local/web-seed-att-presence-base",
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "server_assisted" as const,
        },
        origin: {
          original_url: "http://media.local/original-att-presence-base",
          expires_at_epoch_seconds: 1775942400,
          available: true,
          role: "cold_backup_only" as const,
        },
      },
      blob_asset: null,
    } as 媒体定位结果;

    const distribution = 读取可用协作分发片段(locator);

    expect(distribution?.presence_url).toBe(
      "http://media.local/api/media/att-presence-base/presence?session_id=s-test"
    );
  });

  it("presence_url 缺少 web_seed_url 时不会再借冷源或 canonical 地址补成第二真相", () => {
    const locator = {
      attachment_id: "att-presence-no-webseed",
      kind: "video" as const,
      status: "ready" as const,
      thumbnail_url: null,
      distribution: {
        content_id: "content_att-presence-no-webseed",
        content_hash: "hash-att-presence-no-webseed",
        swarm_id: "swarm-att-presence-no-webseed",
        web_seed_until: "1775942400",
        torrent_url: "http://media.local/torrent-att-presence-no-webseed",
        torrent_info_hash: "torrent-info-hash-att-presence-no-webseed",
        announce_urls: ["ws://127.0.0.1:7072"],
        web_seed_url: null,
        presence_url: "/api/media/att-presence-no-webseed/presence?session_id=s-test",
        join_ticket: null,
        ticket_expires_at: null,
        media_state: {
          code: "MEDIA_READY" as const,
          retry_after_ms: null,
        },
        survival_mode: "peer_only_after_expiry" as const,
      },
      file_asset: {
        asset_id: "att-presence-no-webseed",
        content_hash: "hash-att-presence-no-webseed",
        kind: "file_video" as const,
        variants: {
          canonical: {
            id: "canonical",
            url: "http://media.local/canonical-att-presence-no-webseed.mp4",
            mime_type: "video/mp4",
            width: 1280,
            height: 720,
          },
        },
        distribution: {
          swarm_id: "swarm-att-presence-no-webseed",
          announce_urls: ["ws://127.0.0.1:7072"],
          web_seed_url: null,
          join_ticket: null,
          ticket_expires_at: null,
          survival_mode: "peer_only_after_expiry" as const,
        },
        origin: {
          original_url: "http://media.local/original-att-presence-no-webseed",
          expires_at_epoch_seconds: 1775942400,
          available: false,
          role: "cold_backup_only" as const,
        },
      },
      blob_asset: null,
    } as 媒体定位结果;

    const distribution = 读取可用协作分发片段(locator);

    expect(distribution?.presence_url).toBe(
      "/api/media/att-presence-no-webseed/presence?session_id=s-test"
    );
  });

  it("浏览器协作分发运行时会复用同一个 WebTorrent client，并把已激活的 service worker registration 传给 createServer", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    const createServer = vi.fn().mockReturnValue({ close: vi.fn() });
    const ctorSpy = vi.fn();
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;

      add = (() => {
        throw new Error("test should not call add");
      }) as WebTorrent浏览器客户端["add"];
    }
    const fakeCtor = FakeWebTorrent as unknown as new () => WebTorrent浏览器客户端;

    const first = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor,
      async () => registration
    );
    const second = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor,
      async () => registration
    );

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledWith({ controller: registration });
    expect(first).toBe(second);
  });

  it("首次初始化失败后不会把 rejected promise 永久缓存，后续条件恢复时会重新尝试并成功创建运行时", async () => {
    const registration = {
      active: {
        state: "activated",
      },
    };
    const createServer = vi.fn().mockReturnValue({ close: vi.fn() });
    const ctorSpy = vi.fn();
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;
      add = (() => {
        throw new Error("test should not call add");
      }) as WebTorrent浏览器客户端["add"];
    }
    const fakeCtor = FakeWebTorrent as unknown as new () => WebTorrent浏览器客户端;
    let firstAttempt = true;
    const readRegistration = vi.fn(async () => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("sw not ready");
      }
      return registration;
    });

    await expect(
      获取或创建协作分发浏览器运行时(async () => fakeCtor, readRegistration)
    ).rejects.toThrow("sw not ready");

    const runtime = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor,
      readRegistration
    );
    const sameRuntime = await 获取或创建协作分发浏览器运行时(
      async () => fakeCtor,
      readRegistration
    );

    expect(runtime).toBeDefined();
    expect(sameRuntime).toBe(runtime);
    expect(readRegistration).toHaveBeenCalledTimes(2);
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledTimes(1);
  });

  it("资产协作分发运行时只管理 swarm/session owner，不向壳层回声第二会话表", () => {
    const runtimeSource = readFileSync(
      resolve(process.cwd(), "媒体/资产协作分发运行时.ts"),
      "utf8"
    );
    const stateMachineSource = readFileSync(
      resolve(process.cwd(), "媒体/资产协作分发状态机.ts"),
      "utf8"
    );
    const runtime = 创建资产协作分发运行时();

    try {
      expect(runtime.snapshot().context.sessions).toEqual({});
      expect(runtime.读取会话状态("swarm-none")).toBeNull();
      expect("底层会话表" in (runtime as object)).toBe(false);
      expect("browserRuntime" in (runtime as object)).toBe(false);
      expect(stateMachineSource).toContain("AssetDistributionActor 只回答 swarm 会话是否存活、被谁占用、是否已经完整");
      expect(runtimeSource).not.toContain("createServer(");
      expect(runtimeSource).not.toContain("new WebTorrent");
    } finally {
      runtime.销毁();
    }
  });

  it("资产协作分发运行时 snapshot 只暴露会话投影，外部改写返回值不会污染内部 actor 真相", () => {
    const runtime = 创建资产协作分发运行时();

    try {
      const exposedSnapshot = runtime.snapshot();
      exposedSnapshot.context.sessions["swarm-shadow"] = {
        attachmentId: "att-shadow",
        swarmId: "swarm-shadow",
        torrentInfoHash: "torrent-shadow",
        contentHash: "content-shadow",
        consumers: ["viewer:att-shadow"],
        consumerAttachmentIds: {
          "viewer:att-shadow": "att-shadow",
        },
        consumerModes: {
          "viewer:att-shadow": "viewer",
        },
        eagerCompleting: false,
        locallyComplete: false,
        lifecycle: {
          state: "heavy_playback",
          generation: 0,
          activeReaderCount: 1,
          hasPresenceHeartbeat: false,
          hasJoinTicketRefresh: false,
        },
        hint: "正在协作分发",
      };

      expect(runtime.snapshot().context.sessions).toEqual({});
      expect(runtime.读取会话状态("swarm-shadow")).toBeNull();
    } finally {
      runtime.销毁();
    }
  });

});
