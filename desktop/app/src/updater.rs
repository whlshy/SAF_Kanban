//! In-app updater for the installed desktop app, backed by
//! `tauri-plugin-updater` with minisign signature verification and Windows
//! NSIS `passive` installation.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use saf_kanban_server::updater::{UpdateBackend, UpdateHandle, UpdateState};
use tauri::menu::MenuItem;
use tauri::{App, AppHandle, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASE_URL_PREFIX: &str = "https://github.com/whlshy/SAF_Kanban/releases/tag/desktop-v";
const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(5);
const PERIODIC_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const PROGRESS_THROTTLE: Duration = Duration::from_millis(150);

/// Returns true when this build has a signing public key configured in
/// `tauri.conf.json` (and is a release build).
pub fn is_configured(app: &App) -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|value| value.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

struct Inner {
    app: AppHandle,
    handle: Arc<UpdateHandle>,
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    installing: Arc<AtomicBool>,
    tray_item: Mutex<Option<(MenuItem<Wry>, bool)>>,
}

impl Inner {
    fn set_tray_label(&self, version: Option<&str>) {
        let guard = self
            .tray_item
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some((item, chinese)) = guard.as_ref() else {
            return;
        };
        let label = match (version, *chinese) {
            (Some(ver), true) => format!("更新至 v{ver}"),
            (Some(ver), false) => format!("Update to v{ver}"),
            (None, true) => "檢查更新".to_string(),
            (None, false) => "Check for updates".to_string(),
        };
        let _ = item.set_text(label);
    }
}

#[derive(Clone)]
pub struct TauriUpdater(Arc<Inner>);

impl TauriUpdater {
    pub fn start(
        app: &App,
        installing: Arc<AtomicBool>,
    ) -> tauri::Result<(Arc<UpdateHandle>, Self)> {
        app.handle()
            .plugin(tauri_plugin_updater::Builder::new().build())?;

        let handle = Arc::new(UpdateHandle::new(CURRENT_VERSION));
        let updater = Self(Arc::new(Inner {
            app: app.handle().clone(),
            handle: handle.clone(),
            pending: Mutex::new(None),
            busy: AtomicBool::new(false),
            installing,
            tray_item: Mutex::new(None),
        }));
        handle.set_backend(Arc::new(updater.clone()));

        // Background check shortly after startup, then every 6 hours while the
        // app stays open in the notification area.
        let scheduled = handle.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STARTUP_CHECK_DELAY).await;
            scheduled.check(true);
            let mut every = tokio::time::interval(PERIODIC_CHECK_INTERVAL);
            every.tick().await;
            loop {
                every.tick().await;
                scheduled.check(true);
            }
        });

        Ok((handle, updater))
    }

    pub fn set_tray_item(&self, item: MenuItem<Wry>, chinese: bool) {
        *self
            .0
            .tray_item
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((item, chinese));
    }
}

impl UpdateBackend for TauriUpdater {
    fn check(&self, silent: bool) {
        if self
            .0
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        if !silent {
            self.0.handle.set_state(UpdateState {
                status: "checking",
                ..UpdateState::idle(CURRENT_VERSION)
            });
        }

        let inner = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            let installing = inner.installing.clone();
            let app_for_exit = inner.app.clone();
            let result = match inner
                .app
                .updater_builder()
                .timeout(Duration::from_secs(20))
                .on_before_exit(move || {
                    installing.store(true, Ordering::SeqCst);
                    app_for_exit.cleanup_before_exit();
                })
                .build()
            {
                Ok(updater) => updater.check().await,
                Err(error) => Err(error),
            };

            match result {
                Ok(Some(update)) => {
                    let version = update.version.clone();
                    let notes = update.body.clone();
                    let release_url = Some(format!("{RELEASE_URL_PREFIX}{version}"));
                    *inner
                        .pending
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(update);
                    inner.set_tray_label(Some(&version));
                    inner.handle.set_state(UpdateState {
                        status: "available",
                        current_version: CURRENT_VERSION.to_string(),
                        version: Some(version),
                        notes,
                        release_url,
                        downloaded: None,
                        total: None,
                        error: None,
                    });
                }
                Ok(None) => {
                    *inner
                        .pending
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
                    inner.set_tray_label(None);
                    inner.handle.set_state(UpdateState {
                        status: if silent { "idle" } else { "upToDate" },
                        ..UpdateState::idle(CURRENT_VERSION)
                    });
                }
                Err(error) => {
                    if silent {
                        inner.handle.set_state(UpdateState::idle(CURRENT_VERSION));
                    } else {
                        inner.handle.set_state(UpdateState {
                            status: "error",
                            error: Some(error.to_string()),
                            ..UpdateState::idle(CURRENT_VERSION)
                        });
                    }
                }
            }
            inner.busy.store(false, Ordering::SeqCst);
        });
    }

    fn install(&self) -> Result<(), (&'static str, String)> {
        if self
            .0
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err((
                "UPDATE_BUSY",
                "An update check or installation is already running.".to_string(),
            ));
        }

        let Some(update) = self
            .0
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        else {
            self.0.busy.store(false, Ordering::SeqCst);
            return Err((
                "NO_UPDATE_AVAILABLE",
                "No update is ready to install.".to_string(),
            ));
        };

        let version = update.version.clone();
        let release_url = Some(format!("{RELEASE_URL_PREFIX}{version}"));
        self.0.handle.set_state(UpdateState {
            status: "downloading",
            current_version: CURRENT_VERSION.to_string(),
            version: Some(version.clone()),
            notes: update.body.clone(),
            release_url: release_url.clone(),
            downloaded: Some(0),
            total: None,
            error: None,
        });

        let inner = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            let mut downloaded: u64 = 0;
            let mut last_emit = Instant::now() - PROGRESS_THROTTLE;
            let version_for_chunk = version.clone();
            let release_for_chunk = release_url.clone();
            let handle_for_chunk = inner.handle.clone();
            let version_for_finish = version.clone();
            let release_for_finish = release_url.clone();
            let handle_for_finish = inner.handle.clone();

            let result = update
                .download_and_install(
                    move |chunk_length, content_length| {
                        downloaded = downloaded.saturating_add(chunk_length as u64);
                        if last_emit.elapsed() >= PROGRESS_THROTTLE
                            || content_length.is_some_and(|total| downloaded >= total)
                        {
                            last_emit = Instant::now();
                            handle_for_chunk.set_state(UpdateState {
                                status: "downloading",
                                current_version: CURRENT_VERSION.to_string(),
                                version: Some(version_for_chunk.clone()),
                                notes: None,
                                release_url: release_for_chunk.clone(),
                                downloaded: Some(downloaded),
                                total: content_length,
                                error: None,
                            });
                        }
                    },
                    move || {
                        handle_for_finish.set_state(UpdateState {
                            status: "installing",
                            current_version: CURRENT_VERSION.to_string(),
                            version: Some(version_for_finish),
                            notes: None,
                            release_url: release_for_finish,
                            downloaded: None,
                            total: None,
                            error: None,
                        });
                    },
                )
                .await;

            match result {
                Ok(()) => {
                    inner.installing.store(true, Ordering::SeqCst);
                    inner.app.restart();
                }
                Err(error) => {
                    inner.handle.set_state(UpdateState {
                        status: "error",
                        current_version: CURRENT_VERSION.to_string(),
                        version: Some(version),
                        notes: None,
                        release_url,
                        downloaded: None,
                        total: None,
                        error: Some(error.to_string()),
                    });
                    inner.busy.store(false, Ordering::SeqCst);
                }
            }
        });

        Ok(())
    }
}
