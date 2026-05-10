/**
 * 媒体查看器（图片 PhotoSwipe / 视频 Video.js）共用的浏览器返回键接管 owner。
 *
 * 边界压力来源：
 * 1. 移动端用户按手机物理返回键、或桌面 Alt+← / 鼠标侧键，浏览器会直接 history.back()，
 *    若查看器没把自己作为一条 history 中间态，物理返回会直接退出群聊页面（被 UIUX禁令.md 5.2 / 5.5 明确禁止）；
 * 2. 视频和图片查看器的退出语义同源（关闭沉浸层、回到聊天上下文），不应各自维护两套 pushState/popstate；
 * 3. 退出方式分两类：
 *    - 用户从浏览器返回键触发 popstate（entry 已被浏览器消费）→ 通知查看器关闭；
 *    - 用户从查看器内部关闭按钮 / ESC / 拖拽关闭 → 查看器自己调 history.back() 把入口 entry 消费回去，保 history 干净。
 *
 * 状态机要点：
 * - `pushed`：是否已 pushState；重复 `接管()` 幂等。
 * - `consumedByUser`：用户主动 popstate 后置位，`消费()` 不再 history.back()。
 * - `cleanupInProgress`：`消费()` 自调 history.back() 触发的本会话 popstate 必须被忽略，否则会反向回弹给用户回调。
 * - `cleanupTimer`：让 cleanup-popstate 先到再 detach 监听器，避免并发顺序错乱。
 */

export const 媒体全屏历史键 = "__kokoMediaFullscreenSession";

export interface 媒体查看器历史接管 {
  接管(): void;
  消费(): void;
  释放(): void;
}

export interface 媒体查看器历史接管参数 {
  sessionId: string;
  onUserBackPressed(): void;
}

export const 创建媒体查看器历史接管 = (
  参数: 媒体查看器历史接管参数
): 媒体查看器历史接管 => {
  const { sessionId, onUserBackPressed } = 参数;
  let pushed = false;
  let consumedByUser = false;
  let cleanupInProgress = false;
  let cleanupTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const removeListener = (): void => {
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", handlePopState);
    }
  };

  const handlePopState = (): void => {
    if (cleanupInProgress) {
      cleanupInProgress = false;
      removeListener();
      return;
    }
    consumedByUser = true;
    onUserBackPressed();
  };

  return {
    接管: (): void => {
      if (pushed) {
        return;
      }
      if (
        typeof window === "undefined" ||
        typeof history === "undefined" ||
        typeof history.pushState !== "function"
      ) {
        return;
      }
      try {
        const currentState =
          history.state && typeof history.state === "object"
            ? (history.state as Record<string, unknown>)
            : {};
        history.pushState(
          { ...currentState, [媒体全屏历史键]: sessionId },
          "",
          window.location.href
        );
        pushed = true;
        window.addEventListener("popstate", handlePopState);
      } catch {
        // 失败也不回退成旧旁路；只是少一层返回键接管。
      }
    },
    消费: (): void => {
      if (cleanupTimer) {
        globalThis.clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }
      if (
        pushed &&
        !consumedByUser &&
        typeof history !== "undefined" &&
        typeof history.back === "function" &&
        (history.state as Record<string, unknown> | null)?.[媒体全屏历史键] ===
          sessionId
      ) {
        cleanupInProgress = true;
        history.back();
        cleanupTimer = globalThis.setTimeout(removeListener, 0);
        return;
      }
      removeListener();
    },
    释放: (): void => {
      if (cleanupTimer) {
        globalThis.clearTimeout(cleanupTimer);
        cleanupTimer = null;
      }
      removeListener();
    },
  };
};
