//! Estado de la ventana principal (1.7.3): al reabrir, Frame vuelve tal como
//! se cerró. Maximizada o en pantalla completa si lo estaba; si no, con el
//! mismo tamaño y en la misma posición. Si el monitor donde estaba ya no
//! existe (portátil sin la pantalla externa), vuelve centrada en el principal.
//!
//! - Se recuerda siempre el tamaño «normal» (el de antes de maximizar), así
//!   que al desmaximizar tras reabrir vuelve a ese, no a uno inventado.
//! - Posición en píxeles físicos del escritorio (es lo que entiende Windows
//!   entre monitores); tamaño en píxeles lógicos, para que un cambio de
//!   escala (125 % → 150 %) no encoja ni agrande la ventana.
//! - Se guarda en `%APPDATA%\com.frame.app\window-state.json` cada vez que
//!   cambia (con un respiro de 1,5 s) y al cerrar. Así sobrevive también a
//!   un cierre brusco o a la actualización, que cierra la app sin preguntar.
//! - La ventana nace oculta (`visible: false`) y se muestra ya colocada: no
//!   se ve el salto desde el tamaño de fábrica.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, Runtime, WebviewWindow, Window};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct WindowState {
    /// Esquina superior izquierda del marco, en píxeles físicos.
    x: i32,
    y: i32,
    /// Tamaño del contenido, en píxeles lógicos.
    width: f64,
    height: f64,
    maximized: bool,
    fullscreen: bool,
}

static STATE: Mutex<Option<WindowState>> = Mutex::new(None);
static DIRTY: AtomicBool = AtomicBool::new(false);
const FILE: &str = "window-state.json";
/// Por debajo de esto, un tamaño guardado se considera roto y se ignora.
const MIN_W: f64 = 400.0;
const MIN_H: f64 = 300.0;

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(FILE))
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Option<WindowState> {
    let text = std::fs::read_to_string(state_path(app)?).ok()?;
    let st: WindowState = serde_json::from_str(&text).ok()?;
    let sane = st.width.is_finite() && st.height.is_finite() && st.width >= MIN_W && st.height >= MIN_H;
    sane.then_some(st)
}

/// Escribe el estado si cambió desde la última vez. Escritura atómica: un
/// cierre a mitad no deja un archivo partido.
pub fn save<R: Runtime>(app: &AppHandle<R>) {
    if !DIRTY.swap(false, Ordering::SeqCst) {
        return;
    }
    let Some(st) = *STATE.lock().unwrap_or_else(|e| e.into_inner()) else { return };
    let Some(path) = state_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_string(&st) else { return };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// Toma nota del estado actual (en cada `Moved`/`Resized` de la principal).
/// Minimizada no cuenta: al reabrir, Frame vuelve como estaba antes.
pub fn capture<R: Runtime>(window: &Window<R>) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let mut st = guard.unwrap_or(WindowState { x: 0, y: 0, width: 0.0, height: 0.0, maximized, fullscreen });
    st.maximized = maximized;
    st.fullscreen = fullscreen;
    if !maximized && !fullscreen {
        if let (Ok(pos), Ok(size), Ok(scale)) = (window.outer_position(), window.inner_size(), window.scale_factor()) {
            let logical = size.to_logical::<f64>(scale);
            if logical.width >= MIN_W && logical.height >= MIN_H {
                st.x = pos.x;
                st.y = pos.y;
                st.width = logical.width;
                st.height = logical.height;
            }
        }
    }
    if *guard != Some(st) {
        *guard = Some(st);
        DIRTY.store(true, Ordering::SeqCst);
    }
}

/// ¿Se ve la barra de título en algún monitor? Basta un trozo de 120 × 24 px
/// lógicos dentro del área de trabajo para poder agarrarla y moverla.
fn title_bar_visible<R: Runtime>(window: &WebviewWindow<R>, st: &WindowState) -> bool {
    let Ok(monitors) = window.available_monitors() else { return false };
    monitors.iter().any(|m| {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (ax, ay) = (area.position.x as f64, area.position.y as f64);
        let (aw, ah) = (area.size.width as f64, area.size.height as f64);
        let left = (st.x as f64).max(ax);
        let right = (st.x as f64 + st.width * scale).min(ax + aw);
        let top = (st.y as f64).max(ay);
        let bottom = (st.y as f64 + 32.0 * scale).min(ay + ah);
        right - left >= 120.0 * scale && bottom - top >= 24.0 * scale
    })
}

/// Coloca la ventana como se cerró y la muestra. Se llama una vez, en `setup`.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle().clone();
    let saved = load(&app);
    *STATE.lock().unwrap_or_else(|e| e.into_inner()) = saved;
    if let Some(st) = saved {
        if title_bar_visible(window, &st) {
            // Primero la posición (lleva la ventana a su monitor, con su
            // escala) y después el tamaño lógico.
            let _ = window.set_position(PhysicalPosition::new(st.x, st.y));
            let _ = window.set_size(LogicalSize::new(st.width, st.height));
        } else {
            // El monitor de antes ya no está: al principal, sin pasarse de él.
            let monitor = window.primary_monitor().ok().flatten();
            let (mut w, mut h) = (st.width, st.height);
            if let Some(m) = &monitor {
                let area = m.work_area().size.to_logical::<f64>(m.scale_factor());
                w = w.min(area.width * 0.9);
                h = h.min(area.height * 0.9);
                let pos = m.work_area().position;
                let _ = window.set_position(PhysicalPosition::new(pos.x + 40, pos.y + 40));
            }
            let _ = window.set_size(LogicalSize::new(w.max(MIN_W), h.max(MIN_H)));
            let _ = window.center();
        }
        if st.fullscreen {
            let _ = window.set_fullscreen(true);
        } else if st.maximized {
            let _ = window.maximize();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();

    // Escritor en segundo plano: guarda con un respiro tras cada cambio.
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1500));
        save(&app);
    });
}
