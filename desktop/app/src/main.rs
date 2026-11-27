//! SAF Kanban for the desktop: the local server (`saf-kanban-server`) and a
//! window showing its web UI, in one program.
//!
//!   saf-kanban [--hidden] [--data-dir DIR] [--port PORT]
//!   saf-kanban mcp [--data-dir DIR]
//!
//! Closing the window keeps the program running in the notification area, so
//! AI agents and other programs can go on using the boards; "Quit" in its menu
//! there stops it. `mcp` is for AI apps that start an MCP server as a program
//! (see `saf_kanban_server::bridge`): it opens no window.

// No console window on Windows. Its standard input and output still work when
// another program starts it with pipes, which is how `mcp` is used.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod updater;
mod window_state;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use saf_kanban_server::updater::UpdateHandle;
use saf_kanban_server::{bridge, default_data_dir, skill, Options, Server, UiFiles, DEFAULT_PORT};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::NewWindowResponse;
use tauri::{
    App, AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, Url, WebviewUrl,
    WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use window_state::{
    MonitorRect, WindowSnapshot, WindowState, WindowStateStore, DEFAULT_HEIGHT, DEFAULT_WIDTH,
    MIN_HEIGHT, MIN_WIDTH,
};

const WINDOW: &str = "main";
const ERROR_WINDOW: &str = "error";
/// Given when the program is started at sign-in: no window until asked for.
const HIDDEN: &str = "--hidden";
const SAVE_DEBOUNCE: Duration = Duration::from_millis(350);

struct Args {
    mcp: bool,
    hidden: bool,
    data_dir: PathBuf,
    /// `None`: the usual port, or any free one when that is taken.
    port: Option<u16>,
}

fn args() -> Args {
    let mut parsed = Args {
        mcp: false,
        hidden: false,
        data_dir: default_data_dir(),
        port: None,
    };
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().map(String::as_str) == Some("mcp") {
        parsed.mcp = true;
        args.next();
    }
    while let Some(arg) = args.next() {
        match arg.as_str() {
            HIDDEN => parsed.hidden = true,
            "--data-dir" => {
                if let Some(dir) = args.next() {
                    parsed.data_dir = PathBuf::from(dir);
                }
            }
            "--port" => parsed.port = args.next().and_then(|port| port.parse().ok()),
            // There is nowhere to complain to; anything else is ignored.
            _ => {}
        }
    }
    parsed
}

/// The few words shown outside the web UI, in the system's language.
struct Text {
    chinese: bool,
    open: &'static str,
    autostart: &'static str,
    check_update: &'static str,
    quit: &'static str,
    failed: &'static str,
}

fn text() -> Text {
    let chinese = sys_locale::get_locale().is_some_and(|locale| locale.starts_with("zh"));
    if chinese {
        Text {
            chinese: true,
            open: "開啟 SAF Kanban",
            autostart: "開機時自動啟動",
            check_update: "檢查更新",
            quit: "結束",
            failed: "SAF Kanban 無法啟動",
        }
    } else {
        Text {
            chinese: false,
            open: "Open SAF Kanban",
            autostart: "Start when I sign in",
            check_update: "Check for updates",
            quit: "Quit",
            failed: "SAF Kanban couldn't start",
        }
    }
}

/// The web UI built into this program.
fn built_in_ui(app: &AppHandle) -> UiFiles {
    let resolver = app.asset_resolver();
    // Asking the resolver for a file it doesn't have gets the start page
    // instead, so the files that exist are listed first.
    let files: HashSet<String> = resolver
        .iter()
        .map(|(path, _)| path.trim_start_matches('/').to_string())
        .collect();
    let app = app.clone();
    Arc::new(move |path| {
        if !files.contains(path) {
            return None;
        }
        app.asset_resolver()
            .get_for_scheme(format!("/{path}"), false)
            .map(|asset| asset.bytes)
    })
}

async fn start_server(
    args: &Args,
    ui: UiFiles,
    updater: Option<Arc<UpdateHandle>>,
) -> std::io::Result<Server> {
    let options = |port| Options {
        data_dir: args.data_dir.clone(),
        port,
        ui: Some(ui.clone()),
        updater: updater.clone(),
    };
    if let Some(port) = args.port {
        return Server::bind(options(port)).await;
    }
    match Server::bind(options(DEFAULT_PORT)).await {
        // Another program has the usual port. Programs that start `mcp` still
        // find the server; ones given its address need the new one.
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            Server::bind(options(0)).await
        }
        result => result,
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let should_maximize = app
            .try_state::<PendingMaximize>()
            .is_some_and(|pending| pending.0.swap(false, Ordering::SeqCst));
        let _ = window.unminimize();
        let _ = window.show();
        if should_maximize {
            let _ = window.maximize();
        }
        let _ = window.set_focus();
    }
}

fn snapshot_window(window: &Window) -> Option<WindowSnapshot> {
    let visible = window.is_visible().ok()?;
    let minimized = window.is_minimized().ok()?;
    let maximized = window.is_maximized().ok()?;
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowSnapshot {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized,
        minimized,
        visible,
    })
}

fn record_and_debounce(window: &Window) {
    let Some(saved) = window.try_state::<SavedWindow>() else {
        return;
    };
    let Some(snapshot) = snapshot_window(window) else {
        return;
    };
    let store = Arc::clone(&saved.0);
    if let Some(generation) = store.record(snapshot) {
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SAVE_DEBOUNCE).await;
            store.flush_if_current(generation);
        });
    }
}

fn capture_and_flush(app: &AppHandle) {
    let Some(saved) = app.try_state::<SavedWindow>() else {
        return;
    };
    if let Some(window) = app.get_window(WINDOW) {
        if let Some(snapshot) = snapshot_window(&window) {
            let _ = saved.0.record(snapshot);
        }
    }
    saved.0.flush();
}

/// Whether an address is this program's own web UI.
fn is_ui(url: &Url, port: u16) -> bool {
    url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
        && url.port_or_known_default() == Some(port)
}

/// Links to other sites open in the person's browser. Board contents can be
/// written by other programs, so only web and mail addresses are passed on.
fn open_outside(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = open::that_detached(url.as_str());
    }
}

fn open_ui(
    app: &App,
    port: u16,
    hidden: bool,
    saved: Option<&WindowState>,
    state_store: &WindowStateStore,
    pending_maximize: &AtomicBool,
) -> tauri::Result<()> {
    let url: Url = format!("http://127.0.0.1:{port}/")
        .parse()
        .expect("a valid address");
    // Build hidden first so restoring position/size/maximized never flashes the
    // window at the default position before jumping.
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::External(url))
        .title("SAF Kanban")
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .min_inner_size(MIN_WIDTH as f64, MIN_HEIGHT as f64)
        .visible(false)
        .on_navigation(move |url| {
            // `blob:` is a file the UI made for saving, such as exported boards.
            if is_ui(url, port) || matches!(url.scheme(), "blob" | "about") {
                return true;
            }
            open_outside(url);
            false
        })
        .on_new_window(|url, _| {
            open_outside(&url);
            NewWindowResponse::Deny
        })
        .build()?;

    let mut restore_maximized = false;
    if let Some(state) = saved {
        let monitors: Vec<MonitorRect> = window
            .available_monitors()
            .unwrap_or_default()
            .into_iter()
            .map(|monitor| {
                let area = monitor.work_area();
                MonitorRect {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                }
            })
            .collect();

        if let Some(restored) = window_state::resolve_restore(state, &monitors) {
            // Apply position first so `set_size` runs at the destination monitor's DPI.
            if let Some((x, y)) = restored.position {
                let _ = window.set_position(PhysicalPosition::new(x, y));
                let _ = window.set_size(PhysicalSize::new(restored.width, restored.height));
            } else {
                let _ = window.set_size(PhysicalSize::new(restored.width, restored.height));
                let _ = window.center();
            }
            restore_maximized = restored.maximized;
        }
    }

    if hidden {
        // Calling `maximize()` on Windows makes a hidden window visible, so defer
        // maximizing until the first time the user opens the window from the tray.
        pending_maximize.store(restore_maximized, Ordering::SeqCst);
    } else {
        if restore_maximized {
            let _ = window.maximize();
        }
        let _ = window.show();
    }
    state_store.start_tracking();
    Ok(())
}

/// Shown in place of the UI when the server can't start, for instance when
/// the data folder can't be written to.
fn open_failure(app: &App, error: &std::io::Error) -> tauri::Result<()> {
    let message: String = format!("{}: {error}", text().failed)
        .chars()
        .map(|character| match character {
            '<' | '>' | '&' | '#' | '%' => ' ',
            other => other,
        })
        .collect();
    let page = format!(
        "data:text/html;charset=utf-8,<body style='font:16px sans-serif;margin:2em'>{message}"
    );
    let url: Url = page
        .parse()
        .unwrap_or_else(|_| "about:blank".parse().expect("a valid address"));
    WebviewWindowBuilder::new(app, ERROR_WINDOW, WebviewUrl::External(url))
        .title("SAF Kanban")
        .inner_size(560.0, 240.0)
        .build()?;
    Ok(())
}

/// The icon in the notification area, with its menu.
fn add_tray(
    app: &App,
    updater: Option<(Arc<UpdateHandle>, updater::TauriUpdater)>,
) -> tauri::Result<()> {
    let text = text();
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);

    let open = MenuItem::with_id(app, "open", text.open, true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        text.autostart,
        true,
        autostart_on,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let (menu, update_handle) = if let Some((handle, backend)) = updater {
        let check = MenuItem::with_id(app, "check_update", text.check_update, true, None::<&str>)?;
        backend.set_tray_item(check.clone(), text.chinese);
        let menu = Menu::with_items(app, &[&open, &autostart, &check, &separator, &quit])?;
        (menu, Some(handle))
    } else {
        let menu = Menu::with_items(app, &[&open, &autostart, &separator, &quit])?;
        (menu, None)
    };

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("SAF Kanban")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_window(app),
            "autostart" => {
                let manager = app.autolaunch();
                let wanted = !manager.is_enabled().unwrap_or(false);
                let _ = if wanted {
                    manager.enable()
                } else {
                    manager.disable()
                };
                // Show what is actually set, whether or not that worked.
                let _ = autostart.set_checked(manager.is_enabled().unwrap_or(false));
            }
            "check_update" => {
                show_window(app);
                if let Some(handle) = &update_handle {
                    handle.check(false);
                }
            }
            "quit" => {
                capture_and_flush(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Whether there is an icon in the notification area to bring the window back.
struct InTray(bool);
/// Set right before an update installer quits the app so closing the window
/// isn't intercepted by the tray hide handler.
struct InstallingUpdate(Arc<AtomicBool>);
/// Remembers the main window's bounds across restarts in `<data_dir>/window.json`.
struct SavedWindow(Arc<WindowStateStore>);
/// Deferred maximize when the app starts with `--hidden` and was previously maximized.
struct PendingMaximize(Arc<AtomicBool>);

fn main() {
    let args = args();
    if args.mcp {
        let _ = bridge::run(&args.data_dir);
        return;
    }

    let app = tauri::Builder::default()
        // Starting the program again shows the window of the one running.
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            if !arguments.iter().any(|argument| argument == HIDDEN) {
                show_window(app);
            }
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(HIDDEN)
                .app_name("SAF Kanban")
                .build(),
        )
        .setup(move |app| {
            // Keep any previously installed AI agent skill in sync after an
            // update without installing it where the user hasn't asked for it.
            let skill_content = skill::skill_md(&skill::cli_path(), &args.data_dir);
            let _ = skill::update_installed(&skill_content);

            let installing = Arc::new(AtomicBool::new(false));
            app.manage(InstallingUpdate(installing.clone()));

            let initial_window = window_state::load(&args.data_dir);
            let window_store = Arc::new(WindowStateStore::new(
                &args.data_dir,
                initial_window.clone(),
            ));
            app.manage(SavedWindow(window_store.clone()));

            let pending_maximize = Arc::new(AtomicBool::new(false));
            app.manage(PendingMaximize(pending_maximize.clone()));

            let updater_pair = if updater::is_configured(app) {
                updater::TauriUpdater::start(app, installing.clone()).ok()
            } else {
                None
            };
            let updater_handle = updater_pair.as_ref().map(|(handle, _)| handle.clone());

            let ui = built_in_ui(app.handle());
            match tauri::async_runtime::block_on(start_server(&args, ui, updater_handle)) {
                Ok(server) => {
                    let port = server.address.port();
                    tauri::async_runtime::spawn(server.run(std::future::pending()));
                    open_ui(
                        app,
                        port,
                        args.hidden,
                        initial_window.as_ref(),
                        &window_store,
                        &pending_maximize,
                    )?;
                    // Without the icon, closing the window has to quit.
                    app.manage(InTray(add_tray(app, updater_pair).is_ok()));
                }
                Err(error) => {
                    open_failure(app, &error)?;
                    app.manage(InTray(false));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != WINDOW {
                return;
            }
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    record_and_debounce(window);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    capture_and_flush(window.app_handle());
                    let installing = window
                        .try_state::<InstallingUpdate>()
                        .is_some_and(|flag| flag.0.load(Ordering::SeqCst));
                    if !installing && window.state::<InTray>().0 {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("SAF Kanban couldn't start");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            capture_and_flush(app);
        }
    });
}
