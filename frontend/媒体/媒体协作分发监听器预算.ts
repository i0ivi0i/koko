type 可调监听器预算Emitter = {
  getMaxListeners?(): number;
  setMaxListeners?(count: number): void;
};

type WebTorrent跟踪连接池项 = {
  socket?: 可调监听器预算Emitter | null;
};

type WebTorrent监听器预算目标 = 可调监听器预算Emitter & {
  discovery?: {
    tracker?: {
      _trackers?: WebTorrent跟踪连接池项[];
    } | null;
  } | null;
};

const 协作分发Torrent监听器预算 = 128;

const 调高协作分发监听器预算 = (
  target: 可调监听器预算Emitter | null | undefined
): void => {
  if (
    !target ||
    typeof target.getMaxListeners !== "function" ||
    typeof target.setMaxListeners !== "function"
  ) {
    return;
  }
  const current = target.getMaxListeners();
  if (!Number.isFinite(current) || current <= 0 || current >= 协作分发Torrent监听器预算) {
    return;
  }
  target.setMaxListeners(协作分发Torrent监听器预算);
};

export const 调高协作分发Torrent监听器预算 = (
  torrent: WebTorrent监听器预算目标
): void => {
  /**
   * WebTorrent 单种子在 ready/download/wire/noPeers 等多个观察面上挂监听器。
   * 预算只调 Node 风格 emitter 的阈值，不改变事件语义和回收路径。
   */
  调高协作分发监听器预算(torrent);
};

export const 调高协作分发Tracker连接监听器预算 = (
  torrent: WebTorrent监听器预算目标
): void => {
  const trackerClient = torrent.discovery?.tracker;
  const trackers = Array.isArray(trackerClient?._trackers) ? trackerClient._trackers : [];
  const visited = new Set<可调监听器预算Emitter>();
  for (const tracker of trackers) {
    const socket = tracker?.socket;
    if (!socket || visited.has(socket)) {
      continue;
    }
    visited.add(socket);
    调高协作分发监听器预算(socket);
  }
};

export const 安排调高协作分发Tracker连接监听器预算 = (
  torrent: WebTorrent监听器预算目标
): void => {
  queueMicrotask(() => {
    调高协作分发Tracker连接监听器预算(torrent);
  });
};
