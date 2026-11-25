//! In-app update state shared between the desktop app shell and the local HTTP
//! API. Only the installed desktop app attaches an [`UpdateHandle`]; standalone
//! `saf-kanban-server` leaves it unset.

use std::sync::{Arc, RwLock};

use serde::Serialize;

/// Snapshot returned by `GET /api/update` and after check/install requests.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    /// One of: `idle`, `checking`, `available`, `upToDate`, `downloading`,
    /// `installing`, `error`.
    pub status: &'static str,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl UpdateState {
    pub fn idle(current_version: impl Into<String>) -> Self {
        Self {
            status: "idle",
            current_version: current_version.into(),
            version: None,
            notes: None,
            release_url: None,
            downloaded: None,
            total: None,
            error: None,
        }
    }
}

/// Platform-specific implementation provided by the Tauri desktop shell (or a
/// fake in tests).
pub trait UpdateBackend: Send + Sync {
    /// Checks for a newer version. When `silent` is true (background check),
    /// "already up to date" and network errors settle quietly back to `idle`.
    fn check(&self, silent: bool);

    /// Starts downloading and installing the update found by the last check.
    fn install(&self) -> Result<(), (&'static str, String)>;
}

type Notifier = Arc<dyn Fn() + Send + Sync>;

pub struct UpdateHandle {
    state: RwLock<UpdateState>,
    backend: RwLock<Option<Arc<dyn UpdateBackend>>>,
    notifier: RwLock<Option<Notifier>>,
}

impl UpdateHandle {
    pub fn new(current_version: impl Into<String>) -> Self {
        Self {
            state: RwLock::new(UpdateState::idle(current_version)),
            backend: RwLock::new(None),
            notifier: RwLock::new(None),
        }
    }

    pub fn set_backend(&self, backend: Arc<dyn UpdateBackend>) {
        *self
            .backend
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(backend);
    }

    pub fn set_notifier(&self, notifier: Notifier) {
        *self
            .notifier
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(notifier);
    }

    pub fn state(&self) -> UpdateState {
        self.state
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn set_state(&self, next: UpdateState) {
        {
            let mut state = self
                .state
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = next;
        }
        let notifier = self
            .notifier
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(notify) = notifier {
            notify();
        }
    }

    pub fn check(&self, silent: bool) {
        let backend = self
            .backend
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(backend) = backend {
            backend.check(silent);
        }
    }

    pub fn install(&self) -> Result<(), (&'static str, String)> {
        let backend = self
            .backend
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .ok_or((
                "UPDATER_UNAVAILABLE",
                "In-app updates aren't available in this build.".to_string(),
            ))?;
        backend.install()
    }
}
