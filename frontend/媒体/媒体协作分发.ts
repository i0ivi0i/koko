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
  critical?(start: number, end: number): void;
  select?(start: number, end: number, priority?: number): void;
  on(event: "error", handler: (error: unknown) => void): void;
  on(event: "warning", handler: (warning: unknown) => void): void;
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
      noPeersIntervalTime?: number;
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
const 协作分发媒体源探测最大尝试次数 = 16;
const 协作分发媒体源探测重试间隔毫秒 = 80;
const 服务工作线程接管等待超时毫秒 = 1_200;
const 服务工作线程接管轮询间隔毫秒 = 50;
type 协作分发存活类型 =
  | "viewer_intent"
  | "partial_peer"
  | "complete_peer"
  | "backend_strong_seed";
export const 协作分发JoinTicket失效原因 = "join_ticket_invalid";
export const 协作分发运行时环境不支持原因 = "swarm_runtime_unsupported";
const 协作分发运行时环境不安全上下文细因 = "insecure_context";

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

/**
 * WebTorrent 浏览器流媒体运行时依赖 service worker + secure context：
 * 1. `http://localhost` 可用是因为浏览器把它视为可信来源；
 * 2. `http://局域网IP` 在移动端通常不是 secure context，无法注册/接管 service worker；
 * 3. 这里必须给出稳定错误语义，避免上层把“环境不支持”误判成“资源不可获取”。
 */
export class 协作分发运行时环境不支持错误 extends Error {
  readonly code = 协作分发运行时环境不支持原因;
  readonly reason = 协作分发运行时环境不安全上下文细因;

  constructor(message = 协作分发运行时环境不支持原因) {
    super(message);
    this.name = "协作分发运行时环境不支持错误";
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

export const 是否为协作分发运行时环境不支持错误 = (error: unknown): boolean => {
  if (error instanceof 协作分发运行时环境不支持错误) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 协作分发运行时环境不支持原因
  ) {
    return true;
  }
  return 读取协作分发错误消息(error) === 协作分发运行时环境不支持原因;
};

const 归一化协作分发错误 = (error: unknown): unknown =>
  是否为协作分发JoinTicket失效错误(error)
    ? new 协作分发JoinTicket失效错误()
    : 是否为协作分发运行时环境不支持错误(error)
      ? new 协作分发运行时环境不支持错误()
      : error;

type 协作分发媒体源探测选项 = {
  读取终止错误?: () => unknown | null;
};

const 读取探测终止错误 = (options: 协作分发媒体源探测选项): unknown | null => {
  const raw = options.读取终止错误?.() ?? null;
  if (!raw) {
    return null;
  }
  return 归一化协作分发错误(raw);
};

export type 协作分发底层会话 = {
  attachmentId: string;
  swarmId: string;
  torrentInfoHash: string;
  contentHash: string;
  sourcePromise: Promise<{ src: string } | null>;
  eagerCompleting: boolean;
  locallyComplete: boolean;
  hint: 协作分发媒体源["hint"] | null;
  /**
   * 同一条会话上的 presence 心跳只允许存在一个当前来源类型：
   * 1. `wire` 后先报 `partial_peer`；
   * 2. `done` 后升级成 `complete_peer`；
   * 3. stop 时统一清空，避免旧类型泄漏到下一轮。
   */
  presencePeerKind: 协作分发存活类型 | null;
  presenceIntervalId: ReturnType<typeof setInterval> | null;
  torrent: WebTorrent种子 | null;
  file: WebTorrent文件 | null;
  terminalError: unknown | null;
  cleanupStarted: boolean;
  曾连上群友: boolean;
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

/**
 * 浏览器里的 WebTorrent client / stream server 只有一套共享基础设施真相。
 * 这里显式收口“认领实例”的判断，避免后续在别处偷偷长出第二套缓存逻辑。
 */
function 认领协作分发浏览器运行时实例(
  targetPromise: Promise<协作分发浏览器运行时>,
  runtime: 协作分发浏览器运行时
): 协作分发浏览器运行时 {
  if (协作分发浏览器运行时Promise === targetPromise) {
    协作分发浏览器运行时实例 = runtime;
  }
  return runtime;
}

/**
 * 冷启动失败时必须释放单例锁。
 * 否则第一轮 reject 会把后续所有调用都钉死在旧 promise 上，形成“第二套失败真相”。
 */
function 释放协作分发浏览器运行时单例锁(
  targetPromise: Promise<协作分发浏览器运行时>
): void {
  if (协作分发浏览器运行时Promise === targetPromise) {
    协作分发浏览器运行时Promise = null;
    协作分发浏览器运行时实例 = null;
  }
}

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
  const 是安全上下文 =
    typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : true;
  if (!是安全上下文) {
    throw new 协作分发运行时环境不支持错误();
  }
  const platform = 获取默认浏览器应用平台();
  await platform.启动();
  const registration = platform.serviceWorker.读取注册("media");
  if (!registration) {
    throw new Error("media service worker 尚未注册");
  }
  const activeWorker = registration.active as
    | { state?: string; postMessage?: (message: unknown) => void }
    | null
    | undefined;
  if (activeWorker?.state !== "activated") {
    throw new Error("media service worker 尚未激活");
  }
  /**
   * 首访窗口里常见状态是“registration 已 activated，但当前页尚未被 controller 接管”。
   * 这里先尝试让 active worker 主动 claim 当前页，再短暂等待一次接管结果：
   * 1. claim 成功就继续走同一条 swarm 主链；
   * 2. claim 失败再明确抛错，保持“不可达时不伪装成功”的边界；
   * 3. 后续真正是否可读仍由 `探测协作分发媒体源可读性` 统一裁决。
   *
   * 注意：这里不能依赖 controller 对象发消息，因为“尚未接管”本质上就是 controller 还不存在；
   * 必须直接通过 registration.active 通道向 worker 发起 claim 请求。
   */
  if (!platform.snapshot().serviceWorker.controllerAttached) {
    if (typeof activeWorker?.postMessage === "function") {
      activeWorker.postMessage({ type: "CLAIM_CLIENTS" });
    }
    const startedAt = Date.now();
    while (!platform.snapshot().serviceWorker.controllerAttached) {
      if (Date.now() - startedAt >= 服务工作线程接管等待超时毫秒) {
        throw new Error("media service worker 尚未接管当前页面");
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 服务工作线程接管轮询间隔毫秒);
      });
    }
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
  /**
   * 可用性裁决优先级：
   * 1. 新后端优先看 `media_state.code`（稳定跨端真相）；
   * 2. 灰度期里缺失 `media_state` 时，退回旧 availability 字段；
   * 3. READY / CONNECTING 允许进入同一 swarm 会话；
   * 4. NO_ONLINE_SEED / DELETED 直接判为当前不可用。
   */
  const mediaStateCode = distribution?.media_state?.code ?? null;
  const distribution可用 =
    mediaStateCode !== null
      ? mediaStateCode === "MEDIA_READY" ||
        mediaStateCode === "MEDIA_CONNECTING_TO_PEERS"
      : distribution?.availability !== "expired";
  if (
    !distribution ||
    !distribution可用 ||
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

/**
 * retry_after_ms 是后端给出的跨端重试节奏契约：
 * 1. 浏览器端 WebTorrent 的 noPeers 事件默认 30s，太慢会放大“刚退场窗口”的感知抖动；
 * 2. 这里把连接群友态的 retry 显式透传给 noPeersIntervalTime，让 runtime 与 contract 对齐；
 * 3. 值非法时回退默认行为，避免把异常配置放大成高频事件风暴。
 */
const 读取noPeers探测间隔毫秒 = (distribution: 媒体协作分发定位片段): number | null => {
  const retryAfter = distribution.media_state?.retry_after_ms;
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter) || retryAfter <= 0) {
    return null;
  }
  return Math.floor(retryAfter);
};

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

export async function 探测协作分发媒体源可读性(
  streamUrl: string,
  options: 协作分发媒体源探测选项 = {}
): Promise<void> {
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
    const terminalErrorBeforeFetch = 读取探测终止错误(options);
    if (terminalErrorBeforeFetch) {
      throw terminalErrorBeforeFetch;
    }
    let response: Response;
    try {
      response = await fetch(probeUrl.href, {
        method: "GET",
        headers: {
          Range: "bytes=0-1",
        },
      });
    } catch (error) {
      const terminalErrorAfterFetch = 读取探测终止错误(options);
      if (terminalErrorAfterFetch) {
        throw terminalErrorAfterFetch;
      }
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
    const terminalErrorAfterResponse = 读取探测终止错误(options);
    if (terminalErrorAfterResponse) {
      throw terminalErrorAfterResponse;
    }
    if (attempt >= 协作分发媒体源探测最大尝试次数) {
      throw new Error(`探测协作分发媒体源失败: ${response.status}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 协作分发媒体源探测重试间隔毫秒);
    });
  }
}

async function 上报协作分发存活(
  presenceUrl: string,
  peerKind: 协作分发存活类型
): Promise<void> {
  const response = await fetch(presenceUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      peer_kind: peerKind,
    }),
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
  const noPeersIntervalTime = 读取noPeers探测间隔毫秒(distribution);
  return await new Promise<WebTorrent种子>((resolve, reject) => {
    let 已结束 = false;
    const 收口resolve = (torrent: WebTorrent种子) => {
      if (已结束) {
        return;
      }
      已结束 = true;
      resolve(torrent);
    };
    const 收口reject = (error: unknown) => {
      if (已结束) {
        return;
      }
      已结束 = true;
      reject(归一化协作分发错误(error));
    };
    const torrent = runtime.client.add(
      torrentBytes,
      {
        announce: distribution.announce_urls,
        urlList: distribution.web_seed_url ? [distribution.web_seed_url] : [],
        private: true,
        maxWebConns: 4,
        destroyStoreOnDestroy: false,
        ...(noPeersIntervalTime ? { noPeersIntervalTime } : {}),
        getAnnounceOpts: () => {
          if (!distribution.join_ticket) {
            return {};
          }
          return {
            ticket: distribution.join_ticket,
          };
        },
      },
      收口resolve
    );
    torrent.on("error", (error) => {
      收口reject(error);
    });
    torrent.on("warning", (warning) => {
      if (!是否为协作分发JoinTicket失效错误(warning)) {
        return;
      }
      收口reject(warning);
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
  distribution: 媒体协作分发定位片段,
  peerKind: 协作分发存活类型 = "complete_peer"
) {
  if (!distribution.presence_url) {
    return;
  }
  session.presencePeerKind = peerKind;

  const 推送存活 = () => {
    const 当前存活类型 = session.presencePeerKind;
    if (!当前存活类型) {
      return;
    }
    /**
     * 心跳类型必须紧跟同一条 swarm 会话的真实能力：
     * 1. partial_peer 代表“已进 swarm、正在帮忙补块”；
     * 2. complete_peer 只在 done 后升级，不能提前吹成完整来源；
     * 3. 失败保持静默，不让前端越位改写后端真相。
     */
    void 上报协作分发存活(
      distribution.presence_url!,
      当前存活类型
    ).catch(() => {});
  };

  if (session.presenceIntervalId !== null) {
    推送存活();
    return;
  }
  推送存活();
  session.presenceIntervalId = setInterval(
    推送存活,
    协作分发存活上报间隔毫秒
  );
}

export function 停止协作分发存活上报(session: 协作分发底层会话): void {
  session.presencePeerKind = null;
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
    const nextPromise: Promise<协作分发浏览器运行时> = (async () => {
      const WebTorrentCtor = await loadCtor();
      const serviceWorkerRegistration = await 读取媒体ServiceWorker注册();
      const client = new WebTorrentCtor();
      const streamServer = client.createServer({
        controller: serviceWorkerRegistration,
      });
      return { client, streamServer };
    })()
      .then((runtime) => 认领协作分发浏览器运行时实例(nextPromise, runtime))
      .catch((error) => {
        /**
         * 运行时冷启动失败后不能把 rejected promise 永久缓存：
         * - 否则首轮失败会让当前页面后续所有播放都只剩锚点回退；
         * - 下游条件恢复后（例如 SW 已接管）也无法再重试；
         * - 这里必须释放单例锁，让后续调用能按最新事实重新初始化。
         */
        释放协作分发浏览器运行时单例锁(nextPromise);
        throw error;
      });
    协作分发浏览器运行时Promise = nextPromise;
  }
  return 协作分发浏览器运行时Promise!;
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
