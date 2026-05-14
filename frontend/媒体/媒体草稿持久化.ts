/**
 * 草稿 UI 状态的 localStorage 持久化层。
 *
 * 为什么用 localStorage 而非 IndexedDB：
 * 草稿列表 ≤9 条（媒体单条消息附件上限），JSON ≤2KB，
 * 同步读写更快、刷新后立即可用，不需要 async open/read。
 *
 * 为什么不复用 Golden Retriever：
 * GR 持久化的是 Uppy 文件状态（进度、meta、文件内容），
 * 但项目的草稿 UI 状态（localId、attachmentId、status）是独立于 Uppy 的数据结构。
 *
 * 不持久化的字段：
 * - sourceFile：File 对象不可序列化，刷新后浏览器安全限制无法恢复
 * - previewUrl：Blob URL 刷新后失效，恢复时需要重新生成
 */

const 存储键 = "koko_media_drafts";

/** SSR / 测试环境可能没有 localStorage */
const 可用localStorage = (): Storage | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

/**
 * 可序列化的草稿子集——不含 sourceFile（不可序列化）和 previewUrl（刷新后失效）。
 */
export type 可持久化媒体草稿 = {
  localId: string;
  kind: "image" | "video";
  attachmentId: string;
  width: number;
  height: number;
  status: string;
  fileName: string;
  errorCode: string;
};

/**
 * 将当前草稿列表快照写入 localStorage。
 * 空列表时主动清除条目，避免残留旧数据误导恢复逻辑。
 */
export function 保存媒体草稿到本地存储(drafts: 可持久化媒体草稿[]): void {
  const storage = 可用localStorage();
  if (!storage) return;
  if (drafts.length === 0) {
    storage.removeItem(存储键);
    return;
  }
  try {
    storage.setItem(存储键, JSON.stringify(drafts));
  } catch {
    // localStorage 满了不应阻断上传主链——草稿丢失优于上传失败
  }
}

/**
 * 从 localStorage 恢复草稿列表。
 * 对损坏数据做防御性过滤：只保留包含 localId + kind 的合法条目。
 */
export function 从本地存储恢复媒体草稿(): 可持久化媒体草稿[] {
  const storage = 可用localStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(存储键);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is 可持久化媒体草稿 =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).localId === "string" &&
        typeof (item as Record<string, unknown>).kind === "string"
    );
  } catch {
    return [];
  }
}

/**
 * 清除 localStorage 中的草稿条目。
 * 在发送成功或用户主动清空草稿时调用。
 */
export function 清除本地存储媒体草稿(): void {
  可用localStorage()?.removeItem(存储键);
}
