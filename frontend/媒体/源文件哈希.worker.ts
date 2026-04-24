import { createSHA256 } from "hash-wasm";
import { 计算源文件SHA256 } from "./源文件哈希.js";

type 源文件哈希Worker请求 = {
  type?: string;
  requestId?: string;
  file?: File;
};

self.addEventListener("message", async (event: MessageEvent<源文件哈希Worker请求>) => {
  const { type, requestId, file } = event.data ?? {};
  if (type !== "hash-file" || !requestId || !(file instanceof File)) {
    return;
  }
  try {
    const sourceHash = await 计算源文件SHA256(file, {
      createHasher: async () => createSHA256(),
    });
    self.postMessage({
      requestId,
      ok: true,
      sourceHash,
      sourceByteSize: file.size,
      sourceFileName: file.name,
    });
  } catch {
    self.postMessage({ requestId, ok: false, code: "source_hash_failed" });
  }
});
