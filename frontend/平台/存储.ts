import type { 房间快照 } from "../聊天共享/契约.js";

const 设备匿名凭证存储键 = "koko_device_anonymous_token";
const 当前房间存储键 = "koko_current_room_id";
const 当前房间短码存储键 = "koko_current_room_code";
const 首页房间历史存储键 = "koko_home_sessions";
const 最近引导身份存储键 = "koko_bootstrap_identity";
const 当前房间恢复快照存储键 = "koko_current_room_snapshot";

export interface 首页房间历史条目 {
  roomId: string;
  roomCode: string;
  lastEnteredAt: number;
}

export interface 最近引导身份缓存 {
  sessionId: string;
  displayAlias: string;
}

export interface 当前房间恢复快照缓存 {
  roomCode: string;
  snapshot: 房间快照;
}

/**
 * 前端存储端口只承载“壳层自己的本地记忆”。
 *
 * 边界约束：
 * 1. 这里不保存后端领域真相，只保存壳层为了恢复体验需要的本地锚点；
 * 2. Web 当前落在浏览器存储，未来 CLI / iOS / Android 可以换自己的实现；
 * 3. 上层只能通过端口读写，避免 localStorage 细节继续散落在组件里。
 */
export interface 前端存储端口 {
  读取或创建设备匿名凭证(): string;
  读取最近引导身份(): 最近引导身份缓存 | null;
  写入最近引导身份(identity: 最近引导身份缓存): void;
  清除最近引导身份(): void;
  读取当前房间标识(): string;
  写入当前房间标识(roomId: string): void;
  清除当前房间标识(): void;
  读取当前房间短码(): string;
  写入当前房间短码(roomCode: string): void;
  清除当前房间短码(): void;
  读取当前房间恢复快照(): 当前房间恢复快照缓存 | null;
  写入当前房间恢复快照(cache: 当前房间恢复快照缓存): void;
  清除当前房间恢复快照(): void;
  读取首页房间历史(): 首页房间历史条目[];
  写入或更新首页房间历史条目(item: 首页房间历史条目): void;
  按房间标识删除首页房间历史条目(roomId: string): void;
}

function 读取字符串(storage: Partial<Storage> | undefined, key: string): string {
  const stored =
    storage && typeof storage.getItem === "function" ? storage.getItem(key) : null;
  return stored?.trim() ? stored : "";
}

function 写入字符串(
  storage: Partial<Storage> | undefined,
  key: string,
  value: string
): void {
  if (storage && typeof storage.setItem === "function") {
    storage.setItem(key, value);
  }
}

function 删除字符串(storage: Partial<Storage> | undefined, key: string): void {
  if (storage && typeof storage.removeItem === "function") {
    storage.removeItem(key);
  }
}

function 读取JSON<T>(
  storage: Partial<Storage> | undefined,
  key: string,
  normalize: (value: unknown) => T | null
): T | null {
  const raw = 读取字符串(storage, key);
  if (!raw) {
    return null;
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function 写入JSON(
  storage: Partial<Storage> | undefined,
  key: string,
  value: unknown
): void {
  写入字符串(storage, key, JSON.stringify(value));
}

function 规范化最近引导身份缓存(value: unknown): 最近引导身份缓存 | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    sessionId?: unknown;
    displayAlias?: unknown;
  };
  const sessionId =
    typeof candidate.sessionId === "string" ? candidate.sessionId.trim() : "";
  const displayAlias =
    typeof candidate.displayAlias === "string" ? candidate.displayAlias.trim() : "";
  if (!sessionId || !displayAlias) {
    return null;
  }
  return {
    sessionId,
    displayAlias,
  };
}

function 规范化当前房间恢复快照缓存(
  value: unknown
): 当前房间恢复快照缓存 | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    roomCode?: unknown;
    snapshot?: Partial<房间快照> | null;
  };
  const roomCode = typeof candidate.roomCode === "string" ? candidate.roomCode.trim() : "";
  const snapshot = candidate.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  if (
    typeof snapshot.room_id !== "string" ||
    !snapshot.room_id.trim() ||
    typeof snapshot.latest_event_position !== "number" ||
    !Number.isFinite(snapshot.latest_event_position) ||
    !Array.isArray(snapshot.snapshot_messages) ||
    typeof snapshot.has_more_before !== "boolean"
  ) {
    return null;
  }
  const lastReadEventPosition =
    typeof snapshot.last_read_event_position === "number" &&
    Number.isFinite(snapshot.last_read_event_position)
      ? snapshot.last_read_event_position
      : null;
  const firstUnreadEventPosition =
    typeof snapshot.first_unread_event_position === "number" &&
    Number.isFinite(snapshot.first_unread_event_position)
      ? snapshot.first_unread_event_position
      : null;
  return {
    roomCode,
    snapshot: {
      room_id: snapshot.room_id,
      latest_event_position: snapshot.latest_event_position,
      last_read_event_position: lastReadEventPosition,
      first_unread_event_position: firstUnreadEventPosition,
      snapshot_messages: snapshot.snapshot_messages,
      has_more_before: snapshot.has_more_before,
    },
  };
}

/**
 * 首页历史是用户会话列表，不是数据库房间实例列表：
 * 1. 当前群聊阶段，用户真正能感知的唯一身份是 roomCode；
 * 2. roomId 仍保留给恢复/进房使用，但不能再拿它当首页唯一键；
 * 3. 旧脏 localStorage 也必须在这里自动收口，不能把修复散落到 UI。
 */
function 规范化首页房间历史(items: 首页房间历史条目[]): 首页房间历史条目[] {
  const byRoomCode = new Map<string, 首页房间历史条目>();
  for (const item of items) {
    const roomId = item.roomId.trim();
    const roomCode = item.roomCode.trim();
    if (!roomId || !roomCode || !Number.isFinite(item.lastEnteredAt)) {
      continue;
    }
    const current = byRoomCode.get(roomCode);
    if (!current || item.lastEnteredAt >= current.lastEnteredAt) {
      byRoomCode.set(roomCode, {
        roomId,
        roomCode,
        lastEnteredAt: item.lastEnteredAt,
      });
    }
  }
  return Array.from(byRoomCode.values()).sort(
    (left, right) => right.lastEnteredAt - left.lastEnteredAt
  );
}

function 读取首页房间历史条目(
  storage: Partial<Storage> | undefined
): 首页房间历史条目[] {
  const raw = 读取字符串(storage, 首页房间历史存储键);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const normalized = 规范化首页房间历史(
      parsed.map((item) => ({
        roomId: typeof item?.roomId === "string" ? item.roomId : "",
        roomCode: typeof item?.roomCode === "string" ? item.roomCode : "",
        lastEnteredAt: Number(item?.lastEnteredAt),
      }))
    );
    const normalizedRaw = JSON.stringify(normalized);
    if (normalizedRaw !== raw) {
      // 读取时顺手把旧脏值矫正回唯一真相，避免首页下一次又看到重复房间号。
      写入字符串(storage, 首页房间历史存储键, normalizedRaw);
    }
    return normalized;
  } catch {
    return [];
  }
}

function 写入首页房间历史条目(
  storage: Partial<Storage> | undefined,
  items: 首页房间历史条目[]
): void {
  写入字符串(storage, 首页房间历史存储键, JSON.stringify(规范化首页房间历史(items)));
}

/**
 * 浏览器存储实现继续沿用 localStorage，但把细节关进同一个薄适配层。
 *
 * 这样做的目的不是“包装一个新轮子”，而是让：
 * - 壳组件只表达意图；
 * - 存储键名和降级细节集中；
 * - 未来更换运行壳时只需替换这里。
 *
 * 这个 owner 现在归 `frontend/平台/存储.ts`，因为它表达的是浏览器本地记忆适配，
 * 不是聊天业务根目录的真实实现。
 */
export function 创建浏览器存储(
  storage: Partial<Storage> | undefined
): 前端存储端口 {
  return {
    读取或创建设备匿名凭证(): string {
      const stored = 读取字符串(storage, 设备匿名凭证存储键);
      if (stored) {
        return stored;
      }

      const generated =
        typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
          ? globalThis.crypto.randomUUID()
          : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      写入字符串(storage, 设备匿名凭证存储键, generated);
      return generated;
    },

    读取最近引导身份(): 最近引导身份缓存 | null {
      return 读取JSON(storage, 最近引导身份存储键, 规范化最近引导身份缓存);
    },

    写入最近引导身份(identity: 最近引导身份缓存): void {
      const normalized = 规范化最近引导身份缓存(identity);
      if (!normalized) {
        return;
      }
      写入JSON(storage, 最近引导身份存储键, normalized);
    },

    清除最近引导身份(): void {
      删除字符串(storage, 最近引导身份存储键);
    },

    读取当前房间标识(): string {
      return 读取字符串(storage, 当前房间存储键);
    },

    写入当前房间标识(roomId: string): void {
      写入字符串(storage, 当前房间存储键, roomId);
    },

    清除当前房间标识(): void {
      删除字符串(storage, 当前房间存储键);
    },

    读取当前房间短码(): string {
      return 读取字符串(storage, 当前房间短码存储键);
    },

    写入当前房间短码(roomCode: string): void {
      写入字符串(storage, 当前房间短码存储键, roomCode);
    },

    清除当前房间短码(): void {
      删除字符串(storage, 当前房间短码存储键);
    },

    读取当前房间恢复快照(): 当前房间恢复快照缓存 | null {
      return 读取JSON(storage, 当前房间恢复快照存储键, 规范化当前房间恢复快照缓存);
    },

    写入当前房间恢复快照(cache: 当前房间恢复快照缓存): void {
      const normalized = 规范化当前房间恢复快照缓存(cache);
      if (!normalized) {
        return;
      }
      写入JSON(storage, 当前房间恢复快照存储键, normalized);
    },

    清除当前房间恢复快照(): void {
      删除字符串(storage, 当前房间恢复快照存储键);
    },

    读取首页房间历史(): 首页房间历史条目[] {
      return 读取首页房间历史条目(storage);
    },

    /**
     * 首页历史的去重、更新时间戳排序都收口在存储端口里。
     * 壳层只表达“这个房间刚刚成功进入过”，不自己再读改写整表。
     */
    写入或更新首页房间历史条目(item: 首页房间历史条目): void {
      写入首页房间历史条目(storage, [item, ...读取首页房间历史条目(storage)]);
    },

    /**
     * 删除边界同样收口在端口里，后续 `room_not_found` 等失败路径只需要表达意图。
     */
    按房间标识删除首页房间历史条目(roomId: string): void {
      const trimmedRoomId = roomId.trim();
      if (!trimmedRoomId) {
        return;
      }
      写入首页房间历史条目(
        storage,
        读取首页房间历史条目(storage).filter((item) => item.roomId !== trimmedRoomId)
      );
    },
  };
}
