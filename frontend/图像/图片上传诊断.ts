export type 图片上传失败响应体 = Record<string, unknown>;

export type 图片上传失败响应 =
  | {
      body?: 图片上传失败响应体;
      status?: number;
      responseText?: string;
      readyState?: number;
      responseURL?: string;
      getResponseHeader?(name: string): string | null;
    }
  | undefined;

function 安全解析上传失败响应体(response: 图片上传失败响应): 图片上传失败响应体 | null {
  if (response?.body && typeof response.body === "object") {
    return response.body;
  }
  if (typeof response?.responseText !== "string" || !response.responseText.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(response.responseText) as unknown;
    return payload && typeof payload === "object" ? (payload as 图片上传失败响应体) : null;
  } catch {
    return null;
  }
}

function 判断是否已收到上传层响应(response: 图片上传失败响应): boolean {
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

export function 解析图片上传失败代码(
  error: { message: string },
  response: 图片上传失败响应
): string {
  const responseBody = 安全解析上传失败响应体(response);
  if (typeof responseBody?.code === "string" && responseBody.code.trim()) {
    return responseBody.code.trim();
  }
  if (response?.status === 413) {
    return "attachment_too_large";
  }
  const normalizedMessage = error.message.trim().toLowerCase();
  if (
    response?.status === 0 ||
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
 * 图片上传失败后的排障锚点必须落在 `attachmentId` 上。
 * 这条主链里 prepare 已经先生成附件真相，所以排查时要围绕 attachmentId 串 prepare / PUT / complete，
 * 不能再依赖旧 `/api/attachments/image` 时代遗留的 header 诊断语义。
 */
export function 记录图片上传失败诊断(input: {
  attachmentId: string;
  localId: string;
  fileName: string;
  error: { message: string };
  response: 图片上传失败响应;
  errorCode: string;
}): void {
  const responseText =
    typeof input.response?.responseText === "string" ? input.response.responseText.trim() : "";
  console.warn("[koko:image-upload:error]", {
    attachmentId: input.attachmentId,
    localId: input.localId,
    fileName: input.fileName,
    status: input.response?.status ?? null,
    readyState: input.response?.readyState ?? null,
    responseURL: input.response?.responseURL ?? "",
    errorCode: input.errorCode,
    originalMessage: input.error.message,
    receivedUploadResponse: 判断是否已收到上传层响应(input.response),
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
