import Server from "bittorrent-tracker/server";
import jsonwebtoken from "jsonwebtoken";

const 失效JoinTicket原因 = "join_ticket_invalid";

function readCliOptions(argv) {
  const options = {
    port: 7072,
    publicUrl: "ws://127.0.0.1:7072",
    bindHost: "0.0.0.0",
    ticketSecret: process.env.SWARM_TICKET_SECRET?.trim() || null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--port") {
      if (!next) {
        throw new Error("缺少 --port 的值。");
      }
      const parsedPort = Number.parseInt(next, 10);
      if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        throw new Error(`无效的 tracker 端口: ${next}`);
      }
      options.port = parsedPort;
      index += 1;
      continue;
    }

    if (current === "--public-url") {
      if (!next) {
        throw new Error("缺少 --public-url 的值。");
      }
      options.publicUrl = next;
      index += 1;
      continue;
    }

    if (current === "--bind-host") {
      if (!next) {
        throw new Error("缺少 --bind-host 的值。");
      }
      options.bindHost = next;
      index += 1;
      continue;
    }

    if (current === "--ticket-secret") {
      if (!next) {
        throw new Error("缺少 --ticket-secret 的值。");
      }
      options.ticketSecret = next;
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${current}`);
  }

  return options;
}

function formatSocketAddress(address) {
  if (!address || typeof address !== "object") {
    return "unknown";
  }

  const host = address.address === "::" ? "localhost" : address.address;
  return `${host}:${address.port}`;
}

function 读取Ticket参数(params) {
  const candidate = params.ticket;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  if (Array.isArray(candidate) && typeof candidate[0] === "string" && candidate[0].length > 0) {
    return candidate[0];
  }
  return null;
}

function createJoinTicketFilter(ticketSecret) {
  if (!ticketSecret) {
    return undefined;
  }

  return (infoHash, params, cb) => {
    const ticket = 读取Ticket参数(params);
    if (!ticket) {
      cb(new Error(失效JoinTicket原因));
      return;
    }

    try {
      /**
       * tracker 只校验 join ticket 这条受控门禁：
       * 1. 签名/过期判断直接站在成熟 JWT 库上，不手搓 crypto；
       * 2. tracker 只认“这张票是不是给当前 infoHash 的”，不重复承载业务权限真相；
       * 3. 对客户端统一返回稳定 reason，前端恢复链才能只认一条错误语义。
       */
      const payload = jsonwebtoken.verify(ticket, ticketSecret, {
        algorithms: ["HS256"],
      });
      if (!payload || typeof payload !== "object" || payload.ih !== infoHash) {
        throw new Error("join ticket info hash mismatch");
      }
      cb(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[tracker] 拒绝 swarm ${infoHash}: ${message}`);
      cb(new Error(失效JoinTicket原因));
    }
  };
}

async function main() {
  const options = readCliOptions(process.argv.slice(2));
  const joinTicketFilter = createJoinTicketFilter(options.ticketSecret);

  // 这里故意只复用官方 `bittorrent-tracker/server` 子入口：
  // 1. 当前版本 CLI 会先 import 整个 index，把 client/node-datachannel 一并拖进来；
  // 2. 我们在开发态只需要 websocket tracker，不需要手搓或强行修补官方 CLI；
  // 3. 这层脚本只负责把端口、监听 host 和日志收口成 run.ps1 可托管的稳定进程。
  const server = new Server({
    http: false,
    udp: false,
    ws: true,
    stats: true,
    trustProxy: false,
    ...(joinTicketFilter
      ? {
          filter: joinTicketFilter,
        }
      : {}),
  });

  server.on("error", (error) => {
    console.error(`[tracker] ${error.message}`);
  });

  server.on("warning", (warning) => {
    console.warn(`[tracker] ${warning.message}`);
  });

  server.on("listening", () => {
    const websocketAddress = server.ws?.address();
    const httpAddress = server.http?.address();
    console.log(`[tracker] WebSocket tracker 监听: ws://${formatSocketAddress(websocketAddress)}`);
    console.log(`[tracker] Tracker 对外 announce: ${options.publicUrl}`);
    console.log(
      `[tracker] Join ticket 门禁: ${options.ticketSecret ? "enabled" : "disabled"}`
    );
    if (httpAddress) {
      console.log(`[tracker] Tracker 统计页: http://${formatSocketAddress(httpAddress)}/stats`);
    }
  });

  const shutdown = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
    });

  process.on("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
  });

  server.listen(
    options.port,
    {
      http: options.bindHost,
      udp4: options.bindHost,
      udp6: "::",
    },
    () => {}
  );
}

main().catch((error) => {
  console.error(`[tracker] ${error.message}`);
  process.exit(1);
});
