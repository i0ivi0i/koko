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
    line.contains("warning:") || line.contains("WARN")
}
