import type { 后台登录结果 } from "../聊天共享/契约.js";
import type { 后台会话传输端口 } from "../传输.js";

export interface 后台会话快照 {
  username: string;
  password: string;
  token: string;
}

export interface 后台会话编排端口 {
  snapshot(): 后台会话快照;
  设置用户名(value: string): void;
  设置密码(value: string): void;
  登录(transport: 后台会话传输端口): Promise<后台登录结果>;
}

/**
 * 后台会话 owner 只拥有管理员登录输入和 token：
 * 1. 用户名/密码是本地会话态；
 * 2. 登录后只接住权威 token；
 * 3. 概览和房间读模型仍由查询 owner 负责。
 */
export function 创建后台会话编排(
  initial: Partial<后台会话快照> = {}
): 后台会话编排端口 {
  const state: 后台会话快照 = {
    username: initial.username ?? "admin",
    password: initial.password ?? "admin",
    token: initial.token ?? "",
  };

  return {
    snapshot(): 后台会话快照 {
      return { ...state };
    },

    设置用户名(value: string): void {
      state.username = value;
    },

    设置密码(value: string): void {
      state.password = value;
    },

    async 登录(transport: 后台会话传输端口): Promise<后台登录结果> {
      const out = await transport.adminLogin(state.username, state.password);
      state.token = out.token;
      return out;
    },
  };
}
