// 官方浏览器预构建入口没有自带 d.ts，这里只补最薄的模块声明，
// 让项目继续直接复用官方产物，而不是再手搓一层私有包装。
declare module "webtorrent/dist/webtorrent.min.js";
// Node.js 入口供 characterization 测试和 dev-seeder 使用
declare module "webtorrent";
