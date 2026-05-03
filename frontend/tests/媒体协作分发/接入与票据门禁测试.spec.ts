import { describe, expect, it, vi } from "vitest";
import {
  获取或创建协作分发浏览器运行时,
  接入协作分发种子,
  协作分发JoinTicket失效错误,
  type 协作分发运行时环境不支持错误,
  type WebTorrent浏览器客户端,
} from "../../媒体/媒体协作分发";
import {
  创建假Storage,
  创建假WebTorrent构造器,
  创建可观测假Torrent,
  准备好的定位结果,
  准备已激活媒体ServiceWorker注册,
  注册媒体协作分发测试基线,
  解析协作分发源,
} from "./测试支撑";

describe("媒体协作分发 / 接入与票据门禁", () => {
  注册媒体协作分发测试基线();
  it("join_ticket 存在时会通过 getAnnounceOpts 传给 tracker，而不是前端自己拼第二套 announce URL", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-ticket-opts");
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      expect(options.getAnnounceOpts?.()).toEqual({
        ticket: "ticket-att-ticket-opts",
      });
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-ticket-opts");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.join_ticket = "ticket-att-ticket-opts";

    const source = await 解析协作分发源({
      attachmentId: "att-ticket-opts",
      kind: "video",
      locator,
    });

    expect(source).toEqual({
      src: "blob:http://media.local/swarm-att-ticket-opts",
      hint: null,
      locallyComplete: false,
      formalByteSource: "webtorrent_official_stream",
    });
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("join_ticket 续租引用更新后 getAnnounceOpts 会读取新票据", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-ticket-ref"
    );
    let getAnnounceOpts!: () => Record<string, string | undefined>;
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      getAnnounceOpts = options.getAnnounceOpts!;
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-ticket-ref");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.join_ticket = "ticket-old";
    const ticketRef = { value: "ticket-old" };

    await 接入协作分发种子(
      {
        client: new ctor(),
        streamServer: { close: vi.fn() },
      },
      locator.distribution,
      { joinTicketRef: ticketRef }
    );

    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-old" });
    ticketRef.value = "ticket-new";
    expect(getAnnounceOpts()).toEqual({ ticket: "ticket-new" });
  });

  it("受控 announce 缺少 join_ticket 时会直接按门禁失效收口，而不是继续无票入群", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const add = vi.fn();
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-missing-ticket");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.announce_urls = ["wss://im.example.com/api/swarm/announce"];
    locator.distribution.join_ticket = null;

    await expect(
      接入协作分发种子(
        {
          client: new ctor(),
          streamServer: { close: vi.fn() },
        },
        locator.distribution
      )
    ).rejects.toBeInstanceOf(协作分发JoinTicket失效错误);
    expect(add).not.toHaveBeenCalled();
  });

  it("接入协作分发种子时会把已经收口好的 websocket announce 原样交给 WebTorrent", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-announce-forward"
    );
    let announceUrls: string[] | undefined;
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      announceUrls = options.announce;
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-announce-forward");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.announce_urls = [
      "wss://localhost/api/swarm/announce",
      "wss://tracker.koko.local/announce",
    ];
    locator.distribution.join_ticket = "ticket-att-announce-forward";

    await 接入协作分发种子(
      {
        client: new ctor(),
        streamServer: { close: vi.fn() },
      },
      locator.distribution
    );

    expect(add).toHaveBeenCalledTimes(1);
    expect(announceUrls).toEqual([
      "wss://localhost/api/swarm/announce",
      "wss://tracker.koko.local/announce",
    ]);
  });

  it("接入协作分发种子时会优先交给项目可控的 IndexedDB chunk store，避免看过的 WebTorrent 字节在刷新后漂移", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: vi.fn(),
      },
    });
    vi.stubGlobal("FileSystemFileHandle", {
      prototype: {
        createWritable: vi.fn(),
      },
    });
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-persistent-store"
    );
    const addOptionsList: Array<Parameters<WebTorrent浏览器客户端["add"]>[1]> = [];
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      addOptionsList.push(options);
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-persistent-store");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }

    await 接入协作分发种子(
      {
        client: new ctor(),
        streamServer: { close: vi.fn() },
      },
      locator.distribution
    );

    const addOptions = addOptionsList[0];
    expect(addOptions?.store).toBeTypeOf("function");
    expect(addOptions?.destroyStoreOnDestroy).toBe(false);
  });

  it("接入 WebTorrent 种子时会同时调高 torrent 与共享 tracker socket 监听器预算，避免高并发 swarm 冷启动被误报成泄漏", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-listener-budget"
    );
    const getMaxListeners = vi.fn(() => 10);
    const setMaxListeners = vi.fn();
    const trackerSocketGetMaxListeners = vi.fn(() => 10);
    const trackerSocketSetMaxListeners = vi.fn();
    Object.assign(torrent, {
      getMaxListeners,
      setMaxListeners,
      discovery: {
        tracker: {
          _trackers: [
            {
              socket: {
                getMaxListeners: trackerSocketGetMaxListeners,
                setMaxListeners: trackerSocketSetMaxListeners,
              },
            },
          ],
        },
      },
    });
    const add = vi.fn(((_torrentId, _options, onTorrent) => {
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-listener-budget");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }

    await 解析协作分发源({
      attachmentId: "att-listener-budget",
      kind: "video",
      locator,
    });

    expect(setMaxListeners).toHaveBeenCalledWith(expect.any(Number));
    const [listenerBudget] = setMaxListeners.mock.calls[0] ?? [];
    expect(listenerBudget).toBeGreaterThanOrEqual(64);
    expect(trackerSocketSetMaxListeners).toHaveBeenCalledWith(listenerBudget);
  });

  it("WebTorrent 运行时会把 RTCDataChannel 的预期关闭错误降噪，但不吞真实错误", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    class FakeRTCDataChannel extends EventTarget {
      onerror: ((event: Event) => void) | null = null;
    }
    class FakeRTCPeerConnection extends EventTarget {
      declare ondatachannel: ((event: { channel: FakeRTCDataChannel }) => void) | null;

      createDataChannel(): FakeRTCDataChannel {
        return new FakeRTCDataChannel();
      }
    }
    vi.stubGlobal("RTCPeerConnection", FakeRTCPeerConnection);
    const { ctor } = 创建假WebTorrent构造器(
      vi.fn(((_torrentId, _options, onTorrent) => {
        const { torrent } = 创建可观测假Torrent("blob:http://media.local/swarm-att-rtc-close");
        onTorrent(torrent);
        return torrent;
      }) as WebTorrent浏览器客户端["add"])
    );

    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const pc = new FakeRTCPeerConnection();
    const outboundChannel = pc.createDataChannel();
    let expectedCloseDeliveredToPeer = false;
    outboundChannel.addEventListener("error", () => {
      expectedCloseDeliveredToPeer = true;
    });
    const expectedClose = new Event("error", { cancelable: true });
    Object.defineProperty(expectedClose, "error", {
      value: new Error("User-Initiated Abort, reason=Close called"),
    });

    outboundChannel.dispatchEvent(expectedClose);

    expect(expectedClose.defaultPrevented).toBe(true);
    expect(expectedCloseDeliveredToPeer).toBe(false);

    let realErrorDeliveredToPeer = false;
    outboundChannel.addEventListener("error", () => {
      realErrorDeliveredToPeer = true;
    });
    const realError = new Event("error", { cancelable: true });
    Object.defineProperty(realError, "error", {
      value: new Error("data channel failed for another reason"),
    });
    outboundChannel.dispatchEvent(realError);

    expect(realError.defaultPrevented).toBe(false);
    expect(realErrorDeliveredToPeer).toBe(true);

    const inboundChannel = new FakeRTCDataChannel();
    pc.ondatachannel = () => undefined;
    pc.ondatachannel?.({ channel: inboundChannel });
    const inboundExpectedClose = new Event("error", { cancelable: true });
    Object.defineProperty(inboundExpectedClose, "error", {
      value: new Error("User-Initiated Abort, reason=Close called"),
    });

    inboundChannel.dispatchEvent(inboundExpectedClose);

    expect(inboundExpectedClose.defaultPrevented).toBe(true);
  });

  it("locator 给出 media_state.retry_after_ms 时，会透传给 noPeersIntervalTime 统一探测节奏", async () => {
    const registration = 准备已激活媒体ServiceWorker注册();
    const { torrent } = 创建可观测假Torrent(
      "blob:http://media.local/swarm-att-retry-interval"
    );
    const add = vi.fn(((_torrentId, options, onTorrent) => {
      expect((options as { noPeersIntervalTime?: number }).noPeersIntervalTime).toBe(2000);
      onTorrent(torrent);
      return torrent;
    }) as WebTorrent浏览器客户端["add"]);
    const { ctor } = 创建假WebTorrent构造器(add);
    await 获取或创建协作分发浏览器运行时(async () => ctor, async () => registration);

    const locator = 准备好的定位结果("att-retry-interval");
    if (!locator.distribution) {
      throw new Error("测试前提失败：缺少 distribution");
    }
    locator.distribution.media_state = {
      code: "MEDIA_CONNECTING_TO_PEERS",
      retry_after_ms: 2000,
    };

    await 解析协作分发源({
      attachmentId: "att-retry-interval",
      kind: "video",
      locator,
    });

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("不同 session 的本地 torrent 缓存不会在 fetch 失败时被错误复用", async () => {
    vi.resetModules();
    const storage = 创建假Storage();
    const 缓存模块 = await import("../../媒体/媒体协作分发缓存");
    const repo = 缓存模块.创建浏览器协作分发Torrent缓存仓库(storage);
    repo.写入全部({
      "torrent-info-hash-stale-session": {
        torrentInfoHash: "torrent-info-hash-stale-session",
        sessionId: "s-old",
        torrentUrl: "http://media.local/torrent-att-stale-session?session_id=s-old",
        bytes: [1, 2, 3],
      },
    });
    vi.doMock("../../平台/index.js", () => ({
      获取默认浏览器应用平台: () => ({
        storage: {
          协作分发缓存仓库: () => repo,
        },
      }),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
      }))
    );
    const add = vi.fn();
    const mod = await import("../../媒体/媒体协作分发");

    await expect(
      mod.接入协作分发种子(
        {
          client: {
            add,
          },
          streamServer: {},
        } as never,
        {
          content_id: "content_att-stale-session",
          content_hash: "hash-att-stale-session",
          swarm_id: "swarm-att-stale-session",
          web_seed_until: "1775942400",
          torrent_url: "http://media.local/torrent-att-stale-session?session_id=s-new",
          torrent_info_hash: "torrent-info-hash-stale-session",
          announce_urls: ["ws://127.0.0.1:7072"],
          web_seed_url: "http://media.local/web-seed-att-stale-session",
          presence_url: "/api/media/att-stale-session/presence?session_id=s-new",
          join_ticket: null,
          ticket_expires_at: null,
          media_state: {
            code: "MEDIA_READY" as const,
            retry_after_ms: null,
          },
          survival_mode: "server_assisted" as const,
        }
      )
    ).rejects.toThrow("加载受控 torrent 失败: 503");

    expect(add).not.toHaveBeenCalled();
    mod.重置协作分发浏览器运行时();
    vi.doUnmock("../../平台/index.js");
    vi.resetModules();
  });

  it("当前页还没被根 service worker 接管时，会先请求 active worker 主动 claim 再继续初始化", async () => {
    vi.resetModules();
    let controllerAttached = false;
    const registration = {
      active: {
        state: "activated",
        postMessage: vi.fn((payload: unknown) => {
          if (
            typeof payload === "object" &&
            payload !== null &&
            "type" in payload &&
            (payload as { type?: unknown }).type === "CLAIM_CLIENTS"
          ) {
            controllerAttached = true;
          }
        }),
      },
    };
    const platform = {
      启动: vi.fn(async () => undefined),
      snapshot: () => ({
        serviceWorker: {
          controllerAttached,
        },
      }),
      serviceWorker: {
        读取注册: () => registration,
      },
    };
    vi.doMock("../../平台/index.js", () => ({
      获取默认浏览器应用平台: () => platform,
    }));
    const ctorSpy = vi.fn();
    const createServer = vi.fn(() => ({
      close: vi.fn(),
    }));
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;
      add = vi.fn();
      destroy = vi.fn();
      remove = vi.fn();
    }
    const mod = await import("../../媒体/媒体协作分发");

    const runtime = await mod.获取或创建协作分发浏览器运行时(
      async () => FakeWebTorrent as never
    );

    expect(platform.启动).toHaveBeenCalledTimes(1);
    expect(runtime).toBeDefined();
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(registration.active.postMessage).toHaveBeenCalledWith({
      type: "CLAIM_CLIENTS",
    });
    expect(createServer).toHaveBeenCalledWith({
      controller: registration,
    });

    mod.重置协作分发浏览器运行时();
    vi.doUnmock("../../平台/index.js");
  });

  it("active worker 请求 claim 后仍未接管页面时，会中止 browser server 初始化并返回明确错误", async () => {
    vi.resetModules();
    const registration = {
      active: {
        state: "activated",
        postMessage: vi.fn(),
      },
    };
    const platform = {
      启动: vi.fn(async () => undefined),
      snapshot: () => ({
        serviceWorker: {
          controllerAttached: false,
        },
      }),
      serviceWorker: {
        读取注册: () => registration,
      },
    };
    vi.doMock("../../平台/index.js", () => ({
      获取默认浏览器应用平台: () => platform,
    }));
    const ctorSpy = vi.fn();
    const createServer = vi.fn();
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;
      add = vi.fn();
      destroy = vi.fn();
      remove = vi.fn();
    }
    const mod = await import("../../媒体/媒体协作分发");

    await expect(
      mod.获取或创建协作分发浏览器运行时(async () => FakeWebTorrent as never)
    ).rejects.toThrow("service worker 尚未接管当前页面");

    expect(registration.active.postMessage).toHaveBeenCalledWith({
      type: "CLAIM_CLIENTS",
    });
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(createServer).not.toHaveBeenCalled();
    mod.重置协作分发浏览器运行时();
    vi.doUnmock("../../平台/index.js");
  });

  it("非安全上下文会直接拒绝协作分发运行时初始化，并返回稳定语义错误", async () => {
    vi.resetModules();
    vi.stubGlobal("isSecureContext", false);
    const platform = {
      启动: vi.fn(async () => undefined),
      snapshot: () => ({
        serviceWorker: {
          controllerAttached: true,
        },
      }),
      serviceWorker: {
        读取注册: vi.fn(),
      },
    };
    vi.doMock("../../平台/index.js", () => ({
      获取默认浏览器应用平台: () => platform,
    }));
    const ctorSpy = vi.fn();
    const createServer = vi.fn();
    class FakeWebTorrent {
      constructor() {
        ctorSpy();
      }

      createServer = createServer;
      add = vi.fn();
      destroy = vi.fn();
      remove = vi.fn();
    }
    const mod = await import("../../媒体/媒体协作分发");

    await expect(
      mod.获取或创建协作分发浏览器运行时(async () => FakeWebTorrent as never)
    ).rejects.toMatchObject({
      name: "协作分发运行时环境不支持错误",
      code: "swarm_runtime_unsupported",
      reason: "insecure_context",
    } satisfies Pick<协作分发运行时环境不支持错误, "name" | "code" | "reason">);

    expect(platform.启动).not.toHaveBeenCalled();
    expect(platform.serviceWorker.读取注册).not.toHaveBeenCalled();
    expect(ctorSpy).not.toHaveBeenCalled();
    expect(createServer).not.toHaveBeenCalled();
    mod.重置协作分发浏览器运行时();
    vi.doUnmock("../../平台/index.js");
  });

});
