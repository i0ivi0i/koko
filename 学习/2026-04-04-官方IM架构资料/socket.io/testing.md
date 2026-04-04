# 测试 | Socket.IO

- 来源：https://socket.io/docs/v4/testing/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

文档测试
版本：4.x
测试

下面您将找到一些使用常用测试库的代码示例：

摩卡
笑话
磁带
维特斯
CommonJS
ES模块
TypeScript

安装：

npm install --save-dev mocha chai

测试套件：

test/basic.js
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const ioc = require("socket.io-client");
const { assert } = require("chai");

function waitFor(socket, event) {
  return new Promise((resolve) => {
    socket.once(event, resolve);
  });
}

describe("my awesome project", () => {
  let io, serverSocket, clientSocket;

  before((done) => {
    const httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = ioc(`http://localhost:${port}`);
      io.on("connection", (socket) => {
        serverSocket = socket;
      });
      clientSocket.on("connect", done);
    });
  });

  after(() => {
    io.close();
    clientSocket.disconnect();
  });

  it("should work", (done) => {
    clientSocket.on("hello", (arg) => {
      assert.equal(arg, "world");
      done();
    });
    serverSocket.emit("hello", "world");
  });

  it("should work with an acknowledgement", (done) => {
    serverSocket.on("hi", (cb) => {
      cb("hola");
    });
    clientSocket.emit("hi", (arg) => {
      assert.equal(arg, "hola");
      done();
    });
  });

  it("should work with emitWithAck()", async () => {
    serverSocket.on("foo", (cb) => {
      cb("bar");
    });
    const result = await clientSocket.emitWithAck("foo");
    assert.equal(result, "bar");
  });

  it("should work with waitFor()", () => {
    clientSocket.emit("baz");

    return waitFor(serverSocket, "baz");
  });
});

参考资料：https://mochajs.org/

编辑此页面
最后更新于2026年2月16日
以前的
日志记录和调试
下一个
故障排除

