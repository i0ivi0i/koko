pub struct LogEvent {
    source: &'static str,
    line: String,
}

impl LogEvent {
    pub fn new(source: &'static str, line: String) -> Self {
        Self { source, line }
    }
}

pub fn print_event(event: &LogEvent) {
    let suffix = if is_error(&event.line) {
        ":err"
    } else if is_warning(&event.line) {
        ":warn"
    } else {
        ""
    };

    println!("[{}{}] {}", event.source, suffix, event.line);
}

fn is_error(line: &str) -> bool {
    line.contains("error:") || line.contains("ERROR")
}

fn is_warning(line: &str) -> bool {
    if is_benign_wait_message(line) {
        return false;
    }

    line.contains("warning:") || line.contains("WARN")
}

fn is_benign_wait_message(line: &str) -> bool {
    line.contains("Waiting for cargo-metadata...")
        || (line.contains("warning:") && line.contains("Taking a while..."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cargo_metadata等待提示不应标成警告() {
        assert!(!is_warning("warning: Waiting for cargo-metadata..."));
        assert!(!is_warning("warning: (Try 1) Taking a while..."));
    }
}
