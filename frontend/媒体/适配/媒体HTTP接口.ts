import type {
  Blob媒体资产描述,
  Blob媒体变体描述,
  单文件视频资产描述,
  流媒体资产描述,
  媒体冷源描述,
  媒体资产分发表面,
  媒体附件上传结果,
  媒体定位结果,
  媒体上传准备结果,
  媒体种类,
  预览资源描述,
} from "../../契约.js";

type 读取JSON = <T>(path: string, headers?: Record<string, string>) => Promise<T>;
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

  async prepareMediaUpload(
    kind: 媒体种类,
    sessionId: string,
    file: File
  ): Promise<媒体上传准备结果> {
    const prepared = await this.deps.post<媒体上传准备结果>(`/api/media/${kind}/prepare`, {
      session_id: sessionId,
      file_name: file.name,
      mime_type: file.type,
      byte_size: file.size,
    });
    return {
      ...prepared,
      tus_endpoint: this.deps.解析绝对地址(prepared.tus_endpoint),
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

  async loadMediaLocator(sessionId: string, attachmentId: string): Promise<媒体定位结果> {
    const locator = await this.deps.get<媒体定位结果>(
      `/api/media/${attachmentId}/locator?session_id=${sessionId}`
    );
    const { original_url: _legacyOriginalUrl, ...locatorWithoutLegacyOriginalUrl } = locator as {
      original_url?: string;
    } & 媒体定位结果;
    return {
      ...locatorWithoutLegacyOriginalUrl,
      preview_asset: this.deps.解析预览资源(locator.preview_asset),
      thumbnail_url: locator.thumbnail_url
        ? this.deps.解析绝对地址(locator.thumbnail_url)
        : null,
      distribution: locator.distribution
        ? {
            ...locator.distribution,
            announce_urls: locator.distribution.announce_urls.map((url) =>
              this.deps.解析绝对地址(url)
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
      streaming_asset: locator.streaming_asset
        ? this.解析流媒体资产(locator.streaming_asset)
        : null,
      file_asset: locator.file_asset ? this.解析单文件视频资产(locator.file_asset) : null,
      blob_asset: locator.blob_asset ? this.解析Blob媒体资产(locator.blob_asset) : null,
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
      media_asset: this.解析流媒体资产(result.media_asset),
    };
  }

  private 解析流媒体资产(asset: 流媒体资产描述): 流媒体资产描述 {
    return {
      ...asset,
      manifest: {
        hls_master_url: asset.manifest.hls_master_url
          ? this.deps.解析绝对地址(asset.manifest.hls_master_url)
          : null,
        dash_mpd_url: asset.manifest.dash_mpd_url
          ? this.deps.解析绝对地址(asset.manifest.dash_mpd_url)
          : null,
      },
      distribution: this.解析媒体资产分发表面(asset.distribution),
      origin: this.解析媒体冷源描述(asset.origin),
    };
  }

  private 解析单文件视频资产(asset: 单文件视频资产描述): 单文件视频资产描述 {
    return {
      ...asset,
      variants: {
        canonical: asset.variants.canonical
          ? this.解析Blob媒体变体(asset.variants.canonical)
          : null,
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
        this.deps.解析绝对地址(url)
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
