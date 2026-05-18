import { describe, expect, it, vi } from "vitest";

import { 媒体HTTP接口 } from "../媒体/适配/媒体HTTP接口";

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
});
