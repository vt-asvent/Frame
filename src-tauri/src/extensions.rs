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

/// Nombre del equipo (para la lista de equipos de Wire, en el Drive del propio usuario).
#[tauri::command]
pub fn ext_device_name() -> String {
    std::env::var("COMPUTERNAME").ok().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Windows".into())
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

// ------------------------------------------------------------
// El programa del que depende una extensión (1.9.0)
// ------------------------------------------------------------
//
// Una fuente de música del catálogo puede necesitar un programa de este
// equipo (su motor de descargas). Frame lo mantiene vivo y al día sin que el
// usuario haga nada: lo abre si está cerrado (`ext_app_launch`) y lo instala o
// lo actualiza si falta o es viejo (`ext_app_install`), con el índice de
// versiones del actualizador de Tauri (`latest.json`).
//
// Seguridad: el índice y el instalador, solo por https de github.com; el
// instalador debe venir FIRMADO con una de las llaves de `APP_KEYS` (minisign,
// la misma comprobación que el actualizador de Frame), o no se ejecuta. El
// programa vive en %LOCALAPPDATA%, en la ruta relativa que da el manifiesto.
// En la versión de la Store no se instala nada (sus reglas no lo permiten).

/// Llaves públicas (minisign, en el formato del actualizador de Tauri) de los
/// programas que Frame acepta instalar.
const APP_KEYS: [&str; 1] = [
    // El motor de descargas de la fuente de música del catálogo.
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ0Q0Q1MDI4NzIwRDYwNEMKUldSTVlBMXlLRkROMUVIMGlzYjVydUZIM1RubUdqRHNUT25DNVdpbFA0N3BrT2dTNmt4TFpqRUEK",
];
/// Un instalador más grande que esto no es el de un motor.
const MAX_INSTALLER: u64 = 400 * 1024 * 1024;

/// `Carpeta/programa.exe` dentro de %LOCALAPPDATA% (sin «..» ni rutas absolutas).
fn app_exe(exe: &str) -> Result<PathBuf, String> {
    let relative = Path::new(exe);
    let normal = relative.components().all(|part| matches!(part, std::path::Component::Normal(_)));
    if exe.len() > 160 || !normal || !exe.to_ascii_lowercase().ends_with(".exe") {
        return Err("Ruta de programa no válida.".into());
    }
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).ok_or("Sin carpeta de programas.")?;
    Ok(base.join(relative))
}

/// Solo opciones sencillas («--tray»): nada que el programa lea como ruta.
fn app_args(args: Vec<String>) -> Vec<String> {
    args.into_iter()
        .take(4)
        .filter(|arg| arg.len() <= 32 && arg.starts_with("--") && arg[2..].chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .collect()
}

fn github(url: &str) -> bool {
    url.starts_with("https://github.com/") && !url.contains("..") && !url.contains('@') && !url.chars().any(char::is_whitespace)
}

/// Abre el programa en segundo plano. `false`: no está instalado.
#[tauri::command]
pub fn ext_app_launch(exe: String, args: Vec<String>) -> Result<bool, String> {
    let path = app_exe(&exe)?;
    if !path.is_file() {
        return Ok(false);
    }
    let mut command = std::process::Command::new(&path);
    command
        .args(app_args(args))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Sin consola y fuera del grupo de Frame: sigue abierto aunque Frame se cierre.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map_err(|e| e.to_string())?;
    Ok(true)
}

/// ¿El instalador viene firmado con una de las llaves aceptadas?
fn signed(bytes: &[u8], signature: &str) -> bool {
    use base64::Engine as _;
    let text = |b64: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .ok()
            .and_then(|raw| String::from_utf8(raw).ok())
    };
    let Some(signature) = text(signature).and_then(|t| minisign_verify::Signature::decode(&t).ok()) else {
        return false;
    };
    APP_KEYS.iter().any(|key| {
        text(key)
            .and_then(|t| minisign_verify::PublicKey::decode(&t).ok())
            .is_some_and(|public| public.verify(bytes, &signature, true).is_ok())
    })
}

/// Instala (o actualiza) el programa con su última versión publicada y lo
/// abre. Devuelve la versión instalada. El instalador, en silencio, cierra el
/// programa si estaba abierto: la app solo lo pide cuando no baja nada.
#[tauri::command]
pub async fn ext_app_install(updates: String, exe: String, args: Vec<String>) -> Result<String, String> {
    if crate::ia_bridge::packaged() {
        return Err("store".into());
    }
    let target = app_exe(&exe)?;
    if !github(&updates) {
        return Err("El índice de versiones del programa no es de confianza.".into());
    }
    let client = crate::http_client();
    let index: serde_json::Value = client
        .get(&updates)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let version = index["version"].as_str().unwrap_or_default().trim_start_matches('v').to_string();
    let platform = &index["platforms"]["windows-x86_64"];
    let (Some(url), Some(signature)) = (platform["url"].as_str(), platform["signature"].as_str()) else {
        return Err("El programa no tiene versión para Windows.".into());
    };
    if !github(url) || version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return Err("La versión publicada del programa no es de confianza.".into());
    }
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(900))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|size| size > MAX_INSTALLER) {
        return Err("El instalador del programa es demasiado grande.".into());
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_INSTALLER || !signed(&bytes, signature) {
        return Err("La firma del instalador no es válida: no se instaló nada.".into());
    }

    let dir = std::env::temp_dir().join("frame-ext-app");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let installer = dir.join(format!("setup-{version}.exe"));
    std::fs::write(&installer, &bytes).map_err(|e| e.to_string())?;
    let run = installer.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // NSIS por usuario («/S»: en silencio, sin permisos de administrador).
        let mut child = std::process::Command::new(&run).arg("/S").spawn().map_err(|e| e.to_string())?;
        let started = std::time::Instant::now();
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                return if status.success() { Ok(()) } else { Err("El instalador no terminó bien.".into()) };
            }
            if started.elapsed() > std::time::Duration::from_secs(300) {
                let _ = child.kill();
                return Err("El instalador no terminó a tiempo.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&installer);
    outcome?;
    if !target.is_file() {
        return Err("El programa se instaló en otra carpeta.".into());
    }
    ext_app_launch(exe, args)?;
    Ok(version)
}
