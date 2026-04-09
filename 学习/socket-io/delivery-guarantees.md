# 交付保证 | Socket.IO

- 来源：https://socket.io/docs/v4/delivery-guarantees/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

文档交货保证
版本：4.x
交货保证
消息排序

无论使用哪种底层传输方式（即使是从 HTTP 长轮询升级到 WebSocket），Socket.IO 都能保证消息顺序。

这是通过以下方式实现的：

底层 TCP 连接提供的保证
精心设计的升级机制

例子：

socket.emit("event1");
socket.emit("event2");
socket.emit("event3");

在上面的例子中，事件总是会以相同的顺序被对方接收（前提是它们确实到达，见下文）。

消息到达
最多一次

默认情况下，Socket.IO最多只保证一次数据传输：

如果在发送事件的过程中连接中断，则无法保证对方已收到该事件，并且重新连接后不会重试。
断开连接的客户端会缓存事件，直到重新连接（但前一点仍然适用）。
服务器端没有这样的缓冲区，这意味着断开连接的客户端错过的任何事件都不会在重新连接后传输给该客户端。
信息

目前，您的应用程序中必须实施额外的交付保证。

至少一次
从客户端到服务器

从客户端角度来看，您可以通过以下选项实现至少一次的retries保证：

const socket = io({
  retries: 3,
  ackTimeout: 10000
});

客户端将尝试发送事件（最多retries + 1多次），直到收到服务器的确认为止。

警告

即使在这种情况下，如果用户刷新标签页，任何待处理的事件都会丢失。

从服务器到客户端

对于服务器发送的事件，可以通过以下方式实现额外的送达保证：

为每个事件分配一个唯一 ID
将事件持久化到数据库中
存储客户端上次接收到的事件的偏移量，并在重新连接时发送该偏移量。

例子：

客户

const socket = io({
  auth: {
    offset: undefined
  }
});

socket.on("my-event", ({ id, data }) => {
  // do something with the data, and then update the offset
  socket.auth.offset = id;
});

服务器

io.on("connection", async (socket) => {
  const offset = socket.handshake.auth.offset;
  if (offset) {
    // this is a reconnection
    for (const event of await fetchMissedEventsFromDatabase(offset)) {
      socket.emit("my-event", event);
    }
  } else {
    // this is a first connection
  }
});

setInterval(async () => {
  const event = {
    id: generateUniqueId(),
    data: new Date().toISOString()
  }

  await persistEventToDatabase(event);
  io.emit("my-event", event);
}, 1000);

实现缺失的方法（fetchMissedEventsFromDatabase()，generateUniqueId()和persistEventToDatabase()）与数据库有关，留给读者作为练习。

参考：

socket.auth（客户）
socket.handshake（服务器）
编辑此页面
最后更新于2026年2月16日
以前的
工作原理
下一个
连接状态恢复
消息排序
消息已到达
最多一次
至少一次
从客户端到服务器
从服务器到客户端

