import type { 媒体运行时上下文, 媒体运行时事件 } from "../../媒体运行时.js";
import type { 媒体会话快照, 媒体播放结果 } from "../index.js";

type 媒体附件条目 = {
  attachmentId: string;
  kind: "image" | "video";
};

type 媒体播放释放请求 = {
  attachmentId: string;
  consumerId?: string;
  丢弃未完成补齐?: boolean;
};

type 自动播协作依赖 = {
  读取媒体运行时上下文(): 媒体运行时上下文;
  读取附件条目(attachmentId: string): 媒体附件条目 | null;
  读取媒体会话快照(attachmentId: string): 媒体会话快照 | null;
  接收媒体运行时事实(event: 媒体运行时事件): void;
  解析播放结果(input: {
    attachmentId: string;
    kind: "image" | "video";
    surface?: "viewer" | "inline_autoplay";
    consumerId?: string;
  }): Promise<媒体播放结果>;
  释放附件播放资源(input: 媒体播放释放请求): void;
  构造自动播ConsumerId(attachmentId: string): string;
  标记自动播进入帮助链(attachmentId: string): void;
  请求重渲染(): void;
};

export interface 自动播协作端口 {
  读取自动播播放结果表(): Record<string, 媒体播放结果>;
  同步媒体运行时上下文变化(input: {
    before: 媒体运行时上下文;
    after: 媒体运行时上下文;
  }): void;
  销毁(): void;
}

// 自动播保留轻微迟滞防抖，但不能继续维持旧的 120ms 网页式空窗。
const 自动播候选稳定等待毫秒 = 80;

/**
 * 自动播协作只拥有“消息流自动播 owner 的稳定等待、解析和释放”：
 * 1. runtime 只负责谁该成为 owner；
 * 2. 本模块负责何时触发解析、何时释放底层占用；
 * 3. 最终播放结果仍回写到 runtime 上下文，壳层只做副作用接线。
 */
export function 创建自动播协作(deps: 自动播协作依赖): 自动播协作端口 {
  let 自动播启动定时器: ReturnType<typeof setTimeout> | null = null;
  let 自动播解析代次 = 0;

  const 清除自动播定时器 = (): void => {
    if (自动播启动定时器 === null) {
      return;
    }
    clearTimeout(自动播启动定时器);
    自动播启动定时器 = null;
  };

  const 清空自动播播放结果 = (
    ownerAttachmentId = deps.读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId
  ): void => {
    const 媒体运行时上下文 = deps.读取媒体运行时上下文();
    if (
      !ownerAttachmentId &&
      媒体运行时上下文.inlineAutoplayOwnerAttachmentId === null &&
      媒体运行时上下文.inlineAutoplayPendingAttachmentId === null &&
      自动播启动定时器 === null &&
      媒体运行时上下文.inlineAutoplayPlayback === null
    ) {
      return;
    }
    清除自动播定时器();
    自动播解析代次 += 1;
    if (ownerAttachmentId) {
      deps.接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
        attachmentId: ownerAttachmentId,
      });
      return;
    }
    deps.请求重渲染();
  };

  const 释放当前自动播Owner = (
    ownerAttachmentId = deps.读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId
  ): void => {
    if (!ownerAttachmentId) {
      清空自动播播放结果();
      return;
    }
    deps.释放附件播放资源({
      attachmentId: ownerAttachmentId,
      consumerId: deps.构造自动播ConsumerId(ownerAttachmentId),
    });
    清空自动播播放结果(ownerAttachmentId);
  };

  const 解析自动播播放结果 = (attachmentId: string): void => {
    const attachment = deps.读取附件条目(attachmentId);
    if (!attachment || attachment.kind !== "video") {
      deps.接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
        attachmentId,
      });
      return;
    }
    const 当前代次 = ++自动播解析代次;
    const 当前目标仍有效 = (): boolean => {
      const context = deps.读取媒体运行时上下文();
      return (
        当前代次 === 自动播解析代次 &&
        (context.inlineAutoplayOwnerAttachmentId === attachmentId ||
          context.inlineAutoplayPendingAttachmentId === attachmentId)
      );
    };
    const 热会话播放结果 = deps.读取媒体会话快照(attachmentId)?.playback;
    if (热会话播放结果?.kind === "video" && 热会话播放结果.mode === "swarm") {
      /**
       * 当前附件的正式媒体会话已经拿到 swarm 主链时，自动播 owner 只是在消息流里接管同一条热真相：
       * 1. 不该再用 `inline_autoplay` consumer 额外解析一次同源播放结果；
       * 2. 这样点击放大时，viewer 才能继续沿用这条热会话，而不是在“会话已热、自动播再热”之间抖动；
       * 3. 这里只对 swarm 复用，其他 surface 仍保留原来的自动播裁决分支，避免把 anchor/manifest 误投到时间线自动播。
       */
      deps.标记自动播进入帮助链(attachmentId);
      deps.接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
        attachmentId,
        playback: 热会话播放结果,
      });
      return;
    }
    const 自动播播放结果Promise = deps.解析播放结果({
      attachmentId,
      kind: attachment.kind,
      surface: "inline_autoplay",
      consumerId: deps.构造自动播ConsumerId(attachmentId),
    });
    /**
     * 自动播解析是壳层异步副作用，不能因为下游替身/异常返回了非 Promise 就把线程炸穿：
     * 1. 正常实现本来就应该返回 Promise；
     * 2. 但这里仍要把“非 thenable”降级成一次受控失败，而不是制造未处理异常；
     * 3. 这样 owner 真相依旧只会落成 `failed`，不会把整个浏览器运行时拖死。
     */
    if (
      !自动播播放结果Promise ||
      typeof (自动播播放结果Promise as PromiseLike<媒体播放结果>).then !== "function"
    ) {
      deps.接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
        attachmentId,
      });
      return;
    }
    void 自动播播放结果Promise
      .then((playback) => {
        if (!当前目标仍有效()) {
          return;
        }
        if (playback.kind === "video" && playback.mode === "swarm") {
          deps.标记自动播进入帮助链(attachmentId);
        }
        deps.接收媒体运行时事实({
          type: "INLINE_AUTOPLAY_PLAYBACK_RESOLVED",
          attachmentId,
          playback,
        });
      })
      .catch(() => {
        if (!当前目标仍有效()) {
          return;
        }
        deps.接收媒体运行时事实({
          type: "INLINE_AUTOPLAY_PLAYBACK_FAILED",
          attachmentId,
        });
      });
  };

  const 调度自动播播放结果解析 = (attachmentId: string): void => {
    清除自动播定时器();
    自动播启动定时器 = setTimeout(() => {
      自动播启动定时器 = null;
      if (deps.读取媒体运行时上下文().inlineAutoplayPendingAttachmentId !== attachmentId) {
        return;
      }
      解析自动播播放结果(attachmentId);
    }, 自动播候选稳定等待毫秒);
  };

  return {
    读取自动播播放结果表(): Record<string, 媒体播放结果> {
      const 媒体运行时上下文 = deps.读取媒体运行时上下文();
      const ownerAttachmentId = 媒体运行时上下文.inlineAutoplayOwnerAttachmentId;
      const playback = 媒体运行时上下文.inlineAutoplayPlayback;
      if (!ownerAttachmentId || playback === null) {
        return {};
      }
      return {
        [ownerAttachmentId]: playback,
      };
    },

    同步媒体运行时上下文变化({
      before,
      after,
    }: {
      before: 媒体运行时上下文;
      after: 媒体运行时上下文;
    }): void {
      if (before.inlineAutoplayPendingAttachmentId !== after.inlineAutoplayPendingAttachmentId) {
        清除自动播定时器();
        if (after.inlineAutoplayPendingAttachmentId) {
          调度自动播播放结果解析(after.inlineAutoplayPendingAttachmentId);
        }
      }

      if (before.inlineAutoplayOwnerAttachmentId !== after.inlineAutoplayOwnerAttachmentId) {
        if (before.inlineAutoplayOwnerAttachmentId) {
          释放当前自动播Owner(before.inlineAutoplayOwnerAttachmentId);
        } else if (!after.inlineAutoplayOwnerAttachmentId) {
          清空自动播播放结果();
        }
        if (
          after.inlineAutoplayOwnerAttachmentId &&
          after.inlineAutoplayPlayback?.attachmentId !== after.inlineAutoplayOwnerAttachmentId
        ) {
          解析自动播播放结果(after.inlineAutoplayOwnerAttachmentId);
        }
      }
    },

    销毁(): void {
      清除自动播定时器();
      自动播解析代次 += 1;
    },
  };
}
