import type {
  后台会话传输端口,
  后台查询传输端口,
  前端传输端口,
} from "../../平台/传输.js";
import { 聊天壳 } from "../../应用根/聊天壳.js";
import { 后台壳 } from "../../后台/壳.js";

type 聊天壳测试装配 = {
  设置测试传输(transport: 前端传输端口): void;
};

type 后台壳测试入口 = {
  kernel: unknown;
  requestUpdate(): void;
};

type 可重线后台内核 = {
  切换传输端口(transport: 后台查询传输端口 & 后台会话传输端口): void;
};

declare module "../../应用根/聊天壳.js" {
  interface 聊天壳 {
    setTransportForTest(transport: 前端传输端口): void;
  }
}

declare module "../../后台/壳.js" {
  interface 后台壳 {
    setTransportForTest(transport: 后台查询传输端口 & 后台会话传输端口): void;
    setKernelForTest(kernel: unknown): void;
  }
}

Object.defineProperty(聊天壳.prototype, "setTransportForTest", {
  configurable: true,
  value(this: 聊天壳, transport: 前端传输端口): void {
    ((this as unknown as { 装配: 聊天壳测试装配 }).装配).设置测试传输(transport);
  },
});

Object.defineProperty(后台壳.prototype, "setTransportForTest", {
  configurable: true,
  value(
    this: 后台壳,
    transport: 后台查询传输端口 & 后台会话传输端口
  ): void {
    ((this as unknown as 后台壳测试入口).kernel as 可重线后台内核).切换传输端口(transport);
  },
});

Object.defineProperty(后台壳.prototype, "setKernelForTest", {
  configurable: true,
  value(this: 后台壳, kernel: unknown): void {
    const shell = this as unknown as 后台壳测试入口;
    shell.kernel = kernel;
    shell.requestUpdate();
  },
});
