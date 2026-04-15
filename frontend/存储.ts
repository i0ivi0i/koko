const 设备匿名凭证存储键 = "koko_device_anonymous_token";
const 当前房间存储键 = "koko_current_room_id";
const 当前房间短码存储键 = "koko_current_room_code";
const 首页房间历史存储键 = "koko_home_sessions";

export interface 首页房间历史条目 {
  roomId: string;
  roomCode: string;
  lastEnteredAt: number;
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
  读取当前房间标识(): string;
  写入当前房间标识(roomId: string): void;
  清除当前房间标识(): void;
  读取当前房间短码(): string;
  写入当前房间短码(roomCode: string): void;
  清除当前房间短码(): void;
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
 */
export function 创建浏览器存储(
  storage:
    | Partial<Storage>
    | undefined = typeof window !== "undefined"
    ? (window.localStorage as Partial<Storage>)
    : undefined
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
