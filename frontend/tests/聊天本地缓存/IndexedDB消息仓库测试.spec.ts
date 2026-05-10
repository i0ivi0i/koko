/**
 * IndexedDB 消息仓库 adapter 单测
 *
 * 覆盖端口契约的 9 项行为 + 2 项 IDB 缺失降级，共 11 项：
 * - 写入空数组是 no-op
 * - 写入后能按 event_position 范围读取
 * - 读取按 event_position 升序返回
 * - 数量参数限制返回条数（取最接近上界的）
 * - 写入幂等（同一 [room_id, event_position] 重复以最后一次为准）
 * - 空房间读取返回空数组
 * - 不同房间隔离
 * - 上界 event_position 是严格小于（不含）
 * - 清空房间后读取返回空
 * - IndexedDB 缺失时，写入静默成功
 * - IndexedDB 缺失时，读取返回空
 *
 * 通过 fake-indexeddb/auto 自动 polyfill `indexedDB` / `IDBKeyRange`，
 * 每个用例前清掉所有 db 保证测试相互隔离。
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { 创建IndexedDB消息仓库 } from "../../聊天本地缓存/IndexedDB消息仓库.js";
import type { 消息事件 } from "../../聊天共享/契约.js";

const 房间A = "room-aaaa";

/**
 * 制造测试消息事件。
 * - `event_position` 是排序锚点；
 * - `suffix` 用于区分同一 event_position 的不同写入版本（验证幂等更新）。
 */
const 制造消息 = (event_position: number, suffix = ""): 消息事件 => ({
  type: "message_created",
  room_id: 房间A,
  message_id: `msg-${event_position}${suffix}`,
  client_message_id: `cli-${event_position}${suffix}`,
  sender_session_id: "sess-1",
  sender_display_alias: "Alice",
  text: `hello-${event_position}${suffix}`,
  attachments: [],
  event_position,
});

/**
 * 重置全局 indexedDB 为一个全新的 fake IDBFactory：
 *
 * 不用 indexedDB.deleteDatabase 路径，是因为 adapter 在前一个测试持有未关闭的 db 句柄，
 * fake-indexeddb 会让 deleteDatabase 永久等待 versionchange 关闭，导致测试 timeout。
 * 直接换 factory 等价于「丢掉整套虚拟磁盘」，保证用例 100% 隔离。
 */
function 重置IDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

describe("IndexedDB 消息仓库", () => {
  beforeEach(() => {
    重置IDB();
  });

  it("写入空数组是 no-op", async () => {
    const repo = 创建IndexedDB消息仓库();
    await expect(repo.写入(房间A, [])).resolves.toBeUndefined();
  });

  it("写入后能按 event_position 范围读取", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(10), 制造消息(20), 制造消息(30)]);
    const got = await repo.读取窗口(房间A, { 上界event_position: 25, 数量: 10 });
    // 上界 25 严格不含，所以只返回 10 / 20。
    expect(got.map((m: 消息事件) => m.event_position)).toEqual([10, 20]);
  });

  it("读取按 event_position 升序返回", async () => {
    const repo = 创建IndexedDB消息仓库();
    // 故意打乱写入顺序，验证读取始终升序。
    await repo.写入(房间A, [制造消息(30), 制造消息(10), 制造消息(20)]);
    const got = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    expect(got.map((m: 消息事件) => m.event_position)).toEqual([10, 20, 30]);
  });

  it("数量参数限制返回条数（取最接近上界的）", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [10, 20, 30, 40, 50].map((p) => 制造消息(p)));
    const got = await repo.读取窗口(房间A, { 上界event_position: 100, 数量: 2 });
    // 数量 2，应该取最接近上界的 40 / 50，仍按升序返回。
    expect(got.map((m: 消息事件) => m.event_position)).toEqual([40, 50]);
  });

  it("写入幂等：同一 (room_id, event_position) 重复以最后一次为准", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(10, "-v1")]);
    await repo.写入(房间A, [制造消息(10, "-v2")]);
    const got = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    expect(got).toHaveLength(1);
    // 期望第二次写入覆盖第一次（乐观→权威替换语义）。
    expect(got[0]?.message_id).toBe("msg-10-v2");
  });

  it("空房间读取返回空数组", async () => {
    const repo = 创建IndexedDB消息仓库();
    const got = await repo.读取窗口("room-empty", { 上界event_position: 999, 数量: 10 });
    expect(got).toEqual([]);
  });

  it("不同房间隔离", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(10)]);
    // 读其他房间应该完全干净，不受房间 A 影响。
    const got = await repo.读取窗口("room-bbbb", { 上界event_position: 999, 数量: 10 });
    expect(got).toEqual([]);
  });

  it("上界 event_position 是严格小于（不含）", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(10), 制造消息(20)]);
    // 上界 20 应该排除 event_position === 20 的那条。
    const got = await repo.读取窗口(房间A, { 上界event_position: 20, 数量: 10 });
    expect(got.map((m: 消息事件) => m.event_position)).toEqual([10]);
  });

  it("清空房间后读取返回空", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(10)]);
    await repo.清空房间(房间A);
    const got = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    expect(got).toEqual([]);
  });
});

describe("IndexedDB 消息仓库 - IDB 不可用降级", () => {
  /**
   * 测试 IDB 全局缺失（如某些隐私模式 / 内核不支持）时 adapter 是否优雅降级。
   * 用 globalThis 临时摘除 indexedDB，验证：
   * - 写入不抛错；
   * - 读取返回空数组（让调用方走服务端权威路径）。
   */
  let 已保存indexedDB: typeof indexedDB | undefined;
  let 已保存IDBKeyRange: typeof IDBKeyRange | undefined;

  beforeEach(() => {
    已保存indexedDB = (globalThis as { indexedDB?: typeof indexedDB }).indexedDB;
    已保存IDBKeyRange = (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
    // 故意拿掉以模拟 IDB 缺失环境。cast 后类型为可选，可合法 delete。
    delete (globalThis as { indexedDB?: typeof indexedDB }).indexedDB;
    delete (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange;
  });

  afterEach(() => {
    // 还原全局，避免后续测试受影响。
    if (已保存indexedDB) {
      (globalThis as { indexedDB?: typeof indexedDB }).indexedDB = 已保存indexedDB;
    }
    if (已保存IDBKeyRange) {
      (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange = 已保存IDBKeyRange;
    }
  });

  it("IndexedDB 缺失时，写入静默成功", async () => {
    const repo = 创建IndexedDB消息仓库();
    await expect(repo.写入("room-x", [制造消息(10)])).resolves.toBeUndefined();
  });

  it("IndexedDB 缺失时，读取返回空", async () => {
    const repo = 创建IndexedDB消息仓库();
    const got = await repo.读取窗口("room-x", { 上界event_position: 999, 数量: 10 });
    expect(got).toEqual([]);
  });
});
