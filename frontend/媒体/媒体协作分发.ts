import type { 媒体协作分发定位片段, 媒体定位结果 } from "../契约.js";

/**
 * Phase 1 这里只收口 locator 里的稳定分发片段：
 * 1. 现在还不创建 WebTorrent client；
 * 2. 现在还不拼 tracker announce / ticket；
 * 3. 这里只给后续播放器和协作分发运行时留一条稳定接缝。
 */
export function 读取协作分发定位片段(
  locator: 媒体定位结果
): 媒体协作分发定位片段 | null {
  return locator.distribution ?? null;
}
