use std::process::ExitCode;

fn help_text() -> &'static str {
    "xtask\n\nUsage: cargo xtask [--help]\n\nMinimal workspace task runner placeholder."
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExitStatus {
    Success,
    Failure,
}

impl ExitStatus {
    fn code(self) -> ExitCode {
        match self {
            Self::Success => ExitCode::SUCCESS,
            Self::Failure => ExitCode::FAILURE,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Response {
    stream: OutputStream,
    message: String,
    exit_status: ExitStatus,
}

fn dispatch(args: impl IntoIterator<Item = String>) -> Response {
    let args = args.into_iter().collect::<Vec<_>>();

    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Response {
            stream: OutputStream::Stdout,
            message: help_text().to_owned(),
            exit_status: ExitStatus::Success,
        };
    }

    match args.first() {
        Some(command) => Response {
            stream: OutputStream::Stderr,
            message: format!("xtask placeholder: unknown or unimplemented command `{command}`"),
            exit_status: ExitStatus::Failure,
        },
        None => Response {
            stream: OutputStream::Stderr,
            message: "xtask placeholder: no command provided; use --help".to_owned(),
            exit_status: ExitStatus::Failure,
        },
    }
}

fn main() -> ExitCode {
    let response = dispatch(std::env::args().skip(1));

    match response.stream {
        OutputStream::Stdout => println!("{}", response.message),
        OutputStream::Stderr => eprintln!("{}", response.message),
    }

    response.exit_status.code()
}

#[cfg(test)]
mod tests {
    use super::{ExitStatus, OutputStream, dispatch, help_text};

    #[test]
    fn help_text_mentions_usage() {
        assert!(help_text().contains("Usage: cargo xtask"));
    }

    #[test]
    fn help_request_exits_successfully() {
        let response = dispatch(["--help".to_owned()]);
        assert_eq!(response.stream, OutputStream::Stdout);
        assert_eq!(response.exit_status, ExitStatus::Success);
    }

    #[test]
    fn missing_command_exits_with_failure() {
        let response = dispatch(Vec::<String>::new());
        assert_eq!(response.stream, OutputStream::Stderr);
        assert_eq!(response.exit_status, ExitStatus::Failure);
    }

    #[test]
    fn unknown_command_exits_with_failure() {
        let response = dispatch(["foo".to_owned()]);
        assert_eq!(response.stream, OutputStream::Stderr);
        assert_eq!(response.exit_status, ExitStatus::Failure);
    }
}
