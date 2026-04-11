import Server from "bittorrent-tracker/server";

function readCliOptions(argv) {
  const options = {
    port: 7072,
    publicUrl: "ws://127.0.0.1:7072",
    bindHost: "0.0.0.0",
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

async function main() {
  const options = readCliOptions(process.argv.slice(2));

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
