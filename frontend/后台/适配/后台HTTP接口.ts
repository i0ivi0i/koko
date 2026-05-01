import type { 后台概览, 后台房间列表, 后台房间详情, 后台登录结果 } from "../../聊天共享/契约.js";

type 读取JSON = <T>(path: string, headers?: Record<string, string>) => Promise<T>;
type 提交JSON = <T>(path: string, body: object) => Promise<T>;

export interface 后台HTTP接口依赖 {
  get: 读取JSON;
  post: 提交JSON;
}

/**
 * 后台 HTTP 接口继续只是管理员冷路径适配：
 * 1. 它只翻译后台登录、概览、房间查询接口；
 * 2. 不接管聊天室主链，也不参与恢复语义；
 * 3. 物理目录上也必须和后台 owner 放在一起，避免再次混入聊天操作台。
 */
export class 后台HTTP接口 {
  constructor(private readonly deps: 后台HTTP接口依赖) {}

  async loadAdminOverview(token: string): Promise<后台概览> {
    return this.deps.get("/api/admin/overview", { "x-admin-token": token });
  }

  async adminLogin(username: string, password: string): Promise<后台登录结果> {
    return this.deps.post("/api/admin/login", { username, password });
  }

  async adminRooms(token: string): Promise<后台房间列表> {
    return this.deps.get("/api/admin/rooms", { "x-admin-token": token });
  }

  async adminRoomDetail(token: string, roomId: string): Promise<后台房间详情> {
    return this.deps.get(`/api/admin/rooms/${roomId}`, { "x-admin-token": token });
  }
}
