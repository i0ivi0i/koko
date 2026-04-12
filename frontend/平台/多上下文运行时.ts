type 广播消息事件 = { data: unknown };
type 广播消息处理器 = (event: 广播消息事件) => void;

type 广播信道 =
  | {
      addEventListener(type: "message", handler: 广播消息处理器): void;
      postMessage(data: unknown): void;
      close(): void;
    }
  | null;

type 多上下文消息 =
  | { type: "primary-context"; contextId: string }
  | { type: "notification-shown"; notificationId: string };

export interface 多上下文运行时快照 {
  contextId: string;
  isPrimaryContext: boolean;
  lastPrimaryContextId: string | null;
  deliveredNotificationIds: string[];
}

export interface 多上下文运行时依赖 {
  channelName?: string;
  contextId?: string;
  createChannel?: (name: string) => 广播信道;
}

export interface 多上下文运行时 {
  snapshot(): 多上下文运行时快照;
  声明主上下文(): void;
  通知已展示(notificationId: string): boolean;
  登记通知已展示(notificationId: string): boolean;
}

const 读取默认信道工厂 = (): ((name: string) => 广播信道) | undefined => {
  if (typeof BroadcastChannel === "undefined") {
    return undefined;
  }
  return (name) => new BroadcastChannel(name);
};

const 生成默认上下文标识 = (): string =>
  `ctx-${Math.random().toString(36).slice(2, 10)}`;

/**
 * 多上下文运行时只回答三个问题：
 * - 我是不是当前前台主上下文；
 * - 其他同源上下文刚刚广播了什么平台级消息；
 * - 某条通知是否已经在别的上下文展示过。
 *
 * 它不理解房间、消息、成员这些聊天语义。
 */
export function 创建多上下文运行时(
  deps: 多上下文运行时依赖 = {}
): 多上下文运行时 {
  const contextId = deps.contextId ?? 生成默认上下文标识();
  const createChannel = deps.createChannel ?? 读取默认信道工厂();
  const channel = createChannel?.(deps.channelName ?? "koko-browser-app") ?? null;

  let current: 多上下文运行时快照 = {
    contextId,
    isPrimaryContext: false,
    lastPrimaryContextId: null,
    deliveredNotificationIds: [],
  };
  const deliveredNotifications = new Set<string>();

  const 更新快照 = (patch: Partial<多上下文运行时快照>): void => {
    current = { ...current, ...patch };
  };

  const 处理广播消息 = (message: 多上下文消息): void => {
    if (message.type === "primary-context") {
      更新快照({
        isPrimaryContext: message.contextId === contextId,
        lastPrimaryContextId: message.contextId,
      });
      return;
    }
    if (message.type === "notification-shown") {
      deliveredNotifications.add(message.notificationId);
      更新快照({
        deliveredNotificationIds: Array.from(deliveredNotifications),
      });
    }
  };

  channel?.addEventListener("message", (event) => {
    const message = event.data as 多上下文消息;
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    处理广播消息(message);
  });

  return {
    snapshot(): 多上下文运行时快照 {
      return {
        ...current,
        deliveredNotificationIds: [...current.deliveredNotificationIds],
      };
    },

    声明主上下文(): void {
      const message: 多上下文消息 = {
        type: "primary-context",
        contextId,
      };
      处理广播消息(message);
      channel?.postMessage(message);
    },

    通知已展示(notificationId: string): boolean {
      return deliveredNotifications.has(notificationId);
    },

    登记通知已展示(notificationId: string): boolean {
      if (deliveredNotifications.has(notificationId)) {
        return false;
      }
      const message: 多上下文消息 = {
        type: "notification-shown",
        notificationId,
      };
      处理广播消息(message);
      channel?.postMessage(message);
      return true;
    },
  };
}
