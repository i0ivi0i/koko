import {
  创建生命周期运行时,
  type 生命周期快照,
  type 生命周期运行时,
} from "./生命周期运行时.js";
import {
  创建存储运行时,
  type 存储运行时,
} from "./存储运行时.js";
import {
  创建服务工作线程运行时,
  type 服务工作线程运行时事件,
  type 服务工作线程运行时,
  type 服务工作线程快照,
} from "./服务工作线程运行时.js";
import {
  创建传输运行时,
  type 传输运行时,
  type 传输运行时快照,
} from "./传输运行时.js";
import {
  创建多上下文运行时,
  type 多上下文运行时,
  type 多上下文运行时快照,
} from "./多上下文运行时.js";
import {
  创建通知运行时,
  type 显示通知输入,
  type 通知运行时,
  type 通知运行时快照,
} from "./通知运行时.js";
import {
  创建离线运行时,
  type 离线运行时,
  type 离线运行时快照,
} from "./离线运行时.js";

export interface 浏览器应用平台依赖 {
  lifecycle?: 生命周期运行时;
  storage?: 存储运行时;
  serviceWorker?: 服务工作线程运行时;
  transport?: 传输运行时;
  multiContext?: 多上下文运行时;
  notification?: 通知运行时;
  offline?: 离线运行时;
}

export interface 浏览器应用平台快照 {
  lifecycle: 生命周期快照;
  serviceWorker: 服务工作线程快照;
  transport: 传输运行时快照;
  multiContext: 多上下文运行时快照;
  notification: 通知运行时快照;
  offline: 离线运行时快照;
}

export type 浏览器应用平台命令 =
  | { type: "CLAIM_PRIMARY_CONTEXT" }
  | { type: "ACCEPT_SERVICE_WORKER_UPDATE" }
  | ({ type: "SHOW_NOTIFICATION" } & 显示通知输入)
  | { type: "SET_BADGE"; count: number }
  | { type: "CLEAR_BADGE" };

export type 浏览器应用平台事件 =
  | 服务工作线程运行时事件
  | { type: "PRIMARY_CONTEXT_FOCUSED" }
  | { type: "OFFLINE_STATUS_CHANGED"; online: boolean };

export interface 浏览器应用平台 {
  lifecycle: 生命周期运行时;
  storage: 存储运行时;
  serviceWorker: 服务工作线程运行时;
  transport: 传输运行时;
  multiContext: 多上下文运行时;
  notification: 通知运行时;
  offline: 离线运行时;
  启动(): Promise<void>;
  snapshot(): 浏览器应用平台快照;
  订阅事件?(listener: (event: 浏览器应用平台事件) => void): () => void;
  dispatch(command: 浏览器应用平台命令): Promise<boolean | void>;
}

/**
 * BrowserAppPlatform 是浏览器运行时组合根。
 * 当前阶段先把浏览器运行时能力集中到一个入口：
 * - 生命周期
 * - 存储
 * - service worker
 * - transport 实例归属
 *
 * 它不解释聊天业务事实，只负责把浏览器层能力收口，避免每个壳继续各管一份。
 */
export function 创建浏览器应用平台(
  deps: 浏览器应用平台依赖 = {}
): 浏览器应用平台 {
  const lifecycle = deps.lifecycle ?? 创建生命周期运行时();
  const storage = deps.storage ?? 创建存储运行时();
  const serviceWorker = deps.serviceWorker ?? 创建服务工作线程运行时();
  const transport = deps.transport ?? 创建传输运行时();
  const multiContext = deps.multiContext ?? 创建多上下文运行时();
  const notification = deps.notification ?? 创建通知运行时();
  const offline = deps.offline ?? 创建离线运行时();
  const 事件监听器 = new Set<(event: 浏览器应用平台事件) => void>();

  const 发布平台事件 = (event: 浏览器应用平台事件): void => {
    for (const listener of 事件监听器) {
      listener(event);
    }
  };

  /**
   * 平台层自己只消费浏览器运行时事实：
   * - 生命周期变化继续同步给 transport；
   * - 当前标签重新回到 active 时，平台负责声明主上下文并清理 badge；
   * - 这些都不解释聊天消息是否已读、是否已成立。
   */
  lifecycle.订阅((snapshot) => {
    transport.接收生命周期变化(snapshot);
    if (snapshot.phase === "active") {
      multiContext.声明主上下文();
      void notification.清除角标();
    }
  });
  offline.订阅?.((snapshot) => {
    // 平台层只把“网络是否恢复”翻成稳定浏览器事件；
    // 具体哪些媒体会话该恢复，仍然交给上层应用 owner 裁决。
    发布平台事件({ type: "OFFLINE_STATUS_CHANGED", online: snapshot.online });
  });

  notification.订阅点击(() => {
    void (async () => {
      const 已恢复前台 =
        (await multiContext.请求回到应用前台?.()) ?? false;
      if (!已恢复前台) {
        multiContext.请求聚焦当前上下文();
      }
      multiContext.声明主上下文();
      await notification.清除角标();
      发布平台事件({ type: "PRIMARY_CONTEXT_FOCUSED" });
    })();
  });
  serviceWorker.订阅事件?.((event) => {
    发布平台事件(event);
  });

  const 读取平台快照 = (): 浏览器应用平台快照 => ({
    lifecycle: lifecycle.snapshot(),
    serviceWorker: serviceWorker.snapshot(),
    transport: transport.snapshot(),
    multiContext: multiContext.snapshot(),
    notification: notification.snapshot(),
    offline: offline.snapshot(),
  });

  let 启动中: Promise<void> | null = null;

  return {
    lifecycle,
    storage,
    serviceWorker,
    transport,
    multiContext,
    notification,
    offline,
    async 启动(): Promise<void> {
      if (!启动中) {
        启动中 = (async () => {
          transport.接收生命周期变化(lifecycle.snapshot());
          multiContext.声明主上下文();
          await serviceWorker.启动();
          await offline.就绪({
            已注册服务工作线程: [
              serviceWorker.读取注册("app"),
              serviceWorker.读取注册("media"),
            ],
          });
        })();
      }
      await 启动中;
    },

    snapshot(): 浏览器应用平台快照 {
      return 读取平台快照();
    },

    订阅事件(listener: (event: 浏览器应用平台事件) => void): () => void {
      事件监听器.add(listener);
      return () => {
        事件监听器.delete(listener);
      };
    },

    async dispatch(command: 浏览器应用平台命令): Promise<boolean | void> {
      switch (command.type) {
        case "CLAIM_PRIMARY_CONTEXT":
          multiContext.声明主上下文();
          return;
        case "ACCEPT_SERVICE_WORKER_UPDATE":
          return serviceWorker.接受更新?.() ?? false;
        case "SHOW_NOTIFICATION":
          if (multiContext.通知已展示(command.id)) {
            return false;
          }
          {
            const shown = await notification.显示通知({
            id: command.id,
            title: command.title,
            ...(typeof command.body === "string" ? { body: command.body } : {}),
            ...(typeof command.tag === "string" ? { tag: command.tag } : {}),
          });
            if (!shown) {
              return false;
            }
            multiContext.登记通知已展示(command.id);
            return true;
          }
        case "SET_BADGE":
          await notification.设置角标(command.count);
          return true;
        case "CLEAR_BADGE":
          await notification.清除角标();
          return true;
      }
    },
  };
}
