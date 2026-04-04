# Emitting events | Socket.IO

- 来源：https://socket.io/docs/v4/emitting-events/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

活动发射事件
版本：4.x
发射事件

服务器和客户端之间可以通过多种方式发送事件。

提示

对于 TypeScript 用户，可以为事件提供类型提示。请查看此处。

基本发射

Socket.IO API 的设计灵感来源于 Node.js EventEmitter，这意味着你可以在一端发出事件，并在另一端注册监听器：

服务器

io.on("connection", (socket) => {
  socket.emit("hello", "world");
});

客户

socket.on("hello", (arg) => {
  console.log(arg); // world
});

反过来也一样：

服务器

io.on("connection", (socket) => {
  socket.on("hello", (arg) => {
    console.log(arg); // world
  });
});

客户

socket.emit("hello", "world");

您可以发送任意数量的参数，并且支持所有可序列化的数据结构，包括Buffer或TypedArray等二进制对象。

服务器

io.on("connection", (socket) => {
  socket.emit("hello", 1, "2", { 3: '4', 5: Buffer.from([6]) });
});

客户

// client-side
socket.on("hello", (arg1, arg2, arg3) => {
  console.log(arg1); // 1
  console.log(arg2); // "2"
  console.log(arg3); // { 3: '4', 5: ArrayBuffer (1) [ 6 ] }
});

无需JSON.stringify()对对象进行任何操作，系统会自动完成。

// BAD
socket.emit("hello", JSON.stringify({ name: "John" }));

// GOOD
socket.emit("hello", { name: "John" });

笔记：

Date对象将被转换为（并以）其字符串表示形式接收，例如：1970-01-01T00:00:00.000Z

Map和Set必须手动序列化：

const serializedMap = [...myMap.entries()];
const serializedSet = [...mySet.keys()];

您可以使用该toJSON()方法自定义对象的序列化。

以类为例：

class Hero {
  #hp;

  constructor() {
    this.#hp = 42;
  }

  toJSON() {
    return { hp: this.#hp };
  }
}

socket.emit("here's a hero", new Hero());

致谢

事件机制固然好用，但在某些情况下，您可能需要更传统的请求-响应式 API。在 Socket.IO 中，此功能称为确认机制。

你可以将回调函数作为最后一个参数添加emit()，一旦对方确认事件，就会调用这个回调函数：

服务器

io.on("connection", (socket) => {
  socket.on("update item", (arg1, arg2, callback) => {
    console.log(arg1); // 1
    console.log(arg2); // { name: "updated" }
    callback({
      status: "ok"
    });
  });
});

客户

socket.emit("update item", "1", { name: "updated" }, (response) => {
  console.log(response.status); // ok
});

超时

从 Socket.IO v4.4.0 开始，现在可以为每个 emit 事件设置超时时间：

socket.timeout(5000).emit("my-event", (err) => {
  if (err) {
    // the other side did not acknowledge the event in the given delay
  }
});

您也可以同时使用超时和确认机制：

socket.timeout(5000).emit("my-event", (err, response) => {
  if (err) {
    // the other side did not acknowledge the event in the given delay
  } else {
    console.log(response);
  }
});

剧烈事件

不稳定事件是指如果底层连接未准备就绪，则不会发送的事件（在可靠性方面有点像UDP ）。

例如，如果您需要发送在线游戏中角色的位置（因为只有最新的值才有用），这可能会很有趣。

socket.volatile.emit("hello", "might or might not be received");

另一个用例是当客户端未连接时丢弃事件（默认情况下，事件会被缓冲，直到重新连接）。

例子：

服务器

io.on("connection", (socket) => {
  console.log("connect");

  socket.on("ping", (count) => {
    console.log(count);
  });
});

客户

let count = 0;
setInterval(() => {
  socket.volatile.emit("ping", ++count);
}, 1000);

如果重启服务器，您将在控制台中看到：

connect
1
2
3
4
# the server is restarted, the client automatically reconnects
connect
9
10
11

如果没有这volatile面旗帜，你会看到：

connect
1
2
3
4
# the server is restarted, the client automatically reconnects and sends its buffered events
connect
5
6
7
8
9
10
11

编辑此页面
最后更新于2026年2月16日
以前的
与打包器一起使用
下一个
聆听事件
基本发射
致谢
超时
剧烈事件

