const 协作分发Torrent缓存存储键 = "koko_swarm_torrent_records";

export type 协作分发Torrent缓存记录 = {
  torrentInfoHash: string;
  torrentUrl: string;
  bytes: number[];
};

export type 协作分发Torrent缓存快照 = Record<string, 协作分发Torrent缓存记录>;

export interface 协作分发Torrent缓存仓库 {
  读取全部(): 协作分发Torrent缓存快照;
  写入全部(snapshot: 协作分发Torrent缓存快照): void;
}

const 是可写协作分发缓存存储 = (
  storage: Pick<Storage, "getItem" | "setItem"> | undefined
): storage is Pick<Storage, "getItem" | "setItem"> =>
  Boolean(storage) &&
  typeof storage?.getItem === "function" &&
  typeof storage?.setItem === "function";

const 规范化协作分发Torrent缓存记录 = (
  raw: unknown,
  fallbackInfoHash?: string
): 协作分发Torrent缓存记录 | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as {
    torrentInfoHash?: unknown;
    torrentUrl?: unknown;
    bytes?: unknown;
  };
  const torrentInfoHash =
    typeof candidate.torrentInfoHash === "string" && candidate.torrentInfoHash.trim()
      ? candidate.torrentInfoHash.trim()
      : fallbackInfoHash;
  const torrentUrl =
    typeof candidate.torrentUrl === "string" ? candidate.torrentUrl.trim() : "";
  const bytes = Array.isArray(candidate.bytes)
    ? candidate.bytes.filter(
        (value): value is number =>
          typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255
      )
    : [];
  if (!torrentInfoHash || !torrentUrl || bytes.length === 0) {
    return null;
  }
  return {
    torrentInfoHash,
    torrentUrl,
    bytes,
  };
};

/**
 * 协作分发缓存仓库只负责极小的 `.torrent` 元数据持久化：
 * - 只存 info hash / torrent URL / 原始字节；
 * - 不碰 swarm 业务语义；
 * - 不冒充完整媒体缓存层。
 */
export function 创建浏览器协作分发Torrent缓存仓库(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined
): 协作分发Torrent缓存仓库 {
  return {
    读取全部(): 协作分发Torrent缓存快照 {
      if (!是可写协作分发缓存存储(storage)) {
        return {};
      }
      const raw = storage?.getItem(协作分发Torrent缓存存储键);
      if (!raw) {
        return {};
      }
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") {
          return {};
        }
        const normalized: 协作分发Torrent缓存快照 = {};
        for (const [torrentInfoHash, value] of Object.entries(parsed)) {
          const record = 规范化协作分发Torrent缓存记录(value, torrentInfoHash);
          if (record) {
            normalized[torrentInfoHash] = record;
          }
        }
        return normalized;
      } catch {
        return {};
      }
    },

    写入全部(snapshot: 协作分发Torrent缓存快照): void {
      if (!是可写协作分发缓存存储(storage)) {
        return;
      }
      const normalized: 协作分发Torrent缓存快照 = {};
      for (const [torrentInfoHash, value] of Object.entries(snapshot)) {
        const record = 规范化协作分发Torrent缓存记录(value, torrentInfoHash);
        if (record) {
          normalized[torrentInfoHash] = record;
        }
      }
      storage?.setItem(协作分发Torrent缓存存储键, JSON.stringify(normalized));
    },
  };
}
