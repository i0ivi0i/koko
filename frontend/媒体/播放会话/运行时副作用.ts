import type { 自动播协作端口 } from "../壳层/自动播协作.js";
import type { 查看器会话协作端口 } from "../壳层/查看器会话协作.js";
import type { 媒体运行时事件, 媒体运行时快照 } from "../运行时.js";

interface 播放会话运行时副作用依赖 {
  读取运行时快照(): 媒体运行时快照;
  发送运行时事件(event: 媒体运行时事件): void;
  自动播协作(): Pick<自动播协作端口, "同步媒体运行时上下文变化">;
  查看器会话协作(): Pick<
    查看器会话协作端口,
    "处理查看器请求已清空" | "同步当前查看器请求"
  >;
  释放查看器正式播放占用(attachmentId: string | null | undefined): boolean;
  触发视频预览收敛(attachmentId: string): void;
  请求重渲染(): void;
}

/**
 * 运行时副作用 owner 只响应媒体 runtime 快照变化。
 * 它把 viewer 退场、自动播投影刷新和预览收敛排成顺序，但不拥有播放器或字节分发真相。
 */
export function 创建播放会话运行时副作用(deps: 播放会话运行时副作用依赖) {
  const 同步媒体运行时快照并执行副作用 = async (
    before = deps.读取运行时快照()
  ): Promise<void> => {
    const after = deps.读取运行时快照();
    const beforeContext = before.context;
    const afterContext = after.context;
    const 旧查看器附件标识 = beforeContext.currentViewerRequest?.startAttachmentId ?? null;
    const 当前查看器附件标识 = afterContext.currentViewerRequest?.startAttachmentId ?? null;
    const 自动播位置已变化 =
      beforeContext.inlineAutoplayPositionByAttachmentId !==
      afterContext.inlineAutoplayPositionByAttachmentId;
    const 自动播消息流投影已变化 =
      beforeContext.inlineAutoplayOwnerAttachmentId !==
        afterContext.inlineAutoplayOwnerAttachmentId ||
      beforeContext.inlineAutoplayPlayback !== afterContext.inlineAutoplayPlayback ||
      (!afterContext.currentViewerRequest && 自动播位置已变化);

    deps.自动播协作().同步媒体运行时上下文变化({
      before: beforeContext,
      after: afterContext,
    });

    if (beforeContext.currentViewerRequest && !afterContext.currentViewerRequest) {
      deps.查看器会话协作().处理查看器请求已清空();
    }

    if (afterContext.currentViewerRequest) {
      deps.查看器会话协作().同步当前查看器请求();
    }

    if (旧查看器附件标识 && 旧查看器附件标识 !== 当前查看器附件标识) {
      deps.释放查看器正式播放占用(旧查看器附件标识);
    }

    if (
      beforeContext.inlineAutoplayPlayback !== afterContext.inlineAutoplayPlayback &&
      afterContext.inlineAutoplayPlayback?.kind === "video" &&
      afterContext.inlineAutoplayPlayback.mode === "swarm"
    ) {
      deps.触发视频预览收敛(afterContext.inlineAutoplayPlayback.attachmentId);
    }

    if (自动播消息流投影已变化) {
      deps.请求重渲染();
    }
  };

  return {
    接收媒体运行时事实(event: 媒体运行时事件): void {
      const before = deps.读取运行时快照();
      deps.发送运行时事件(event);
      void 同步媒体运行时快照并执行副作用(before);
    },

    同步媒体运行时快照并执行副作用,
  };
}
