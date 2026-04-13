type 通知权限状态 = NotificationPermission | "unsupported";

export interface 通知运行时快照 {
  permission: 通知权限状态;
  lastClickedNotificationId: string | null;
  badgeCount: number;
}

type 通知实例 = {
  onclick: null | ((event?: Event) => void);
};

type 通知依赖 =
  | {
      permission: NotificationPermission;
      requestPermission(): Promise<NotificationPermission>;
      createNotification(
        title: string,
        options: { body?: string; tag?: string }
      ): 通知实例;
    }
  | undefined;

type 角标导航器 =
  | (Navigator & {
      setAppBadge?: (count?: number) => Promise<unknown> | unknown;
      clearAppBadge?: () => Promise<unknown> | unknown;
    })
  | undefined;

export interface 通知运行时依赖 {
  notification?: 通知依赖;
  navigator?: 角标导航器;
}

export interface 显示通知输入 {
  id: string;
  title: string;
  body?: string;
  tag?: string;
}

export interface 通知运行时 {
  snapshot(): 通知运行时快照;
  订阅点击(listener: (notificationId: string) => void): () => void;
  请求权限(): Promise<通知权限状态>;
  显示通知(input: 显示通知输入): Promise<boolean>;
  设置角标(count: number): Promise<void>;
  清除角标(): Promise<void>;
}

const 读取默认通知依赖 = (): 通知依赖 => {
  if (typeof Notification === "undefined") {
    return undefined;
  }
  return {
    get permission() {
      return Notification.permission;
    },
    requestPermission: () => Notification.requestPermission(),
    createNotification: (title, options) =>
      new Notification(title, options) as unknown as 通知实例,
  };
};

/**
 * 通知运行时只负责执行浏览器通知能力：
 * - 请求权限
 * - 显示系统通知
 * - 设置 / 清理 badge
 * - 把点击事件回流成平台快照
 *
 * “哪条消息该提醒”必须由业务内核判断。
 */
export function 创建通知运行时(
  deps: 通知运行时依赖 = {}
): 通知运行时 {
  const notificationApi = deps.notification ?? 读取默认通知依赖();
  const badgeNavigator =
    deps.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);

  let current: 通知运行时快照 = {
    permission: notificationApi?.permission ?? "unsupported",
    lastClickedNotificationId: null,
    badgeCount: 0,
  };
  const 点击监听器 = new Set<(notificationId: string) => void>();

  return {
    snapshot(): 通知运行时快照 {
      return { ...current };
    },

    订阅点击(listener: (notificationId: string) => void): () => void {
      点击监听器.add(listener);
      return () => {
        点击监听器.delete(listener);
      };
    },

    async 请求权限(): Promise<通知权限状态> {
      if (!notificationApi) {
        current = { ...current, permission: "unsupported" };
        return "unsupported";
      }
      const permission =
        current.permission === "default"
          ? await notificationApi.requestPermission()
          : current.permission;
      current = { ...current, permission };
      return permission;
    },

    async 显示通知(input: 显示通知输入): Promise<boolean> {
      const permission = await this.请求权限();
      if (!notificationApi || permission !== "granted") {
        return false;
      }
      const notificationOptions: { body?: string; tag?: string } = {};
      if (typeof input.body === "string") {
        notificationOptions.body = input.body;
      }
      if (typeof input.tag === "string") {
        notificationOptions.tag = input.tag;
      }
      const notification = notificationApi.createNotification(input.title, notificationOptions);
      notification.onclick = () => {
        current = {
          ...current,
          lastClickedNotificationId: input.id,
        };
        for (const listener of 点击监听器) {
          listener(input.id);
        }
      };
      return true;
    },

    async 设置角标(count: number): Promise<void> {
      current = { ...current, badgeCount: count };
      if (typeof badgeNavigator?.setAppBadge === "function") {
        await badgeNavigator.setAppBadge(count);
      }
    },

    async 清除角标(): Promise<void> {
      current = { ...current, badgeCount: 0 };
      if (typeof badgeNavigator?.clearAppBadge === "function") {
        await badgeNavigator.clearAppBadge();
      }
    },
  };
}
