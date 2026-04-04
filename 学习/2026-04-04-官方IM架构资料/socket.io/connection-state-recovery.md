# 连接状态恢复 | Socket.IO

- 来源：https://socket.io/docs/v4/connection-state-recovery/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

文档连接状态恢复
版本：4.x
连接状态恢复

连接状态恢复功能允许在临时断开连接后恢复客户端的状态，包括任何丢失的数据包。

信息

此功能是4.6.0在 2023 年 2 月发布的版本中添加的。

发行说明请点击此处查看。

免责声明

在实际情况下，无论连接质量如何，Socket.IO 客户端都不可避免地会遇到暂时断开连接的情况。

此功能可帮助您应对此类断线情况，但请注意，恢复并非总是成功。因此，您仍然需要处理客户端和服务器状态必须同步的情况。

用法

服务器必须启用连接状态恢复功能：

const io = new Server(httpServer, {
  connectionStateRecovery: {
    // the backup duration of the sessions and the packets
    maxDisconnectionDuration: 2 * 60 * 1000,
    // whether to skip middlewares upon successful recovery
    skipMiddlewares: true,
  }
});

警告

连接状态恢复功能旨在处理间歇性断开连接的情况，因此请使用合理的值maxDisconnectionDuration。

如果发生意外断开连接（即没有手动断开连接socket.disconnect()），服务器将存储连接号id、房间和data套接字属性。

然后，当客户端重新连接时，服务器会尝试恢复客户端的状态。该recovered属性指示恢复是否成功：

服务器

io.on("connection", (socket) => {
  if (socket.recovered) {
    // recovery was successful: socket.id, socket.rooms and socket.data were restored
  } else {
    // new or unrecoverable session
  }
});

客户

socket.on("connect", () => {
  if (socket.recovered) {
    // any event missed during the disconnection period will be received now
  } else {
    // new or unrecoverable session
  }
});

您可以通过强制关闭底层引擎来检查恢复功能是否正常工作：

import { io } from "socket.io-client";

const socket = io({
  reconnectionDelay: 10000, // defaults to 1000
  reconnectionDelayMax: 10000 // defaults to 5000
});

socket.on("connect", () => {
  console.log("recovered?", socket.recovered);

  setTimeout(() => {
    if (socket.io.engine) {
      // close the low-level connection and trigger a reconnection
      socket.io.engine.close();
    }
  }, 10000);
});

提示

您也可以直接在浏览器中运行此示例：

CodeSandbox
StackBlitz
与现有适配器的
适配器	支持？
内置适配器（在内存中）	是的✅
Redis适配器	第一名​
Redis Streams 适配器	是的✅
MongoDB 适配器	是的 ✅（自版本起0.3.0）
Postgres适配器	进行中
集群适配器	进行中

[1]持久化数据包与 Redis PUB/SUB 机制不兼容。

其内部
服务器在握手期间发送会话 ID （这与现有的属性不同id，现有的属性是公开的，可以自由共享）。

例子：

40{"sid":"GNpWD7LbGCBNCr8GAAAB","pid":"YHcX2sdAF1z452-HAAAW"}

where

4         => the Engine.IO message type
0         => the Socket.IO CONNECT type
GN...AB   => the public id of the session
YH...AW   => the private id of the session

服务器还在每个数据包中包含一个偏移量（为了向后兼容，该偏移量添加到数据数组的末尾）。

例子：

42["foo","MzUPkW0"]

where

4         => the Engine.IO message type
2         => the Socket.IO EVENT type
foo       => the event name (socket.emit("foo"))
MzUPkW0   => the offset

笔记

为了使恢复成功，服务器必须至少发送一个事件，以便在客户端初始化偏移量。

临时断开连接时，服务器会将客户端状态存储一段时间（在适配器级别实现）。

重新连接后，客户端会发送会话 ID 和它处理的最后一个偏移量，服务器会尝试恢复状态。

例子：

40{"pid":"YHcX2sdAF1z452-HAAAW","offset":"MzUPkW0"}

where

4         => the Engine.IO message type
0         => the Socket.IO CONNECT type
YH...AW   => the private id of the session
MzUPkW0   => the last processed offset

编辑此页面
最后更新于2026年2月16日
以前的
交货保证
下一个
日志记录和调试
免责声明
用法
与现有适配器的兼容性
其底层工作原理

