# 房间 | Socket.IO

- 来源：https://socket.io/docs/v4/rooms/
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

活动房间
版本：4.x
房间

房间是套接字可以访问的任意通道。它可以用来向一部分客户端广播事件：joinleave

信息

请注意，房间是服务器端独有的概念（即客户端无法访问其已加入的房间列表）。

加入和离开

你可以调用以下方法join将套接字订阅到指定的通道：

io.on("connection", (socket) => {
  socket.join("some room");
});

然后，在广播或发送消息时，只需使用toor in（它们是相同的）：

io.to("some room").emit("some event");

或者排除某个房间：

io.except("some room").emit("some event");

您还可以同时向多个房间发送消息：

io.to("room1").to("room2").to("room3").emit("some event");

在这种情况下，将执行联合操作：每个至少在一个房间中的套接字都会收到一次事件（即使套接字在两个或多个房间中）。

您还可以通过指定的套接字向房间广播信息：

io.on("connection", (socket) => {
  socket.to("some room").emit("some event");
});

在这种情况下，除了发送者之外，房间里的每个套接字都会收到该事件。

要离开频道，你leave使用与 相同的方式进行呼叫join。

示例用例
向给定用户的每个设备/标签页广播数据
function computeUserIdFromHeaders(headers) {
  // to be implemented
}

io.on("connection", async (socket) => {
  const userId = await computeUserIdFromHeaders(socket.handshake.headers);

  socket.join(userId);

  // and then later
  io.to(userId).emit("hi");
});

发送有关指定实体的通知
io.on("connection", async (socket) => {
  const projects = await fetchProjects(socket);

  projects.forEach(project => socket.join("project:" + project.id));

  // and then later
  io.to("project:4321").emit("project updated");
});

断开连接

断开连接后，插座会leave自动断开它们所属的所有通道，您无需进行任何特殊拆卸。

您可以通过监听事件来获取 Socket 所在的房间disconnecting：

io.on("connection", socket => {
  socket.on("disconnecting", () => {
    console.log(socket.rooms); // the Set contains at least the socket ID
  });

  socket.on("disconnect", () => {
    // socket.rooms.size === 0
  });
});

使用多个 Socket.IO服务器

与全球广播类似，向房间广播也支持多个 Socket.IO 服务器。

您只需将默认适配器替换为 Redis 适配器即可。更多信息请点击此处。

实施细节

“房间”功能是通过我们称之为适配器的组件实现的。该适配器是一个服务器端组件，负责：

存储 Socket 实例和房间之间的关系
向所有（或部分）客户端广播事件

您可以在这里找到默认内存适配器的代码。

它主要由两个ES6 Map组成：

sids：Map<SocketId, Set<Room>>
rooms：Map<Room, Set<SocketId>>

拨打电话socket.join("the-room")将导致：

在sids地图中，将“the-room”添加到由插槽 ID 标识的集合中
在roomsMap 中，添加由字符串“the-room”标识的 Set 中的 socket ID

广播时会用到这两张地图：

向所有套接字广播（io.emit()）会遍历sidsMap，并将数据包发送到所有套接字。
向指定房间（）的广播io.to("room21").emit()会遍历 Map 中的 Set rooms，并将数据包发送到所有匹配的套接字。

您可以使用以下方式访问这些对象：

// main namespace
const rooms = io.of("/").adapter.rooms;
const sids = io.of("/").adapter.sids;

// custom namespace
const rooms = io.of("/my-namespace").adapter.rooms;
const sids = io.of("/my-namespace").adapter.sids;

笔记：

这些对象不应该直接修改，你应该始终使用socket.join(...)andsocket.leave(...)代替。
在多服务器设置中，` roomsand`sids对象不会在 Socket.IO 服务器之间共享（一个房间可能只“存在于”一个服务器上，而不存在于另一个服务器上）。
房间事件

从此开始socket.io@3.1.0，底层适配器将发出以下事件：

create-room（论点：房间）
delete-room（论点：房间）
join-room（参数：房间，ID）
leave-room（参数：房间，ID）

例子：

io.of("/").adapter.on("create-room", (room) => {
  console.log(`room ${room} was created`);
});

io.of("/").adapter.on("join-room", (room, id) => {
  console.log(`socket ${id} has joined room ${room}`);
});

编辑此页面
最后更新于2026年2月16日
以前的
广播活动
下一个
介绍
加入和离开
示例用例
断开
使用多个 Socket.IO 服务器
实施细节
房间事件

