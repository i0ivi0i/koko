import type { 消息事件 } from "../聊天共享/契约.js";
import type { 聊天内核平台端口 } from "./聊天应用编排桥接.js";

/**
 * 通知副作用 owner 只负责把“他人的权威新消息”翻译成平台命令。
 * 它不判断消息是否合法，也不计算房间成员/权限；这些业务事实已经来自后端权威事件。
 */
export function 处理权威新消息平台副作用(input: {
  events: 消息事件[];
  currentSessionId: string;
  平台桥接: 聊天内核平台端口;
}): void {
  const otherMessages = input.events.filter(
    (event) => event.sender_session_id !== input.currentSessionId
  );
  if (otherMessages.length === 0) {
    return;
  }

  const platformSnapshot = input.平台桥接.snapshot();
  const 当前就在前台主窗口 =
    platformSnapshot.lifecycle.phase === "active" &&
    platformSnapshot.lifecycle.visibility === "visible" &&
    platformSnapshot.multiContext.isPrimaryContext;
  if (当前就在前台主窗口) {
    return;
  }

  const 最新一条他人消息 = otherMessages.at(-1)!;
  void input.平台桥接.dispatch({
    type: "SET_BADGE",
    count: platformSnapshot.notification.badgeCount + otherMessages.length,
  });
  void input.平台桥接.dispatch({
    type: "SHOW_NOTIFICATION",
    id: 最新一条他人消息.message_id,
    title: 最新一条他人消息.sender_display_alias,
    body: 最新一条他人消息.text,
    tag: 最新一条他人消息.room_id,
  });
}
