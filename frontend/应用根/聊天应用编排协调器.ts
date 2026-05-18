import type { 平台离线任务 } from "../平台/index.js";
import type { 实时会话快照 } from "../实时/会话运行时.js";
import {
  创建内核恢复编排端口,
  创建内核实时编排端口,
  创建内核阅读推进编排端口,
  type 内核恢复编排桥接依赖,
  type 内核实时编排桥接依赖,
  type 内核阅读推进编排桥接依赖,
  type 聊天内核平台端口,
} from "./聊天应用编排桥接.js";
import type { 房间恢复编排端口 } from "../恢复/壳层/房间恢复编排.js";
import type { 房间实时编排端口 } from "../实时/应用.js";
import type { 阅读推进编排端口 } from "../房间/壳层/阅读推进.js";

export interface 聊天应用编排协调器依赖 {
  创建恢复编排依赖(): 内核恢复编排桥接依赖;
  创建实时编排依赖(): 内核实时编排桥接依赖;
  创建阅读推进依赖(): 内核阅读推进编排桥接依赖;
  排空到期任务?: 聊天内核平台端口["排空到期任务"];
}

/**
 * recovery / realtime / 阅读推进 三条编排口的唯一应用根编排 owner。
 *
 * 约束：
 * 1. 它只负责懒创建、重置和跨编排口协作；
 * 2. 它不拥有聊天状态真相，也不直接持有 DOM / transport 实现；
 * 3. 聊天应用内核因此可以退回“命令 + 状态 + actor 副作用”边界。
 */
export class 聊天应用编排协调器 {
  private readonly deps: 聊天应用编排协调器依赖;
  private 恢复编排: 房间恢复编排端口 | null = null;
  private 实时编排: 房间实时编排端口 | null = null;
  private 阅读推进编排: 阅读推进编排端口 | null = null;
  // session refresh 门闩：刷新进行中时阻止对旧 socket 的重订阅操作
  private sessionRefreshInProgress = false;

  constructor(deps: 聊天应用编排协调器依赖) {
    this.deps = deps;
  }

  标记SessionRefresh进行中(value: boolean): void {
    this.sessionRefreshInProgress = value;
  }

  async bootstrap(): Promise<void> {
    await this.读取恢复编排().bootstrap();
  }

  async joinRoom(): Promise<void> {
    await this.读取恢复编排().joinRoom();
  }

  async sendMessage(): Promise<void> {
    await this.读取实时编排().sendMessage();
  }

  async ensureRealtimeSocket(sessionId: string): Promise<void> {
    await this.读取实时编排().ensureRealtimeSocket(sessionId);
  }

  subscribeRoom(from: number): void {
    this.读取实时编排().subscribeRoom(from);
  }

  disconnectRealtime(): void {
    this.实时编排?.disconnect();
  }

  接收候选已读位置(position: number): void {
    this.读取阅读推进编排().接收候选已读位置(position);
  }

  接收首屏稳定完成(): void {
    this.读取阅读推进编排().接收首屏稳定完成();
  }

  async 请求加载更早历史(): Promise<void> {
    await this.读取阅读推进编排().请求加载更早历史();
  }

  async 请求跳到最新(): Promise<void> {
    await this.读取阅读推进编排().请求跳到最新();
  }

  async 接收Realtime追加后跟随(): Promise<void> {
    await this.读取阅读推进编排().接收Realtime追加后跟随();
  }

  取消待刷新已读锚点(): void {
    this.读取阅读推进编排().取消待刷新已读锚点();
  }

  取消待跟随最新采样(): void {
    this.读取阅读推进编排().取消待跟随最新采样();
  }

  async 接收Transport异常(
    error: Parameters<房间恢复编排端口["接收Transport异常"]>[0]
  ): Promise<void> {
    this.sessionRefreshInProgress = true;
    try {
      await this.读取恢复编排().接收Transport异常(error);
    } finally {
      this.sessionRefreshInProgress = false;
    }
  }

  处理恢复失败(error: unknown, keepRoomVisible: boolean): void {
    this.读取恢复编排().处理恢复失败(error, keepRoomVisible);
  }

  withSessionRefreshOnInvalid<T>(
    operation: (sessionId: string) => Promise<T>
  ): Promise<T> {
    return this.读取恢复编排().withSessionRefreshOnInvalid(operation);
  }

  async 重放待补发任务(task: 平台离线任务): Promise<"done" | "retry"> {
    return (await this.读取实时编排().重放待补发任务?.(task)) ?? "retry";
  }

  async 处理实时会话变化(
    before: 实时会话快照,
    snapshot: 实时会话快照
  ): Promise<void> {
    const beforeContext = before.context;
    const nextContext = snapshot.context;

    if (
      nextContext.needsResubscribe &&
      !beforeContext.needsResubscribe &&
      nextContext.roomId &&
      nextContext.sessionId &&
      !this.sessionRefreshInProgress
    ) {
      await this.ensureRealtimeSocket(nextContext.sessionId);
      this.subscribeRoom(nextContext.latestEventPosition);
    }

    if (nextContext.backgroundDrainPending && !beforeContext.backgroundDrainPending) {
      await this.排空待补发任务();
    }
  }

  重置端口(): void {
    this.实时编排?.disconnect();
    this.阅读推进编排?.dispose();
    this.恢复编排 = null;
    this.实时编排 = null;
    this.阅读推进编排 = null;
  }

  dispose(): void {
    this.重置端口();
  }

  private async 排空待补发任务(): Promise<void> {
    if (typeof this.deps.排空到期任务 !== "function") {
      return;
    }
    await this.deps.排空到期任务(async (task) => this.重放待补发任务(task));
  }

  private 读取恢复编排(): 房间恢复编排端口 {
    if (!this.恢复编排) {
      this.恢复编排 = 创建内核恢复编排端口(this.deps.创建恢复编排依赖());
    }
    return this.恢复编排;
  }

  private 读取实时编排(): 房间实时编排端口 {
    if (!this.实时编排) {
      this.实时编排 = 创建内核实时编排端口(this.deps.创建实时编排依赖());
    }
    return this.实时编排;
  }

  private 读取阅读推进编排(): 阅读推进编排端口 {
    if (!this.阅读推进编排) {
      this.阅读推进编排 = 创建内核阅读推进编排端口(this.deps.创建阅读推进依赖());
    }
    return this.阅读推进编排;
  }
}
