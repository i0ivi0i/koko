import type {
  Blob媒体资产描述,
  Blob媒体变体描述,
  单文件视频资产描述,
  媒体冷源描述,
  媒体资产分发表面,
  媒体附件上传结果,
  媒体附件转发请求,
  媒体附件转发结果,
  媒体定位结果,
  媒体SourceHash复用请求,
  媒体SourceHash复用结果,
  媒体SourceHash信息,
  媒体上传准备结果,
  媒体种类,
  预览资源描述,
} from "../../聊天共享/契约.js";

type 读取JSON = <T>(
  path: string,
  headers?: Record<string, string>,
  signal?: AbortSignal
) => Promise<T>;
type 提交JSON = <T>(path: string, body: object) => Promise<T>;

export interface 媒体HTTP接口依赖 {
  get: 读取JSON;
  post: 提交JSON;
  解析绝对地址(pathOrUrl: string): string;
  解析预览资源(preview: 预览资源描述 | null | undefined): 预览资源描述 | null;
}

/**
 * 这个适配器只处理媒体上传与定位的 HTTP 表面：
 * - prepare / abandon / complete 继续只是浏览器直传配套；
 * - locator 继续只是把后端契约收口成前端可消费的稳定地址形状。
 *
 * 它不碰聊天 socket，也不接管媒体播放 owner。
 */
export class 媒体HTTP接口 {
  constructor(private readonly deps: 媒体HTTP接口依赖) {}

  /**
   * announce 不是普通 HTTP 内容地址，而是交给 WebTorrent tracker client 的 transport 入口：
   * 1. 后端 contract 允许继续下发同源相对 `/api/swarm/announce`；
   * 2. 浏览器真正可用的是 `ws/wss` tracker，而不是 `http/https` 页面地址；
   * 3. 因此前端必须在 HTTP adapter 就把它收口成 websocket announce，不能等 runtime 再猜。
   */
  private 解析协作分发Announce地址(pathOrUrl: string): string {
    const absoluteUrl = this.deps.解析绝对地址(pathOrUrl);
    const url = new URL(absoluteUrl);
    if (url.protocol === "ws:" || url.protocol === "wss:") {
      return url.href;
    }
    if (url.protocol === "http:") {
      url.protocol = "ws:";
      return url.href;
    }
    if (url.protocol === "https:") {
      url.protocol = "wss:";
      return url.href;
    }
    return absoluteUrl;
  }

  async prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File,
    sourceHash?: 媒体SourceHash信息
  ): Promise<媒体上传准备结果> {
    const body = {
      session_id: sessionId,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
      ...(sourceHash
        ? {
            source_hash: sourceHash.source_hash,
            source_byte_size: sourceHash.source_byte_size,
            ...(sourceHash.source_file_name
              ? { source_file_name: sourceHash.source_file_name }
              : {}),
          }
        : {}),
    };
    const prepared = await this.deps.post<媒体上传准备结果>(`/api/media/${kind}/prepare`, body);
    return {
      ...prepared,
      tus_endpoint: this.deps.解析绝对地址(prepared.tus_endpoint),
    };
  }

  async reuseMediaBySourceHash(
    kind: 媒体种类,
    input: 媒体SourceHash复用请求
  ): Promise<媒体SourceHash复用结果> {
    const result = await this.deps.post<媒体SourceHash复用结果>(
      `/api/media/${kind}/source-dedupe`,
      {
        session_id: input.session_id,
        room_id: input.room_id,
        source_hash: input.source_hash,
        source_byte_size: input.source_byte_size,
        ...(input.source_file_name ? { source_file_name: input.source_file_name } : {}),
      }
    );
    if (result.status !== "reused") {
      return { status: "miss" };
    }
    return {
      status: "reused",
      attachment: this.解析媒体上传结果(result.attachment),
    };
  }

  async forwardMediaAttachment(
    kind: 媒体种类,
    input: 媒体附件转发请求
  ): Promise<媒体附件转发结果> {
    const result = await this.deps.post<媒体附件转发结果>(`/api/media/${kind}/forward`, {
      session_id: input.session_id,
      target_room_id: input.target_room_id,
      source_attachment_id: input.source_attachment_id,
      client_message_id: input.client_message_id,
      text: input.text ?? "",
    });
    const attachments = result.message.attachments?.map((attachment) => ({
      ...attachment,
      preview_asset: this.deps.解析预览资源(attachment.preview_asset),
    }));
    return {
      ...result,
      message: {
        ...result.message,
        ...(attachments ? { attachments } : {}),
      },
      attachment: this.解析媒体上传结果(result.attachment),
    };
  }

  async abandonMediaUpload(sessionId: string, attachmentId: string): Promise<void> {
    await this.deps.post<{ attachment_id: string; status: string }>(
      `/api/media/${attachmentId}/abandon`,
      {
        session_id: sessionId,
      }
    );
  }

  async completeMediaUpload(
    sessionId: string,
    attachmentId: string
  ): Promise<媒体附件上传结果> {
    const result = await this.deps.post<媒体附件上传结果>(
      `/api/media/${attachmentId}/complete`,
      {
        session_id: sessionId,
      }
    );
    return this.解析媒体上传结果(result);
  }

  async loadMediaLocator(
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal
  ): Promise<媒体定位结果> {
    const locator = await this.deps.get<媒体定位结果>(
      `/api/media/${attachmentId}/locator?session_id=${sessionId}`,
      {},
      signal
    );
    const { original_url: _discardedOriginalUrl, ...locatorWithoutTopLevelOriginalUrl } = locator as {
      original_url?: string;
    } & 媒体定位结果;
    const file_asset = locator.file_asset ? this.解析单文件视频资产(locator.file_asset) : null;
    const blob_asset = locator.blob_asset ? this.解析Blob媒体资产(locator.blob_asset) : null;
    return {
      ...locatorWithoutTopLevelOriginalUrl,
      preview_asset: this.deps.解析预览资源(locator.preview_asset),
      thumbnail_url: locator.thumbnail_url
        ? this.deps.解析绝对地址(locator.thumbnail_url)
        : null,
      distribution: locator.distribution
        ? {
            ...locator.distribution,
            announce_urls: locator.distribution.announce_urls.map((url) =>
              this.解析协作分发Announce地址(url)
            ),
            torrent_url: locator.distribution.torrent_url
              ? this.deps.解析绝对地址(locator.distribution.torrent_url)
              : null,
            web_seed_url: locator.distribution.web_seed_url
              ? this.deps.解析绝对地址(locator.distribution.web_seed_url)
              : null,
            /**
             * presence 绝对地址必须在 HTTP adapter 就收口：
             * 1. runtime 只消费可直接 fetch 的受控地址；
             * 2. 不再借 locator.original_url 做二次拼接；
             * 3. 这样缓存下来的 locator 也不会携带“还得再猜 base URL”的隐形前提。
             */
            presence_url: locator.distribution.presence_url
              ? this.deps.解析绝对地址(locator.distribution.presence_url)
              : null,
          }
        : null,
      file_asset,
      blob_asset,
    };
  }

  private 解析媒体上传结果(result: 媒体附件上传结果): 媒体附件上传结果 {
    const preview_asset = this.deps.解析预览资源(result.preview_asset);
    if (!result.media_asset) {
      return {
        ...result,
        preview_asset,
      };
    }
    if (result.media_asset.kind === "blob_image") {
      return {
        ...result,
        preview_asset,
        media_asset: this.解析Blob媒体资产(result.media_asset),
      };
    }
    if (result.media_asset.kind === "file_video") {
      return {
        ...result,
        preview_asset,
        media_asset: this.解析单文件视频资产(result.media_asset),
      };
    }
    return {
      ...result,
      preview_asset,
    };
  }

  private 解析单文件视频资产(asset: 单文件视频资产描述): 单文件视频资产描述 {
    return {
      ...asset,
      variants: {
        /**
         * 新代际单文件视频的正式主链已经收口到协作分发 runtime：
         * 1. 即使后端旧响应一时还残留 canonical HTTP 地址，这里也先主动压平成 null；
         * 2. 这样前端各壳层不会再把它误认成正式可播放视频源；
         * 3. 冷备能力继续留在 origin 元数据里，和正式播放主链分层。
         */
        canonical: null,
      },
      distribution: this.解析媒体资产分发表面(asset.distribution),
      origin: this.解析媒体冷源描述(asset.origin),
    };
  }

  private 解析Blob媒体资产(asset: Blob媒体资产描述): Blob媒体资产描述 {
    return {
      ...asset,
      variants: {
        canonical: asset.variants.canonical
          ? this.解析Blob媒体变体(asset.variants.canonical)
          : null,
      },
      distribution: asset.distribution
        ? this.解析媒体资产分发表面(asset.distribution)
        : null,
      origin: this.解析媒体冷源描述(asset.origin),
    };
  }

  private 解析媒体资产分发表面(
    distribution: 媒体资产分发表面
  ): 媒体资产分发表面 {
    return {
      ...distribution,
      announce_urls: distribution.announce_urls.map((url) =>
        this.解析协作分发Announce地址(url)
      ),
      web_seed_url: distribution.web_seed_url
        ? this.deps.解析绝对地址(distribution.web_seed_url)
        : null,
    };
  }

  private 解析媒体冷源描述(origin: 媒体冷源描述): 媒体冷源描述 {
    return {
      ...origin,
      original_url: origin.original_url
        ? this.deps.解析绝对地址(origin.original_url)
        : null,
    };
  }

  private 解析Blob媒体变体(variant: Blob媒体变体描述): Blob媒体变体描述 {
    return {
      ...variant,
      url: this.deps.解析绝对地址(variant.url),
    };
  }
}
