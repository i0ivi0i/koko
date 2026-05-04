fn main() {
    // SQLx 的 migrate! 会把 migrations 目录嵌入编译产物。
    // 这里显式声明目录依赖，避免只改数据库基线时 Cargo 复用旧构建结果。
    println!("cargo:rerun-if-changed=migrations");
}
