import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { 消息事件 } from "../聊天共享/契约.js";
import type { 消息仓库端口 } from "./消息仓库端口.js";

/**
 * IndexedDB 消息仓库 adapter（外圈 adapter）。
 *
 * 职责：实现 application 层的 消息仓库端口 接口；只做：
 * - IndexedDB API 调用（openDB / transaction / cursor）；
 * - 序列化与反序列化（消息事件 ↔ 消息记录）；
 * - 错误降级（任何 IDB 异常都吞掉）。
 *
 * **不**承载任何业务规则——合流、去重、合法性、权限都不在这里。
 *
 * Schema：
 *   DB:    koko-messages（版本 1）
 *   Store: messages, keyPath: ["room_id", "event_position"]（复合主键，天然按房间分桶 + 升序）
 *
 * 错误降级原则（spec §10）：
 * - 任何 IDB 异常 → 写入静默吞掉、读取返回空数组、清空静默吞掉；
 * - 没有 indexedDB 全局或 IDBKeyRange 全局时立刻返回 no-op stub，不抛错。
 *
 * 范本：复用 frontend/平台/离线任务仓库.ts 已验证过的 idb v8 用法。
 */

/**
 * 持久化记录形状：在 消息事件 之上加 cached_at（写入时间，便于未来 LRU）
 * 和 schema_version（未来字段升级时降级老数据用的版本号）。
 *
 * `cached_at` / `schema_version` 都是仓库内部元数据，**禁止**让上层业务感知。
 */
interface 消息记录 extends 消息事件 {
  cached_at: number;
  schema_version: 1;
}

interface 消息缓存数据库定义 extends DBSchema {
  messages: {
    key: [string, number];
    value: 消息记录;
  };
}

const 数据库名 = "koko-messages";
const 数据库版本 = 1;
const 消息库名 = "messages";

/**
 * IDB 全局缺失时的 no-op 实现：保证调用方代码可以原样跑，不需要在外层加 if 守卫。
 * - 写入静默成功；
 * - 读取返回空数组（调用方应该走服务端权威路径）；
 * - 清空静默成功。
 */
const 创建空仓库 = (): 消息仓库端口 => ({
  async 写入(): Promise<void> {
    /* IDB 不可用：no-op */
  },
  async 读取窗口(): Promise<消息事件[]> {
    /* IDB 不可用：返回空，调用方走服务端 */
    return [];
  },
  async 清空房间(): Promise<void> {
    /* IDB 不可用：no-op */
  },
});

/**
 * 工厂函数：装配 IndexedDB 消息仓库 adapter。
 *
 * 不持有跨实例状态，每次调用返回独立闭包；这样测试 / 多 Tab 都可独立装配，
 * 不会互相串扰（实际数据库唯一性由 数据库名 保证）。
 */
export function 创建IndexedDB消息仓库(): 消息仓库端口 {
  // IDB 全局能力探测：缺任一项就返回空仓库（可能是隐私模式 / 老内核）。
  if (typeof indexedDB === "undefined" || typeof IDBKeyRange === "undefined") {
    return 创建空仓库();
  }

  /**
   * 数据库句柄是惰性打开 + 缓存的：
   * - 首次调用 读取数据库() 时才发起 openDB；
   * - 之后所有读写共用同一个 Promise，避免每次 IO 都走一次 open。
   *
   * 注意：openDB 在这一层捕获不到（idb v8 会把 onerror 转成 reject），
   * 所以下游每个写入/读取/清空 都自己包 try/catch 兜底。
   */
  let 数据库Promise: Promise<IDBPDatabase<消息缓存数据库定义>> | null = null;
  const 读取数据库 = (): Promise<IDBPDatabase<消息缓存数据库定义>> => {
    if (!数据库Promise) {
      数据库Promise = openDB<消息缓存数据库定义>(数据库名, 数据库版本, {
        upgrade(db, oldVersion) {
          // 未来加新版本时，仍可继续在这里追 if (oldVersion < N) 分支做 migrate。
          if (oldVersion < 1) {
            db.createObjectStore(消息库名, {
              keyPath: ["room_id", "event_position"],
            });
          }
        },
      });
    }
    return 数据库Promise;
  };

  /** 把领域事件转成持久化记录（加上仓库内部元数据）。 */
  const 转记录 = (msg: 消息事件): 消息记录 => ({
    ...msg,
    cached_at: Date.now(),
    schema_version: 1,
  });

  /** 把持久化记录还原成领域事件（剔除仓库内部元数据）。 */
  const 转事件 = (rec: 消息记录): 消息事件 => {
    const { cached_at: _cached, schema_version: _schema, ...rest } = rec;
    return rest;
  };

  return {
    async 写入(roomId, messages): Promise<void> {
      if (messages.length === 0) {
        // 空数组直接 no-op，避免无谓打开 transaction。
        return;
      }
      try {
        const db = await 读取数据库();
        const tx = db.transaction(消息库名, "readwrite");
        // 防御式过滤：只写入 room_id 与目标房间一致的消息，
        // 避免上游粗心传入跨房间数据导致索引污染。
        const tasks = messages
          .filter((m) => m.room_id === roomId)
          .map((m) => tx.store.put(转记录(m)));
        await Promise.all(tasks);
        await tx.done;
      } catch {
        // 写入失败一律静默：本地缓存只是体验加速，丢一笔不会影响业务真相
        // （业务真相在服务端，下次 BOOTSTRAP 仍可重新拉回来）。
      }
    },

    async 读取窗口(roomId, { 上界event_position, 数量 }): Promise<消息事件[]> {
      if (数量 <= 0) return [];
      try {
        const db = await 读取数据库();
        // 复合主键 [room_id, event_position]：
        // - 下界 [roomId, MIN_SAFE_INTEGER] 保证只命中本房间；
        // - 上界 [roomId, 上界event_position] + open（true）保证严格小于；
        // - 倒序游标读 N 条，反转后即为升序。
        const range = IDBKeyRange.bound(
          [roomId, Number.MIN_SAFE_INTEGER],
          [roomId, 上界event_position],
          false, // 下界闭区间
          true   // 上界开区间（严格小于）
        );
        const 收集: 消息记录[] = [];
        let cursor = await db
          .transaction(消息库名, "readonly")
          .store.openCursor(range, "prev");
        while (cursor && 收集.length < 数量) {
          收集.push(cursor.value);
          cursor = await cursor.continue();
        }
        // 倒序游标拿到的是「最接近上界的 N 条 倒序」，反转回升序后再剥元数据。
        收集.reverse();
        return 收集.map(转事件);
      } catch {
        // 读取失败返回空数组，让调用方走服务端权威路径，不弹错给用户。
        return [];
      }
    },

    async 清空房间(roomId): Promise<void> {
      try {
        const db = await 读取数据库();
        // 删除整个房间区间：[roomId, MIN_SAFE_INTEGER] ~ [roomId, MAX_SAFE_INTEGER]，
        // 都是闭区间。idb 的 db.delete(store, range) 会按 keyRange 批量删。
        const range = IDBKeyRange.bound(
          [roomId, Number.MIN_SAFE_INTEGER],
          [roomId, Number.MAX_SAFE_INTEGER]
        );
        await db.delete(消息库名, range);
      } catch {
        // 清空失败一律静默：实际场景里调用方会再走 BOOTSTRAP 拉权威，
        // 不需要在这里把错误抛给业务。
      }
    },
  };
}
