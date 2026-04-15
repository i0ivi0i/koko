import type { 媒体定位结果, 媒体种类, 媒体资产分发表面 } from "../契约.js";
import {
  读取协作分发定位片段,
  type 协作分发会话事件,
} from "./媒体协作分发.js";

type 播放表面 = "viewer" | "inline_autoplay";

type 媒体播放输入 = {
  attachmentId: string;
  kind: 媒体种类;
  surface?: 播放表面;
  consumerId?: string;
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
      contentHash?: string | null;
      distribution?: 媒体资产分发表面 | null;
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
    consumerId?: string;
    onSessionEvent?: (event: 协作分发会话事件) => void;
  }): Promise<{ src: string; hint: "正在协作分发" | "正在补块" | null } | null>;
  releaseSwarmSource?(input: { attachmentId: string; consumerId?: string }): void;
  probeAnchor?(url: string): Promise<void>;
};

const 过滤可播放媒体提示 = (
  hint: "正在协作分发" | "正在补块" | null
): "正在协作分发" | null => {
  // “正在补块”只说明协作分发还在后台补齐文件块；只要已有可播放 src，就不是用户可见故障。
  return hint === "正在补块" ? null : hint;
};

/**
 * “视频默认循环播放”属于前端统一播放策略，而不是某个壳层的临时 DOM 技巧。
 * 当前阶段只需要一条最薄的 owner 规则：
 * - 视频默认循环；
 * - 图片不参与这条策略；
 * - 不按 surface、source、mode 再长第二套分支。
 */
export const 媒体是否默认循环播放 = (kind: 媒体种类): boolean => kind === "video";

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

  const 释放协作分发占用 = (input: {
    attachmentId: string;
    consumerId?: string;
  }): void => {
    // 播放器 owner 只在“当前已经不再选择 swarm 主链”时释放 consumer lease，
    // 不把 release 判断散落回壳层或媒体会话里重复裁一次。
    releaseSwarmSource({
      attachmentId: input.attachmentId,
      ...(input.consumerId ? { consumerId: input.consumerId } : {}),
    });
  };

  /**
   * 过渡阶段优先读共享资产里的冷源描述：
   * 1. 它已经明确声明原始附件只是 cold_backup_only；
   * 2. 后续顶层 original_url 退场时，这里不用再回头大改播放入口；
   * 3. 仍保留旧字段兜底，保证第一批后端过渡面上线时不打爆旧 locator。
   */
  const 读取锚点地址 = (locator: 媒体定位结果): string =>
    locator.streaming_asset?.origin.original_url ?? locator.original_url;

  const 读取预览缩略图地址 = (locator: 媒体定位结果): string | null =>
    locator.preview_asset?.still_url ?? locator.thumbnail_url;

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
      thumbnailUrl: locator.blob_asset.preview?.url ?? 读取预览缩略图地址(locator),
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
    thumbnailUrl: locator ? 读取预览缩略图地址(locator) : null,
    reason,
    hint: "附件当前不可获取",
  });

  const 尝试锚点 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果,
    allowRefresh: boolean
  ): Promise<媒体播放结果> => {
    释放协作分发占用(input);
    const anchorUrl = 读取锚点地址(locator);
    try {
      await probeAnchor(anchorUrl);
      return {
        mode: "anchor",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: anchorUrl,
        thumbnailUrl: 读取预览缩略图地址(locator),
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
          thumbnailUrl: 读取预览缩略图地址(refreshedLocator),
          hint: null,
        };
      } catch {
        return 创建降级结果(input, refreshedLocator, "anchor_unavailable");
      }
    }
  };

  const 尝试协作分发主链 = async (
    input: 媒体播放输入,
    locator: 媒体定位结果
  ): Promise<媒体播放结果 | null> => {
    const distribution = 读取协作分发定位片段(locator);
    if (distribution?.availability === "expired") {
      释放协作分发占用(input);
      return {
        mode: "expired",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: "",
        thumbnailUrl: 读取预览缩略图地址(locator),
        hint: "内容已过期",
      };
    }
    if (!distribution) {
      return null;
    }
    try {
      const swarmSource = await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        ...(input.consumerId ? { consumerId: input.consumerId } : {}),
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
      });
      if (!swarmSource) {
        return null;
      }
      /**
       * swarm/web seed 是正式分发平面的同一份事实：
       * 1. viewer 和 inline_autoplay 都应该复用同一个 resolver；
       * 2. surface 只决定“什么时候尝试”，不决定“另造一套来源”；
       * 3. hint 继续在这里统一过滤，避免壳层各自理解“正在补块”。
       */
      return {
        mode: "swarm",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: swarmSource.src,
        thumbnailUrl: 读取预览缩略图地址(locator),
        hint: 过滤可播放媒体提示(swarmSource.hint),
      };
    } catch {
      // swarm 只是热分发层；失败后必须回到锚点，不允许把热路径波动升级成业务失败。
      return null;
    }
  };

  /**
   * 图片查看器一旦进入 backfilling，就要把 blob 资产绑定的协作分发平面真正激活起来：
   * 1. 是否值得进入 swarm，仍然先看 blob_asset 这个共享资产真相；
   * 2. 真正启动 WebTorrent 仍复用现有 resolveSwarmSource/runtime，不新造图片专用实现；
   * 3. 失败保持静默，因为这里是“后台尽快补齐”的增强路径，不是首屏主链。
   *
   * 当前 Web 阶段里，blob_asset.distribution 负责宣告“这张图应该进入分发平面”，
   * 顶层 distribution 继续承载 torrent_url / info_hash / presence_url 这类浏览器运行时所需字段。
   * 等后端把两层契约进一步收口后，这里只需要缩短兼容读取，不用反向污染调用方。
   */
  const 激活协作补齐 = async (input: 媒体播放输入): Promise<void> => {
    let locator: 媒体定位结果;
    try {
      locator = await deps.locate(input.attachmentId);
    } catch {
      return;
    }
    if (locator.status !== "ready") {
      return;
    }
    if (!读取图片Blob主链(locator) || !locator.blob_asset?.distribution) {
      return;
    }
    const distribution = 读取协作分发定位片段(locator);
    if (!distribution || distribution.availability === "expired") {
      return;
    }
    try {
      await resolveSwarmSource({
        attachmentId: input.attachmentId,
        kind: input.kind,
        locator,
        ...(input.consumerId ? { consumerId: input.consumerId } : {}),
        ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
      });
    } catch {
      return;
    }
  };

  const 解析播放结果 = async (input: 媒体播放输入): Promise<媒体播放结果> => {
    const surface = input.surface ?? "viewer";
    let locator: 媒体定位结果;
    try {
      locator = await deps.locate(input.attachmentId);
    } catch {
      释放协作分发占用(input);
      return 创建降级结果(input, null, "locator_unavailable");
    }
    if (locator.status !== "ready") {
      释放协作分发占用(input);
      return 创建降级结果(input, locator, "attachment_not_ready");
    }
    const blobSource = 读取图片Blob主链(locator);
    if (blobSource) {
      释放协作分发占用(input);
      return {
        mode: "blob",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: blobSource.src,
        viewerSrc: blobSource.viewerSrc,
        thumbnailUrl: blobSource.thumbnailUrl,
        // 图片查看器后续要靠 contentHash 把“真的拿到完整资产”落进 MediaCacheOwner，
        // 这里必须把共享资产真相一路带下去，不能再让壳层去猜。
        contentHash: locator.blob_asset?.content_hash ?? null,
        distribution: locator.blob_asset?.distribution ?? null,
        hint: null,
      };
    }
    const manifestUrl = 读取流媒体主链地址(locator);
    if (surface === "viewer" && manifestUrl) {
      释放协作分发占用(input);
      return {
        mode: "manifest",
        attachmentId: input.attachmentId,
        kind: input.kind,
        src: manifestUrl,
        thumbnailUrl: 读取预览缩略图地址(locator),
        // 标准流媒体主链一旦成立，查看器/播放器适配层就应该直接消费统一分发表面，
        // 而不是再从旧 file-level locator 里猜 swarm 线索。
        streamingDistribution: locator.streaming_asset?.distribution ?? null,
        hint: null,
      };
    }
    if (surface === "inline_autoplay") {
      /**
       * 消息流自动播现在回到 P2P/WebTorrent 优先：
       * 1. 仍然禁止列表里的轻量 `<video>` 直接吞 HLS manifest；
       * 2. 但会先复用同一个 swarm/web seed resolver，吃正式分发平面的真相；
       * 3. 只有 swarm 不足时，才回退到浏览器原生冷源锚点。
       */
      const swarmPlayback = await 尝试协作分发主链(input, locator);
      if (swarmPlayback) {
        return swarmPlayback;
      }
      return 尝试锚点(input, locator, true);
    }
    const swarmPlayback = await 尝试协作分发主链(input, locator);
    if (swarmPlayback) {
      return swarmPlayback;
    }
    return 尝试锚点(input, locator, true);
  };

  return {
    解析播放结果,
    激活协作补齐,
    释放附件播放资源: 释放协作分发占用,
  };
}

export type { 媒体播放输入, 媒体播放结果 };
