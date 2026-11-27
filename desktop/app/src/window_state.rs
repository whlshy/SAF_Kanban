//! Remembers the main window's size, position and maximized state across restarts
//! in `<data_dir>/window.json`.
//!
//! Coordinates and sizes are stored in physical pixels so Windows HiDPI scaling
//! doesn't cause the window to drift or grow on each launch. Minimized bounds
//! (e.g. Windows `-32000, -32000`) are ignored, maximized state preserves the
//! last normal bounds for un-maximizing, and restoring checks that the titlebar
//! still overlaps a currently connected monitor's work area.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const DEFAULT_WIDTH: f64 = 1280.0;
pub const DEFAULT_HEIGHT: f64 = 800.0;
pub const MIN_WIDTH: u32 = 360;
pub const MIN_HEIGHT: u32 = 480;

const FILE_NAME: &str = "window.json";
const MAX_DIMENSION: u32 = 16_384;
/// Windows moves minimized windows to (-32000, -32000); reject anything near that.
const MIN_REASONABLE_COORD: i32 = -30_000;
/// Assumed titlebar grab strip height and minimum visible overlap (in physical px)
/// so the user can always grab and drag a restored window.
const TITLEBAR_HEIGHT: i64 = 48;
const MIN_VISIBLE_TITLEBAR_W: i64 = 80;
const MIN_VISIBLE_TITLEBAR_H: i64 = 24;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    /// Outer position in physical pixels (last normal, non-maximized bounds).
    pub x: i32,
    pub y: i32,
    /// Inner size in physical pixels (last normal, non-maximized bounds).
    pub width: u32,
    pub height: u32,
    /// Whether the window was maximized.
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowSnapshot {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
    pub minimized: bool,
    pub visible: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RestoredBounds {
    /// `None` means the saved position is no longer on any connected monitor,
    /// so the caller should center the window after applying `width` and `height`.
    pub position: Option<(i32, i32)>,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl WindowState {
    fn has_valid_size(&self) -> bool {
        (MIN_WIDTH..=MAX_DIMENSION).contains(&self.width)
            && (MIN_HEIGHT..=MAX_DIMENSION).contains(&self.height)
    }

    fn has_reasonable_coords(&self) -> bool {
        self.x > MIN_REASONABLE_COORD && self.y > MIN_REASONABLE_COORD
    }
}

/// Validates and adapts a persisted `WindowState` against currently connected
/// monitor work areas. Returns `None` if the saved size is unusable.
pub fn resolve_restore(state: &WindowState, monitors: &[MonitorRect]) -> Option<RestoredBounds> {
    if !state.has_valid_size() {
        return None;
    }

    if monitors.is_empty() {
        let position = state.has_reasonable_coords().then_some((state.x, state.y));
        return Some(RestoredBounds {
            position,
            width: state.width,
            height: state.height,
            maximized: state.maximized,
        });
    }

    if state.has_reasonable_coords() {
        if let Some(monitor) = best_overlapping_monitor(state, monitors) {
            let (width, height) = clamp_size_to_monitor(state.width, state.height, monitor);
            return Some(RestoredBounds {
                position: Some((state.x, state.y)),
                width,
                height,
                maximized: state.maximized,
            });
        }
    }

    // Saved monitor was disconnected or coordinates are off-screen: preserve size
    // (clamped to the primary/first monitor) and let the caller center the window.
    let fallback = monitors[0];
    let (width, height) = clamp_size_to_monitor(state.width, state.height, fallback);
    Some(RestoredBounds {
        position: None,
        width,
        height,
        maximized: state.maximized,
    })
}

fn clamp_size_to_monitor(width: u32, height: u32, monitor: MonitorRect) -> (u32, u32) {
    let clamped_w = if monitor.width >= MIN_WIDTH {
        width.clamp(MIN_WIDTH, monitor.width)
    } else {
        width.max(MIN_WIDTH)
    };
    let clamped_h = if monitor.height >= MIN_HEIGHT {
        height.clamp(MIN_HEIGHT, monitor.height)
    } else {
        height.max(MIN_HEIGHT)
    };
    (clamped_w, clamped_h)
}

fn best_overlapping_monitor(state: &WindowState, monitors: &[MonitorRect]) -> Option<MonitorRect> {
    let wx1 = i64::from(state.x);
    let wy1 = i64::from(state.y);
    let wx2 = wx1 + i64::from(state.width);
    let wy2 = wy1 + TITLEBAR_HEIGHT;

    let mut best: Option<(i64, MonitorRect)> = None;
    for &monitor in monitors {
        let mx1 = i64::from(monitor.x);
        let my1 = i64::from(monitor.y);
        let mx2 = mx1 + i64::from(monitor.width);
        let my2 = my1 + i64::from(monitor.height);

        let overlap_w = (wx2.min(mx2) - wx1.max(mx1)).max(0);
        let overlap_h = (wy2.min(my2) - wy1.max(my1)).max(0);
        if overlap_w >= MIN_VISIBLE_TITLEBAR_W && overlap_h >= MIN_VISIBLE_TITLEBAR_H {
            let area = overlap_w * overlap_h;
            if best.is_none_or(|(best_area, _)| area > best_area) {
                best = Some((area, monitor));
            }
        }
    }
    best.map(|(_, monitor)| monitor)
}

/// Applies a live window snapshot onto the previous remembered state.
/// Returns `Some(updated)` only when the remembered state changed.
pub fn apply_snapshot(
    previous: Option<&WindowState>,
    snapshot: WindowSnapshot,
) -> Option<WindowState> {
    if !snapshot.visible || snapshot.minimized {
        return None;
    }

    let next = if snapshot.maximized {
        match previous {
            Some(prev) => WindowState {
                maximized: true,
                ..prev.clone()
            },
            None => {
                if snapshot.width < MIN_WIDTH
                    || snapshot.height < MIN_HEIGHT
                    || snapshot.x <= MIN_REASONABLE_COORD
                    || snapshot.y <= MIN_REASONABLE_COORD
                {
                    return None;
                }
                WindowState {
                    x: snapshot.x,
                    y: snapshot.y,
                    width: snapshot.width.min(MAX_DIMENSION),
                    height: snapshot.height.min(MAX_DIMENSION),
                    maximized: true,
                }
            }
        }
    } else {
        if !(MIN_WIDTH..=MAX_DIMENSION).contains(&snapshot.width)
            || !(MIN_HEIGHT..=MAX_DIMENSION).contains(&snapshot.height)
            || snapshot.x <= MIN_REASONABLE_COORD
            || snapshot.y <= MIN_REASONABLE_COORD
        {
            return None;
        }
        WindowState {
            x: snapshot.x,
            y: snapshot.y,
            width: snapshot.width,
            height: snapshot.height,
            maximized: false,
        }
    };

    if previous == Some(&next) {
        None
    } else {
        Some(next)
    }
}

pub fn load(data_dir: &Path) -> Option<WindowState> {
    let text = fs::read_to_string(data_dir.join(FILE_NAME)).ok()?;
    let state: WindowState = serde_json::from_str(&text).ok()?;
    state.has_valid_size().then_some(state)
}

pub fn save(path: &Path, state: &WindowState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(state)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(&temporary, text)?;
    rename_replacing(&temporary, path)
}

fn rename_replacing(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied && tries < 20 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(error) => return Err(error),
        }
    }
}

/// Thread-safe holder for the main window's remembered state and debounced disk writes.
pub struct WindowStateStore {
    path: PathBuf,
    tracking: AtomicBool,
    dirty: AtomicBool,
    generation: AtomicU64,
    state: Mutex<Option<WindowState>>,
}

impl WindowStateStore {
    pub fn new(data_dir: &Path, initial: Option<WindowState>) -> Self {
        Self {
            path: data_dir.join(FILE_NAME),
            tracking: AtomicBool::new(false),
            dirty: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            state: Mutex::new(initial),
        }
    }

    pub fn start_tracking(&self) {
        self.tracking.store(true, Ordering::SeqCst);
    }

    pub fn is_tracking(&self) -> bool {
        self.tracking.load(Ordering::SeqCst)
    }

    /// Records a snapshot into memory. Returns `Some(generation)` when the state
    /// changed so the caller can schedule a debounced flush.
    pub fn record(&self, snapshot: WindowSnapshot) -> Option<u64> {
        if !self.is_tracking() {
            return None;
        }
        let mut guard = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let updated = apply_snapshot(guard.as_ref(), snapshot)?;
        *guard = Some(updated);
        self.dirty.store(true, Ordering::SeqCst);
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        Some(gen)
    }

    /// Flushes only if no newer `record` has happened since `expected_generation`.
    pub fn flush_if_current(&self, expected_generation: u64) {
        if self.generation.load(Ordering::SeqCst) == expected_generation {
            self.flush();
        }
    }

    /// Writes the latest state to disk if anything changed since the last write.
    pub fn flush(&self) {
        if !self.dirty.swap(false, Ordering::SeqCst) {
            return;
        }
        let snapshot = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        if let Some(state) = snapshot {
            let _ = save(&self.path, &state);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "saf-kanban-window-state-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saves_and_loads_round_trip() {
        let dir = unique_temp_dir("roundtrip");
        assert_eq!(load(&dir), None);

        let state = WindowState {
            x: 240,
            y: 120,
            width: 1440,
            height: 900,
            maximized: true,
        };
        save(&dir.join(FILE_NAME), &state).unwrap();
        assert_eq!(load(&dir), Some(state));

        // Corrupt JSON returns None instead of panicking.
        fs::write(dir.join(FILE_NAME), "{not json").unwrap();
        assert_eq!(load(&dir), None);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_minimized_and_hidden_snapshots() {
        let normal = WindowState {
            x: 100,
            y: 100,
            width: 1280,
            height: 800,
            maximized: false,
        };

        // Windows minimized coordinates (-32000, -32000) and 0x0 size.
        let minimized = WindowSnapshot {
            x: -32_000,
            y: -32_000,
            width: 0,
            height: 0,
            maximized: false,
            minimized: true,
            visible: true,
        };
        assert_eq!(apply_snapshot(Some(&normal), minimized), None);

        let hidden = WindowSnapshot {
            x: 500,
            y: 400,
            width: 1000,
            height: 700,
            maximized: false,
            minimized: false,
            visible: false,
        };
        assert_eq!(apply_snapshot(Some(&normal), hidden), None);
    }

    #[test]
    fn maximizing_preserves_normal_bounds_for_unmaximize() {
        let normal = WindowState {
            x: 200,
            y: 150,
            width: 1200,
            height: 760,
            maximized: false,
        };

        let maximized = WindowSnapshot {
            x: -8,
            y: -8,
            width: 1920,
            height: 1040,
            maximized: true,
            minimized: false,
            visible: true,
        };

        let updated = apply_snapshot(Some(&normal), maximized).unwrap();
        assert_eq!(
            updated,
            WindowState {
                x: 200,
                y: 150,
                width: 1200,
                height: 760,
                maximized: true,
            }
        );

        // Repeated maximized events produce no redundant writes.
        assert_eq!(apply_snapshot(Some(&updated), maximized), None);

        // Un-maximizing updates normal bounds and clears maximized.
        let unmax = WindowSnapshot {
            x: 300,
            y: 200,
            width: 1100,
            height: 700,
            maximized: false,
            minimized: false,
            visible: true,
        };
        assert_eq!(
            apply_snapshot(Some(&updated), unmax),
            Some(WindowState {
                x: 300,
                y: 200,
                width: 1100,
                height: 700,
                maximized: false,
            })
        );
    }

    #[test]
    fn restores_on_secondary_monitor_and_handles_dwm_border() {
        let monitors = [
            MonitorRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            MonitorRect {
                x: 1920,
                y: 0,
                width: 2560,
                height: 1400,
            },
        ];

        // Snapped to left edge of primary monitor with -7px Windows DWM shadow border.
        let snapped = WindowState {
            x: -7,
            y: 0,
            width: 960,
            height: 1040,
            maximized: false,
        };
        assert_eq!(
            resolve_restore(&snapped, &monitors),
            Some(RestoredBounds {
                position: Some((-7, 0)),
                width: 960,
                height: 1040,
                maximized: false,
            })
        );

        // Placed on secondary monitor.
        let secondary = WindowState {
            x: 2100,
            y: 100,
            width: 1400,
            height: 900,
            maximized: true,
        };
        assert_eq!(
            resolve_restore(&secondary, &monitors),
            Some(RestoredBounds {
                position: Some((2100, 100)),
                width: 1400,
                height: 900,
                maximized: true,
            })
        );
    }

    #[test]
    fn centers_and_clamps_when_secondary_monitor_is_unplugged() {
        let laptop_only = [MonitorRect {
            x: 0,
            y: 0,
            width: 1366,
            height: 728,
        }];

        // Was on a 4K external monitor to the right.
        let off_screen = WindowState {
            x: 2200,
            y: 200,
            width: 1800,
            height: 1000,
            maximized: false,
        };
        assert_eq!(
            resolve_restore(&off_screen, &laptop_only),
            Some(RestoredBounds {
                position: None,
                width: 1366,
                height: 728,
                maximized: false,
            })
        );
    }

    #[test]
    fn store_respects_tracking_gate_and_debounced_generation() {
        let dir = unique_temp_dir("store");
        let store = WindowStateStore::new(&dir, None);

        let snap1 = WindowSnapshot {
            x: 120,
            y: 80,
            width: 1100,
            height: 750,
            maximized: false,
            minimized: false,
            visible: true,
        };
        // Ignored before tracking starts (during startup restore).
        assert_eq!(store.record(snap1), None);

        store.start_tracking();
        let gen1 = store.record(snap1).unwrap();
        let snap2 = WindowSnapshot { x: 400, ..snap1 };
        let gen2 = store.record(snap2).unwrap();

        // Stale debounce tick does nothing.
        store.flush_if_current(gen1);
        assert_eq!(load(&dir), None);

        // Current tick writes snap2.
        store.flush_if_current(gen2);
        assert_eq!(load(&dir).map(|s| s.x), Some(400));

        let _ = fs::remove_dir_all(&dir);
    }
}
