import type { 媒体定位结果, 媒体种类, 媒体资产分发表面 } from "../契约.js";
import {
  读取协作分发定位片段,
  type 协作分发会话事件,
} from "./媒体协作分发.js";

type 媒体播放输入 = {
  attachmentId: string;
  kind: 媒体种类;
  onSessionEvent?: (event: 协作分发会话事件) => void;
};

type 媒体播放结果 =
  | {
      mode: "swarm" | "anchor" | "manifest" | "blob";
      attachmentId: string;
      kind: 媒体种类;
      src: string;
      viewerSrc?: string;
      thumbnailUrl: string | null;
      streamingDistribution?: 媒体资产分发表面 | null;
      hint: "正在协作分发" | null;
    }
  | {
      mode: "expired";
      attachmentId: string;
      kind: 媒体种类;
      src: "";
      thumbnailUrl: string | null;
      hint: "内容已过期";
    }
  | {
      mode: "degraded";
      attachmentId: string;
      kind: 媒体种类;
      src: "";
      thumbnailUrl: string | null;
      reason: "locator_unavailable" | "attachment_not_ready" | "anchor_unavailable";
      hint: "附件当前不可获取";
    };

type 媒体播放器依赖 = {
  locate(attachmentId: string, options?: { forceRefresh?: boolean }): Promise<媒体定位结果>;
  resolveSwarmSource?(input: {
    attachmentId: string;
    kind: 媒体种类;
    locator: 媒体定位结果;
    onSessionEvent?: (event: 协作分发会话事件) => void;
  }): Promise<{ src: string; hint: "正在协作分发" | "正在补块" | null } | null>;
  releaseSwarmSource?(input: { attachmentId: string }): void;
  probeAnchor?(url: string): Promise<void>;
};

const 过滤可播放媒体提示 = (
  hint: "正在协作分发" | "正在补块" | null
): "正在协作分发" | null => {
  // “正在补块”只说明协作分发还在后台补齐文件块；只要已有可播放 src，就不是用户可见故障。
  return hint === "正在补块" ? null : hint;
};

/**
 * 播放器编排只回答“当前这一条媒体该从哪里读”：
 * 1. 先看 locator 是否 ready；
 * 2. 如果有 swarm 能力就优先尝试；
 * 3. swarm 不足或当前没有 swarm 定位符时，退回锚点；
 * 4. 锚点失效时强制重签一次，再决定是否 degraded。
 *
 * 当前后端 locator 还没有暴露 magnet/infohash，所以默认 `resolveSwarmSource`
 * 会返回 `null`。这不是偷懒，而是不伪造不存在的 P2P 真相。
 */
export function 创建媒体播放器(deps: 媒体播放器依赖) {
  const resolveSwarmSource =
    deps.resolveSwarmSource ??
    (async () => {
      return null;
    });
  const releaseSwarmSource =
    deps.releaseSwarmSource ??
    (() => {
      return;
    });
  const probeAnchor =
    deps.probeAnchor ??
    (async () => {
      return;
    });

  const 释放协作分发占用 = (attachmentId: string): void => {
    // 播放器 owner 只在“当前已经不再选择 swarm 主链”时释放 consumer lease，
    // 不把 release 判断散落回壳层或媒体会话里重复裁一次。
    releaseSwarmSource({ attachmentId });
  };

  /**
   * 过渡阶段优先读共享资产里的冷源描述：
   * 1. 它已经明确声明原始附件只是 cold_backup_only；
   * 2. 后续顶层 original_url 退场时，这里不用再回头大改播放入口；
   * 3. 仍保留旧字段兜底，保证第一批后端过渡面上线时不打爆旧 locator。
   */
  const 读取锚点地址 = (locator: 媒体定位结果): string =>
    locator.streaming_asset?.origin.original_url ?? locator.original_url;

  /**
   * 视频一旦拿到正式 HLS manifest，就不应该继续把原始附件冷源当主播放链。
   * 当前阶段先统一优先消费 HLS：
   * 1. 它已经是标准流媒体入口，后续接播放器/provider 不用再倒回 file URL；
   * 2. DASH 先保留作契约冗余与后续多端适配，不在浏览器主链里同时搞双入口；
   * 3. 没有 manifest 时才继续走旧的 swarm/file 过渡路径。
   */
  const 读取流媒体主链地址 = (locator: 媒体定位结果): string | null =>
    locator.kind === "video" ? locator.streaming_asset?.manifest.hls_master_url ?? null : null;

  /**
   * 图片资产不再默认回到原始附件直链：
   * 1. 列表卡片优先吃 preview，降低首开成本；
   * 2. 查看器优先吃 full/original，避免继续把 preview 放大冒充原图；
   * 3. 只有 blob 资产根本不存在时，才退回旧冷源锚点。
   */
  const 读取图片Blob主链 = (locator: 媒体定位结果) => {
    if (locator.kind !== "image" || !locator.blob_asset) {
      return null;
    }
    const previewSrc =
      locator.blob_asset.preview?.url ??
      locator.blob_asset.full?.url ??
      locator.blob_asset.original?.url ??
      null;
    const viewerSrc =
      locator.blob_asset.full?.url ??
      locator.blob_asset.original?.url ??
      previewSrc;
    if (!previewSrc || !viewerSrc) {
      return null;
    }
    return {
      src: previewSrc,
      viewerSrc,
      thumbnailUrl: locator.blob_asset.preview?.url ?? locator.thumbnail_url,
    };
  };

  const 创建降级结果 = (
    input: 媒体播放输入,
    locator: 媒体定位结果 | null,
    reason: "locator_unavailable" | "attachment_not_ready" | "anchor_unavailable"
  ): 媒体播放结果 => ({
    mode: "degraded",
    attachmentId: input.attachmentId,
    kind: input.kind,
    src: "",
    thumbnailUrl: locator?.thumbnail_url ?? null,
    reason,
    hint: "附件当前不可获取",
  });

  const 尝试锚点 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果,
    allowRefresh: boolean
  ): Promise<媒体播放结果> => {
    释放协作分发占用(input.attachmentId);
    const anchorUrl = 读取锚点地址(locator);
    try {
      await probeAnchor(anchorUrl);
      return {
        mode: "anchor",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: anchorUrl,
        thumbnailUrl: locator.thumbnail_url,
        hint: null,
      };
    } catch {
      if (!allowRefresh) {
        return 创建降级结果(input, locator, "anchor_unavailable");
      }
      const refreshedLocator = await deps.locate(input.attachmentId, { forceRefresh: true });
      if (refreshedLocator.status !== "ready") {
        return 创建降级结果(input, refreshedLocator, "attachment_not_ready");
      }
      const refreshedAnchorUrl = 读取锚点地址(refreshedLocator);
      try {
        await probeAnchor(refreshedAnchorUrl);
        return {
          mode: "anchor",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: refreshedAnchorUrl,
          thumbnailUrl: refreshedLocator.thumbnail_url,
          hint: null,
        };
      } catch {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
    }
  };

  const 解析播放结果 = async (input: 媒体播放输入): Promise<媒体播放结果> => {
    let locator: 媒体定位结果;
    try {
      locator = await deps.locate(input.attachmentId);
    } catch {
      释放协作分发占用(input.attachmentId);
      return 创建降级结果(input, null, "locator_unavailable");
    }
    if (locator.status !== "ready") {
      释放协作分发占用(input.attachmentId);
      return 创建降级结果(input, locator, "attachment_not_ready");
    }
    const blobSource = 读取图片Blob主链(locator);
    if (blobSource) {
      释放协作分发占用(input.attachmentId);
      return {
        mode: "blob",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: blobSource.src,
        viewerSrc: blobSource.viewerSrc,
        thumbnailUrl: blobSource.thumbnailUrl,
        hint: null,
      };
    }
    const manifestUrl = 读取流媒体主链地址(locator);
    if (manifestUrl) {
      释放协作分发占用(input.attachmentId);
      return {
        mode: "manifest",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: manifestUrl,
        thumbnailUrl: locator.thumbnail_url,
        // 标准流媒体主链一旦成立，查看器/播放器适配层就应该直接消费统一分发表面，
        // 而不是再从旧 file-level locator 里猜 swarm 线索。
        streamingDistribution: locator.streaming_asset?.distribution ?? null,
        hint: null,
      };
    }
    const distribution = 读取协作分发定位片段(locator);
    if (distribution?.availability === "expired") {
      释放协作分发占用(input.attachmentId);
      return {
        mode: "expired",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: "",
        thumbnailUrl: locator.thumbnail_url,
        hint: "内容已过期",
      };
    }
    if (!distribution) {
      return 尝试锚点(input, locator, true);
    }
    try {
      const swarmSource = await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
      });
      if (swarmSource) {
        return {
          mode: "swarm",
          attachmentId: input.attachmentId,
          kind: input.kind,
          src: swarmSource.src,
          thumbnailUrl: locator.thumbnail_url,
          hint: 过滤可播放媒体提示(swarmSource.hint),
        };
      }
    } catch {
      // swarm 只是热分发层；失败后必须回到锚点，不允许把热路径波动升级成业务失败。
    }
    return 尝试锚点(input, locator, true);
  };

  return {
    解析播放结果,
    释放附件播放资源: 释放协作分发占用,
  };
}

export type { 媒体播放输入, 媒体播放结果 };
