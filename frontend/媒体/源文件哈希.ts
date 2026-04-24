export type 源文件哈希结果 = {
  sourceHash: string;
  sourceByteSize: number;
  sourceFileName: string;
};

export interface 源文件SHA256Hasher {
  update(chunk: Uint8Array): unknown | Promise<unknown>;
  digest(format?: "hex"): string | Promise<string>;
}

export interface 源文件哈希WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: "message" | "error", listener: EventListener): void;
  removeEventListener(type: "message" | "error", listener: EventListener): void;
}

type 源文件哈希Worker响应 =
  | {
      requestId: string;
      ok: true;
      sourceHash: string;
      sourceByteSize: number;
      sourceFileName: string;
    }
  | {
      requestId: string;
      ok: false;
      code?: string;
    };

function 创建默认源文件哈希Worker(): Worker {
  return new Worker("/dist/source-hash-worker.js", { type: "module" });
}

function 切片转Uint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array();
}

/**
 * 分块读取原始 File/Blob 字节并交给注入的 SHA-256 hasher。
 * 哈希内核必须来自成熟库；这里只负责浏览器文件流编排，不手搓 SHA-256。
 */
export async function 计算源文件SHA256(
  file: Blob,
  options: {
    createHasher(): Promise<源文件SHA256Hasher> | 源文件SHA256Hasher;
    chunkSize?: number;
  }
): Promise<string> {
  const hasher = await options.createHasher();
  const chunkSize = options.chunkSize ?? 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
    await hasher.update(切片转Uint8Array(chunk));
  }
  return hasher.digest("hex");
}

export async function 计算源文件SHA256经Worker(
  file: File,
  options: {
    createWorker?: () => 源文件哈希WorkerLike;
    requestId?: string;
  } = {}
): Promise<源文件哈希结果> {
  const worker = options.createWorker?.() ?? 创建默认源文件哈希Worker();
  const requestId =
    options.requestId ?? globalThis.crypto?.randomUUID?.() ?? `source-hash-${Date.now()}`;

  return new Promise<源文件哈希结果>((resolve, reject) => {
    const cleanup = (): void => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
    };
    const fail = (code = "source_hash_failed"): void => {
      cleanup();
      reject(new Error(code));
    };
    const handleMessage = (event: Event): void => {
      const data = (event as MessageEvent).data as 源文件哈希Worker响应;
      if (!data || data.requestId !== requestId) {
        return;
      }
      if (!data.ok) {
        fail(data.code ?? "source_hash_failed");
        return;
      }
      cleanup();
      resolve({
        sourceHash: data.sourceHash,
        sourceByteSize: data.sourceByteSize,
        sourceFileName: data.sourceFileName,
      });
    };
    const handleError = (): void => {
      fail("source_hash_failed");
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({
      type: "hash-file",
      requestId,
      file,
    });
  });
}
