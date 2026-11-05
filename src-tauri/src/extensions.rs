//! Lo que las extensiones guardan en el núcleo nativo (1.7.3).
//!
//! Cada extensión tiene su carpeta, `%APPDATA%\com.frame.app\extensions\<id>`,
//! y nada suyo vive fuera de ella. Desinstalar (`ext_forget`) borra esa
//! carpeta entera: no queda rastro.
//!
//! - **Carpeta de una fuente de música** (`music-folder.txt`): la elige el
//!   usuario en el explorador de Windows. Después Frame puede volver a mirarla
//!   (para traer lo nuevo que dejó, por ejemplo, el programa de descargas) sin
//!   preguntar cada vez, pero SOLO esa: el comando no acepta rutas de fuera.
//! - **Llaves** (`secret-<nombre>.bin`): la de Google Drive de Wire. Cifradas
//!   con DPAPI, atadas al usuario de Windows: copiadas a otro equipo o a otra
//!   cuenta de Windows no sirven.

use crate::{walk_music, PickedSource, PICKED};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Mismo formato que en la app (`EXTENSION_ID` de manifest.ts).
fn valid_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    id.len() <= 64
        && (2..=5).contains(&parts.len())
        && parts.iter().all(|part| {
            !part.is_empty()
                && !part.starts_with('-')
                && !part.ends_with('-')
                && !part.contains("--")
                && part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn ext_dir(app: &AppHandle, ext: &str) -> Result<PathBuf, String> {
    if !valid_id(ext) {
        return Err("Extensión no válida.".into());
    }
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(base.join("extensions").join(ext))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Borra todo lo que la extensión guardó aquí.
#[tauri::command]
pub fn ext_forget(app: AppHandle, ext: String) -> Result<(), String> {
    let dir = ext_dir(&app, &ext)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ------------------------------------------------------------
// Carpeta de una fuente de música
// ------------------------------------------------------------

fn saved_folder(app: &AppHandle, ext: &str) -> Result<Option<PathBuf>, String> {
    let file = ext_dir(app, ext)?.join("music-folder.txt");
    Ok(std::fs::read_to_string(file).ok().map(|text| PathBuf::from(text.trim())).filter(|path| path.is_dir()))
}

fn folder_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Elige (o cambia) la carpeta donde el programa deja lo que descarga. La
/// sugerencia del manifiesto solo abre el explorador ahí; quien elige es el
/// usuario. Devuelve el nombre de la carpeta, o None si canceló.
#[tauri::command]
pub async fn ext_music_folder_pick(
    app: AppHandle,
    window: tauri::Window,
    ext: String,
    hint_base: Option<String>,
    hint_path: Option<String>,
) -> Result<Option<String>, String> {
    let dir = ext_dir(&app, &ext)?;
    let base = match hint_base.as_deref() {
        Some("downloads") => app.path().download_dir().ok(),
        Some("music") => app.path().audio_dir().ok(),
        Some("home") => app.path().home_dir().ok(),
        _ => None,
    };
    let start = match (base, hint_path) {
        // La sugerencia es una subcarpeta: nada de «..» ni rutas absolutas.
        (Some(base), Some(sub)) if !sub.contains("..") && !sub.contains(':') && !sub.starts_with(['/', '\\']) => {
            let full = base.join(&sub);
            Some(if full.is_dir() { full } else { base })
        }
        (Some(base), _) => Some(base),
        _ => None,
    };
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title(crate::ui("Elige la carpeta donde se guardan las descargas", "Choose the folder where downloads are saved"));
    if let Some(start) = start {
        dialog = dialog.set_directory(start);
    }
    let Some(picked) = dialog.pick_folder().await else { return Ok(None) };
    let path = picked.path().to_path_buf();
    write_atomic(&dir.join("music-folder.txt"), path.to_string_lossy().as_bytes())?;
    Ok(Some(folder_name(&path)))
}

/// Nombre de la carpeta elegida, si sigue existiendo.
#[tauri::command]
pub fn ext_music_folder(app: AppHandle, ext: String) -> Result<Option<String>, String> {
    Ok(saved_folder(&app, &ext)?.map(|path| folder_name(&path)))
}

/// Lo que hay ahora en la carpeta elegida, listo para «Importar» (como una
/// carpeta elegida en el explorador: `music_read` puede leer esos archivos).
#[tauri::command]
pub async fn ext_music_folder_scan(app: AppHandle, ext: String) -> Result<Option<PickedSource>, String> {
    let Some(root) = saved_folder(&app, &ext)? else { return Ok(None) };
    let walk_root = root.clone();
    let files = tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        walk_music(&walk_root, &walk_root, &mut files, 0);
        files
    })
    .await
    .map_err(|e| e.to_string())?;
    let allowed = files.iter().map(|f| PathBuf::from(&f.path)).collect();
    *PICKED.lock().map_err(|e| e.to_string())? = Some(allowed);
    Ok(Some(PickedSource { kind: "folder", name: folder_name(&root), files }))
}

// ------------------------------------------------------------
// Llaves cifradas (DPAPI)
// ------------------------------------------------------------

#[cfg(windows)]
mod sealed {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: entradas válidas durante la llamada; la salida la reserva
        // Windows y se libera con LocalFree tras copiarla.
        let ok = unsafe {
            if protect {
                CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            }
        };
        if ok == 0 || out.pbData.is_null() {
            return Err("Windows no pudo proteger la llave.".into());
        }
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
        unsafe { LocalFree(out.pbData as _) };
        Ok(bytes)
    }

    pub fn seal(plain: &str) -> Result<Vec<u8>, String> {
        run(plain.as_bytes(), true)
    }

    pub fn open(sealed: &[u8]) -> Result<String, String> {
        String::from_utf8(run(sealed, false)?).map_err(|_| "Llave dañada.".to_string())
    }
}

#[cfg(not(windows))]
mod sealed {
    pub fn seal(_plain: &str) -> Result<Vec<u8>, String> {
        Err("Guardar llaves solo está disponible en Windows.".into())
    }
    pub fn open(_sealed: &[u8]) -> Result<String, String> {
        Err("Guardar llaves solo está disponible en Windows.".into())
    }
}

fn secret_path(app: &AppHandle, ext: &str, name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err("Nombre de llave no válido.".into());
    }
    Ok(ext_dir(app, ext)?.join(format!("secret-{name}.bin")))
}

#[tauri::command]
pub fn ext_secret_set(app: AppHandle, ext: String, name: String, value: String) -> Result<(), String> {
    let path = secret_path(&app, &ext, &name)?;
    write_atomic(&path, &sealed::seal(&value)?)
}

#[tauri::command]
pub fn ext_secret_get(app: AppHandle, ext: String, name: String) -> Result<Option<String>, String> {
    let path = secret_path(&app, &ext, &name)?;
    match std::fs::read(&path) {
        Ok(bytes) => sealed::open(&bytes).map(Some),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn ext_secret_delete(app: AppHandle, ext: String, name: String) -> Result<(), String> {
    let path = secret_path(&app, &ext, &name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
