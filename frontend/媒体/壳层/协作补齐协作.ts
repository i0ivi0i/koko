import type { 媒体种类 } from "../../契约.js";
import type { 媒体会话信号, 媒体会话端口, 媒体播放结果 } from "../index.js";
import type { 协作分发会话事件 } from "../媒体协作分发.js";

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

type 附件缓存元数据 = {
  kind?: 媒体种类 | null;
  contentHash?: string | null;
};

type 协作补齐协作依赖 = {
  读取媒体会话(attachmentId: string): 媒体会话端口 | null;
  读取附件缓存元数据(attachmentId: string): 附件缓存元数据;
  读取附件缓存是否完整(attachmentId: string): boolean;
  读取媒体缓存已启动(): boolean;
  激活协作补齐(input: {
    attachmentId: string;
    kind: "image" | "video";
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
  }): Promise<void>;
  应用缓存完整度到会话(attachmentId: string): void;
  标记媒体定位过期(attachmentId: string): void;
  标记附件完整并持久化(
    attachmentId: string,
    input: { kind?: 媒体种类 | null; contentHash?: string | null }
  ): void;
  读取当前房间媒体附件(): 媒体附件条目[];
  读取附件条目(attachmentId: string): 媒体附件条目 | null;
  读取当前查看器起始附件标识(): string | null;
  构造媒体会话ConsumerId(attachmentId: string): string;
};

export interface 协作补齐协作端口 {
  创建协作分发事件转发器(attachment: 媒体附件条目): (event: 协作分发会话事件) => void;
  恢复当前房间缓存帮助任务(attachments?: 媒体附件条目[]): void;
  处理媒体会话信号(input: {
    attachmentId: string;
    signal: 媒体会话信号;
  }): boolean;
  应保留帮助任务(input: {
    attachmentId: string;
    playback: 媒体播放结果 | null;
  }): boolean;
  清理附件(attachmentId: string): void;
  清空(): void;
}

/**
 * 协作补齐协作只拥有“帮助链附件的保留、恢复与会话事件转译”：
 * 1. 判断某个附件是否已经进入帮助链；
 * 2. 把协作分发事件翻译回媒体会话 / locator owner；
 * 3. 在缓存恢复时只恢复当前房间真正需要的帮助任务。
 *
 * 它不自己持有播放结果，也不接手查看器或自动播流程。
 */
export function 创建协作补齐协作(
  deps: 协作补齐协作依赖
): 协作补齐协作端口 {
  const 已进入帮助链附件 = new Set<string>();
  const 已恢复帮助任务附件 = new Set<string>();

  const 处理协作分发事件 = (
    attachment: 媒体附件条目,
    event: 协作分发会话事件
  ): void => {
    if (event.type === "SWARM_ACTIVE") {
      deps.读取媒体会话(attachment.attachmentId)?.send({ type: "SWARM_ACTIVE" });
      return;
    }
    if (event.type === "SWARM_NO_PEERS") {
      deps.读取媒体会话(attachment.attachmentId)?.send({ type: "SWARM_NO_PEERS" });
      return;
    }
    if (event.type === "SWARM_TICKET_INVALID") {
      /**
       * join ticket 过期后，真正该过期的是这条 locator 缓存，而不是附件业务真相：
       * 1. 编排层掌握 locator owner，所以由这里统一标脏；
       * 2. 媒体会话只收到“需要恢复”的稳定信号，不直接碰缓存实现；
       * 3. 下一次恢复解析会自然 forceRefresh，拿到后端新签的 ticket。
       */
      deps.标记媒体定位过期(attachment.attachmentId);
      deps.读取媒体会话(attachment.attachmentId)?.send({ type: "SWARM_TICKET_INVALID" });
      return;
    }
    deps.标记附件完整并持久化(attachment.attachmentId, {
      kind: attachment.kind,
      contentHash: event.contentHash,
    });
  };

  const 激活附件协作补齐 = (attachmentId: string): void => {
    const metadata = deps.读取附件缓存元数据(attachmentId);
    if (!metadata.kind) {
      return;
    }
    已进入帮助链附件.add(attachmentId);
    // 编排层只负责把“当前这张图值得后台补齐”的业务信号转交给播放器；
    // 真正 locate、读取 locator 兼容字段、接入 WebTorrent runtime 的细节仍留在播放器 owner。
    void deps
      .激活协作补齐({
        attachmentId,
        kind: metadata.kind,
        consumerId: deps.构造媒体会话ConsumerId(attachmentId),
        onSessionEvent: (event) =>
          处理协作分发事件(
            {
              attachmentId,
              kind: metadata.kind!,
            },
            event
          ),
      })
      .catch(() => undefined);
  };

  return {
    创建协作分发事件转发器(attachment: 媒体附件条目) {
      return (event: 协作分发会话事件) => {
        处理协作分发事件(attachment, event);
      };
    },

    恢复当前房间缓存帮助任务(
      attachments = deps.读取当前房间媒体附件()
    ): void {
      if (!deps.读取媒体缓存已启动()) {
        return;
      }
      for (const attachment of attachments) {
        if (!deps.读取附件缓存是否完整(attachment.attachmentId)) {
          continue;
        }
        const playback = deps.读取媒体会话(attachment.attachmentId)?.snapshot().playback ?? null;
        if (playback?.mode === "degraded" && playback.reason === "media_deleted") {
          continue;
        }
        deps.应用缓存完整度到会话(attachment.attachmentId);
        if (已恢复帮助任务附件.has(attachment.attachmentId)) {
          continue;
        }
        /**
         * 缓存恢复只认“当前房间 + 本地已完整”的最小事实：
         * 1. 不扫描全局缓存历史，避免把浏览器壳偷做成后台守护进程；
         * 2. 同一附件每轮页面生命周期只恢复一次，避免同步消息时重复放大同一帮助任务；
         * 3. 真正的 swarm 接入仍沿现有播放器 owner 链推进，编排层不自造第二实现。
         */
        激活附件协作补齐(attachment.attachmentId);
        已恢复帮助任务附件.add(attachment.attachmentId);
      }
    },

    处理媒体会话信号({
      attachmentId,
      signal,
    }: {
      attachmentId: string;
      signal: 媒体会话信号;
    }): boolean {
      if (signal.type === "ASSET_COMPLETE") {
        // 图片查看器只负责把“完整图已经拿到”回抛成会话信号；
        // 真正落盘到 MediaCacheOwner 的动作仍然只能由编排层统一收口。
        deps.标记附件完整并持久化(attachmentId, deps.读取附件缓存元数据(attachmentId));
        return false;
      }
      if (signal.type === "ASSET_BACKFILLING") {
        激活附件协作补齐(attachmentId);
      }
      if (
        signal.type === "PLAYER_PLAYING" &&
        deps.读取当前查看器起始附件标识() === attachmentId &&
        deps.读取附件条目(attachmentId)?.kind === "video"
      ) {
        激活附件协作补齐(attachmentId);
      }
      return true;
    },

    应保留帮助任务({
      attachmentId,
      playback,
    }: {
      attachmentId: string;
      playback: 媒体播放结果 | null;
    }): boolean {
      return (
        已进入帮助链附件.has(attachmentId) &&
        !(playback?.mode === "degraded" && playback.reason === "media_deleted")
      );
    },

    清理附件(attachmentId: string): void {
      已进入帮助链附件.delete(attachmentId);
      已恢复帮助任务附件.delete(attachmentId);
    },

    清空(): void {
      已进入帮助链附件.clear();
      已恢复帮助任务附件.clear();
    },
  };
}
