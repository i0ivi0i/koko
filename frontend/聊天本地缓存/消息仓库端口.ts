import type { 消息事件 } from "../聊天共享/契约.js";

/**
 * 消息仓库端口（application 层 port）
 *
 * 这是聊天本地缓存对外暴露的稳定接口，按 Onion Clean Architecture：
 * - 内圈编排（恢复/阅读推进/聊天应用内核）只依赖此端口；
 * - 外圈 adapter（IndexedDB / 内存 / 未来 OPFS）按本端口实现真实存储；
 * - 端口本身不感知任何具体存储技术，更不暴露底层 transaction / cursor。
 *
 * 端口语义（必须由所有实现共同遵守）：
 * 1. 写入语义为 upsert，按 [room_id, event_position] 复合主键去重；
 *    同一主键重复写入以最后一次为准（处理乐观→权威替换、重发、补洞）。
 * 2. 读取语义为「取严格小于 上界event_position 的最近 N 条，按 event_position 升序返回」；
 *    上界 N 不变量：上界本身**不**进入返回集合。
 * 3. 任何实现层异常都必须降级处理：
 *    - 写入失败：静默吞掉，不向上抛；
 *    - 读取失败：返回空数组（让调用方走服务端权威路径）。
 * 4. 仓库不解释消息业务事实，不做合流，不做去重之外的业务裁决。
 */
export interface 消息仓库端口 {
  /**
   * 写入一批消息事件（upsert）。
   *
   * @param roomId 房间标识；任何 `m.room_id !== roomId` 的消息会被静默丢弃，
   *   防止跨房间窜入（防御式编程，不依赖调用方先行过滤）。
   * @param messages 消息事件数组；空数组是合法 no-op。
   * @returns 始终 resolve；底层异常被吞掉。
   */
  写入(roomId: string, messages: 消息事件[]): Promise<void>;

  /**
   * 读取「严格小于 上界event_position」的最近 N 条消息，按 event_position 升序返回。
   *
   * @param roomId 房间标识。
   * @param request.上界event_position 上界（严格不含）。
   * @param request.数量 期望条数；< 1 时返回空数组。
   * @returns 升序消息数组；底层异常返回空数组。
   */
  读取窗口(
    roomId: string,
    request: { 上界event_position: number; 数量: number }
  ): Promise<消息事件[]>;

  /**
   * 清空指定房间的所有缓存条目（不影响其他房间）。
   *
   * 用于硬失败退场（room_not_found、membership_required 等）时
   * 清理本房间本地缓存，防止下次错误地用陈旧数据填充首屏。
   */
  清空房间(roomId: string): Promise<void>;

  /**
   * 显式刷出内部所有 buffered 写入（如果实现层有 coalesce 缓冲）。
   *
   * 设计意图：
   * - 对于 in-memory 实现：no-op；
   * - 对于 IndexedDB adapter：把 100ms debounce buffer 立即落盘；
   * - 主要使用方：`pagehide` / `beforeunload` 钩子，避免页面关闭时丢数据。
   *
   * 错误降级：与其他方法一致，异常一律吞掉返回 resolved Promise。
   */
  flush(): Promise<void>;
}
