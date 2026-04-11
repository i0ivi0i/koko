import { describe, expect, it, vi } from "vitest";
import {
  记录媒体上传失败诊断,
  解析媒体上传失败代码,
  解析传输错误代码,
} from "../媒体/媒体诊断";

describe("图片上传诊断", () => {
  it("会优先提取响应体里的稳定错误码", () => {
    const errorCode = 解析媒体上传失败代码(
      { message: "Upload error" },
      {
        status: 401,
        body: {
          code: "invalid_session",
          message: "会话无效",
        },
      }
    );

    expect(errorCode).toBe("invalid_session");
  });

  it("status=0 时会归一化成网络错误", () => {
    const errorCode = 解析媒体上传失败代码(
      { message: "Network Error" },
      {
        status: 0,
        responseText: "",
        readyState: 4,
        responseURL: "",
      }
    );

    expect(errorCode).toBe("attachment_upload_network_error");
  });

  it("超时消息会归一化成 stalled 错误", () => {
    const errorCode = 解析媒体上传失败代码(
      { message: "Request timed out" },
      undefined
    );

    expect(errorCode).toBe("attachment_upload_stalled");
  });

  it("Tus DetailedError 会优先读取 originalResponse 里的稳定错误码", () => {
    const errorCode = 解析媒体上传失败代码(
      {
        message: "tus upload failed",
        originalResponse: {
          getStatus: () => 400,
          getBody: () =>
            JSON.stringify({
              code: "invalid_argument",
              message: "hook length/offset 与 metadata.byte_size 不一致",
            }),
        },
      },
      undefined
    );

    expect(errorCode).toBe("invalid_argument");
  });

  it("Tus DetailedError 缺少显式 response 参数时仍能把 413 识别成大小超限", () => {
    const errorCode = 解析媒体上传失败代码(
      {
        message:
          "tus: unexpected response while uploading chunk, originated from request (method: PATCH, url: http://127.0.0.1:1081/files/demo, response code: 413, response text: , request id: n/a)",
      },
      undefined
    );

    expect(errorCode).toBe("attachment_too_large");
  });

  it("诊断日志会以 attachmentId 作为主关联锚点", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    记录媒体上传失败诊断({
      attachmentId: "att-diagnostic-1",
      localId: "draft-diagnostic-1",
      fileName: "broken.jpg",
      error: { message: "Upload error" },
      response: {
        status: 401,
        responseText: JSON.stringify({
          code: "invalid_session",
          message: "会话无效",
        }),
        readyState: 4,
        responseURL: "http://test.local/upload",
        getResponseHeader(name: string) {
          return name === "x-koko-upload-id" ? "legacy-trace-1" : null;
        },
      },
      errorCode: "invalid_session",
    });

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const [, payload] = consoleWarnSpy.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      attachmentId: "att-diagnostic-1",
      localId: "draft-diagnostic-1",
      fileName: "broken.jpg",
      status: 401,
      errorCode: "invalid_session",
      receivedUploadResponse: true,
    });
    expect(payload).not.toHaveProperty("uploadTraceId");
  });

  it("传输错误对象会优先取 code 字段", () => {
    const errorCode = 解析传输错误代码({
      code: "attachment_type_not_allowed",
      message: "only images allowed",
    });

    expect(errorCode).toBe("attachment_type_not_allowed");
  });
});
