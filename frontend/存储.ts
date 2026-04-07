const 设备匿名凭证存储键 = "koko_device_anonymous_token";
const 当前房间存储键 = "koko_current_room_id";
const 当前房间短码存储键 = "koko_current_room_code";

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
  };
}
