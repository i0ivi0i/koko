import type { 媒体协作分发定位片段, 媒体定位结果, 媒体种类 } from "../契约.js";
import { 获取默认浏览器应用平台 } from "../平台/index.js";
import type { 协作分发Torrent缓存快照 } from "./媒体协作分发缓存.js";

export interface WebTorrent文件 {
  readonly streamURL: string;
  select(priority?: number): void;
}

export interface WebTorrent连接 {
  readonly type?: string;
}

export interface WebTorrent种子 {
  files: WebTorrent文件[];
  on(event: "error", handler: (error: unknown) => void): void;
  on(event: "wire", handler: (wire: WebTorrent连接) => void): void;
  on(event: "noPeers", handler: () => void): void;
  on(event: "done", handler: () => void): void;
  destroy?(options?: { destroyStore?: boolean }): void;
}

type WebTorrent流服务 = {
  close?(): void;
};

export interface WebTorrent浏览器客户端 {
  createServer(options: { controller?: unknown }): WebTorrent流服务;
  add(
    torrentId: Uint8Array | ArrayBuffer,
    options: {
      announce?: string[];
      urlList?: string[];
      private?: boolean;
      maxWebConns?: number;
      destroyStoreOnDestroy?: boolean;
      getAnnounceOpts?: () => Record<string, string | undefined>;
    },
    onTorrent: (torrent: WebTorrent种子) => void
  ): WebTorrent种子;
  remove?(torrentId: string | Uint8Array | ArrayBuffer, options?: { destroyStore?: boolean }): void;
  destroy?(): void;
}

type WebTorrent浏览器构造器 = new () => WebTorrent浏览器客户端;

export interface 协作分发浏览器运行时 {
  client: WebTorrent浏览器客户端;
  streamServer: WebTorrent流服务;
}

export interface 协作分发媒体源 {
  src: string;
  hint: "正在协作分发" | "正在补块";
}

export type 协作分发会话事件 =
  | { type: "SWARM_ACTIVE"; attachmentId: string; swarmId: string }
  | { type: "SWARM_NO_PEERS"; attachmentId: string; swarmId: string }
  | { type: "ASSET_COMPLETE"; attachmentId: string; swarmId: string; contentHash: string };

const 协作分发存活上报间隔毫秒 = 60_000;

type 协作分发会话 = {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
  contentHash: string;
  sourcePromise: Promise<{ src: string } | null>;
  eagerCompleting: boolean;
  locallyComplete: boolean;
  hint: 协作分发媒体源["hint"] | null;
  presenceIntervalId: ReturnType<typeof setInterval> | null;
  torrent: WebTorrent种子 | null;
  file: WebTorrent文件 | null;
  consumerBindings: Map<
    string,
    {
      attachmentId: string;
      onSessionEvent: ((event: 协作分发会话事件) => void) | null;
    }
  >;
};

let 协作分发浏览器运行时Promise: Promise<协作分发浏览器运行时> | null = null;
let 协作分发浏览器运行时实例: 协作分发浏览器运行时 | null = null;
const 协作分发会话表 = new Map<string, 协作分发会话>();

function 读取协作分发Torrent缓存仓库() {
  return 获取默认浏览器应用平台().storage.协作分发缓存仓库?.() ?? null;
}

function 读取协作分发Torrent缓存快照(): 协作分发Torrent缓存快照 {
  return 读取协作分发Torrent缓存仓库()?.读取全部() ?? {};
}

function 写入协作分发Torrent缓存快照(snapshot: 协作分发Torrent缓存快照): void {
  读取协作分发Torrent缓存仓库()?.写入全部(snapshot);
}

function 保存协作分发Torrent缓存记录(
  torrentInfoHash: string,
  torrentUrl: string,
  bytes: Uint8Array
): void {
  const current = 读取协作分发Torrent缓存快照();
  current[torrentInfoHash] = {
    torrentInfoHash,
    torrentUrl,
    bytes: Array.from(bytes),
  };
  写入协作分发Torrent缓存快照(current);
}

function 读取协作分发Torrent缓存字节(torrentInfoHash: string): Uint8Array | null {
  const record = 读取协作分发Torrent缓存快照()[torrentInfoHash];
  if (!record) {
    return null;
  }
  return new Uint8Array(record.bytes);
}

async function 默认加载WebTorrent浏览器构造器(): Promise<WebTorrent浏览器构造器> {
  const mod = await import("webtorrent/dist/webtorrent.min.js");
  return (mod.default ?? mod) as WebTorrent浏览器构造器;
}

/**
 * 协作分发只消费平台层已经托管好的 media service worker registration：
 * 1. 页面侧不再自己等待浏览器原生的 SW ready promise；
 * 2. 真正的注册、激活和更新握手都归 BrowserAppPlatform；
 * 3. 这里只有“我要一个已经可用的 media worker”这一个需求。
 */
async function 默认读取媒体ServiceWorker注册(): Promise<unknown> {
  const platform = 获取默认浏览器应用平台();
  await platform.启动();
  const registration = platform.serviceWorker.读取注册("media");
  if (!registration) {
    throw new Error("media service worker 尚未注册");
  }
  if (registration.active?.state !== "activated") {
    throw new Error("media service worker 尚未激活");
  }
  return registration;
}

async function 尝试请求持久化存储(): Promise<void> {
  await 获取默认浏览器应用平台().storage.请求持久化存储?.();
}

/**
 * Phase 2 先把“浏览器运行时底座”收口在这里：
 * 1. 页面内只创建一个 WebTorrent client；
 * 2. stream server 也跟着 client 单例复用；
 * 3. 真正的 torrent 会话与时间线接线放到后续任务再接，不在这里提前把业务逻辑写死。
 */
export function 读取协作分发定位片段(
  locator: 媒体定位结果
): 媒体协作分发定位片段 | null {
  return locator.distribution ?? null;
}

function 读取可用协作分发片段(locator: 媒体定位结果): 媒体协作分发定位片段 | null {
  const distribution = 读取协作分发定位片段(locator);
  if (
    !distribution ||
    distribution.availability === "expired" ||
    !distribution.torrent_url ||
    !distribution.torrent_info_hash
  ) {
    return null;
  }
  return {
    ...distribution,
    presence_url: distribution.presence_url
      ? new URL(distribution.presence_url, locator.original_url).href
      : null,
  };
}

async function 拉取受控Torrent字节(
  distribution: 媒体协作分发定位片段
): Promise<Uint8Array> {
  const torrentInfoHash = distribution.torrent_info_hash!;
  const torrentUrl = distribution.torrent_url!;
  try {
    const response = await fetch(torrentUrl, {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`加载受控 torrent 失败: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // WebTorrent 的块持久化只能解决“字节还在本机磁盘”；
    // 想要在页面重开、后端临时离线时重新挂回同一 swarm，还得把极小的 .torrent 描述一起记住。
    保存协作分发Torrent缓存记录(torrentInfoHash, torrentUrl, bytes);
    return bytes;
  } catch (error) {
    const cachedBytes = 读取协作分发Torrent缓存字节(torrentInfoHash);
    if (cachedBytes) {
      return cachedBytes;
    }
    throw error;
  }
}

async function 探测协作分发媒体源可读性(streamUrl: string): Promise<void> {
  const probeUrl = new URL(
    streamUrl,
    globalThis.location?.href ?? "http://127.0.0.1/"
  );
  if (!/^https?:$/i.test(probeUrl.protocol)) {
    return;
  }
  /**
   * `file.streamURL` 可能先于本地 stream server 真正就绪而生成出来。
   * 如果现在就把这条 URL 暴露给上层，正式查看器会直接撞进 404，
   * 看起来像“明明用了缓存，结果反而播不出来”。
   *
   * 这里用极小 Range 先探测一次：
   * - 命中 2xx/206，说明这条本地协作分发路径已经可读；
   * - 非 2xx 直接视为当前不可用，让上层继续按既有 HLS/锚点回退；
   * - 不读取响应体，避免把探测放大成真正的数据下载。
   */
  const response = await fetch(probeUrl.href, {
    method: "GET",
    headers: {
      Range: "bytes=0-1",
    },
  });
  if (!response.ok) {
    throw new Error(`探测协作分发媒体源失败: ${response.status}`);
  }
}

async function 上报协作分发存活(presenceUrl: string): Promise<void> {
  const response = await fetch(presenceUrl, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`上报协作分发存活失败: ${response.status}`);
  }
}

async function 接入协作分发种子(
  runtime: 协作分发浏览器运行时,
  distribution: 媒体协作分发定位片段
): Promise<WebTorrent种子> {
  const torrentBytes = await 拉取受控Torrent字节(distribution);
  return await new Promise<WebTorrent种子>((resolve, reject) => {
    const torrent = runtime.client.add(
      torrentBytes,
      {
        announce: distribution.announce_urls,
        urlList: distribution.web_seed_url ? [distribution.web_seed_url] : [],
        private: true,
        maxWebConns: 4,
        destroyStoreOnDestroy: false,
        getAnnounceOpts: () => {
          if (!distribution.join_ticket) {
            return {};
          }
          return {
            ticket: distribution.join_ticket,
          };
        },
      },
      resolve
    );
    torrent.on("error", reject);
  });
}

function 读取首个可播放文件(
  torrent: WebTorrent种子,
  attachmentId: string,
  _kind: 媒体种类
): WebTorrent文件 {
  const file = torrent.files[0];
  if (!file) {
    throw new Error(`协作分发未返回可播放文件: ${attachmentId}`);
  }
  return file;
}

function 激活整附件补齐(session: 协作分发会话): void {
  if (session.eagerCompleting) {
    return;
  }
  session.eagerCompleting = true;
  session.file?.select(1);
}

function 推导协作分发提示(session: 协作分发会话): 协作分发媒体源["hint"] {
  if (session.hint) {
    return session.hint;
  }
  return session.eagerCompleting ? "正在补块" : "正在协作分发";
}

function 归一化协作分发消费者(input: {
  attachmentId: string;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
}) {
  return {
    consumerId: input.consumerId ?? input.attachmentId,
    attachmentId: input.attachmentId,
    onSessionEvent: input.onSessionEvent ?? null,
  };
}

function 更新协作分发会话主附件(session: 协作分发会话): void {
  const nextBinding = session.consumerBindings.values().next().value;
  if (nextBinding && typeof nextBinding.attachmentId === "string") {
    session.attachmentId = nextBinding.attachmentId;
  }
}

function 发布协作分发会话事件(
  session: 协作分发会话,
  type: 协作分发会话事件["type"]
): void {
  for (const binding of session.consumerBindings.values()) {
    if (!binding.onSessionEvent) {
      continue;
    }
    const event: 协作分发会话事件 =
      type === "ASSET_COMPLETE"
        ? {
            type,
            attachmentId: binding.attachmentId,
            swarmId: session.swarmId,
            contentHash: session.contentHash,
          }
        : {
            type,
            attachmentId: binding.attachmentId,
            swarmId: session.swarmId,
          };
    binding.onSessionEvent(event);
  }
}

function 绑定协作分发会话事件(session: 协作分发会话, torrent: WebTorrent种子) {
  // 运行态提示严格站在官方 torrent 事件上：
  // 1. 有 peer/wire 说明开始进入群友接力；
  // 2. noPeers 或只剩 web seed 时，提示回到“正在补块”；
  // 3. done 代表整附件已经补齐，本地后续就能完整参与协作分发。
  torrent.on("wire", (wire) => {
    session.hint = wire.type === "webSeed" ? "正在补块" : "正在协作分发";
    发布协作分发会话事件(session, "SWARM_ACTIVE");
  });
  torrent.on("noPeers", () => {
    session.hint = "正在补块";
    发布协作分发会话事件(session, "SWARM_NO_PEERS");
  });
  torrent.on("done", () => {
    session.eagerCompleting = false;
    session.locallyComplete = true;
    session.hint = "正在协作分发";
    发布协作分发会话事件(session, "ASSET_COMPLETE");
  });
}

function 启动协作分发存活上报(
  session: 协作分发会话,
  distribution: 媒体协作分发定位片段
) {
  if (!distribution.presence_url || session.presenceIntervalId !== null) {
    return;
  }

  const 推送存活 = () => {
    // presence 只是“我还在线帮传”的受控上报。
    // 失败时保持静默，不允许把临时网络抖动升级成前端自己裁决 expired。
    void 上报协作分发存活(distribution.presence_url!).catch(() => {});
  };

  推送存活();
  session.presenceIntervalId = setInterval(
    推送存活,
    协作分发存活上报间隔毫秒
  );
}

function 停止协作分发存活上报(session: 协作分发会话): void {
  if (session.presenceIntervalId === null) {
    return;
  }
  clearInterval(session.presenceIntervalId);
  session.presenceIntervalId = null;
}

function 清理协作分发底层会话(
  session: 协作分发会话,
  runtime: 协作分发浏览器运行时 | null = 协作分发浏览器运行时实例
): void {
  // 优先调用 client.remove，让 WebTorrent 自己负责把 torrent 从 client 生命周期里摘掉；
  // 如果当前测试替身或运行环境没暴露 remove，再退回 torrent.destroy。
  runtime?.client.remove?.(session.torrentInfoHash, {
    destroyStore: false,
  });
  session.torrent?.destroy?.({
    destroyStore: false,
  });
}

function 协作分发会话可在零引用后保留(session: 协作分发会话): boolean {
  /**
   * 只有两类 swarm 值得在 refs=0 后继续留着：
   * 1. 正在 eagerCompleting，必须把整附件补齐；
   * 2. 已经 locallyComplete，后续同页重开才能直接复用。
   *
   * 纯列表自动播扫出来、既没补齐也没完成的冷会话，不应该继续挂在 runtime 里吃内存和连接。
   */
  return session.eagerCompleting || session.locallyComplete;
}

async function 确保协作分发会话(input: {
  attachmentId: string;
  kind: 媒体种类;
  distribution: 媒体协作分发定位片段;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
  reuseOnly?: boolean;
}): Promise<协作分发会话 | null> {
  const consumerBinding = 归一化协作分发消费者(input);
  let session = 协作分发会话表.get(input.distribution.swarm_id);
  if (session) {
    /**
     * 一个 swarm 会话可以被多个浏览器内消费者同时复用：
     * - 时间线媒体会话
     * - 消息流 inline_autoplay
     * - 后续可能存在的其它只读消费者
     * 这里按 consumerId 建绑定，避免“一个附件的自动播释放掉正式链路”。
     */
    session.consumerBindings.set(consumerBinding.consumerId, {
      attachmentId: consumerBinding.attachmentId,
      onSessionEvent: consumerBinding.onSessionEvent,
    });
    if (input.eagerCompleting) {
      激活整附件补齐(session);
    }
    更新协作分发会话主附件(session);
    启动协作分发存活上报(session, input.distribution);
    return session;
  }

  /**
   * inline_autoplay 只允许复用已经热起来的 swarm。
   * 如果当前消息只是滚动路过，不值得为了轻量预览新开一整套 whole-file WebTorrent 会话。
   */
  if (input.reuseOnly) {
    return null;
  }

  session = {
    attachmentId: input.attachmentId,
    swarmId: input.distribution.swarm_id,
    torrentInfoHash: input.distribution.torrent_info_hash!,
    contentHash: input.distribution.content_hash,
    sourcePromise: Promise.resolve(null),
    eagerCompleting: Boolean(input.eagerCompleting),
    locallyComplete: false,
    hint: null,
    presenceIntervalId: null,
    torrent: null,
    file: null,
    consumerBindings: new Map([
      [
        consumerBinding.consumerId,
        {
          attachmentId: consumerBinding.attachmentId,
          onSessionEvent: consumerBinding.onSessionEvent,
        },
      ],
    ]),
  };
  协作分发会话表.set(input.distribution.swarm_id, session);
  启动协作分发存活上报(session, input.distribution);
  /**
   * 浏览器持久化存储只是“尽量保住本地整附件”的增强动作：
   * 1. 不等待结果，不阻塞 swarm 冷启动；
   * 2. 失败不回写任何业务可用性字段；
   * 3. 真正能不能继续活，仍由后端 locator 和 peer 事实共同裁决。
   */
  void 尝试请求持久化存储();

  session.sourcePromise = (async () => {
    const runtime = await 获取或创建协作分发浏览器运行时();
    const torrent = await 接入协作分发种子(runtime, input.distribution);
    session.torrent = torrent;
    if (协作分发会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, runtime);
      return null;
    }
    绑定协作分发会话事件(session, torrent);
    const file = 读取首个可播放文件(torrent, input.attachmentId, input.kind);
    session.file = file;
    if (session.eagerCompleting) {
      file.select(1);
    }
    await 探测协作分发媒体源可读性(file.streamURL);
    if (协作分发会话表.get(session.swarmId) !== session) {
      清理协作分发底层会话(session, runtime);
      return null;
    }
    return {
      src: file.streamURL,
    };
  })().catch((error) => {
    停止协作分发存活上报(session);
    if (协作分发会话表.get(input.distribution.swarm_id) === session) {
      协作分发会话表.delete(input.distribution.swarm_id);
    }
    throw error;
  });

  return session;
}

export function 释放协作分发消费者(
  input: string | { attachmentId: string; consumerId?: string }
): void {
  const consumerBinding =
    typeof input === "string"
      ? 归一化协作分发消费者({ attachmentId: input })
      : 归一化协作分发消费者(input);
  for (const [swarmId, session] of 协作分发会话表) {
    const binding = session.consumerBindings.get(consumerBinding.consumerId);
    if (!binding || binding.attachmentId !== consumerBinding.attachmentId) {
      continue;
    }
    session.consumerBindings.delete(consumerBinding.consumerId);
    if (session.attachmentId === binding.attachmentId) {
      更新协作分发会话主附件(session);
    }
    if (session.consumerBindings.size > 0) {
      continue;
    }
    /**
     * 最后一个 consumer 释放后，要按“是否还有保留价值”裁决：
     * 1. eagerCompleting=true 时继续补齐整附件；
     * 2. 已经 locallyComplete 的 swarm 继续保留，支撑同页重开；
     * 3. 既没补齐也没完成的冷会话立即销毁，避免列表自动播滚着滚着堆出一排空转 torrent。
     */
    停止协作分发存活上报(session);
    if (协作分发会话可在零引用后保留(session)) {
      continue;
    }
    协作分发会话表.delete(swarmId);
    清理协作分发底层会话(session);
  }
}

export function 读取协作分发会话状态(swarmId: string) {
  const session = 协作分发会话表.get(swarmId);
  if (!session) {
    return null;
  }
  return {
    attachmentId: session.attachmentId,
    swarmId: session.swarmId,
    refs: session.consumerBindings.size,
    consumers: Array.from(session.consumerBindings.keys()),
    eagerCompleting: session.eagerCompleting,
    hint: 推导协作分发提示(session),
  };
}

export async function 解析协作分发源(input: {
  attachmentId: string;
  kind: 媒体种类;
  locator: 媒体定位结果;
  consumerId?: string;
  onSessionEvent?: (event: 协作分发会话事件) => void;
  eagerCompleting?: boolean;
  reuseOnly?: boolean;
}): Promise<协作分发媒体源 | null> {
  const distribution = 读取可用协作分发片段(input.locator);
  if (!distribution) {
    return null;
  }
  const session = await 确保协作分发会话({
    attachmentId: input.attachmentId,
    kind: input.kind,
    distribution,
    ...(input.consumerId ? { consumerId: input.consumerId } : {}),
    ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
    ...(input.eagerCompleting ? { eagerCompleting: true } : {}),
    ...(input.reuseOnly ? { reuseOnly: true } : {}),
  });
  if (!session) {
    return null;
  }
  const source = await session.sourcePromise;
  if (!source) {
    return null;
  }
  return {
    src: source.src,
    hint: 推导协作分发提示(session),
  };
}

export async function 获取或创建协作分发浏览器运行时(
  loadCtor: () => Promise<WebTorrent浏览器构造器> = 默认加载WebTorrent浏览器构造器,
  读取媒体ServiceWorker注册: () => Promise<unknown> = 默认读取媒体ServiceWorker注册
): Promise<协作分发浏览器运行时> {
  if (!协作分发浏览器运行时Promise) {
    const nextPromise = (async () => {
      const WebTorrentCtor = await loadCtor();
      const serviceWorkerRegistration = await 读取媒体ServiceWorker注册();
      const client = new WebTorrentCtor();
      const streamServer = client.createServer({
        controller: serviceWorkerRegistration,
      });
      return { client, streamServer };
    })().then((runtime) => {
      if (协作分发浏览器运行时Promise === nextPromise) {
        协作分发浏览器运行时实例 = runtime;
      }
      return runtime;
    });
    协作分发浏览器运行时Promise = nextPromise;
  }
  return 协作分发浏览器运行时Promise;
}

export function 重置协作分发浏览器运行时() {
  const runtimePromise = 协作分发浏览器运行时Promise;
  const runtime = 协作分发浏览器运行时实例;
  协作分发浏览器运行时Promise = null;
  协作分发浏览器运行时实例 = null;
  for (const session of 协作分发会话表.values()) {
    停止协作分发存活上报(session);
  }
  协作分发会话表.clear();
  runtime?.streamServer.close?.();
  runtime?.client.destroy?.();
  if (!runtime && runtimePromise) {
    void runtimePromise
      .then((resolvedRuntime) => {
        resolvedRuntime.streamServer.close?.();
        resolvedRuntime.client.destroy?.();
      })
      .catch(() => {});
  }
}
