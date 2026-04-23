import type { 消息事件, 媒体种类 } from "./契约.js";
import type { 媒体传输端口 } from "./传输.js";
import type { 聊天运行时预算状态 } from "./状态.js";
import {
  创建媒体运行时Actor,
  投影媒体运行时预算,
  type 媒体运行时事件,
} from "./媒体运行时.js";
import {
  创建查看器会话协作,
  type 查看器会话协作端口,
} from "./媒体/壳层/查看器会话协作.js";
import { 创建自动播协作, type 自动播协作端口 } from "./媒体/壳层/自动播协作.js";
import {
  创建视频预览协作,
  type 视频预览协作端口,
} from "./媒体/壳层/视频预览协作.js";
import {
  创建协作补齐协作,
  type 协作补齐协作端口,
} from "./媒体/壳层/协作补齐协作.js";
import {
  创建媒体定位器,
  创建媒体缓存,
  创建内存预览缓存,
  创建内存媒体定位缓存仓库,
  创建内存媒体缓存仓库,
  创建媒体播放器,
  创建媒体发布器,
  创建媒体会话,
  创建媒体查看器,
  从媒体源抓取视频预览,
  写入媒体草稿 as 写入媒体草稿状态,
  更新媒体草稿状态 as 更新媒体草稿状态值,
  移除媒体草稿 as 移除媒体草稿状态,
  创建资产协作分发运行时,
  type 消息视频自动播候选,
  type 媒体附件草稿,
  type 媒体缓存仓库,
  type 媒体定位缓存仓库,
  type 媒体草稿状态补丁,
  type 媒体查看器打开请求,
  type 媒体会话信号,
  type 媒体会话快照,
  type 媒体会话端口,
  type 媒体播放结果,
  type 预览缓存端口,
  type 视频预览状态,
} from "./媒体/index.js";

type 程序滚动来源 = "media_viewer_open";

export type 附件内容地址快照 = {
  originalSrc: string;
  thumbnailSrc: string;
};

export type 聊天媒体快照 = {
  playbackByAttachmentId: Record<string, 媒体播放结果>;
  previewByAttachmentId: Record<string, 视频预览状态>;
  sessionByAttachmentId: Record<string, 媒体会话快照>;
  contentUrlByAttachmentId: Record<string, 附件内容地址快照>;
  inlineAutoplayOwnerAttachmentId: string | null;
  inlineAutoplayPlaybackByAttachmentId: Record<string, 媒体播放结果>;
};

type 聊天媒体预算快照 = Pick<
  聊天运行时预算状态,
  | "activeVideoCount"
  | "autoplayOwnerCount"
  | "activeSwarmCount"
  | "inflightLocatorCount"
  | "inflightManifestOrRangeCount"
  | "hiddenHeavyTaskCount"
  | "longTaskCount"
>;

type 聊天媒体编排依赖 = {
  transport(): 媒体传输端口;
  读取会话编号(): string;
  读取消息(): 消息事件[];
  读取草稿(): 媒体附件草稿[];
  媒体缓存仓库?: 媒体缓存仓库;
  媒体定位仓库?: 媒体定位缓存仓库;
  预览缓存?: 预览缓存端口;
  写入草稿列表(next: 媒体附件草稿[]): void;
  请求重渲染(): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  登记程序滚动来源(source: 程序滚动来源): void;
  清除程序滚动来源(source: 程序滚动来源): void;
  抓取视频预览?: typeof 从媒体源抓取视频预览;
};

export interface 聊天媒体编排端口 {
  snapshot(): 聊天媒体快照;
  读取预算(): 聊天媒体预算快照;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  移除媒体草稿(localId: string): void;
  继续上传媒体草稿(localId: string): Promise<void>;
  重新上传媒体草稿(localId: string): Promise<void>;
  清空草稿(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步消息附件播放结果(): void;
  处理自动播候选(candidates: 消息视频自动播候选[]): void;
  释放消息流自动播Owner(): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  处理应用生命周期(input: {
    visibility: "visible" | "hidden";
    phase: "active" | "background" | "page_hidden" | "frozen" | "resumed";
    heavyWorkPolicy: "normal" | "reduced" | "suspended";
  }): void;
  处理平台在线状态变化(online: boolean): void;
  清空(): void;
  销毁(): void;
  设置媒体播放器供测试(player: {
    解析播放结果(input: {
      attachmentId: string;
      kind: "image" | "video";
      surface?: "viewer" | "inline_autoplay";
      consumerId?: string;
    }): Promise<媒体播放结果>;
    激活协作补齐?(input: {
      attachmentId: string;
      kind: "image" | "video";
      consumerId?: string;
    }): Promise<void>;
    释放附件播放资源?(input: 媒体播放释放请求): void;
  }): void;
  设置媒体查看器供测试(viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }): void;
  关闭媒体查看器供测试(): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    继续上传草稿(localId: string): Promise<void>;
    重新上传草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  写入媒体草稿列表供测试(drafts: 媒体附件草稿[]): void;
}

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};
type 媒体播放释放请求 = { attachmentId: string; consumerId?: string; 丢弃未完成补齐?: boolean };

const 构造媒体会话ConsumerId = (attachmentId: string): string => `session:${attachmentId}`;
const 构造自动播ConsumerId = (attachmentId: string): string => `inline_autoplay:${attachmentId}`;
const 构造预览ConsumerId = (attachmentId: string): string => `preview:${attachmentId}`;

/**
 * 聊天媒体编排只拥有“浏览器端媒体体验真相”：
 * - 上传草稿属于本地体验态；
 * - 播放结果属于浏览器端解析态；
 * - 查看器开关和视口占用属于前端交互编排。
 *
 * 它不拥有聊天时间线真相，也不直接暴露 transport。
 */
export function 创建聊天媒体编排(deps: 聊天媒体编排依赖): 聊天媒体编排端口 {
  const 媒体运行时 = 创建媒体运行时Actor();
  const 协作分发运行时 = 创建资产协作分发运行时();
  let 媒体缓存已启动 = false;
  const 读取媒体运行时上下文 = () => 媒体运行时.getSnapshot().context;
  const 媒体定位器 = 创建媒体定位器({
    getSessionId: () => deps.读取会话编号(),
    loadMediaLocator: (sessionId, attachmentId) =>
      deps.transport().loadMediaLocator(sessionId, attachmentId),
    repo: deps.媒体定位仓库 ?? 创建内存媒体定位缓存仓库(),
  });

  let 媒体播放器 = 创建媒体播放器({
    locate: (attachmentId, options) => 媒体定位器.获取定位(attachmentId, options),
    resolveSwarmSource: (input) => 协作分发运行时.解析协作分发源(input),
    releaseSwarmSource: (input) => 协作分发运行时.释放协作分发消费者(input),
  });
  const 媒体会话表 = new Map<string, 媒体会话端口>();
  const 媒体缓存 = 创建媒体缓存({
    repo: deps.媒体缓存仓库 ?? 创建内存媒体缓存仓库(),
  });
  const 抓取视频预览 = deps.抓取视频预览 ?? 从媒体源抓取视频预览;
  /**
   * 预览缓存默认只退回内存仓库：
   * - 生产环境由平台存储运行时显式注入浏览器仓库；
   * - 这里不允许再直接猜 `localStorage`，避免 owner 越层双活；
   * - 测试未注入时，内存仓库也足够覆盖编排行为。
   */
  const 预览缓存 = deps.预览缓存 ?? 创建内存预览缓存();
  let 查看器会话协作!: 查看器会话协作端口;
  let 自动播协作!: 自动播协作端口;
  let 视频预览协作!: 视频预览协作端口;
  let 协作补齐协作!: 协作补齐协作端口;
  const 释放附件播放资源 = (input: 媒体播放释放请求): void => {
    // 编排层只在附件会话退场时通知播放器释放底层占用；
    // 真正“该不该持有 swarm lease”的判断仍在播放器/runtime 自己收口。
    媒体播放器.释放附件播放资源?.(input);
  };
  const 释放媒体附件会话 = (
    attachmentId: string,
    input: {
      丢弃未完成播放补齐?: boolean;
      丢弃未完成预览补齐?: boolean;
      清理协作补齐?: boolean;
      清理视频预览?: boolean;
      立即请求重渲染?: boolean;
    } = {}
  ): boolean => {
    const session = 媒体会话表.get(attachmentId);
    if (!session) {
      return false;
    }
    释放附件播放资源({
      attachmentId,
      consumerId: 构造媒体会话ConsumerId(attachmentId),
      ...(input.丢弃未完成播放补齐 ? { 丢弃未完成补齐: true } : {}),
    });
    协作分发运行时.释放协作分发消费者({
      attachmentId,
      consumerId: 构造预览ConsumerId(attachmentId),
      ...(input.丢弃未完成预览补齐 ? { 丢弃未完成补齐: true } : {}),
    });
    session.销毁();
    媒体会话表.delete(attachmentId);
    if (input.清理协作补齐) {
      协作补齐协作.清理附件(attachmentId);
    }
    if (input.清理视频预览) {
      视频预览协作.删除视频预览状态(attachmentId);
    }
    if (input.立即请求重渲染) {
      deps.请求重渲染();
    }
    return true;
  };
  const 接收媒体运行时事实 = (event: 媒体运行时事件): void => {
    const before = 媒体运行时.getSnapshot();
    媒体运行时.send(event);
    void 同步媒体运行时快照并执行副作用(before);
  };
  const 同步媒体运行时快照并执行副作用 = async (
    before = 媒体运行时.getSnapshot()
  ): Promise<void> => {
    const after = 媒体运行时.getSnapshot();
    const beforeContext = before.context;
    const afterContext = after.context;
    const 自动播消息流投影已变化 =
      beforeContext.inlineAutoplayOwnerAttachmentId !==
        afterContext.inlineAutoplayOwnerAttachmentId ||
      beforeContext.inlineAutoplayPlayback !== afterContext.inlineAutoplayPlayback;

    自动播协作.同步媒体运行时上下文变化({
      before: beforeContext,
      after: afterContext,
    });

    if (beforeContext.currentViewerRequest && !afterContext.currentViewerRequest) {
      const attachmentId = beforeContext.currentViewerRequest.startAttachmentId;
      const 已释放查看器起始附件 = 释放媒体附件会话(attachmentId, {
        丢弃未完成播放补齐: true,
        丢弃未完成预览补齐: true,
        清理协作补齐: true,
        清理视频预览: true,
        立即请求重渲染: true,
      });
      if (!已释放查看器起始附件) {
        协作补齐协作.清理附件(attachmentId);
        视频预览协作.删除视频预览状态(attachmentId);
      }
      查看器会话协作.处理查看器请求已清空();
    }

    if (afterContext.currentViewerRequest) {
      查看器会话协作.同步当前查看器请求();
    }

    if (自动播消息流投影已变化) {
      /**
       * 自动播 owner / playback 真相已经改了，但它们不走聊天基础状态那条 patch 链；
       * 这里必须主动触发一次壳层刷新，避免视频要等下一次无关滚动/输入才从 poster 切进来。
       */
      deps.请求重渲染();
    }
  };
  const 转发媒体查看器会话信号 = (attachmentId: string, signal: 媒体会话信号): void => {
    媒体会话表.get(attachmentId)?.send(signal);
  };
  let 媒体查看器 = 创建媒体查看器({
    onViewportCaptureEnd: () => {
      接收媒体运行时事实({ type: "VIEWER_CLOSED" });
    },
    onMediaSessionSignal: 转发媒体查看器会话信号,
  });

  const 写入草稿列表 = (
    nextDrafts: 媒体附件草稿[],
    previewUrlsToRevoke: string[] = []
  ): void => {
    deps.写入草稿列表(nextDrafts);
    deps.回收媒体草稿预览地址(previewUrlsToRevoke);
  };

  const 写入媒体草稿 = (draft: 媒体附件草稿): void => {
    const result = 写入媒体草稿状态(deps.读取草稿(), draft);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 更新媒体草稿状态 = (localId: string, patch: 媒体草稿状态补丁): void => {
    const result = 更新媒体草稿状态值(deps.读取草稿(), localId, patch);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 移除媒体草稿 = (localId: string): void => {
    const result = 移除媒体草稿状态(deps.读取草稿(), localId);
    写入草稿列表(result.草稿列表, result.需要回收的预览地址);
  };

  const 清空媒体草稿 = (): void => {
    const previewUrls = deps.读取草稿().map((draft) => draft.previewUrl);
    写入草稿列表([], previewUrls);
  };

  let 媒体发布器 = 创建媒体发布器({
    getSessionId: () => deps.读取会话编号(),
    prepareMediaUpload: (kind, sessionId, file) =>
      deps.transport().prepareMediaUpload(kind, sessionId, file),
    abandonMediaUpload: (sessionId, attachmentId) =>
      deps.transport().abandonMediaUpload(sessionId, attachmentId),
    completeMediaUpload: (sessionId, attachmentId) =>
      deps.transport().completeMediaUpload(sessionId, attachmentId),
    readDrafts: () => deps.读取草稿(),
    writeDraft: 写入媒体草稿,
    updateDraft: 更新媒体草稿状态,
    removeDraft: 移除媒体草稿,
    clearDrafts: 清空媒体草稿,
  });

  const 读取当前房间媒体附件 = (): 媒体附件条目[] => {
    const seen = new Set<string>();
    const attachments: 媒体附件条目[] = [];
    for (const message of deps.读取消息()) {
      for (const attachment of message.attachments ?? []) {
        if (seen.has(attachment.attachment_id)) {
          continue;
        }
        seen.add(attachment.attachment_id);
        attachments.push({
          attachmentId: attachment.attachment_id,
          kind: attachment.kind,
        });
      }
    }
    return attachments;
  };

  const 读取附件条目 = (attachmentId: string): 媒体附件条目 | null =>
    读取当前房间媒体附件().find((attachment) => attachment.attachmentId === attachmentId) ?? null;

  const 读取会话播放源版本 = (attachmentId: string): number =>
    媒体会话表.get(attachmentId)?.snapshot().sourceVersion ?? 0;

  const 读取视频预览候选播放源 = (
    attachmentId: string
  ): { src: string; contentHash: string | null } | null => {
    const playback = 媒体会话表.get(attachmentId)?.snapshot().playback;
    if (
      !playback ||
      playback.kind !== "video" ||
      (playback.mode !== "anchor" && playback.mode !== "swarm")
    ) {
      return null;
    }
    return {
      src: playback.src,
      contentHash: playback.contentHash ?? null,
    };
  };

  /**
   * 附件内容地址属于“当前会话下可访问的媒体资源定位结果”。
   * 这里按当前时间线里的附件集合现算现给，目的有两个：
   * 1. 壳层 presenter 只消费 snapshot 里的纯数据，不再回调内核 helper；
   * 2. URL 仍然只从 transport 能力构建，避免视图层自己猜 session 参数。
   */
  const 读取附件内容地址表 = (): Record<string, 附件内容地址快照> => {
    const sessionId = deps.读取会话编号();
    const urlsByAttachmentId: Record<string, 附件内容地址快照> = {};
    for (const attachment of 读取当前房间媒体附件()) {
      urlsByAttachmentId[attachment.attachmentId] = {
        originalSrc: deps.transport().buildAttachmentContentUrl(
          attachment.attachmentId,
          sessionId,
          "original"
        ),
        /**
         * 图片时间线已经不再存在独立 thumbnail 主链：
         * 1. 图片卡片 fallback 直接回 canonical/original；
         * 2. 只有视频 poster 继续保留 thumbnail 入口；
         * 3. 这样壳层不会平白再构造一条已退场的图片 URL。
         */
        thumbnailSrc:
          attachment.kind === "video"
            ? deps.transport().buildAttachmentContentUrl(
                attachment.attachmentId,
                sessionId,
                "thumbnail"
              )
            : deps.transport().buildAttachmentContentUrl(
                attachment.attachmentId,
                sessionId,
                "original"
              ),
      };
    }
    return urlsByAttachmentId;
  };

  /**
   * 播放结果表不再自己持久保存一份可变真相，而是从媒体会话快照现算现给。
   * 这样“播放源”“恢复态”“本地完整度”都收口在单个 owner，不会继续回到一张大 Map 到处 patch。
   */
  const 读取媒体会话快照表 = (): Record<string, 媒体会话快照> => {
    const snapshots: Record<string, 媒体会话快照> = {};
    for (const [attachmentId, session] of 媒体会话表) {
      snapshots[attachmentId] = session.snapshot();
    }
    return snapshots;
  };

  const 读取媒体播放结果表 = (): Record<string, 媒体播放结果> => {
    const playbackByAttachmentId: Record<string, 媒体播放结果> = {};
    for (const [attachmentId, session] of 媒体会话表) {
      const playback = session.snapshot().playback;
      if (playback) {
        playbackByAttachmentId[attachmentId] = playback;
      }
    }
    return playbackByAttachmentId;
  };

  const 应用缓存完整度到会话 = (
    attachmentId: string,
    sessionOverride?: 媒体会话端口
  ): void => {
    if (媒体缓存.snapshot()[attachmentId]?.complete) {
      // 新建会话时，条目可能还没挂进 Map；
      // 这里允许直接命中刚创建出的会话实例，避免“缓存里明明是完整资产，但重开后第一拍仍丢失 locally_complete”。
      (sessionOverride ?? 媒体会话表.get(attachmentId))?.send({
        type: "ASSET_COMPLETE",
      });
    }
  };

  const 读取附件缓存元数据 = (
    attachmentId: string
  ): { kind?: 媒体种类 | null; contentHash?: string | null } => {
    const playback = 媒体会话表.get(attachmentId)?.snapshot().playback;
    if (
      playback &&
      (playback.mode === "anchor" || playback.mode === "swarm") &&
      "contentHash" in playback &&
      playback.contentHash
    ) {
      return {
        kind: playback.kind,
        contentHash: playback.contentHash ?? null,
      };
    }
    const currentViewerItem = 读取媒体运行时上下文().currentViewerRequest?.items.find(
      (item) => item.attachmentId === attachmentId && item.kind === "image"
    );
    if (currentViewerItem?.kind === "image") {
      return {
        kind: "image",
        contentHash: currentViewerItem.contentHash ?? null,
      };
    }
    return {
      kind:
        读取当前房间媒体附件().find((item) => item.attachmentId === attachmentId)?.kind ??
        null,
      contentHash: null,
    };
  };

  const 标记附件完整并持久化 = (
    attachmentId: string,
    input: { kind?: 媒体种类 | null; contentHash?: string | null }
  ): void => {
    媒体会话表.get(attachmentId)?.send({ type: "ASSET_COMPLETE" });
    void 媒体缓存.标记完整(attachmentId, input).then(() => {
      deps.请求重渲染();
    });
  };

  查看器会话协作 = 创建查看器会话协作({
    读取当前查看器请求: () => 读取媒体运行时上下文().currentViewerRequest,
    读取查看器是否已打开: () => 读取媒体运行时上下文().viewerOpen,
    读取媒体会话快照: (attachmentId) => 媒体会话表.get(attachmentId)?.snapshot() ?? null,
    读取媒体会话: (attachmentId) => 媒体会话表.get(attachmentId) ?? null,
    读取视频预览状态: (attachmentId) => 视频预览协作.读取视频预览状态(attachmentId),
    更新当前查看器请求: (request) => {
      接收媒体运行时事实({
        type: "VIEWER_REQUEST_SYNCED",
        request,
      });
    },
    确认查看器已打开: () => {
      接收媒体运行时事实({ type: "VIEWER_OPEN_CONFIRMED" });
    },
    打开查看器: (request) => {
      媒体查看器.打开(request);
    },
    同步查看器: (request) => {
      媒体查看器.同步?.(request);
    },
    登记程序滚动来源: deps.登记程序滚动来源,
    清除程序滚动来源: deps.清除程序滚动来源,
  });

  自动播协作 = 创建自动播协作({
    读取媒体运行时上下文,
    读取附件条目,
    接收媒体运行时事实,
    解析播放结果: (input) => 媒体播放器.解析播放结果(input),
    释放附件播放资源,
    构造自动播ConsumerId,
    请求重渲染: deps.请求重渲染,
  });

  视频预览协作 = 创建视频预览协作({
    读取附件条目,
    读取会话播放源版本,
    读取当前视频预览播放源: 读取视频预览候选播放源,
    获取媒体定位: (attachmentId) => 媒体定位器.获取定位(attachmentId),
    解析协作分发预览源: ({ attachmentId, locator, consumerId }) =>
      协作分发运行时.解析协作分发源({
        attachmentId,
        kind: "video",
        locator,
        consumerId,
      }),
    释放协作分发消费者: (input) => {
      协作分发运行时.释放协作分发消费者(input);
    },
    预览缓存,
    抓取视频预览,
    接收媒体运行时事实,
    请求重渲染: deps.请求重渲染,
    同步当前查看器请求: () => {
      查看器会话协作.同步当前查看器请求();
    },
    构造预览ConsumerId,
  });

  协作补齐协作 = 创建协作补齐协作({
    读取媒体会话: (attachmentId) => 媒体会话表.get(attachmentId) ?? null,
    读取附件缓存元数据,
    读取附件缓存是否完整: (attachmentId) =>
      媒体缓存.snapshot()[attachmentId]?.complete === true,
    读取媒体缓存已启动: () => 媒体缓存已启动,
    激活协作补齐: (input) => 媒体播放器.激活协作补齐?.(input) ?? Promise.resolve(),
    应用缓存完整度到会话: (attachmentId) => {
      应用缓存完整度到会话(attachmentId);
    },
    标记媒体定位过期: (attachmentId) => {
      媒体定位器.标记过期(attachmentId);
    },
    标记附件完整并持久化,
    读取当前房间媒体附件,
    读取附件条目,
    读取当前查看器起始附件标识: () =>
      读取媒体运行时上下文().currentViewerRequest?.startAttachmentId ?? null,
    构造媒体会话ConsumerId,
  });

  const 创建媒体会话条目 = (attachment: 媒体附件条目): 媒体会话端口 => {
    let session: 媒体会话端口;
    session = 创建媒体会话({
      attachmentId: attachment.attachmentId,
      kind: attachment.kind,
      解析播放结果: (input) =>
        媒体播放器.解析播放结果({
          ...input,
          onSessionEvent: 协作补齐协作.创建协作分发事件转发器(attachment),
        }),
      onSnapshotChange: () => {
        deps.请求重渲染();
        查看器会话协作.同步当前查看器请求();
        if (
          attachment.kind === "video" &&
          (() => {
            const previewPhase = 视频预览协作.读取视频预览状态(attachment.attachmentId)?.phase;
            return !previewPhase || previewPhase === "idle" || previewPhase === "missing_source";
          })()
        ) {
          视频预览协作.解析视频预览(attachment.attachmentId);
        }
      },
    });
    应用缓存完整度到会话(attachment.attachmentId, session);
    return session;
  };

  const 读取或创建媒体会话 = (attachment: 媒体附件条目): 媒体会话端口 => {
    const current = 媒体会话表.get(attachment.attachmentId);
    if (current) {
      return current;
    }
    const session = 创建媒体会话条目(attachment);
    媒体会话表.set(attachment.attachmentId, session);
    deps.请求重渲染();
    return session;
  };

  const 启动查看器起始附件会话 = (request: 媒体查看器打开请求): void => {
    const startAttachment = 读取附件条目(request.startAttachmentId);
    if (!startAttachment || startAttachment.kind !== "video") {
      return;
    }
    const session = 读取或创建媒体会话(startAttachment);
    const snapshot = session.snapshot();
    if (!snapshot.playback) {
      void session.启动();
      return;
    }
    /**
     * 手动打开正式查看器必须先重裁一次当前会话真相：
     * 1. degraded/expired 当然要立刻重试，不能继续等后台慢轮询；
     * 2. 即使旧会话手里还有可播 src，也要给删除态 / 新 ticket / 新主链一次抢占机会；
     * 3. 只对显式 viewer open 生效，不把消息流常态渲染放大成持续重解析。
     */
    session.send({ type: "ENTER_RECOVERING" });
  };

  const 清理失活媒体会话 = (activeAttachmentIds: Set<string>): boolean => {
    let hasSessionSetChanged = false;
    for (const [attachmentId, session] of 媒体会话表) {
      if (activeAttachmentIds.has(attachmentId)) {
        continue;
      }
      const playback = session.snapshot().playback;
      if (
        协作补齐协作.应保留帮助任务({
          attachmentId,
          playback,
        })
      ) {
        continue;
      }
      if (
        释放媒体附件会话(attachmentId, {
          丢弃未完成预览补齐: true,
          清理协作补齐: true,
          清理视频预览: true,
        })
      ) {
        hasSessionSetChanged = true;
      }
    }
    return hasSessionSetChanged;
  };

  const 补齐当前房间媒体会话 = (attachments: 媒体附件条目[]): boolean => {
    let hasSessionSetChanged = false;
    for (const attachment of attachments) {
      if (媒体会话表.has(attachment.attachmentId)) {
        if (attachment.kind === "video") {
          const previewPhase = 视频预览协作.读取视频预览状态(attachment.attachmentId)?.phase;
          if (!previewPhase || previewPhase === "idle") {
            视频预览协作.解析视频预览(attachment.attachmentId);
          }
        }
        continue;
      }
      hasSessionSetChanged = true;
      const session = 创建媒体会话条目(attachment);
      媒体会话表.set(attachment.attachmentId, session);
      if (attachment.kind === "image") {
        void session.启动();
        continue;
      }
      视频预览协作.解析视频预览(attachment.attachmentId);
    }
    return hasSessionSetChanged;
  };

  const 清空播放状态 = (): void => {
    for (const attachmentId of Array.from(媒体会话表.keys())) {
      释放媒体附件会话(attachmentId, {
        丢弃未完成预览补齐: true,
      });
    }
    协作补齐协作.清空();
    视频预览协作.清空();
    查看器会话协作.重置();
    媒体定位器.清空();
  };

  const 执行媒体编排关停 = (input: {
    发布器动作: "clear" | "destroy";
    协作分发动作: "reset" | "destroy";
    停止媒体运行时?: boolean;
  }): void => {
    const before = 媒体运行时.getSnapshot();
    媒体运行时.send({ type: "VIEWER_CLOSED" });
    媒体运行时.send({ type: "INLINE_AUTOPLAY_RELEASE_REQUESTED" });
    媒体查看器.销毁();
    if (input.发布器动作 === "clear") {
      媒体发布器.清空();
    } else {
      媒体发布器.销毁();
    }
    清空播放状态();
    if (input.协作分发动作 === "reset") {
      协作分发运行时.重置();
    } else {
      协作分发运行时.销毁();
    }
    void 同步媒体运行时快照并执行副作用(before);
    if (input.停止媒体运行时) {
      媒体运行时.stop();
    }
    自动播协作.销毁();
    deps.请求重渲染();
  };

  void 媒体缓存.启动().then(() => {
    媒体缓存已启动 = true;
    协作补齐协作.恢复当前房间缓存帮助任务();
    deps.请求重渲染();
  });

  return {
    snapshot(): 聊天媒体快照 {
      return {
        playbackByAttachmentId: 读取媒体播放结果表(),
        previewByAttachmentId: 视频预览协作.读取视频预览状态表(),
        sessionByAttachmentId: 读取媒体会话快照表(),
        contentUrlByAttachmentId: 读取附件内容地址表(),
        inlineAutoplayOwnerAttachmentId:
          读取媒体运行时上下文().inlineAutoplayOwnerAttachmentId,
        inlineAutoplayPlaybackByAttachmentId: 自动播协作.读取自动播播放结果表(),
      };
    },

    读取预算(): 聊天媒体预算快照 {
      return {
        ...投影媒体运行时预算(媒体运行时.getSnapshot()),
        ...协作分发运行时.读取预算(),
      };
    },

    async 处理选择媒体文件(files: Iterable<File>): Promise<void> {
      await 媒体发布器.处理选择媒体文件(files);
    },

    移除媒体草稿(localId: string): void {
      媒体发布器.移除草稿(localId);
    },

    async 继续上传媒体草稿(localId: string): Promise<void> {
      await 媒体发布器.继续上传草稿(localId);
    },

    async 重新上传媒体草稿(localId: string): Promise<void> {
      await 媒体发布器.重新上传草稿(localId);
    },

    清空草稿(): void {
      媒体发布器.清空();
    },

    打开查看器(request: 媒体查看器打开请求): void {
      const baseRequest = {
        startAttachmentId: request.startAttachmentId,
        items: request.items.map((item) => ({ ...item })),
      };
      启动查看器起始附件会话(baseRequest);
      const nextRequest = 查看器会话协作.投影查看器请求到当前播放真相(baseRequest);
      if (读取附件条目(request.startAttachmentId)?.kind === "video") {
        视频预览协作.解析视频预览(request.startAttachmentId);
      }
      接收媒体运行时事实({
        type: "VIEWER_OPEN_REQUESTED",
        request: nextRequest,
      });
    },

    处理自动播候选(candidates: 消息视频自动播候选[]): void {
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_CANDIDATES_OBSERVED",
        candidates,
      });
    },

    释放消息流自动播Owner(): void {
      // 自动播只是消息流轻量体验态；后台必须释放 owner、video、解码器和协作分发占用。
      接收媒体运行时事实({
        type: "INLINE_AUTOPLAY_RELEASE_REQUESTED",
      });
    },

    /**
     * 播放结果仍以当前时间线附件集合为主输入；
     * 但已进入帮助链的附件不能因为暂时退出当前消息集合就被立刻释放。
     */
    同步消息附件播放结果(): void {
      const attachments = 读取当前房间媒体附件();
      const activeAttachmentIds = new Set(attachments.map((item) => item.attachmentId));
      if (清理失活媒体会话(activeAttachmentIds)) {
        deps.请求重渲染();
      }
      接收媒体运行时事实({
        type: "MESSAGE_ATTACHMENTS_SYNCED",
        attachmentIds: Array.from(activeAttachmentIds),
      });
      const hasSessionSetChanged = 补齐当前房间媒体会话(attachments);
      协作补齐协作.恢复当前房间缓存帮助任务(attachments);
      if (hasSessionSetChanged) {
        deps.请求重渲染();
      }
    },

    处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void {
      if (
        !协作补齐协作.处理媒体会话信号({
          attachmentId,
          signal,
        })
      ) {
        return;
      }
      接收媒体运行时事实({
        type: "MEDIA_SESSION_SIGNALLED",
        attachmentId,
        signal,
      });
      转发媒体查看器会话信号(attachmentId, signal);
    },

    处理应用生命周期(input): void {
      接收媒体运行时事实({
        type: "LIFECYCLE_POLICY_CHANGED",
        heavyWorkPolicy: input.heavyWorkPolicy,
      });
      协作分发运行时.send({
        type: "LIFECYCLE_POLICY_CHANGED",
        heavyWorkPolicy: input.heavyWorkPolicy,
      });
    },

    处理平台在线状态变化(online: boolean): void {
      for (const session of 媒体会话表.values()) {
        session.send({ type: online ? "ORIGIN_AVAILABLE" : "ORIGIN_UNAVAILABLE" });
      }
    },

    清空(): void {
      执行媒体编排关停({
        发布器动作: "clear",
        协作分发动作: "reset",
      });
    },

    销毁(): void {
      执行媒体编排关停({
        发布器动作: "destroy",
        协作分发动作: "destroy",
        停止媒体运行时: true,
      });
    },

    设置媒体播放器供测试(player): void {
      清空播放状态();
      媒体播放器 = {
        解析播放结果: player.解析播放结果,
        激活协作补齐: player.激活协作补齐 ?? (async () => undefined),
        释放附件播放资源: player.释放附件播放资源 ?? (() => undefined),
      };
      deps.请求重渲染();
    },

    设置媒体查看器供测试(viewer): void {
      媒体查看器.销毁();
      let 测试查看器已打开 = false;
      // 测试替身允许只关心“打开/销毁”两件事；
      // 这里把它适配成正式查看器契约，避免生产代码为了测试而放宽 owner 边界。
      媒体查看器 = {
        打开: (input) => {
          测试查看器已打开 = true;
          viewer.打开(input);
        },
        同步:
          viewer.同步 ??
          ((input) => {
            if (测试查看器已打开) {
              return;
            }
            测试查看器已打开 = true;
            viewer.打开(input);
          }),
        销毁: () => {
          测试查看器已打开 = false;
          viewer.销毁();
        },
      };
    },

    关闭媒体查看器供测试(): void {
      const before = 媒体运行时.getSnapshot();
      媒体运行时.send({ type: "VIEWER_CLOSED" });
      媒体查看器.销毁();
      void 同步媒体运行时快照并执行副作用(before);
    },

    设置媒体发布器供测试(publisher): void {
      媒体发布器.销毁();
      媒体发布器 = publisher;
    },

    写入媒体草稿列表供测试(drafts): void {
      const 旧草稿预览地址 = deps.读取草稿().map((draft) => draft.previewUrl);
      const 保留中的预览地址 = new Set(drafts.map((draft) => draft.previewUrl));
      const 需要回收的预览地址 = 旧草稿预览地址.filter(
        (previewUrl) => !保留中的预览地址.has(previewUrl)
      );
      写入草稿列表([...drafts], 需要回收的预览地址);
    },
  };
}
