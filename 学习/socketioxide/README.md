# socketioxide 分馆

这里收 `socketioxide` 的 docs.rs 资料，重点是当前 crate 表面和 Socket 能力边界。

## 资料清单

- [crate-latest.md](./crate-latest.md)
  用来看当前 crate 的版本、特性和依赖入口。
- [api-latest.md](./api-latest.md)
  整个 API 的 docs.rs 总入口，适合回看模块表面。
- [socket-struct.md](./socket-struct.md)
  直接盯住 `Socket` 的 room、emit、ack 等能力边界。

## 建议阅读顺序

1. [crate-latest.md](./crate-latest.md)
2. [api-latest.md](./api-latest.md)
3. [socket-struct.md](./socket-struct.md)

## 这个分馆怎么用

- 先用 `crate-latest.md` 确认当前版本表面。
- 再用 `api-latest.md` 找模块入口。
- 最后用 `socket-struct.md` 回看具体实时能力，不要把运行时房间能力误当业务真相。
