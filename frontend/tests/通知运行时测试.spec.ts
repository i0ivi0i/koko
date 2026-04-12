import { describe, expect, it, vi } from "vitest";
import { 创建通知运行时 } from "../平台/通知运行时";

describe("通知运行时", () => {
  it("只执行权限申请、badge 设置和通知点击回流，不判断业务上该提醒谁", async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    const createdNotifications: Array<{ onclick: null | (() => void) }> = [];
    const runtime = 创建通知运行时({
      notification: {
        permission: "default",
        requestPermission: vi.fn(async (): Promise<NotificationPermission> => "granted"),
        createNotification: (_title, _options) => {
          const instance = { onclick: null as null | (() => void) };
          createdNotifications.push(instance);
          return instance;
        },
      },
      navigator: {
        setAppBadge,
        clearAppBadge,
      } as unknown as Navigator,
    });

    await runtime.请求权限();
    await runtime.显示通知({
      id: "msg-1",
      title: "新消息",
      body: "hello",
      tag: "room-1",
    });
    expect(createdNotifications[0]).toBeDefined();
    createdNotifications[0]!.onclick?.();
    await runtime.设置角标(3);
    await runtime.清除角标();

    expect(runtime.snapshot()).toEqual({
      permission: "granted",
      lastClickedNotificationId: "msg-1",
      badgeCount: 0,
    });
    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
  });
});
