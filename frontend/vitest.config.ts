import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      debug: path.resolve(__dirname, "调试兼容.ts"),
    },
    conditions: ["p2pml:core-as-bundle"],
  },
});
