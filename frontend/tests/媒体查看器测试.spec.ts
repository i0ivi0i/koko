// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { 创建媒体查看器 } from "../媒体/媒体查看器";

describe("媒体查看器适配器", () => {
  it("会把已解析的媒体 source 映射给 GLightbox，并从指定附件打开", () => {
    const openAt = vi.fn();
    const destroy = vi.fn();
    const createLightbox = vi.fn(() => ({
      openAt,
      destroy,
    }));
    const viewer = 创建媒体查看器({ createLightbox });

    viewer.打开({
      startAttachmentId: "att-video-1",
      items: [
        {
          kind: "image",
          attachmentId: "att-image-1",
          src: "http://media.local/original-image-1",
          alt: "图片附件原图",
          width: 1200,
          height: 800,
        },
        {
          kind: "video",
          attachmentId: "att-video-1",
          src: "blob:http://media.local/webtorrent-video-1",
          posterSrc: "http://media.local/poster-video-1",
          width: 1280,
          height: 720,
        },
      ],
    });

    expect(createLightbox).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: null,
        touchNavigation: true,
        keyboardNavigation: true,
        autoplayVideos: true,
        loop: false,
        elements: [
          {
            href: "http://media.local/original-image-1",
            type: "image",
            alt: "图片附件原图",
            width: "1200px",
            height: "800px",
          },
          {
            href: "blob:http://media.local/webtorrent-video-1",
            type: "video",
            source: "local",
            width: "1280px",
            height: "720px",
            poster: "http://media.local/poster-video-1",
          },
        ],
      })
    );
    expect(openAt).toHaveBeenCalledWith(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});
