//! The command line: `saf-kanban-cli --help`. See `saf_kanban_server::cli`.

fn main() -> std::process::ExitCode {
    saf_kanban_server::cli::main()
}
