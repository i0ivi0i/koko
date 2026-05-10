/**
 * IndexedDB 消息仓库 写入 coalesce 单测（修漏洞 D）
 *
 * 验证 adapter 内部缓冲：
 * - 小批量 push 在 100ms 内合并成单次 transaction（避免 IDB queue 积压）；
 * - 大批量（≥100 条）立即 flush，不等 timer（保 BOOTSTRAP 首屏延迟）；
 * - 读取/清空 前先内部排干 buffer，保证业务数据一致；
 * - flush() API 显式刷出（用于 pagehide / beforeunload 钩子）；
 * - 房间隔离：A 房间 push 不影响 B 房间。
 *
 * 验证策略：在 adapter 之外另开一个 IDB 直读连接，在 timer 推进前后比较 store 内的实际记录数。
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { 创建IndexedDB消息仓库 } from "../../聊天本地缓存/IndexedDB消息仓库.js";
import type { 消息事件 } from "../../聊天共享/契约.js";

const 房间A = "room-co-A";
const 房间B = "room-co-B";

const 制造消息 = (room_id: string, event_position: number): 消息事件 => ({
  type: "message_created",
  room_id,
  message_id: `${room_id}-m-${event_position}`,
  client_message_id: `${room_id}-c-${event_position}`,
  sender_session_id: "s",
  sender_display_alias: "u",
  text: `t-${event_position}`,
  attachments: [],
  event_position,
});

/** 重置 fake-indexeddb factory，保证用例之间互相隔离。 */
function 重置IDB(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

/**
 * 真实等待 N 毫秒。
 *
 * 不能用 vi.useFakeTimers()：fake-indexeddb 内部用 setTimeout 调度 IDB 异步任务，
 * fake timer 会卡住 IDB 流水线导致整个测试超时。100ms 真实等待是可接受的代价。
 */
const 真实等待 = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 直接绕过 adapter，原始 IDB API 读 messages store 总条数。
 * 用于断言「buffer 是否已落盘」——adapter 还没 flush 时这个数应该为 0。
 *
 * 注意：fake-indexeddb 同 db 名允许多 connection 并存，不会阻塞 adapter 的内部 connection。
 */
async function 直接计数物理条目数(): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("koko-messages", 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("messages", "readonly");
      const countReq = tx.objectStore("messages").count();
      countReq.onsuccess = () => {
        db.close();
        resolve(countReq.result);
      };
      countReq.onerror = () => reject(countReq.error);
    };
    req.onerror = () => reject(req.error);
    // upgradeneeded 不会在这里触发：第一次 open 已被 adapter 完成 schema 创建。
  });
}

/**
 * 预先建好 messages store schema，让 `直接计数物理条目数` 即使在 adapter 还没首次打开
 * connection 时也能正常 open（避免 NotFoundError: No objectStore named messages）。
 *
 * adapter 后续打开同 db version 1 时会跳过 upgradeneeded（因为已经是 version 1），
 * 直接复用我们建好的 store，行为一致。
 */
async function 预建schema(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("koko-messages", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("messages", {
        keyPath: ["room_id", "event_position"],
      });
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe("IndexedDB 消息仓库 - 写入 coalesce", () => {
  beforeEach(async () => {
    重置IDB();
    await 预建schema();
  });

  it("小批量 push：debounce 期间不落盘，100ms+ 后合并落盘", async () => {
    const repo = 创建IndexedDB消息仓库();
    /**
     * 先调用一次 写入 让 adapter 打开 IDB connection 并完成 schema 创建。
     * （fake-indexeddb 的 upgradeneeded 必须由首次 open 触发）
     */
    await repo.写入(房间A, [制造消息(房间A, 1)]);
    // 此时 buffer 应该有 1 条但还没刷（debounce 100ms 未到期）
    await 真实等待(10);
    expect(await 直接计数物理条目数()).toBe(0);

    // 再 push 4 条，仍在 100ms 内，buffer 累计 5 条
    for (let i = 2; i <= 5; i += 1) {
      await repo.写入(房间A, [制造消息(房间A, i)]);
    }
    expect(await 直接计数物理条目数()).toBe(0);

    // 等超过 debounce 窗口以及 flush 本身的 IDB IO
    await 真实等待(200);
    expect(await 直接计数物理条目数()).toBe(5);
  });

  it("大批量 push（达量阈值 100）立即落盘，不等 timer", async () => {
    const repo = 创建IndexedDB消息仓库();
    const 大批 = Array.from({ length: 100 }, (_, i) => 制造消息(房间A, i + 1));
    await repo.写入(房间A, 大批);
    // 达量路径会在 await repo.写入 内部同步刷盘，返回后 IDB 已有数据
    expect(await 直接计数物理条目数()).toBe(100);
  });

  it("读取窗口 前先排干 buffer，业务能立即读到刚写的", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(房间A, 1), 制造消息(房间A, 2)]);
    // timer 还没动，但读取窗口应该自己先 flush
    const got = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    expect(got.map((m) => m.event_position)).toEqual([1, 2]);
  });

  it("flush() 显式 API：把 buffer 排干", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(房间A, 1)]);
    expect(await 直接计数物理条目数()).toBe(0);
    await repo.flush();
    expect(await 直接计数物理条目数()).toBe(1);
  });

  it("两个房间并发 push 互不串扰，flush 后各自可读", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(房间A, 1)]);
    await repo.写入(房间B, [制造消息(房间B, 1)]);
    await repo.flush();

    const gotA = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    const gotB = await repo.读取窗口(房间B, { 上界event_position: 999, 数量: 10 });
    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(1);
    expect(gotA[0]?.room_id).toBe(房间A);
    expect(gotB[0]?.room_id).toBe(房间B);
  });

  it("flush 后再写入再 flush：每次都能读到", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(房间A, 1)]);
    await repo.flush();
    await repo.写入(房间A, [制造消息(房间A, 2)]);
    await repo.flush();
    const got = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    expect(got.map((m) => m.event_position)).toEqual([1, 2]);
  });

  it("空 buffer 调 flush 是 no-op", async () => {
    const repo = 创建IndexedDB消息仓库();
    await expect(repo.flush()).resolves.toBeUndefined();
    expect(await 直接计数物理条目数()).toBe(0);
  });

  it("清空房间 前先排干 buffer，保证不漏删", async () => {
    const repo = 创建IndexedDB消息仓库();
    await repo.写入(房间A, [制造消息(房间A, 1)]);
    // buffer 中有数据，清空房间应该处理掉它（即使没进 IDB 也应该不留下）
    await repo.清空房间(房间A);
    const got = await repo.读取窗口(房间A, { 上界event_position: 999, 数量: 10 });
    expect(got).toEqual([]);
  });
});
