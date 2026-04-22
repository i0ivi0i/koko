import { createServer } from "node:http";
import { parseArgs } from "node:util";
import process from "node:process";

/**
 * 统一把 infoHash 归一化成小写十六进制。
 * 后端、tracker、sidecar 都按同一键空间收口，避免因为大小写差异产生重复会话。
 */
const 归一化InfoHash = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    return null;
  }
  return normalized;
};

const 读取请求体JSON = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
};

/**
 * 兼容控制面里可能出现的 ticket 命名：
 * - 新字段优先 `joinTicket`（JS 风格）；
 * - 同时接受 `join_ticket` / `ticket`，避免灰度阶段不同 caller 命名导致 seeder 漏票；
 * - 统一只把非空字符串透传给 tracker announce。
 */
const 读取JoinTicket = (payload) => {
  const raw =
    payload?.joinTicket ?? payload?.join_ticket ?? payload?.ticket ?? null;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const 发送JSON响应 = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

const 读取WebTorrent构造器 = async () => {
  /**
   * 优先尝试 webtorrent-hybrid：
   * 1. 它是官方 FAQ 明确提到的“Node 端可连接 WebRTC 浏览器 peer”路径；
   * 2. 但它包含原生依赖，某些开发机可能暂时没有装好；
   * 3. 回退到 webtorrent 时，sidecar 仍可工作，但会在日志里明确提醒能力边界。
   */
  try {
    const hybrid = await import("webtorrent-hybrid");
    return {
      Ctor: hybrid.default ?? hybrid.WebTorrent ?? hybrid,
      capability: "hybrid",
    };
  } catch (hybridError) {
    try {
      const fallback = await import("webtorrent");
      return {
        Ctor: fallback.default ?? fallback.WebTorrent ?? fallback,
        capability: "webtorrent",
      };
    } catch (fallbackError) {
      return {
        Ctor: null,
        capability: "mock",
        error: fallbackError ?? hybridError,
      };
    }
  }
};

const { values } = parseArgs({
  options: {
    host: {
      type: "string",
      default: "127.0.0.1",
    },
    port: {
      type: "string",
      default: process.env.SWARM_SEEDER_PORT ?? "7073",
    },
  },
});

const seederPort = Number(values.port);
if (!Number.isInteger(seederPort) || seederPort <= 0 || seederPort > 65535) {
  console.error(`[dev-seeder] 非法端口: ${values.port}`);
  process.exit(1);
}

const { Ctor: WebTorrentCtor, capability, error: webtorrentError } =
  await 读取WebTorrent构造器();
if (capability === "mock") {
  console.warn(
    "[dev-seeder] WebTorrent 运行时不可用，已退回 mock seeder（仅保留控制面语义）。",
    webtorrentError?.message ?? webtorrentError ?? ""
  );
} else if (capability !== "hybrid") {
  console.warn(
    "[dev-seeder] 当前未加载 webtorrent-hybrid；浏览器 WebRTC 互通能力可能受限（仅用于开发兜底）。"
  );
}

const client = WebTorrentCtor ? new WebTorrentCtor() : null;
const activeSessions = new Map();

const 读取活跃会话快照 = () =>
  Array.from(activeSessions.values()).map((session) => ({
    infoHash: session.infoHash,
    addedAt: session.addedAt,
    source: session.source,
    progress: Number.isFinite(session.torrent.progress)
      ? session.torrent.progress
      : 0,
    numPeers: Number.isFinite(session.torrent.numPeers)
      ? session.torrent.numPeers
      : 0,
    downloaded: Number.isFinite(session.torrent.downloaded)
      ? session.torrent.downloaded
      : 0,
    uploaded: Number.isFinite(session.torrent.uploaded)
      ? session.torrent.uploaded
      : 0,
  }));

const 绑定会话日志 = (session) => {
  session.torrent.on("warning", (warning) => {
    console.warn(`[dev-seeder][${session.infoHash}] warning:`, warning?.message ?? warning);
  });
  session.torrent.on("error", (error) => {
    console.error(`[dev-seeder][${session.infoHash}] error:`, error?.message ?? error);
  });
};

const 选择种子来源 = (payload, normalizedInfoHash) => {
  if (typeof payload.magnetUri === "string" && payload.magnetUri.trim().length > 0) {
    return payload.magnetUri.trim();
  }
  if (typeof payload.torrentUrl === "string" && payload.torrentUrl.trim().length > 0) {
    return payload.torrentUrl.trim();
  }
  if (normalizedInfoHash) {
    return `magnet:?xt=urn:btih:${normalizedInfoHash}`;
  }
  return null;
};

const 启动做种会话 = async (payload) => {
  const normalizedInfoHash = 归一化InfoHash(payload.infoHash);
  if (!normalizedInfoHash) {
    throw new Error("infoHash 非法或缺失");
  }
  const existing = activeSessions.get(normalizedInfoHash);
  if (existing) {
    return { session: existing, created: false };
  }

  const source = 选择种子来源(payload, normalizedInfoHash);
  if (!source) {
    throw new Error("缺少 magnetUri/torrentUrl/infoHash，无法启动做种");
  }

  if (!client) {
    const session = {
      infoHash: normalizedInfoHash,
      source,
      torrent: {
        progress: 0,
        numPeers: 0,
        downloaded: 0,
        uploaded: 0,
        destroy(callback) {
          if (typeof callback === "function") {
            callback();
          }
        },
      },
      addedAt: new Date().toISOString(),
    };
    activeSessions.set(normalizedInfoHash, session);
    return { session, created: true };
  }

  const announce = Array.isArray(payload.announceUrls)
    ? payload.announceUrls.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const urlList =
    typeof payload.webSeedUrl === "string" && payload.webSeedUrl.trim().length > 0
      ? [payload.webSeedUrl.trim()]
      : [];
  const joinTicket = 读取JoinTicket(payload);

  const torrent = await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("做种启动超时"));
      }
    }, 15_000);
    const options = {
      announce,
      urlList,
      /**
       * seeder 也必须按统一 swarm 门禁入场：
       * - tracker 开启 join ticket 时，announce 请求要带 ticket；
       * - 不允许 seeder 走“无票特权”导致 join_ticket_invalid 噪音；
       * - 这里透传的是 swarm 控制面门禁，不是前端第二播放链。
       */
      ...(joinTicket
        ? {
            getAnnounceOpts: () => ({
              ticket: joinTicket,
            }),
          }
        : {}),
    };
    const instance = client.add(source, options, (readyTorrent) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(readyTorrent);
    });
    instance.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });

  const actualInfoHash = 归一化InfoHash(torrent.infoHash) ?? normalizedInfoHash;
  const session = {
    infoHash: actualInfoHash,
    source,
    torrent,
    addedAt: new Date().toISOString(),
  };
  activeSessions.set(actualInfoHash, session);
  绑定会话日志(session);
  return { session, created: true };
};

const 停止做种会话 = async (infoHashLike) => {
  const normalizedInfoHash = 归一化InfoHash(infoHashLike);
  if (!normalizedInfoHash) {
    return false;
  }
  const session = activeSessions.get(normalizedInfoHash);
  if (!session) {
    return false;
  }
  await new Promise((resolve) => {
    session.torrent.destroy(() => resolve());
  });
  activeSessions.delete(normalizedInfoHash);
  return true;
};

const 对账做种会话 = async (payload) => {
  const keep = new Set(
    Array.isArray(payload?.activeInfoHashes)
      ? payload.activeInfoHashes.map((value) => 归一化InfoHash(value)).filter(Boolean)
      : []
  );
  const removed = [];
  for (const infoHash of Array.from(activeSessions.keys())) {
    if (keep.has(infoHash)) {
      continue;
    }
    const stopped = await 停止做种会话(infoHash);
    if (stopped) {
      removed.push(infoHash);
    }
  }
  return removed;
};

const server = createServer(async (request, response) => {
  const method = (request.method ?? "GET").toUpperCase();
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  try {
    if (method === "GET" && url.pathname === "/health") {
      发送JSON响应(response, 200, {
        ok: true,
        capability,
        activeCount: activeSessions.size,
        sessions: 读取活跃会话快照(),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/seed/start") {
      const payload = await 读取请求体JSON(request);
      const { session, created } = await 启动做种会话(payload);
      发送JSON响应(response, 200, {
        ok: true,
        created,
        infoHash: session.infoHash,
        activeCount: activeSessions.size,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/seed/stop") {
      const payload = await 读取请求体JSON(request);
      const stopped = await 停止做种会话(payload?.infoHash);
      发送JSON响应(response, 200, {
        ok: true,
        stopped,
        activeCount: activeSessions.size,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/seed/reconcile") {
      const payload = await 读取请求体JSON(request);
      const removed = await 对账做种会话(payload ?? {});
      发送JSON响应(response, 200, {
        ok: true,
        removed,
        activeCount: activeSessions.size,
      });
      return;
    }

    发送JSON响应(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    发送JSON响应(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const 优雅退出 = async () => {
  for (const infoHash of Array.from(activeSessions.keys())) {
    await 停止做种会话(infoHash);
  }
  if (client) {
    await new Promise((resolve) => {
      client.destroy(() => resolve());
    });
  }
  process.exit(0);
};

process.once("SIGINT", () => {
  void 优雅退出();
});
process.once("SIGTERM", () => {
  void 优雅退出();
});

server.listen(seederPort, values.host, () => {
  console.log(
    `[dev-seeder] Seeder ready on http://${values.host}:${seederPort} (capability=${capability})`
  );
});
