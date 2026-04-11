import type { 媒体协作分发定位片段, 媒体定位结果, 媒体种类 } from "../契约.js";

export interface WebTorrent文件 {
  readonly streamURL: string;
  select(priority?: number): void;
}

export interface WebTorrent种子 {
  files: WebTorrent文件[];
  on(event: "error", handler: (error: unknown) => void): void;
}

export interface WebTorrent浏览器客户端 {
  createServer(options: { controller?: unknown }): unknown;
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
}

type WebTorrent浏览器构造器 = new () => WebTorrent浏览器客户端;

export interface 协作分发浏览器运行时 {
  client: WebTorrent浏览器客户端;
  streamServer: unknown;
}

export interface 协作分发媒体源 {
  src: string;
  hint: "正在协作分发";
}

let 协作分发浏览器运行时Promise: Promise<协作分发浏览器运行时> | null = null;
const 协作分发媒体源Promise表 = new Map<string, Promise<协作分发媒体源 | null>>();

async function 默认加载WebTorrent浏览器构造器(): Promise<WebTorrent浏览器构造器> {
  const mod = await import("webtorrent/dist/webtorrent.min.js");
  return (mod.default ?? mod) as WebTorrent浏览器构造器;
}

/**
 * WebTorrent 浏览器侧 stream server 要拿的是已经激活的 registration。
 * 如果只把当前页面 controller 塞进去，首次激活和真实 streamURL 会直接失真。
 */
async function 获取已激活媒体ServiceWorker注册(): Promise<ServiceWorkerRegistration> {
  if (!navigator.serviceWorker?.ready) {
    throw new Error("当前环境不支持 media service worker");
  }
  const registration = await navigator.serviceWorker.ready;
  if (registration.active?.state !== "activated") {
    throw new Error("media service worker 尚未激活");
  }
  return registration;
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
  return distribution;
}

async function 拉取受控Torrent字节(torrentUrl: string): Promise<Uint8Array> {
  const response = await fetch(torrentUrl, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`加载受控 torrent 失败: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function 接入协作分发种子(
  runtime: 协作分发浏览器运行时,
  distribution: 媒体协作分发定位片段
): Promise<WebTorrent种子> {
  const torrentBytes = await 拉取受控Torrent字节(distribution.torrent_url!);
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
  // 一旦用户开始查看，就默认尽快补齐整个附件，而不是只按观看进度懒加载。
  file.select(1);
  return file;
}

export async function 解析协作分发源(input: {
  attachmentId: string;
  kind: 媒体种类;
  locator: 媒体定位结果;
}): Promise<协作分发媒体源 | null> {
  const distribution = 读取可用协作分发片段(input.locator);
  if (!distribution) {
    return null;
  }
  let sourcePromise = 协作分发媒体源Promise表.get(distribution.swarm_id);
  if (!sourcePromise) {
    sourcePromise = (async () => {
      const runtime = await 获取或创建协作分发浏览器运行时();
      const torrent = await 接入协作分发种子(runtime, distribution);
      const file = 读取首个可播放文件(torrent, input.attachmentId, input.kind);
      return {
        src: file.streamURL,
        hint: "正在协作分发" as const,
      };
    })().catch((error) => {
      协作分发媒体源Promise表.delete(distribution.swarm_id);
      throw error;
    });
    协作分发媒体源Promise表.set(distribution.swarm_id, sourcePromise);
  }
  return sourcePromise;
}

export async function 获取或创建协作分发浏览器运行时(
  loadCtor: () => Promise<WebTorrent浏览器构造器> = 默认加载WebTorrent浏览器构造器
): Promise<协作分发浏览器运行时> {
  if (!协作分发浏览器运行时Promise) {
    协作分发浏览器运行时Promise = (async () => {
      const WebTorrentCtor = await loadCtor();
      const serviceWorkerRegistration = await 获取已激活媒体ServiceWorker注册();
      const client = new WebTorrentCtor();
      const streamServer = client.createServer({
        controller: serviceWorkerRegistration,
      });
      return { client, streamServer };
    })();
  }
  return 协作分发浏览器运行时Promise;
}

export function 重置协作分发浏览器运行时() {
  协作分发浏览器运行时Promise = null;
  协作分发媒体源Promise表.clear();
}
