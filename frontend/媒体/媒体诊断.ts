export type 媒体上传失败响应体 = Record<string, unknown>;

export type 媒体上传失败响应 =
  | {
      body?: 媒体上传失败响应体;
      status?: number;
      responseText?: string;
      readyState?: number;
      responseURL?: string;
      getResponseHeader?(name: string): string | null;
    }
  | undefined;

type Tus原始响应 = {
  getBody?(): string;
  getHeader?(name: string): string | null;
  getStatus?(): number;
};

export type 媒体上传失败错误 = {
  message: string;
  originalResponse?: Tus原始响应 | null;
};

function 读取响应头(
  getHeader: ((name: string) => string | null) | undefined,
  name: string
): string {
  const value = getHeader?.(name) ?? getHeader?.(name.toLowerCase()) ?? getHeader?.(name.toUpperCase());
  return typeof value === "string" ? value.trim() : "";
}

function 安全解析上传失败响应体(response: 媒体上传失败响应): 媒体上传失败响应体 | null {
  if (response?.body && typeof response.body === "object") {
    return response.body;
  }
  if (typeof response?.responseText !== "string" || !response.responseText.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(response.responseText) as unknown;
    return payload && typeof payload === "object" ? (payload as 媒体上传失败响应体) : null;
  } catch {
    return null;
  }
}

function 判断是否已收到上传层响应(response: 媒体上传失败响应): boolean {
  if (!response) {
    return false;
  }
  return Boolean(
    response.status !== undefined ||
      response.readyState !== undefined ||
      response.responseURL?.trim() ||
      response.responseText?.trim()
  );
}

function 从Tus原始响应归一化失败响应(error: 媒体上传失败错误): 媒体上传失败响应 {
  const originalResponse = error.originalResponse;
  if (!originalResponse || typeof originalResponse !== "object") {
    return undefined;
  }
  const status =
    typeof originalResponse.getStatus === "function" ? originalResponse.getStatus() : undefined;
  const responseText =
    typeof originalResponse.getBody === "function" ? originalResponse.getBody() || "" : "";
  if (status === undefined && !responseText.trim()) {
    return undefined;
  }
  const normalizedResponse: NonNullable<媒体上传失败响应> = {
    responseText,
    /**
     * Uppy/Tus 不会把 xhr-like response 作为 upload-error 第三个参数透传出来。
     * 这里把 tus-js-client 的原始响应鸭子类型收口成现有诊断接口，避免壳层丢失真实状态码。
     */
    getResponseHeader(name: string): string | null {
      if (typeof originalResponse.getHeader !== "function") {
        return null;
      }
      return originalResponse.getHeader(name) ?? null;
    },
  };
  if (status !== undefined) {
    normalizedResponse.status = status;
  }
  return normalizedResponse;
}

function 从Tus错误消息归一化失败响应(error: 媒体上传失败错误): 媒体上传失败响应 {
  const rawMessage = error.message.trim();
  if (!rawMessage) {
    return undefined;
  }
  const statusMatch = rawMessage.match(/response code:\s*(\d{3})/i);
  const responseTextMatch = rawMessage.match(/response text:\s*(.*), request id:/i);
  if (!statusMatch && !responseTextMatch) {
    return undefined;
  }
  const normalizedResponse: NonNullable<媒体上传失败响应> = {
    responseText: responseTextMatch?.[1]?.trim() ?? "",
  };
  if (statusMatch) {
    normalizedResponse.status = Number.parseInt(statusMatch[1]!, 10);
  }
  return normalizedResponse;
}

function 读取媒体上传请求标识(
  error: 媒体上传失败错误,
  response: 媒体上传失败响应
): string {
  const responseRequestId = 读取响应头(response?.getResponseHeader, "X-Request-ID");
  if (responseRequestId) {
    return responseRequestId;
  }
  const originalResponseRequestId = 读取响应头(error.originalResponse?.getHeader, "X-Request-ID");
  if (originalResponseRequestId) {
    return originalResponseRequestId;
  }
  const requestIdMatch = error.message.match(/request id:\s*([^)]+)/i);
  const requestId = requestIdMatch?.[1]?.trim() ?? "";
  return requestId.toLowerCase() === "n/a" ? "" : requestId;
}

function 归一化媒体上传失败响应(
  error: 媒体上传失败错误,
  response: 媒体上传失败响应
): 媒体上传失败响应 {
  if (判断是否已收到上传层响应(response)) {
    return response;
  }
  return 从Tus原始响应归一化失败响应(error) ?? 从Tus错误消息归一化失败响应(error);
}

export function 解析媒体上传失败代码(
  error: 媒体上传失败错误,
  response: 媒体上传失败响应
): string {
  const normalizedResponse = 归一化媒体上传失败响应(error, response);
  const responseBody = 安全解析上传失败响应体(normalizedResponse);
  if (typeof responseBody?.code === "string" && responseBody.code.trim()) {
    return responseBody.code.trim();
  }
  if (normalizedResponse?.status === 413) {
    return "attachment_too_large";
  }
  const normalizedMessage = error.message.trim().toLowerCase();
  if (
    normalizedResponse?.status === 0 ||
    normalizedMessage.includes("network error") ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("load failed")
  ) {
    return "attachment_upload_network_error";
  }
  if (normalizedMessage.includes("timeout") || normalizedMessage.includes("timed out")) {
    return "attachment_upload_stalled";
  }
  return error.message.trim() || "attachment_upload_failed";
}

/**
 * 媒体上传失败后的排障锚点必须落在 `attachmentId` 上。
 * 这条主链里 prepare 已经先生成附件真相，所以排查时要围绕 attachmentId 串 prepare / tus / complete，
 * 不能再依赖历史特化链路里遗留的 header 诊断语义。
 */
export function 记录媒体上传失败诊断(input: {
  attachmentId: string;
  localId: string;
  fileName: string;
  error: 媒体上传失败错误;
  response: 媒体上传失败响应;
  errorCode: string;
}): void {
  const normalizedResponse = 归一化媒体上传失败响应(input.error, input.response);
  const responseText =
    typeof normalizedResponse?.responseText === "string" ? normalizedResponse.responseText.trim() : "";
  const requestId = 读取媒体上传请求标识(input.error, normalizedResponse);
  console.warn("[koko:image-upload:error]", {
    attachmentId: input.attachmentId,
    localId: input.localId,
    fileName: input.fileName,
    status: normalizedResponse?.status ?? null,
    readyState: normalizedResponse?.readyState ?? null,
    responseURL: normalizedResponse?.responseURL ?? "",
    errorCode: input.errorCode,
    originalMessage: input.error.message,
    receivedUploadResponse: 判断是否已收到上传层响应(normalizedResponse),
    /**
     * requestId 只是 transport 诊断锚点，不参与业务裁决。
     * 它存在的意义，是把浏览器里的 tus 错误和 sidecar / 主服务日志更快串起来。
     */
    requestId,
    responseText: responseText ? responseText.slice(0, 240) : "",
  });
}

export function 解析传输错误代码(error: unknown, fallbackCode = "attachment_upload_failed"): string {
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
    const code = ((error as { code: string }).code || "").trim();
    if (code) {
      return code;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallbackCode;
}
