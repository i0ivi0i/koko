import { describe, expect, it } from "vitest";
import {
  创建离线任务仓库,
  type 平台离线任务,
  type 离线任务存储实现,
} from "../平台/离线任务仓库";

const 创建内存存储 = (): 离线任务存储实现 => {
  const tasks = new Map<string, 平台离线任务>();
  return {
    async 保存(task) {
      tasks.set(task.id, { ...task });
    },
    async 删除(taskId) {
      tasks.delete(taskId);
    },
    async 按任务标识读取(taskId) {
      const task = tasks.get(taskId);
      return task ? { ...task } : null;
    },
    async 按去重键读取(dedupeKey) {
      for (const task of tasks.values()) {
        if (task.dedupeKey === dedupeKey) {
          return { ...task };
        }
      }
      return null;
    },
    async 读取到期任务(now) {
      return Array.from(tasks.values())
        .filter((task) => task.retryAt <= now)
        .map((task) => ({ ...task }));
    },
  };
};

describe("离线任务仓库", () => {
  it("会按 dedupeKey 去重，避免重复任务入队", async () => {
    const 仓库 = 创建离线任务仓库({
      存储实现: 创建内存存储(),
    });
    const first = await 仓库.保存({
      id: "task-1",
      kind: "create_message",
      payload: { roomId: "r-1", text: "hello" },
      createdAt: 1,
      retryAt: 1,
      dedupeKey: "dedupe-1",
    });
    const second = await 仓库.保存({
      id: "task-2",
      kind: "create_message",
      payload: { roomId: "r-1", text: "hello" },
      createdAt: 2,
      retryAt: 2,
      dedupeKey: "dedupe-1",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await 仓库.列出到期任务(10)).toHaveLength(1);
  });

  it("会在重试后更新 retryAt，并只返回已到期任务", async () => {
    const 仓库 = 创建离线任务仓库({
      存储实现: 创建内存存储(),
    });
    await 仓库.保存({
      id: "task-retry",
      kind: "create_message",
      payload: { roomId: "r-1", text: "retry" },
      createdAt: 1,
      retryAt: 200,
      dedupeKey: "dedupe-retry",
    });

    expect(await 仓库.列出到期任务(100)).toEqual([]);
    await 仓库.标记重试("task-retry", 100);
    expect(await 仓库.列出到期任务(100)).toEqual([
      expect.objectContaining({
        id: "task-retry",
        retryAt: 100,
      }),
    ]);
  });
});
