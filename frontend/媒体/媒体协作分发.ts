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
  remove?(
    torrentId: string | Uint8Array | ArrayBuffer,
    options?: { destroyStore?: boolean }
  ): void | Promise<void>;
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
  locallyComplete: boolean;
}

export type 协作分发会话事件 =
  | { type: "SWARM_ACTIVE"; attachmentId: string; swarmId: string }
  | { type: "SWARM_NO_PEERS"; attachmentId: string; swarmId: string }
  | { type: "SWARM_TICKET_INVALID"; attachmentId: string; swarmId: string }
  | { type: "ASSET_COMPLETE"; attachmentId: string; swarmId: string; contentHash: string };

const 协作分发存活上报间隔毫秒 = 60_000;
const 协作分发媒体源探测最大尝试次数 = 3;
const 协作分发媒体源探测重试间隔毫秒 = 80;
export const 协作分发JoinTicket失效原因 = "join_ticket_invalid";

/**
 * join ticket 失效需要一条稳定、可跨层识别的错误语义：
 * 1. tracker 侧对外只暴露固定 reason，避免把签名细节泄给浏览器；
 * 2. runtime / 播放器只认这一条权威原因，不再四处猜 message 文案；
 * 3. 后续无论是 dev tracker 还是正式 tracker，只要沿用这条 reason，前端恢复链就不用改。
 */
export class 协作分发JoinTicket失效错误 extends Error {
  readonly code = 协作分发JoinTicket失效原因;

  constructor(message = 协作分发JoinTicket失效原因) {
    super(message);
    this.name = "协作分发JoinTicket失效错误";
  }
}

const 读取协作分发错误消息 = (error: unknown): string | null => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return null;
};

export const 是否为协作分发JoinTicket失效错误 = (error: unknown): boolean => {
  if (error instanceof 协作分发JoinTicket失效错误) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 协作分发JoinTicket失效原因
  ) {
    return true;
  }
  return 读取协作分发错误消息(error) === 协作分发JoinTicket失效原因;
};

const 归一化协作分发错误 = (error: unknown): unknown =>
  是否为协作分发JoinTicket失效错误(error)
    ? new 协作分发JoinTicket失效错误()
    : error;

export type 协作分发底层会话 = {
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
  cleanupStarted: boolean;
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
  /**
   * WebTorrent browser server 在构造时就会自测 `/webtorrent/cancel/`。
   * 如果当前页还没被根 scope worker 接管，这条探测和后续 stream probe 都只会打到网络 404。
   * 这里宁可先回退到既有 HLS/锚点主链，也不让浏览器背着控制台噪音去碰一条必败路径。
   */
  if (!platform.snapshot().serviceWorker.controllerAttached) {
    throw new Error("media service worker 尚未接管当前页面");
  }
  const registration = platform.serviceWorker.读取注册("media");
  if (!registration) {
    throw new Error("media service worker 尚未注册");
  }
  if (registration.active?.state !== "activated") {
    throw new Error("media service worker 尚未激活");
  }
  return registration;
}

export async function 请求协作分发持久化存储(): Promise<void> {
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

export function 读取可用协作分发片段(
  locator: 媒体定位结果
): 媒体协作分发定位片段 | null {
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

export async function 探测协作分发媒体源可读性(streamUrl: string): Promise<void> {
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
   * 这里用极小 Range 先探测，但允许极短的有限重试：
   * - 命中 2xx/206，说明这条本地协作分发路径已经可读；
   * - 刚挂载时偶发 404 不立刻判死，给 stream server 一个短暂就绪窗口；
   * - 重试耗尽仍非 2xx，才视为当前不可用，让上层按既有锚点回退；
   * - 不读取响应体，避免把探测放大成真正的数据下载。
   */
  for (let attempt = 1; attempt <= 协作分发媒体源探测最大尝试次数; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(probeUrl.href, {
        method: "GET",
        headers: {
          Range: "bytes=0-1",
        },
      });
    } catch (error) {
      if (attempt >= 协作分发媒体源探测最大尝试次数) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 协作分发媒体源探测重试间隔毫秒);
      });
      continue;
    }
    if (response.ok) {
      return;
    }
    if (attempt >= 协作分发媒体源探测最大尝试次数) {
      throw new Error(`探测协作分发媒体源失败: ${response.status}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 协作分发媒体源探测重试间隔毫秒);
    });
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

export async function 接入协作分发种子(
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
    torrent.on("error", (error) => {
      reject(归一化协作分发错误(error));
    });
  });
}

export function 读取首个可播放文件(
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

export function 启动协作分发存活上报(
  session: 协作分发底层会话,
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

export function 停止协作分发存活上报(session: 协作分发底层会话): void {
  if (session.presenceIntervalId === null) {
    return;
  }
  clearInterval(session.presenceIntervalId);
  session.presenceIntervalId = null;
}

function 销毁协作分发Torrent(session: 协作分发底层会话): void {
  session.torrent?.destroy?.({
    destroyStore: false,
  });
}

export function 清理协作分发底层会话(
  session: 协作分发底层会话,
  runtime: 协作分发浏览器运行时 | null = 协作分发浏览器运行时实例
): void {
  // sourcePromise 和 consumer 释放链都可能同时试图收尾同一个 swarm，会话清理必须幂等。
  if (session.cleanupStarted) {
    return;
  }
  session.cleanupStarted = true;
  const remove = runtime?.client.remove;
  if (!remove) {
    销毁协作分发Torrent(session);
    return;
  }
  try {
    // `client.remove()` 本身就是 WebTorrent 官方的移除入口；
    // 成功时不要再同步二次 destroy，同失败时才回退到当前 torrent。
    const removeResult = remove.call(runtime.client, session.torrentInfoHash, {
      destroyStore: false,
    });
    void Promise.resolve(removeResult).catch(() => {
      销毁协作分发Torrent(session);
    });
  } catch {
    销毁协作分发Torrent(session);
  }
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
