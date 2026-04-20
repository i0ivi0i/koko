/**
 * 这里必须和 Rust 外壳里的 `DefaultBodyLimit` 同步。
 * 否则前端放行、后端拒绝时，就会重新长出“某些设备永远卡在上传中”的错位体验。
 */
export const 图片附件上传上限字节数 = 10 * 1024 * 1024;

export const 可选择图片文件类型 = ["image/*", ".heic", ".heif", ".heics", ".heifs"] as const;

const 常见图片扩展名到Mime类型 = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heics: "image/heic-sequence",
  heif: "image/heif",
  heifs: "image/heif-sequence",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
} as const;

const 需要转码的手机图片Mime类型 = new Set([
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
]);

const 需要转码的手机图片扩展名 = new Set(["heic", "heics", "heif", "heifs"]);

export function 创建本地图片预览地址(file: Blob | File | null | undefined): string {
  return file instanceof Blob ? URL.createObjectURL(file) : "";
}

function 读取文件扩展名(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension ?? "";
}

export function 推导图片Mime类型(file: File): string {
  const normalizedType = file.type.trim().toLowerCase();
  if (normalizedType) {
    return normalizedType;
  }
  const fallbackMimeType = 常见图片扩展名到Mime类型[
    读取文件扩展名(file.name) as keyof typeof 常见图片扩展名到Mime类型
  ];
  return typeof fallbackMimeType === "string" ? fallbackMimeType : "";
}

function 是图片文件(file: File): boolean {
  return 推导图片Mime类型(file).startsWith("image/");
}

function 是需要前端转码的手机图片(file: File): boolean {
  const mimeType = 推导图片Mime类型(file);
  return (
    需要转码的手机图片Mime类型.has(mimeType) ||
    需要转码的手机图片扩展名.has(读取文件扩展名(file.name))
  );
}

function 替换文件扩展名(fileName: string, extension: string): string {
  const normalizedExtension = extension.replace(/^\./u, "");
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return `${fileName}.${normalizedExtension}`;
  }
  return `${fileName.slice(0, lastDot)}.${normalizedExtension}`;
}

function 补全图片文件Mime类型(file: File): File {
  const mimeType = 推导图片Mime类型(file);
  if (!mimeType || file.type === mimeType) {
    return file;
  }
  return new File([file], file.name, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

async function 浏览器转码图片为Webp(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("attachment_upload_failed");
  }
  const bitmap = await createImageBitmap(file);
  try {
    // 图片 canonical 归一化只依赖浏览器原生解码/编码能力：
    // 这里不在发布器里手搓图片编码，也不把服务器变成补偿转码链。
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("attachment_upload_failed");
      }
      context.drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({
        type: "image/webp",
        quality: 0.95,
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("attachment_upload_failed");
    }
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("attachment_upload_failed"));
          }
        },
        "image/webp",
        0.95
      );
    });
  } finally {
    bitmap.close();
  }
}

async function 转码手机图片为标准Jpeg(file: File): Promise<File> {
  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
  });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!(blob instanceof Blob)) {
    throw new Error("attachment_upload_failed");
  }
  return new File([blob], 替换文件扩展名(file.name, "jpg"), {
    type: blob.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}

async function 预制图片为CanonicalWebp(file: File): Promise<File> {
  const normalizedSource = 是需要前端转码的手机图片(file)
    ? await 转码手机图片为标准Jpeg(file)
    : 补全图片文件Mime类型(file);
  const sourceMimeType = 推导图片Mime类型(normalizedSource);
  const canonicalBlob =
    sourceMimeType === "image/webp"
      ? normalizedSource
      : await 浏览器转码图片为Webp(normalizedSource);
  return new File([canonicalBlob], "canonical.webp", {
    type: "image/webp",
    lastModified: file.lastModified,
  });
}

/**
 * 输入区文件规范化只回答一件事：
 * “浏览器刚选中的这个文件，能不能被当成待上传图片继续进入主链？”
 *
 * 它不做草稿状态推进，也不做上传，只负责：
 * 1. 类型校验；
 * 2. HEIC/HEIF 先交给成熟库转成浏览器可读中间态；
 * 3. 最终统一产出客户端 canonical.webp，后端只做轻校验。
 */
export async function 准备待上传图片文件(file: File): Promise<File> {
  if (!是图片文件(file)) {
    throw new Error("attachment_type_not_allowed");
  }
  try {
    return await 预制图片为CanonicalWebp(file);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "attachment_type_not_allowed") {
      throw error;
    }
    console.warn("[koko:image-upload:prepare]", {
      fileName: file.name,
      fileType: file.type,
      fileByteSize: file.size,
      error:
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "attachment_upload_failed",
    });
    throw new Error("attachment_upload_failed");
  }
}
