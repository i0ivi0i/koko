import { describe, expect, it, vi } from "vitest";

import { 媒体HTTP接口 } from "../媒体/适配/媒体HTTP接口";
import { 创建前端传输 } from "../平台/传输";

describe("媒体 HTTP 接口", () => {
  it("resumeMediaUpload 会调用后端恢复端口并归一化 tus endpoint", async () => {
    const postCalls: Array<{ path: string; body: object }> = [];
    const post = async <T,>(path: string, body: object): Promise<T> => {
      postCalls.push({ path, body });
      return {
      status: "resumable" as const,
      attachment_id: "att-1",
      upload_session_id: "upl-1",
      upload_method: "tus" as const,
      tus_endpoint: "/files",
      tus_headers: { Authorization: "Bearer renewed" },
      tus_metadata: { attachment_id: "att-1", upload_session_id: "upl-1" },
      expires_at: "2026-05-18T09:30:00Z",
      } as T;
    };
    const api = new 媒体HTTP接口({
      get: vi.fn(),
      post,
      解析绝对地址: (path) => new URL(path, "https://kokoqun.com").href,
      解析预览资源: (preview) => preview ?? null,
    });

    const result = await api.resumeMediaUpload("s-1", "att-1", "upl-1");

    expect(postCalls).toEqual([
      {
        path: "/api/media/att-1/resume",
        body: {
          session_id: "s-1",
          upload_session_id: "upl-1",
        },
      },
    ]);
    expect(result).toMatchObject({
      status: "resumable",
      tus_endpoint: "https://kokoqun.com/files",
    });
  });

  it("创建前端传输会把媒体恢复端口暴露给应用层", async () => {
    const fetchCalls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          status: "resumable",
          attachment_id: "att-1",
          upload_session_id: "upl-1",
          upload_method: "tus",
          tus_endpoint: "/files",
          tus_headers: { Authorization: "Bearer renewed" },
          tus_metadata: {
            attachment_id: "att-1",
            upload_session_id: "upl-1",
            file_name: "a.jpg",
            mime_type: "image/jpeg",
            byte_size: "3",
          },
          expires_at: "2026-05-18T10:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const transport = 创建前端传输("https://kokoqun.com");

      const result = await transport.resumeMediaUpload("s-1", "att-1", "upl-1");

      expect(result).toMatchObject({
        status: "resumable",
        tus_endpoint: "https://kokoqun.com/files",
      });
      expect(fetchCalls).toEqual([
        {
          url: "https://kokoqun.com/api/media/att-1/resume",
          body: { session_id: "s-1", upload_session_id: "upl-1" },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
