# socketioxide::socket 中的 Socket - Rust

- 来源：https://docs.rs/socketioxide/latest/socketioxide/socket/struct.Socket.html
- 抓取日期：2026-04-04
- 抓取方式：Chrome CDP 正文抽取

---

socketioxide ::插座
结构插座 复制项目路径
来源
搜索
设置
帮助
概括
pub struct Socket<A: Adapter = LocalAdapter> {
    pub id: Sid,
    pub extensions: Extensions,
    /* private fields */
}

Socket 表示连接到命名空间的客户端。它用于向客户端发送和接收消息、加入和离开房间等。Socket 结构本身不应该直接使用，而应该通过SocketRef.

田野
id: Sid

套接字 ID

extensions: Extensions
仅限箱子功能extensions。

协议扩展的类型映射。它可用于在套接字的生命周期内共享数据。

注意extensions：这与结构体中的字段数据不同http::Request::extensions()。如果要从 HTTP 请求中提取扩展名，应该使用HttpExtension提取器。

实施方案
来源
impl<A:适配器>套接字<A>
来源
pub fn on <H, T>(&self, event: impl Into < Cow <'static, str >>, handler: H)
其中 H: MessageHandler <A, T>, T: Send + Sync + 'static,
注册MessageHandler给定事件。
message有关消息处理程序的更多详细信息，请参阅模块文档。
extract有关可用提取器的更多详细信息，请参阅模块文档。

为了使代码更清晰，建议将处理程序定义为顶级函数，而不是闭包。

使用异步闭包和异步函数的简单示例：
#[derive(Debug, Serialize, Deserialize)]
struct MyData {
    name: String,
    age: u8,
}
async fn handler(socket: SocketRef, Data(data): Data::<MyData>) {
    println!("Received a test message {:?}", data);
    socket.emit("test-test", &MyData { name: "Test".to_string(), age: 8 }).ok(); // Emit a message to the client
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| {
    // Register a handler for the "test" event and extract the data as a `MyData` struct
    // With the Data extractor, the handler is called only if the data can be deserialized as a `MyData` struct
    // If you want to manage errors yourself you can use the TryData extractor
    socket.on("test", async |socket: SocketRef, Data::<MyData>(data)| {
        println!("Received a test message {:?}", data);
        socket.emit("test-test", &MyData { name: "Test".to_string(), age: 8 }).ok(); // Emit a message to the client
    });
    // Do the same thing but with an async function
    socket.on("test_2", handler);
});

示例：使用闭包和带有确认信息及二进制数据的函数：
#[derive(Debug, Serialize, Deserialize)]
struct MyData {
    name: String,
    age: u8,
}
async fn handler(socket: SocketRef, Data(data): Data::<MyData>, ack: AckSender) {
    println!("Received a test message {:?}", data);
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    ack.send(&data).ok(); // The data received is sent back to the client through the ack
    socket.emit("test-test", &MyData { name: "Test".to_string(), age: 8 }).ok(); // Emit a message to the client
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| {
    // Register an async handler for the "test" event and extract the data as a `MyData` struct
    // Extract the binary payload as a `Vec<Bytes>` with the Bin extractor.
    // It should be the last extractor because it consumes the request
    socket.on("test", async |socket: SocketRef, Data::<MyData>(data), ack: AckSender| {
        println!("Received a test message {:?}", data);
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        ack.send(&data).ok(); // The data received is sent back to the client through the ack
        socket.emit("test-test", &MyData { name: "Test".to_string(), age: 8 }).ok(); // Emit a message to the client
    });
    // Do the same thing but with an async function
    socket.on("test_2", handler);
});
来源
pub fn on_fallback <H, T>(&self, handler: H)
其中 H: MessageHandler <A, T>, T: Send + Sync + 'static,
注册一个备用处理程序MessageHandler，用于在找不到其他处理程序时返回错误信息。您可以将其视为 404 错误处理程序。

每个套接字只能注册一个备用处理程序。如果注册了多个处理程序，则只会使用最后一个。

message有关消息处理程序的更多详细信息，请参阅模块文档。
extract有关可用提取器的更多详细信息，请参阅模块文档。

为了使代码更清晰，建议将处理程序定义为顶级函数，而不是闭包。

例子：
async fn fallback_handler(socket: SocketRef, Event(event): Event, Data(data): Data::<Value>) {
    println!("Received an {event} event with message {:?}", data);
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| {
    // Register a fallback handler.
    // In our example it will be always called as there is no other handler.
    socket.on_fallback(fallback_handler);
});

来源
pub fn on_disconnect <C, T>(&self, callback: C)
其中 C: DisconnectHandler <A, T> + Send + Sync + 'static, T: Send + Sync + 'static,
注册一个断开连接处理程序。

You can register only one disconnect handler per socket. If you register multiple handlers, only the last one will be used.

This implementation is slightly different to the socket.io spec. The difference being that rooms are still available in this handler and only cleaned up AFTER the execution of this handler. Therefore you must not indefinitely stall/hang this handler, for example by entering an endless loop.

It is recommended for code clarity to define your handler as top level function rather than closures.

See the disconnect module doc for more details on disconnect handler.
See the extract module doc for more details on available extractors.

The callback will be called when the socket is disconnected from the server or the client or when the underlying connection crashes. A DisconnectReason is passed to the callback to indicate the reason for the disconnection.

Example
let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| {
    socket.on("test", async |socket: SocketRef| {
        // Close the current socket
        socket.disconnect().ok();
    });
    socket.on_disconnect(async |socket: SocketRef, reason: DisconnectReason| {
        println!("Socket {} on ns {} disconnected, reason: {:?}", socket.id, socket.ns(), reason);
    });
});
Source
pub fn emit<T: ?Sized + Serialize>(
    &self,
    event: impl AsRef<str>,
    data: &T,
) -> Result<(), SendError>
Emit a message to one or many clients

If you provide tuple-like data (tuples, arrays), it will be considered as multiple arguments. Therefore, if you want to send an array as the first argument of the payload, you need to wrap it in an array or a tuple. A Vec will always be considered a single argument.

Emitting binary data

To emit binary data, you must use a data type that implements Serialize as binary data. Currently, if you use Vec<u8>, it will be considered a sequence of numbers rather than binary data. To handle this, you can either use a special type like Bytes or the serde_bytes crate. If you want to emit generic data that may contain binary, use rmpv::Value instead of serde_json::Value, as binary data will otherwise be serialized as a sequence of numbers.

Errors
When encoding the data, a SendError::Serialize may be returned.
If the underlying engine.io connection is closed, a SendError::Socket(SocketError::Closed) will be returned, and the data you attempted to send will be included in the error.
If the packet buffer is full, a SendError::Socket(SocketError::InternalChannelFull) will be returned, and the data you attempted to send will be included in the error. See the SocketIoBuilder::max_buffer_size option for more information on internal buffer configuration.
Single-socket example
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // Emit a test message to the client
    socket.emit("test", &data).ok();
    // Emit a test message with multiple arguments to the client
    socket.emit("test", &("world", "hello", 1)).ok();
    // Emit a test message with an array as the first argument
    let arr = [1, 2, 3, 4];
    socket.emit("test", &[arr]).ok();
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| socket.on("test", handler));
Single-socket binary example with the bytes crate
async fn handler(socket: SocketRef, Data(data): Data::<(String, Bytes, Bytes)>) {
    // Emit a test message to the client
    socket.emit("test", &data).ok();
    // Emit a test message with multiple arguments to the client
    socket.emit("test", &("world", "hello", Bytes::from_static(&[1, 2, 3, 4]))).ok();
    // Emit a test message with an array as the first argument
    let arr = [1, 2, 3, 4];
    socket.emit("test", &[arr]).ok();
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| socket.on("test", handler));
Broadcast example

Here the emit method will return a Future that must be awaited because socket.io may communicate with remote instances if you use horizontal scaling through remote adapters.

async fn handler(socket: SocketRef, Data(data): Data::<(String, Bytes, Bytes)>) {
    // Emit a test message in the room1 and room3 rooms, except for room2, with the received binary payload
    socket.to("room1").to("room3").except("room2").emit("test", &data).await;

    // Emit a test message with multiple arguments to the client
    socket.to("room1").emit("test", &("world", "hello", 1)).await;

    // Emit a test message with an array as the first argument
    let arr = [1, 2, 3, 4];
    socket.to("room2").emit("test", &[arr]).await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn emit_with_ack<T: ?Sized + Serialize, V>(
    &self,
    event: impl AsRef<str>,
    data: &T,
) -> Result<AckStream<V>, SendError>
Emit a message to one or many clients and wait for one or more acknowledgments.

See emit() for more details on emitting messages.

The acknowledgment has a timeout specified in the config (5 seconds by default) (see SocketIoBuilder::ack_timeout) or can be set with the timeout() operator.

To receive acknowledgments, an AckStream is returned. It can be used in two ways:

As a Stream: This will yield all the acknowledgment responses, along with the corresponding socket ID, received from the client. This is useful when broadcasting to multiple sockets and expecting more than one acknowledgment. To get the socket from this ID, use io::get_socket().
As a Future: This will yield the first acknowledgment response received from the client, useful when expecting only one acknowledgment.
Errors

If packet encoding fails, an ParserError is immediately returned.

If the socket is full or if it is closed before receiving the acknowledgment, a SendError::Socket will be immediately returned, and the value to send will be given back.

If the client does not respond before the timeout, the AckStream will yield an AckError::Timeout. If the data sent by the client is not deserializable as V, an AckError::Decode will be yielded.

Single-socket example
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // Emit a test message and wait for an acknowledgment with the timeout specified in the global config
    match socket.emit_with_ack::<_, Value>("test", &data).unwrap().await {
        Ok(ack) => println!("Ack received {:?}", ack),
        Err(err) => println!("Ack error {:?}", err),
    }
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| socket.on("test", handler));
Single-socket example with custom acknowledgment timeout
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // Emit a test message and wait for an acknowledgment with the timeout specified here
    match socket.timeout(Duration::from_millis(2)).emit_with_ack::<_, Value>("test", &data).unwrap().await {
        Ok(ack) => println!("Ack received {:?}", ack),
        Err(err) => println!("Ack error {:?}", err),
    }
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| socket.on("test", handler));
Broadcast example

Here the emit method will return a Future that must be awaited because socket.io may communicate with remote instances if you use horizontal scaling through remote adapters.

async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // Emit a test message in the room1 and room3 rooms,
    // except for room2, with the binary payload received
    let ack_stream = socket.to("room1")
        .to("room3")
        .except("room2")
        .emit_with_ack::<_, String>("message-back", &data)
        .await
        .unwrap();
    ack_stream.for_each(async |(id, ack)| {
        match ack {
            Ok(ack) => println!("Ack received, socket {} {:?}", id, ack),
            Err(err) => println!("Ack error, socket {} {:?}", id, err),
        }
    }).await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn join(&self, rooms: impl RoomParam)
Add the current socket to the specified room(s).
Example
async fn handler(socket: SocketRef) {
    // Add all sockets that are in room1 and room3 to room4 and room5
    socket.join(["room4", "room5"]);
    // We should retrieve all the local sockets that are in room3 and room5
    let sockets = socket.within("room4").within("room5").sockets();
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn leave(&self, rooms: impl RoomParam)
Remove the current socket from the specified room(s).
Example
async fn handler(socket: SocketRef) {
    // Remove all sockets that are in room1 and room3 from room4 and room5
    socket.within("room1").within("room3").leave(["room4", "room5"]);
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn leave_all(&self)
Remove the current socket from all its rooms.
Source
pub fn rooms(&self) -> Vec<Room> ⓘ
Get all room names this socket is connected to.
Example
async fn handler(socket: SocketRef) {
    println!("Socket connected to the / namespace with id: {}", socket.id);
    socket.join(["room1", "room2"]);
    let rooms = socket.rooms();
    println!("All rooms in the / namespace: {:?}", rooms);
}

let (_, io) = SocketIo::new_svc();
io.ns("/", handler);
Source
pub fn connected(&self) -> bool
Return true if the socket is connected to the namespace.

A socket is considered connected when it has been successfully handshaked with the server and that all connect middlewares have been executed.

Source
pub fn to(&self, rooms: impl RoomParam) -> BroadcastOperators<A>
Select all the sockets in the given rooms except for the current socket.

When called from a socket, if you want to also include it, use the within() operator.

However, when called from the io (global context) level, there will be no difference.

Example
async fn handler(socket: SocketRef, io: SocketIo, Data(data): Data::<Value>) {
    // Emit a message to all sockets in room1, room2, room3, and room4, except the current socket
    socket
        .to("room1")
        .to(["room2", "room3"])
        .emit("test", &data)
        .await;

    // Emit a message to all sockets in room1, room2, room3, and room4, including the current socket
    io
        .to("room1")
        .to(["room2", "room3"])
        .emit("test", &data)
        .await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn within(&self, rooms: impl RoomParam) -> BroadcastOperators<A>
Select all the sockets in the given rooms (current one included).

This includes the current socket, in contrast to the to() operator.

However, when called from the io (global context) level, there will be no difference.

Example
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    let other_rooms = "room4".to_string();
    // Emit a message to all sockets in room1, room2, room3, and room4, including the current socket
    socket
        .within("room1")
        .within(["room2", "room3"])
        .within(vec![other_rooms])
        .emit("test", &data)
        .await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn except(&self, rooms: impl RoomParam) -> BroadcastOperators<A>
Filter out all sockets selected with the previous operators that are in the specified rooms.
Example
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // This message will be broadcast to all sockets in the namespace,
    // except for those in room1 and the current socket
    socket.broadcast().except("room1").emit("test", &data).await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef| {
    socket.on("register1", async |s: SocketRef| s.join("room1"));
    socket.on("register2", async |s: SocketRef| s.join("room2"));
    socket.on("test", handler);
});
Source
pub fn local(&self) -> BroadcastOperators<A>
Broadcast to all sockets only connected to this node.

When using the default in-memory adapter, this operator is a no-op.

Example
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // This message will be broadcast to all sockets in this
    // namespace that are connected to this node
    socket.local().emit("test", &data).await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn timeout(&self, timeout: Duration) -> ConfOperators<'_, A>
Set a custom timeout when sending a message with an acknowledgement.
See SocketIoBuilder::ack_timeout for the default timeout.
See emit_with_ack() for more details on acknowledgements.
Example
async fn handler(socket: SocketRef, Data(data): Data::<Value>) {
    // Emit a test message in the room1 and room3 rooms, except for the room2
    // room with the binary payload received, and wait for 5 seconds for an acknowledgement
    socket.to("room1")
          .to("room3")
          .except("room2")
          .timeout(Duration::from_secs(5))
          .emit_with_ack::<_, Value>("message-back", &data)
          .await
          .unwrap()
          .for_each(async |(id, ack)| {
            match ack {
                Ok(ack) => println!("Ack received from socket {}: {:?}", id, ack),
                Err(err) => println!("Ack error from socket {}: {:?}", id, err),
            }
          }).await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn broadcast(&self) -> BroadcastOperators<A>
Broadcast to all sockets without any filtering (except the current socket).

If you want to include the current socket use the broadcast operators from the io global context.

Example
async fn handler(io: SocketIo, socket: SocketRef, Data(data): Data::<Value>) {
    // This message will be broadcast to all sockets in this namespace except this one.
    socket.broadcast().emit("test", &data).await;
    // This message will be broadcast to all sockets in this namespace, including this one.
    io.emit("test", &data).await;
}

let (_, io) = SocketIo::new_svc();
io.ns("/", async |s: SocketRef| s.on("test", handler));
Source
pub fn disconnect(self: Arc<Self>) -> Result<(), SocketError>
Disconnect the socket from the current namespace,

It will also call the disconnect handler if it is set with a DisconnectReason::ServerNSDisconnect.

Source
pub fn req_parts(&self) -> &Parts
Get the request info made by the client to connect.

It might be used to retrieve the http::Extensions

Source
pub fn transport_type(&self) -> TransportType
Get the TransportType used by the client to connect with this Socket.

It can also be accessed as an extractor

Example

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef, transport: TransportType| {
    assert_eq!(socket.transport_type(), transport);
});
Source
pub fn protocol(&self) -> ProtocolVersion

Get the socket.io ProtocolVersion used by the client to connect with this Socket.

It can also be accessed as an extractor:

Example

let (_, io) = SocketIo::new_svc();
io.ns("/", async |socket: SocketRef, v: ProtocolVersion| {
    assert_eq!(socket.protocol(), v);
});
Source
pub fn ns(&self) -> &str
Get the socket namespace path.
Trait Implementations
Source
impl<A: Adapter> Debug for Socket<A>
Source
fn fmt(&self, f: &mut Formatter<'_>) -> Result
Formats the value using the given formatter. Read more
Source
impl<A: Adapter> PartialEq for Socket<A>
Source
fn eq(&self, other: &Self) -> bool
Tests for self and other values to be equal, and is used by ==.
1.0.0 · Source
fn ne(&self, other: &Rhs) -> bool
Tests for !=. The default implementation is almost always sufficient, and should not be overridden without very good reason.
Auto Trait Implementations
impl<A = LocalAdapter> !Freeze for Socket<A>
impl<A = LocalAdapter> !RefUnwindSafe for Socket<A>
impl<A> Send for Socket<A>
impl<A> Sync for Socket<A>
impl<A> Unpin for Socket<A>
impl<A = LocalAdapter> !UnwindSafe for Socket<A>
Blanket Implementations
Source
impl<T> Any for T
where
    T: 'static + ?Sized,
Source
impl<T> Borrow<T> for T
where
    T: ?Sized,
Source
impl<T> BorrowMut<T> for T
where
    T: ?Sized,
Source
impl<T> From<T> for T
Source
impl<T> Instrument for T
来源
impl<T, U> Into <U> for T
其中 U：来自<T>，
来源
impl<T>对 T也一样
来源
impl<T, U> TryFrom <U> for T
其中 U：进入<T>，
来源
impl<T, U> TryInto <U> for T
其中 U: TryFrom <T>，
来源
impl<V, T> VZip <V> for T
其中 V：多车道<T>，
来源
impl<T> WithSubscriber for T

