import type { 消息事件, 媒体种类 } from "./契约.js";
import type { 前端传输端口 } from "./传输.js";
import {
  创建媒体定位器,
  创建媒体缓存,
  创建内存媒体缓存仓库,
  创建媒体播放器,
  创建媒体发布器,
  创建媒体会话,
  创建媒体查看器,
  写入媒体草稿 as 写入媒体草稿状态,
  更新媒体草稿状态 as 更新媒体草稿状态值,
  移除媒体草稿 as 移除媒体草稿状态,
  解析协作分发源,
  释放协作分发消费者,
  type 媒体附件草稿,
  type 媒体缓存仓库,
  type 媒体草稿状态补丁,
  type 媒体查看器打开请求,
  type 媒体会话信号,
  type 媒体会话快照,
  type 媒体会话端口,
  type 媒体播放结果,
} from "./媒体/index.js";

type 程序滚动来源 = "media_viewer_open";

export type 附件内容地址快照 = {
  originalSrc: string;
  thumbnailSrc: string;
};

export type 聊天媒体快照 = {
  playbackByAttachmentId: Record<string, 媒体播放结果>;
  sessionByAttachmentId: Record<string, 媒体会话快照>;
  contentUrlByAttachmentId: Record<string, 附件内容地址快照>;
};

type 聊天媒体编排依赖 = {
  transport(): 前端传输端口;
  读取会话编号(): string;
  读取消息(): 消息事件[];
  读取草稿(): 媒体附件草稿[];
  媒体缓存仓库?: 媒体缓存仓库;
  写入草稿列表(next: 媒体附件草稿[]): void;
  请求重渲染(): void;
  回收媒体草稿预览地址(previewUrls: string[]): void;
  登记程序滚动来源(source: 程序滚动来源): void;
  清除程序滚动来源(source: 程序滚动来源): void;
};

export interface 聊天媒体编排端口 {
  snapshot(): 聊天媒体快照;
  处理选择媒体文件(files: Iterable<File>): Promise<void>;
  移除媒体草稿(localId: string): void;
  重试媒体草稿(localId: string): Promise<void>;
  清空草稿(): void;
  打开查看器(request: 媒体查看器打开请求): void;
  同步消息附件播放结果(): void;
  处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void;
  处理平台在线状态变化(online: boolean): void;
  清空(): void;
  销毁(): void;
  设置媒体播放器供测试(player: {
    解析播放结果(input: { attachmentId: string; kind: "image" | "video" }): Promise<媒体播放结果>;
    激活协作补齐?(input: {
      attachmentId: string;
      kind: "image" | "video";
    }): Promise<void>;
    释放附件播放资源?(attachmentId: string): void;
  }): void;
  设置媒体查看器供测试(viewer: {
    打开(input: 媒体查看器打开请求): void;
    同步?(input: 媒体查看器打开请求): void;
    销毁(): void;
  }): void;
  设置媒体发布器供测试(publisher: {
    处理选择媒体文件(files: Iterable<File>): Promise<void>;
    移除草稿(localId: string): void;
    重试草稿(localId: string): Promise<void>;
    清空(): void;
    销毁(): void;
  }): void;
  写入媒体草稿列表供测试(drafts: 媒体附件草稿[]): void;
}

type 媒体附件条目 = {
  attachmentId: string;
  kind: 媒体种类;
};

/**
 * 聊天媒体编排只拥有“浏览器端媒体体验真相”：
 * - 上传草稿属于本地体验态；
 * - 播放结果属于浏览器端解析态；
 * - 查看器开关和视口占用属于前端交互编排。
 *
 * 它不拥有聊天时间线真相，也不直接暴露 transport。
 */
export function 创建聊天媒体编排(deps: 聊天媒体编排依赖): 聊天媒体编排端口 {
  const 媒体定位器 = 创建媒体定位器({
    getSessionId: () => deps.读取会话编号(),
    loadMediaLocator: (sessionId, attachmentId) =>
      deps.transport().loadMediaLocator(sessionId, attachmentId),
  });

  let 媒体播放器 = 创建媒体播放器({
    locate: (attachmentId, options) => 媒体定位器.获取定位(attachmentId, options),
    resolveSwarmSource: 解析协作分发源,
    releaseSwarmSource: ({ attachmentId }) => 释放协作分发消费者(attachmentId),
  });

  let 当前查看器请求: 媒体查看器打开请求 | null = null;
  const 投影查看器请求到当前播放真相 = (
    request: 媒体查看器打开请求
  ): 媒体查看器打开请求 => {
    // 查看器一旦打开，就不能继续抱着旧 request.items 里的静态 src。
    // 这里把会话 owner 当前裁决出的播放源重新投影回查看器，让 overlay 和时间线预览共用同一条恢复真相。
    return {
      startAttachmentId: request.startAttachmentId,
      items: request.items.map((item) => {
        const playback = 媒体会话表.get(item.attachmentId)?.snapshot().playback;
        if (
          playback?.mode === "blob" ||
          playback?.mode === "swarm" ||
          playback?.mode === "anchor" ||
          playback?.mode === "manifest"
        ) {
          if (item.kind === "video") {
            return {
              ...item,
              src: playback.src,
              posterSrc: playback.thumbnailUrl ?? item.posterSrc,
              ...(playback.mode === "manifest" && playback.streamingDistribution
                ? {
                    streamingDistribution: playback.streamingDistribution,
                  }
                : {}),
            };
          }
          return {
            ...item,
            src: playback.mode === "blob" ? playback.viewerSrc ?? playback.src : playback.src,
          };
        }
        return item;
      }),
    };
  };
  const 同步当前查看器请求 = (): void => {
    if (!当前查看器请求) {
      return;
    }
    const nextRequest = 投影查看器请求到当前播放真相(当前查看器请求);
    当前查看器请求 = nextRequest;
    媒体查看器.同步?.(nextRequest);
  };
  const 转发媒体查看器会话信号 = (attachmentId: string, signal: 媒体会话信号): void => {
    媒体会话表.get(attachmentId)?.send(signal);
  };
  let 媒体查看器 = 创建媒体查看器({
    onViewportCaptureEnd: () => {
      当前查看器请求 = null;
      deps.清除程序滚动来源("media_viewer_open");
    },
    onMediaSessionSignal: 转发媒体查看器会话信号,
  });

  const 媒体会话表 = new Map<string, 媒体会话端口>();
  const 媒体缓存 = 创建媒体缓存({
    repo: deps.媒体缓存仓库 ?? 创建内存媒体缓存仓库(),
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
        thumbnailSrc: deps.transport().buildAttachmentContentUrl(
          attachment.attachmentId,
          sessionId,
          "thumbnail"
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
    if (playback?.mode === "blob") {
      return {
        kind: playback.kind,
        contentHash: playback.contentHash ?? null,
      };
    }
    const currentViewerItem = 当前查看器请求?.items.find(
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

  const 处理协作分发事件 = (
    attachment: { attachmentId: string; kind: 媒体种类 },
    event:
      | { type: "SWARM_ACTIVE"; attachmentId: string; swarmId: string }
      | { type: "SWARM_NO_PEERS"; attachmentId: string; swarmId: string }
      | { type: "ASSET_COMPLETE"; attachmentId: string; swarmId: string; contentHash: string }
  ): void => {
    if (event.type === "SWARM_ACTIVE") {
      媒体会话表.get(attachment.attachmentId)?.send({ type: "SWARM_ACTIVE" });
      return;
    }
    if (event.type === "SWARM_NO_PEERS") {
      媒体会话表.get(attachment.attachmentId)?.send({ type: "SWARM_NO_PEERS" });
      return;
    }
    标记附件完整并持久化(attachment.attachmentId, {
      kind: attachment.kind,
      contentHash: event.contentHash,
    });
  };

  const 激活附件协作补齐 = (attachmentId: string): void => {
    const metadata = 读取附件缓存元数据(attachmentId);
    if (!metadata.kind) {
      return;
    }
    // 编排层只负责把“当前这张图值得后台补齐”的业务信号转交给播放器；
    // 真正 locate、读取 locator 兼容字段、接入 WebTorrent runtime 的细节仍留在播放器 owner。
    void 媒体播放器.激活协作补齐?.({
      attachmentId,
      kind: metadata.kind,
      onSessionEvent: (event) =>
        处理协作分发事件(
          { attachmentId, kind: metadata.kind! },
          event
        ),
    }).catch(() => undefined);
  };

  const 释放附件播放资源 = (attachmentId: string): void => {
    // 编排层只在附件会话退场时通知播放器释放底层占用；
    // 真正“该不该持有 swarm lease”的判断仍在播放器/runtime 自己收口。
    媒体播放器.释放附件播放资源?.(attachmentId);
  };

  const 创建媒体会话条目 = (attachment: 媒体附件条目): 媒体会话端口 => {
    let session: 媒体会话端口;
    session = 创建媒体会话({
      attachmentId: attachment.attachmentId,
      kind: attachment.kind,
      解析播放结果: (input) =>
        媒体播放器.解析播放结果({
          ...input,
          onSessionEvent: (event) => 处理协作分发事件(attachment, event),
        }),
      onSnapshotChange: () => {
        deps.请求重渲染();
        同步当前查看器请求();
      },
    });
    应用缓存完整度到会话(attachment.attachmentId, session);
    return session;
  };

  const 清空播放状态 = (): void => {
    for (const [attachmentId, session] of 媒体会话表) {
      释放附件播放资源(attachmentId);
      session.销毁();
    }
    媒体会话表.clear();
    媒体定位器.清空();
  };

  void 媒体缓存.启动().then(() => {
    for (const attachmentId of 媒体会话表.keys()) {
      应用缓存完整度到会话(attachmentId);
    }
    deps.请求重渲染();
  });

  return {
    snapshot(): 聊天媒体快照 {
      return {
        playbackByAttachmentId: 读取媒体播放结果表(),
        sessionByAttachmentId: 读取媒体会话快照表(),
        contentUrlByAttachmentId: 读取附件内容地址表(),
      };
    },

    async 处理选择媒体文件(files: Iterable<File>): Promise<void> {
      await 媒体发布器.处理选择媒体文件(files);
    },

    移除媒体草稿(localId: string): void {
      媒体发布器.移除草稿(localId);
    },

    async 重试媒体草稿(localId: string): Promise<void> {
      await 媒体发布器.重试草稿(localId);
    },

    清空草稿(): void {
      媒体发布器.清空();
    },

    打开查看器(request: 媒体查看器打开请求): void {
      当前查看器请求 = 投影查看器请求到当前播放真相({
        startAttachmentId: request.startAttachmentId,
        items: request.items.map((item) => ({ ...item })),
      });
      deps.登记程序滚动来源("media_viewer_open");
      媒体查看器.打开(当前查看器请求);
    },

    /**
     * 播放结果只从“当前时间线里的附件集合”推导：
     * - 新出现的附件进入解析；
     * - 已经不在时间线里的附件立即退场；
     * - 壳层只读这个结果表，不再自己记一份播放缓存。
     */
    同步消息附件播放结果(): void {
      const attachments = 读取当前房间媒体附件();
      const activeAttachmentIds = new Set(attachments.map((item) => item.attachmentId));
      let hasSessionSetChanged = false;

      for (const [attachmentId, session] of 媒体会话表) {
        if (activeAttachmentIds.has(attachmentId)) {
          continue;
        }
        释放附件播放资源(attachmentId);
        session.销毁();
        媒体会话表.delete(attachmentId);
        hasSessionSetChanged = true;
      }

      if (hasSessionSetChanged) {
        deps.请求重渲染();
      }

      for (const attachment of attachments) {
        if (媒体会话表.has(attachment.attachmentId)) {
          continue;
        }
        hasSessionSetChanged = true;
        const session = 创建媒体会话条目(attachment);
        媒体会话表.set(attachment.attachmentId, session);
        void session.启动();
      }

      if (hasSessionSetChanged) {
        deps.请求重渲染();
      }
    },

    处理媒体会话信号(attachmentId: string, signal: 媒体会话信号): void {
      if (signal.type === "ASSET_COMPLETE") {
        // 图片查看器只负责把“完整图已经拿到”回抛成会话信号；
        // 真正落盘到 MediaCacheOwner 的动作仍然只能由编排层统一收口。
        标记附件完整并持久化(attachmentId, 读取附件缓存元数据(attachmentId));
        return;
      }
      if (signal.type === "ASSET_BACKFILLING") {
        激活附件协作补齐(attachmentId);
      }
      转发媒体查看器会话信号(attachmentId, signal);
    },

    处理平台在线状态变化(online: boolean): void {
      for (const session of 媒体会话表.values()) {
        session.send({ type: online ? "ORIGIN_AVAILABLE" : "ORIGIN_UNAVAILABLE" });
      }
    },

    清空(): void {
      当前查看器请求 = null;
      媒体查看器.销毁();
      媒体发布器.清空();
      清空播放状态();
      deps.请求重渲染();
    },

    销毁(): void {
      当前查看器请求 = null;
      媒体查看器.销毁();
      媒体发布器.销毁();
      清空播放状态();
      deps.请求重渲染();
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
      // 测试替身允许只关心“打开/销毁”两件事；
      // 这里把它适配成正式查看器契约，避免生产代码为了测试而放宽 owner 边界。
      媒体查看器 = {
        打开: viewer.打开,
        同步: viewer.同步 ?? (() => undefined),
        销毁: viewer.销毁,
      };
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
