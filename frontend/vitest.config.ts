import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      debug: path.resolve(__dirname, "平台", "调试浏览器适配.ts"),
    },
    conditions: ["p2pml:core-as-bundle"],
  },
});
