use serde::Serialize;

mod window_state;
mod extensions;
pub mod ia_bridge;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU8, Ordering};
use tauri::{Emitter, Manager};

/// Se levanta cuando ya se preguntó al frontend si puede cerrarse. Una segunda
/// pulsación de la X cierra la app sin más, pase lo que pase en la interfaz.
static CLOSE_ASKED: AtomicBool = AtomicBool::new(false);

/// Idioma de la interfaz (1.6.7): lo fija el frontend al arrancar y al
/// cambiarlo. Solo lo usan los títulos de ventanas y de los selectores de
/// archivos; los mensajes de error se traducen en la interfaz.
/// 0 español, 1 inglés y, desde 1.7.3, los de `UI_LANGS[2..]`.
static UI_LANG: AtomicU8 = AtomicU8::new(0);

/// Los códigos, en el orden de `UI_LANG` y de las columnas de `NATIVE_TEXTS`.
const UI_LANGS: [&str; 8] = ["es", "en", "de", "fr", "it", "pt", "ru", "ja"];

/// Los textos nativos en los idiomas de 1.7.3, buscados por su inglés
/// (columnas: alemán, francés, italiano, portugués, ruso, japonés). Así las
/// llamadas siguen siendo `ui("español", "inglés")` y el comprobador de
/// idioma las reconoce igual. El primero es el código para `lang`, `hl` y
/// `Accept-Language`.
const NATIVE_TEXTS: [(&str, [&str; 6]); 11] = [
    ("en", ["de", "fr", "it", "pt-BR", "ru", "ja"]),
    ("Sign in with Google — Frame", ["Mit Google anmelden — Frame", "Se connecter avec Google — Frame", "Accedi con Google — Frame", "Entrar com o Google — Frame", "Вход через Google — Frame", "Google でログイン — Frame"]),
    ("Focus — Frame", ["Fokus — Frame", "Concentration — Frame", "Concentrazione — Frame", "Foco — Frame", "Фокус — Frame", "集中 — Frame"]),
    ("Schedule — Frame", ["Stundenplan — Frame", "Emploi du temps — Frame", "Orario — Frame", "Horário — Frame", "Расписание — Frame", "時間割 — Frame"]),
    ("Connection completed", ["Verbindung hergestellt", "Connexion établie", "Connessione completata", "Conexão concluída", "Подключение выполнено", "接続が完了しました"]),
    ("You can close this window and go back to Frame.", ["Du kannst dieses Fenster schließen und zu Frame zurückkehren.", "Tu peux fermer cette fenêtre et revenir à Frame.", "Puoi chiudere questa finestra e tornare a Frame.", "Você já pode fechar esta janela e voltar ao Frame.", "Можно закрыть это окно и вернуться во Frame.", "このウィンドウを閉じて Frame に戻れます。"]),
    ("Choose the folder where downloads are saved", ["Wähle den Ordner, in dem Downloads gespeichert werden", "Choisis le dossier où enregistrer les téléchargements", "Scegli la cartella in cui salvare i download", "Escolha a pasta onde os downloads são salvos", "Выбери папку для загрузок", "ダウンロードの保存先フォルダーを選んでください"]),
    ("Choose the folder with your music", ["Wähle den Ordner mit deiner Musik", "Choisis le dossier contenant ta musique", "Scegli la cartella con la tua musica", "Escolha a pasta com suas músicas", "Выбери папку с музыкой", "音楽が入っているフォルダーを選んでください"]),
    ("Folder", ["Ordner", "Dossier", "Cartella", "Pasta", "Папка", "フォルダー"]),
    ("Choose your songs (and their lyrics and covers, if you have them)", ["Wähle deine Songs (und, falls vorhanden, ihre Songtexte und Cover)", "Choisis tes chansons (et leurs paroles et pochettes, si tu les as)", "Scegli le tue canzoni (e, se li hai, testi e copertine)", "Escolha suas músicas (e, se tiver, as letras e capas)", "Выбери песни (и, если есть, их тексты и обложки)", "曲を選んでください(歌詞やジャケットがあればそれも)"]),
    ("Songs, lyrics and covers", ["Songs, Songtexte und Cover", "Chansons, paroles et pochettes", "Canzoni, testi e copertine", "Músicas, letras e capas", "Песни, тексты и обложки", "曲・歌詞・ジャケット"]),
];

/// Texto nativo en el idioma de la interfaz (en los de 1.7.3, desde
/// `NATIVE_TEXTS`; si faltara, en inglés).
fn ui(es: &'static str, en: &'static str) -> &'static str {
    match UI_LANG.load(Ordering::Relaxed) {
        0 => es,
        1 => en,
        n => NATIVE_TEXTS
            .iter()
            .find(|(key, _)| *key == en)
            .map(|(_, texts)| texts[(n as usize - 2).min(5)])
            .unwrap_or(en),
    }
}

/// Títulos de las ventanas propias, en los dos idiomas.
const WINDOW_TITLES: [(&str, &str, &str); 3] = [
    (AUTH_WINDOW, "Acceder con Google — Frame", "Sign in with Google — Frame"),
    ("minitimer", "Enfoque — Frame", "Focus — Frame"),
    ("schedulepeek", "Horario — Frame", "Schedule — Frame"),
];

fn window_title(label: &str) -> &'static str {
    WINDOW_TITLES
        .iter()
        .find(|(l, _, _)| *l == label)
        .map(|(_, es, en)| ui(es, en))
        .unwrap_or("Frame")
}

#[tauri::command]
fn set_ui_language(app: tauri::AppHandle, lang: String) {
    let index = UI_LANGS.iter().position(|code| *code == lang).unwrap_or(0) as u8;
    // Gmail, YouTube y Classroom se abren en el idioma de Frame (`hl`): si
    // cambia, se cierran y el recuadro los vuelve a abrir solo, ya en el nuevo.
    if UI_LANG.swap(index, Ordering::Relaxed) != index {
        close_embeds(&app);
    }
    // Las ventanas que ya están abiertas cambian de título en el acto.
    for (label, _, _) in WINDOW_TITLES {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_title(window_title(label));
        }
    }
}

/// Texto del portapapeles para «Pegar» en el menú propio de los campos de
/// texto (TextFieldMenu.tsx). El motor web pediría permiso con un aviso en el
/// idioma de Windows; aquí se lee sin preguntar, solo cuando el usuario pega.
#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::DataExchange::{
            CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
        };
        use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
        use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

        if IsClipboardFormatAvailable(CF_UNICODETEXT as u32) == 0 {
            return Ok(String::new());
        }
        // Otro programa puede tenerlo abierto un instante: se reintenta.
        let mut open = false;
        for _ in 0..10 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                open = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        if !open {
            return Err("clipboard busy".into());
        }
        let mut text = String::new();
        let handle = GetClipboardData(CF_UNICODETEXT as u32);
        if !handle.is_null() {
            let data = GlobalLock(handle) as *const u16;
            if !data.is_null() {
                let mut len = 0;
                while *data.add(len) != 0 {
                    len += 1;
                }
                text = String::from_utf16_lossy(std::slice::from_raw_parts(data, len));
                GlobalUnlock(handle);
            }
        }
        CloseClipboard();
        Ok(text)
    }
    #[cfg(not(windows))]
    Err("unsupported".into())
}

// ============================================================
// OAuth nativo (Google, PKCE + loopback).
//
// La pantalla de Google se abre en una ventana de Frame (ver
// `open_auth_window`), no en el navegador del sistema: entrar a la app no
// debería sacarte de la app. Esta mini-escucha HTTP en 127.0.0.1 recibe el
// redirect con el `code` venga de donde venga la ventana.
// ============================================================

/// Puerto cuya espera OAuth debe abortarse (0 = ninguna). Lo fija el
/// frontend cuando el usuario cierra la ventana de Google sin terminar; sin
/// esto la escucha seguiría viva cinco minutos con el puerto ocupado.
static OAUTH_CANCEL_PORT: AtomicU16 = AtomicU16::new(0);

#[tauri::command]
fn oauth_cancel_wait(port: u16) {
    OAUTH_CANCEL_PORT.store(port, Ordering::SeqCst);
}

/// Etiqueta de la ventana de acceso con Google.
const AUTH_WINDOW: &str = "googleauth";

/// Abre la pantalla de acceso de Google en una ventana propia de Frame.
/// Solo acepta URLs de accounts.google.com: la ventana existe para esto y
/// para nada más.
#[tauri::command]
async fn open_auth_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("accounts.google.com") {
        return Err("Solo se puede abrir la pantalla de acceso de Google.".into());
    }

    if let Some(previous) = app.get_webview_window(AUTH_WINDOW) {
        let _ = previous.close();
    }

    // Privada (1.6.7): en un equipo compartido, la siguiente persona no ve la
    // cuenta de Google de la anterior ya elegida ni su sesión abierta.
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        AUTH_WINDOW,
        tauri::WebviewUrl::External(parsed),
    )
    .incognito(true)
    .title(window_title(AUTH_WINDOW))
    .inner_size(520.0, 700.0)
    .min_inner_size(420.0, 560.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    // Si el usuario la cierra a mano, el frontend cancela la espera.
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = handle.emit("auth-window-closed", ());
        }
    });
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
async fn close_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
struct OauthCallback {
    /// Parámetros de query devueltos por Google (code, state, error…)
    params: HashMap<String, String>,
}

/// Reserva un puerto loopback y devuelve el puerto elegido junto con un
/// token de sesión. La escucha queda viva hasta recibir UNA petición.
#[tauri::command]
async fn oauth_wait_callback(port: u16, timeout_secs: Option<u64>) -> Result<OauthCallback, String> {
    let timeout = std::time::Duration::from_secs(timeout_secs.unwrap_or(300));

    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
        listener
            .set_nonblocking(false)
            .map_err(|e| e.to_string())?;

        let deadline = std::time::Instant::now() + timeout;
        listener
            .set_nonblocking(true)
            .map_err(|e| e.to_string())?;

        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream
                        .set_nonblocking(false)
                        .map_err(|e| e.to_string())?;
                    // Lectura con plazo: una conexión que no envía nada se descarta
                    // y se sigue esperando a la de verdad.
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
                    let mut reader = match stream.try_clone() {
                        Ok(clone) => BufReader::new(clone),
                        Err(_) => continue,
                    };
                    let mut request_line = String::new();
                    if reader.read_line(&mut request_line).is_err() || request_line.trim().is_empty() {
                        continue;
                    }

                    // "GET /callback?code=...&state=... HTTP/1.1"
                    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
                    let query = path.splitn(2, '?').nth(1).unwrap_or("");
                    let params: HashMap<String, String> = query
                        .split('&')
                        .filter(|kv| !kv.is_empty())
                        .filter_map(|kv| {
                            let mut it = kv.splitn(2, '=');
                            let k = it.next()?;
                            let v = it.next().unwrap_or("");
                            Some((
                                urldecode(k),
                                urldecode(v),
                            ))
                        })
                        .collect();

                    // Solo la respuesta de Google trae `code` o `error`: un
                    // favicon.ico o un sondeo cualquiera no terminan la espera.
                    if !params.contains_key("code") && !params.contains_key("error") {
                        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                        continue;
                    }

                    // En el idioma de Frame (1.6.7).
                    let html = format!(
                        r#"<!doctype html><html lang="{}"><head><meta charset="utf-8"><title>Frame</title></head>
<body style="background:#1c1c1e;color:#fafafa;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><h2 style="color:#7c8cff">{}</h2><p>{}</p></div>
</body></html>"#,
                        ui("es", "en"),
                        ui("Conexión completada", "Connection completed"),
                        ui("Ya puedes cerrar esta ventana y volver a Frame.", "You can close this window and go back to Frame.")
                    );
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();

                    return Ok(OauthCallback { params });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if OAUTH_CANCEL_PORT.load(Ordering::SeqCst) == port {
                        OAUTH_CANCEL_PORT.store(0, Ordering::SeqCst);
                        return Err("Inicio de sesión cancelado.".into());
                    }
                    if std::time::Instant::now() > deadline {
                        return Err("Tiempo de espera agotado para la autorización.".into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(120));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let (Some(h), Some(l)) = (hexval(bytes.get(i + 1)), hexval(bytes.get(i + 2))) {
                    out.push(h * 16 + l);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hexval(b: Option<&u8>) -> Option<u8> {
    match b? {
        c @ b'0'..=b'9' => Some(c - b'0'),
        c @ b'a'..=b'f' => Some(c - b'a' + 10),
        c @ b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Un solo cliente HTTP para todo el núcleo (1.7.0): con plazos (una conexión
/// muda ya no deja la petición colgada para siempre), el proxy del sistema
/// (colegios y empresas lo configuran en Windows; antes solo se leían las
/// variables de entorno) y la versión real en el agente.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(25))
            .user_agent(concat!("Frame/", env!("CARGO_PKG_VERSION"), " (Asvent)"))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// Intercambio de tokens contra el endpoint de Google, hecho en el proceso
/// nativo para evitar restricciones CORS del webview.
#[tauri::command]
async fn google_token_request(form: HashMap<String, String>) -> Result<serde_json::Value, String> {
    let resp = http_client()
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(json
            .get("error_description")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("Error de token de Google")
            .to_string());
    }
    Ok(json)
}

/// Servicios a los que el núcleo nativo puede pedir texto: los de la
/// ubicación del clima (lib/reverse-geocode.ts) y la ficha pública de los
/// vídeos de estudio (lib/study-videos.ts). Lista cerrada: un comando que
/// aceptara cualquier dirección sería una puerta abierta.
const TEXT_HOSTS: [&str; 4] = ["api.bigdatacloud.net", "photon.komoot.io", "nominatim.openstreetmap.org", "www.youtube.com"];

fn checked_https(url: &str, hosts: &[&str]) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.trim().parse().map_err(|_| "Dirección no válida.".to_string())?;
    let host_ok = parsed.host_str().map_or(false, |host| hosts.contains(&host));
    if parsed.scheme() != "https" || !host_ok {
        return Err("Servicio no permitido.".into());
    }
    Ok(parsed)
}

/// GET ejecutado en el proceso nativo (sin restricciones CORS del webview):
/// devuelve el cuerpo como texto.
#[tauri::command]
async fn http_get_text(url: String) -> Result<String, String> {
    let url = checked_https(&url, &TEXT_HOSTS)?;
    let resp = http_client()
        .get(url)
        .header("Accept-Language", ui("es", "en"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// GET binario → data URL: las miniaturas de los vídeos de estudio.
#[tauri::command]
async fn http_get_data_url(url: String) -> Result<String, String> {
    use base64::Engine;
    let url = checked_https(&url, &["i.ytimg.com"])?;
    let resp = http_client()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mime = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Playlists por enlace (1.9.2, Música → Añadir; lib/extensions/playlist-link.ts):
/// la página pública de la lista en Spotify, YouTube (Music) o Apple Music, o
/// la API pública de Deezer. Lista cerrada de servicios; las redirecciones de
/// los enlaces cortos, solo dentro de ella; y POST solo para pedir a YouTube
/// la página siguiente de una lista larga.
const PLAYLIST_HOSTS: [&str; 11] = [
    "open.spotify.com",
    "spotify.link",
    "spotify.app.link",
    "api.deezer.com",
    "www.deezer.com",
    "deezer.com",
    "link.deezer.com",
    "deezer.page.link",
    "www.youtube.com",
    "music.youtube.com",
    "music.apple.com",
];
const PLAYLIST_MAX_BYTES: usize = 8 * 1024 * 1024;

fn playlist_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        let policy = reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.url().scheme() == "https"
                && attempt.url().host_str().map_or(false, |host| PLAYLIST_HOSTS.contains(&host));
            if attempt.previous().len() >= 5 {
                attempt.error("Demasiadas redirecciones.")
            } else if allowed {
                attempt.follow()
            } else {
                attempt.stop()
            }
        });
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(25))
            .user_agent(concat!("Frame/", env!("CARGO_PKG_VERSION"), " (Asvent)"))
            .redirect(policy)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

#[derive(serde::Serialize)]
struct PlaylistPage {
    /// Adonde llegó (o adonde apunta una redirección fuera de la lista).
    url: String,
    status: u16,
    body: String,
}

#[tauri::command]
async fn playlist_page(url: String, body: Option<String>) -> Result<PlaylistPage, String> {
    let parsed = checked_https(&url, &PLAYLIST_HOSTS)?;
    let client = playlist_client();
    let request = match body {
        Some(json) => {
            if parsed.host_str() != Some("www.youtube.com") || parsed.path() != "/youtubei/v1/browse" || json.len() > 64 * 1024 {
                return Err("Servicio no permitido.".into());
            }
            client.post(parsed).header("Content-Type", "application/json").body(json)
        }
        None => client.get(parsed),
    };
    let resp = request
        .header("Accept-Language", ui("es", "en"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let landed = if status.is_redirection() {
        resp.headers().get("location").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string()
    } else {
        resp.url().to_string()
    };
    if resp.content_length().map_or(false, |len| len as usize > PLAYLIST_MAX_BYTES) {
        return Err("La página es demasiado grande.".into());
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > PLAYLIST_MAX_BYTES {
        return Err("La página es demasiado grande.".into());
    }
    Ok(PlaylistPage { url: landed, status: status.as_u16(), body: String::from_utf8_lossy(&bytes).into_owned() })
}

/// Servicios de Google REALES incrustados en la interfaz (Gmail, YouTube,
/// Classroom): un webview hijo superpuesto exactamente sobre el
/// recuadro que dibuja la app. El frontend reporta posición/tamaño del
/// recuadro (px CSS = lógicos) en cada scroll/resize; con visible=false el
/// webview se aparta fuera de vista (sigue vivo, así la página no se recarga
/// al navegar entre secciones). La sesión de Google persiste en WebView2.
/// Pantalla completa CONTENIDA dentro del recuadro de Frame.
///
/// El reproductor de YouTube pide pantalla completa al motor web y este, al
/// concederla, expande la ventana por encima de todo — barra de tareas
/// incluida. Eso deja al usuario sin reloj, sin bandeja y sin forma de cambiar
/// de aplicación, que no es lo que pide quien solo quiere ver el vídeo grande.
///
/// La solución es sustituir la API por una equivalente que estira el elemento
/// hasta los bordes DEL WEBVIEW: el vídeo ocupa todo el espacio de Frame, la
/// página cree que está en pantalla completa (se emite `fullscreenchange` y
/// `document.fullscreenElement` responde), y el escritorio sigue en su sitio.
const FULLSCREEN_GUARD_JS: &str = r#"
(function () {
  if (window.__frameFsPatched) return;
  window.__frameFsPatched = true;
  var current = null;

  function ensureStyle() {
    if (document.getElementById('frame-fs-style')) return;
    var css = document.createElement('style');
    css.id = 'frame-fs-style';
    css.textContent = '[data-frame-fs]{position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;width:100vw !important;height:100vh !important;max-width:100vw !important;max-height:100vh !important;margin:0 !important;z-index:2147483647 !important;background:#000 !important;}html[data-frame-fs-on],html[data-frame-fs-on] body{overflow:hidden !important;}';
    (document.head || document.documentElement).appendChild(css);
  }

  function fire() {
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(function (name) {
      try { document.dispatchEvent(new Event(name, { bubbles: true })); } catch (e) {}
    });
  }

  function enter(el) {
    ensureStyle();
    if (current && current !== el) current.removeAttribute('data-frame-fs');
    current = el;
    el.setAttribute('data-frame-fs', '');
    document.documentElement.setAttribute('data-frame-fs-on', '');
    fire();
    return Promise.resolve();
  }

  function leave() {
    if (current) current.removeAttribute('data-frame-fs');
    current = null;
    document.documentElement.removeAttribute('data-frame-fs-on');
    fire();
    return Promise.resolve();
  }

  var descriptor = { get: function () { return current; }, configurable: true };
  ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'].forEach(function (prop) {
    try { Object.defineProperty(Document.prototype, prop, descriptor); } catch (e) {}
    try { Object.defineProperty(document, prop, descriptor); } catch (e) {}
  });
  try {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: function () { return true; }, configurable: true });
  } catch (e) {}

  ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen', 'msRequestFullscreen'].forEach(function (name) {
    try { Element.prototype[name] = function () { return enter(this); }; } catch (e) {}
  });
  ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach(function (name) {
    try { Document.prototype[name] = function () { return leave(); }; } catch (e) {}
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && current) leave();
  }, true);
})();
"#;

/// Enlaces que abren otra ventana (`target="_blank"`) en las páginas de Google
/// (1.6.8). El plugin `opener` de Tauri inyecta en TODAS las páginas un script
/// que los intercepta en `window`, hace `preventDefault()` y pide abrirlos por
/// IPC; en una página remota esa llamada no está permitida y el enlace se
/// anula sin más: así «Iniciar sesión» de Gmail y de Classroom no hacía nada
/// (lo midió el `.exe` por CDP el 13-oct). Este script escucha antes, en
/// `document`, y abre el enlace con `window.open`, que sí llega a
/// `on_new_window`: el acceso de Google sigue en la página y lo demás va al
/// navegador del sistema. Si la página ya atendió el clic, no hace nada.
const NEW_WINDOW_LINKS_JS: &str = r#"
(function () {
  if (window.__frameNewWindowLinks) return;
  window.__frameNewWindowLinks = true;
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var path = event.composedPath ? event.composedPath() : [event.target];
    var link = null;
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (node && node.nodeName && node.nodeName.toUpperCase() === 'A' && node.href) {
        link = node;
        break;
      }
    }
    if (!link || link.hasAttribute('download')) return;
    var target = (link.getAttribute('target') || '').toLowerCase();
    if (!target || target === '_self' || target === '_top' || target === '_parent') return;
    if (!/^https?:/i.test(link.href)) return;
    event.preventDefault();
    window.open(link.href, '_blank', 'noopener');
  }, false);
})();
"#;

/// Páginas de Google incrustadas. Cada perfil de Frame tiene su propia carpeta
/// de datos (cookies y sesión de Google): en un equipo compartido nadie hereda
/// el correo ni las clases de quien usó Frame antes (1.6.7).
const EMBED_LABELS: [&str; 4] = ["gmail-embed", "youtube-embed", "classroom-embed", "drive-embed"];
static EMBED_PROFILE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
/// La cuenta con que se abrió Drive (la de Wire, 1.8.0): si cambia, se vuelve
/// a abrir con la nueva.
static DRIVE_ACCOUNT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Carpeta de datos de las páginas incrustadas de un perfil.
fn embed_data_dir(app: &tauri::AppHandle, profile: &str) -> Result<std::path::PathBuf, String> {
    let safe: String = profile
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if safe.is_empty() {
        return Err("Perfil no válido.".into());
    }
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("embeds").join(safe))
}

fn close_embeds(app: &tauri::AppHandle) {
    for label in EMBED_LABELS {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.close();
        }
    }
}

/// Al cerrar sesión o cambiar de perfil: fuera las páginas del perfil anterior.
#[tauri::command]
fn google_embed_close_all(app: tauri::AppHandle) -> Result<(), String> {
    close_embeds(&app);
    *EMBED_PROFILE.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// google.com, google.com.pe, accounts.google.com… y los dominios de YouTube y Google.
fn is_google_domain(domain: &str) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    const OTHERS: [&str; 6] = ["youtube.com", "gstatic.com", "googleusercontent.com", "googleapis.com", "ggpht.com", "ytimg.com"];
    domain.split('.').any(|part| part == "google")
        || OTHERS.iter().any(|d| domain == *d || domain.ends_with(&format!(".{d}")))
}

/// Hasta la 1.6.6 las páginas incrustadas compartían las cookies de la app:
/// la sesión de Google de un perfil la veían todos. Se borran una vez del
/// almacén común (lo propio de Frame —datos, ajustes— no se toca).
#[tauri::command]
async fn clear_shared_google_session(app: tauri::AppHandle) -> Result<u32, String> {
    let main = app.get_webview_window("main").ok_or("Ventana principal no disponible.")?;
    let mut removed = 0;
    for cookie in main.cookies().map_err(|e| e.to_string())? {
        if cookie.domain().map_or(false, is_google_domain) && main.delete_cookie(cookie).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Servicio de cada página incrustada: su casa y la dirección con que se abre.
fn embed_service(kind: &str) -> Option<(&'static str, &'static str, &'static [&'static str])> {
    match kind {
        "gmail" => Some(("gmail-embed", "https://mail.google.com/", &["mail.google.com"])),
        "youtube" => Some(("youtube-embed", "https://www.youtube.com/", &["www.youtube.com", "youtube.com", "m.youtube.com"])),
        "classroom" => Some(("classroom-embed", "https://classroom.google.com/", &["classroom.google.com"])),
        // Drive (1.8.0, con Wire): los documentos que abre en otra ventana van
        // al navegador, como los enlaces de Classroom.
        "drive" => Some(("drive-embed", "https://drive.google.com/drive/my-drive", &["drive.google.com"])),
        _ => None,
    }
}

/// La dirección con que se abre un servicio: en el idioma de Frame (sin `hl`,
/// Google saldría en el de Windows) y, si se pide, con una cuenta concreta
/// (`authuser`: Google elige esa entre las que tienen sesión abierta).
fn embed_url(base: &str, account: Option<&str>) -> Result<tauri::Url, String> {
    let mut url = base.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("hl", ui("es", "en"));
        if let Some(account) = account {
            query.append_pair("authuser", account);
        }
    }
    Ok(url)
}

/// `google.com/url?q=…` (los enlaces de un correo pasan por ahí): el destino real.
fn unwrap_google_redirect(url: tauri::Url) -> tauri::Url {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if (host == "www.google.com" || host == "google.com") && url.path() == "/url" {
        if let Some((_, target)) = url.query_pairs().find(|(k, _)| k == "q" || k == "url") {
            if let Ok(parsed) = target.parse::<tauri::Url>() {
                return parsed;
            }
        }
    }
    url
}

/// ¿Esta ventana nueva se queda dentro del recuadro? Sí el inicio de sesión de
/// Google (cuentas y consentimiento) y la casa del propio servicio; lo demás
/// (un enlace de un correo, la página de un vídeo en otro sitio…) va al
/// navegador del sistema.
fn stays_in_embed(url: &tauri::Url, home: &[&str]) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    const SIGN_IN: [&str; 5] = [
        "accounts.google.com",
        "accounts.youtube.com",
        "consent.google.com",
        "consent.youtube.com",
        "myaccount.google.com",
    ];
    SIGN_IN.contains(&host.as_str()) || home.contains(&host.as_str())
}

#[tauri::command]
async fn google_embed_update(
    app: tauri::AppHandle,
    kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    profile: String,
    account: Option<String>,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    let (label, base, home) = embed_service(&kind).ok_or("Servicio no permitido.")?;
    // Solo Drive se abre con una cuenta concreta: la conectada en Wire.
    let account = if kind == "drive" {
        account.map(|a| a.trim().to_string()).filter(|a| !a.is_empty() && a.len() <= 320)
    } else {
        None
    };
    let url = embed_url(base, account.as_deref())?;

    // Otro perfil: las páginas del anterior se cierran antes de nada.
    {
        let mut current = EMBED_PROFILE.lock().map_err(|e| e.to_string())?;
        if current.as_deref() != Some(profile.as_str()) {
            close_embeds(&app);
            *current = Some(profile.clone());
        }
    }

    const OFFSCREEN: LogicalPosition<f64> = LogicalPosition { x: -30000.0, y: 0.0 };
    let w = width.max(1.0);
    let h = height.max(1.0);

    if let Some(webview) = app.get_webview(label) {
        if visible {
            // Otra cuenta en Wire: Drive se vuelve a abrir con ella.
            if kind == "drive" {
                let mut last = DRIVE_ACCOUNT.lock().map_err(|e| e.to_string())?;
                if *last != account {
                    *last = account.clone();
                    let _ = webview.navigate(url.clone());
                }
            }
            webview
                .set_size(LogicalSize::new(w, h))
                .map_err(|e| e.to_string())?;
            webview
                .set_position(LogicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        } else {
            webview.set_position(OFFSCREEN).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    // Aún no existe: solo se crea cuando el recuadro es visible.
    if !visible {
        return Ok(());
    }
    let window = app
        .get_window("main")
        .ok_or("Ventana principal no disponible.")?;
    // Ventanas nuevas (1.6.8). Sin este manejador wry las descarta en
    // silencio, y «Iniciar sesión» de Gmail, Classroom o YouTube abre una:
    // desde la 1.6.7 cada perfil tiene su propia sesión de Google en estas
    // páginas y el botón no hacía nada. El inicio de sesión se abre aquí
    // mismo; un enlace a otro sitio, en el navegador del sistema. Los enlaces
    // `_blank` llegan aquí gracias a NEW_WINDOW_LINKS_JS.
    if kind == "drive" {
        *DRIVE_ACCOUNT.lock().map_err(|e| e.to_string())? = account.clone();
    }
    let app_ = app.clone();
    let builder =
        tauri::webview::WebviewBuilder::new(label, tauri::WebviewUrl::External(url))
            // Cookies y sesión de Google de ESTE perfil, aparte de las de los demás.
            .data_directory(embed_data_dir(&app, &profile)?)
            // El reproductor vive a veces en un iframe: hay que parchear todos.
            .initialization_script_for_all_frames(FULLSCREEN_GUARD_JS)
            // Los enlaces a otra ventana, hacia `on_new_window` (ver arriba).
            .initialization_script_for_all_frames(NEW_WINDOW_LINKS_JS)
            .on_new_window(move |requested, _features| {
                let target = unwrap_google_redirect(requested);
                if stays_in_embed(&target, home) {
                    if let Some(webview) = app_.get_webview(label) {
                        let _ = webview.navigate(target);
                    }
                } else if matches!(target.scheme(), "https" | "http") {
                    let _ = tauri_plugin_opener::open_url(target.as_str(), None::<&str>);
                }
                tauri::webview::NewWindowResponse::Deny
            });
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// URL actual del webview incrustado de YouTube: «Añadir vídeo» de Estudio la
/// usa para saber qué vídeo se está viendo y guardar su ficha.
#[tauri::command]
fn youtube_embed_current_url(app: tauri::AppHandle) -> Result<String, String> {
    let webview = app
        .get_webview("youtube-embed")
        .ok_or("Abre un video de YouTube primero.")?;
    webview.url().map(|u| u.to_string()).map_err(|e| e.to_string())
}

/// Comando de proceso sin destello de consola en Windows (los .exe de
/// explorer abriría una ventana negra por cada llamada).
fn silent_command(bin: &std::path::Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

// ============================================================
// Ventana flotante de Enfoque: pequeña, sin bordes, SIEMPRE por encima de
// todo (incluidas otras apps) y viva aunque la ventana principal se cierre
// a la bandeja. Solo muestra la UI: el motor del temporizador sigue en la
// ventana principal y le llega por eventos.
// ============================================================

/// Tamaños de la ventana flotante: mediana (tarjeta completa) y compacta
/// (una sola fila con el tiempo y los controles).
const MINI_MEDIUM: (f64, f64) = (300.0, 190.0);
const MINI_COMPACT: (f64, f64) = (280.0, 56.0);
/// Mediana con el editor de anotaciones abierto.
const MINI_TALL: (f64, f64) = (300.0, 300.0);

#[tauri::command]
async fn open_mini_timer(
    app: tauri::AppHandle,
    compact: Option<bool>,
    tall: Option<bool>,
) -> Result<(), String> {
    let (w_px, h_px) = if compact.unwrap_or(false) {
        MINI_COMPACT
    } else if tall.unwrap_or(false) {
        MINI_TALL
    } else {
        MINI_MEDIUM
    };

    if let Some(w) = app.get_webview_window("minitimer") {
        // La ventana no es redimensionable por el usuario: en Windows
        // set_size se ignora en ese estado, así que se habilita solo
        // durante el cambio de tamaño programático.
        let _ = w.set_resizable(true);
        let _ = w.set_size(tauri::LogicalSize::new(w_px, h_px));
        let _ = w.set_resizable(false);
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    let w = tauri::WebviewWindowBuilder::new(
        &app,
        "minitimer",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(window_title("minitimer"))
    .inner_size(w_px, h_px)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Arranca en la esquina superior derecha del monitor, con margen.
    if let Ok(Some(monitor)) = w.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let _ = w.set_position(tauri::LogicalPosition::new(size.width - w_px - 24.0, 64.0));
    }
    Ok(())
}

/// Despertador del reloj de estudio. Con la ventana oculta, Chromium estrangula
/// los temporizadores de la página y el fin del temporizador llegaba tarde; un
/// evento nativo no se estrangula. Los despertares de más son inofensivos: la
/// interfaz solo recalcula el reloj.
#[tauri::command]
fn schedule_wake(app: tauri::AppHandle, ms: u64) {
    let ms = ms.min(24 * 60 * 60 * 1000);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(ms));
        let _ = app.emit("frame-wake", ());
    });
}

#[tauri::command]
async fn close_mini_timer(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("minitimer") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ------------------------------------------------------------
// Vistazo al horario desde el borde de la pantalla
//
// Llevar el cursor al borde izquierdo y dejarlo ahí un segundo enseña el
// horario a tamaño completo, esté Frame delante, detrás o minimizada. Es el
// gesto de las barras laterales de Windows, y resuelve el caso real: mirar el
// horario mientras se trabaja en otra cosa, sin cambiar de aplicación.
//
// El seguimiento es un sondeo del cursor cada 120 ms —no un hook global del
// sistema— porque no necesita interceptar nada: solo saber dónde está el
// ratón. Es barato y no toca la entrada de las demás aplicaciones.
// ------------------------------------------------------------

/// Franja del borde izquierdo que dispara el vistazo (píxeles físicos).
const HOT_CORNER_PX: f64 = 3.0;
/// Cuánto hay que quedarse ahí: sin esto saltaría al pasar de largo.
const HOT_CORNER_DWELL_MS: u64 = 700;
/// A partir de esta distancia del borde, el vistazo se retira solo.
const HOT_CORNER_RELEASE_PX: f64 = 120.0;
/// Alto del vistazo: la mitad exacta de la pantalla, centrado en vertical.
/// A pantalla completa el horario tapaba el escritorio entero; a la mitad se
/// lee igual de bien y se sigue viendo lo que hay debajo.
const PEEK_HEIGHT_RATIO: f64 = 0.5;
/// Ancho inicial: el frontend lo ajusta a la proporción real de la imagen.
const PEEK_WIDTH_RATIO: f64 = 0.32;

static PEEK_OPEN: AtomicBool = AtomicBool::new(false);
/// El frontend lo apaga cuando no hay ninguna imagen de horario guardada.
static PEEK_ENABLED: AtomicBool = AtomicBool::new(false);

fn monitor_under_cursor(app: &tauri::AppHandle) -> (f64, f64, f64, f64) {
    let cursor = app
        .cursor_position()
        .unwrap_or(tauri::PhysicalPosition::new(0.0, 0.0));
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    match monitor {
        Some(m) => {
            let scale = m.scale_factor();
            let size = m.size().to_logical::<f64>(scale);
            let position = m.position().to_logical::<f64>(scale);
            (position.x, position.y, size.width, size.height)
        }
        None => (0.0, 0.0, 1280.0, 800.0),
    }
}

fn peek_geometry(app: &tauri::AppHandle) -> (f64, f64, f64, f64) {
    let (x, y, width, height) = monitor_under_cursor(app);
    let peek_height = (height * PEEK_HEIGHT_RATIO).max(240.0);
    // Pegado al borde izquierdo y centrado en vertical.
    (
        x,
        y + (height - peek_height) / 2.0,
        (width * PEEK_WIDTH_RATIO).max(280.0),
        peek_height,
    )
}

fn show_schedule_peek(app: &tauri::AppHandle) -> Result<(), String> {
    let (x, y, peek_width, peek_height) = peek_geometry(app);

    if let Some(window) = app.get_webview_window("schedulepeek") {
        let _ = window.set_size(tauri::LogicalSize::new(peek_width, peek_height));
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        PEEK_OPEN.store(true, Ordering::SeqCst);
        // La ventana ya existe: hay que avisarla para que rearranque su
        // animación de entrada, porque no se vuelve a montar.
        let _ = app.emit("schedule-peek-open", ());
        return Ok(());
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        "schedulepeek",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title(window_title("schedulepeek"))
    .inner_size(peek_width, peek_height)
    .position(x, y)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = window.show();
    PEEK_OPEN.store(true, Ordering::SeqCst);
    Ok(())
}

fn hide_schedule_peek(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("schedulepeek") {
        let _ = window.hide();
    }
    PEEK_OPEN.store(false, Ordering::SeqCst);
}

/// Mostrar u ocultar el vistazo a mano (lo usa la propia ventana al cerrarse).
#[tauri::command]
fn schedule_peek(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if visible {
        show_schedule_peek(&app)
    } else {
        hide_schedule_peek(&app);
        Ok(())
    }
}

/// El gesto solo tiene sentido si hay un horario que enseñar.
#[tauri::command]
fn schedule_peek_enable(app: tauri::AppHandle, enabled: bool) {
    PEEK_ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        hide_schedule_peek(&app);
    }
}

/// Ajuste fino del ancho: lo pide la ventana cuando conoce la proporción real
/// de la imagen, para que no sobre ni falte ni un píxel a su derecha.
#[tauri::command]
fn schedule_peek_resize(app: tauri::AppHandle, width: f64) -> Result<(), String> {
    let (x, y, _, peek_height) = peek_geometry(&app);
    let (_, _, monitor_width, _) = monitor_under_cursor(&app);
    let window = app
        .get_webview_window("schedulepeek")
        .ok_or("El vistazo no está abierto.")?;
    let clamped = width.max(200.0).min(monitor_width);
    window
        .set_size(tauri::LogicalSize::new(clamped, peek_height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn spawn_hot_corner(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        const STEP_MS: u64 = 120;
        let step = std::time::Duration::from_millis(STEP_MS);
        let mut dwell: u64 = 0;

        loop {
            std::thread::sleep(step);
            if !PEEK_ENABLED.load(Ordering::Relaxed) {
                dwell = 0;
                continue;
            }

            let cursor = match app.cursor_position() {
                Ok(position) => position,
                Err(_) => continue,
            };
            // Borde izquierdo DEL MONITOR donde está el cursor: con dos
            // pantallas, el borde de la derecha no es x = 0.
            let left = app
                .monitor_from_point(cursor.x, cursor.y)
                .ok()
                .flatten()
                .map(|m| m.position().x as f64)
                .unwrap_or(0.0);
            let distance = cursor.x - left;
            // Salvaguarda: si el indicador dice "abierto" pero la ventana no
            // está a la vista, alguien perdió el hilo (un cierre y una
            // reapertura que se cruzaron). Sin esto el vistazo se quedaba
            // muerto para el resto de la sesión, que es justo el fallo que
            // hacía que solo funcionara la primera vez.
            let shown = app
                .get_webview_window("schedulepeek")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if PEEK_OPEN.load(Ordering::Relaxed) && !shown {
                PEEK_OPEN.store(false, Ordering::SeqCst);
            }
            let open = PEEK_OPEN.load(Ordering::Relaxed);

            if distance <= HOT_CORNER_PX && !open {
                dwell += STEP_MS;
                if dwell >= HOT_CORNER_DWELL_MS {
                    dwell = 0;
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let _ = show_schedule_peek(&handle);
                    });
                }
            } else if distance > HOT_CORNER_PX {
                dwell = 0;
                // Con el vistazo abierto, el margen de salida es el ancho de
                // la propia imagen: si no, bastaría mover el ratón para
                // mirarla de cerca para que se cerrara en la cara.
                let release = if open {
                    app.get_webview_window("schedulepeek")
                        .and_then(|w| w.outer_size().ok())
                        .map(|size| size.width as f64 + HOT_CORNER_RELEASE_PX)
                        .unwrap_or(HOT_CORNER_RELEASE_PX)
                } else {
                    HOT_CORNER_RELEASE_PX
                };
                if open && distance > release {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        hide_schedule_peek(&handle);
                    });
                }
            }
        }
    });
}

/// Trae la ventana principal al frente (p. ej. al presionar Finalizar
/// desde la ventana flotante).
#[tauri::command]
async fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        // Windows no deja que una ventana se ponga delante de otra app solo
        // con pedir el foco: la hace parpadear en la barra de tareas y la
        // deja detrás. Ponerla un instante «siempre encima» la trae al
        // frente de verdad; enseguida se quita, para que después se comporte
        // como una ventana normal.
        //
        // Quitarlo en el acto no bastaba cuando Frame no era la app activa
        // (fin de una sesión con la vista flotante): Windows la volvía a dejar
        // detrás. Se mantiene encima un momento y luego se suelta.
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
        let w2 = w.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = w2.set_always_on_top(false);
            let _ = w2.set_focus();
        });
    }
    Ok(())
}

/// Cierra Frame de verdad. Lo llama el frontend cuando ya resolvió qué hacer
/// con una sesión de estudio en curso (o cuando no había ninguna).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    if let Some(main) = app.get_window("main") {
        window_state::capture(&main);
    }
    window_state::save(&app);
    app.exit(0);
}

/// El usuario se arrepintió de cerrar: se rearma la pregunta para la próxima.
#[tauri::command]
fn cancel_quit() {
    CLOSE_ASKED.store(false, Ordering::SeqCst);
}

// ------------------------------------------------------------
// Guardas de los comandos que tocan archivos.
//
// Estos comandos reciben rutas y nombres desde la interfaz web. La interfaz
// es nuestra, pero muestra contenido que no lo es (adjuntos, textos pegados,
// páginas incrustadas), así que el núcleo nativo no da por buena ninguna ruta:
// abrir "lo que me digan" y borrar "lo que me digan" son justo las dos piezas
// que un fallo en la web necesitaría para salir del navegador.
// ------------------------------------------------------------

/// Extensiones que Windows EJECUTA al "abrirlas". Frame abre documentos,
/// nunca programas: un adjunto «tarea.pdf.exe» no se lanza desde aquí.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf",
    "wsh", "hta", "msi", "msp", "lnk", "reg", "dll", "cpl", "jar", "scf", "url", "inf", "msc",
    "application", "gadget", "appref-ms",
    // Intérpretes que Windows lanza al abrir el archivo si están instalados.
    "py", "pyw", "pyc", "pyz", "pyzw", "rb", "pl", "php", "sh", "wsc", "ws", "vb", "sct", "shb", "shs",
    "psc1", "ps1xml", "ps2", "ps2xml", "msh", "msh1", "msh2", "mshxml", "xbap", "chm", "hlp", "ade",
    "adp", "mde", "ins", "isp", "its", "jnlp", "diagcab", "settingcontent-ms", "library-ms", "website",
    // Instaladores y discos.
    "appx", "appxbundle", "msix", "msixbundle", "appinstaller", "iso", "img", "vhd", "vhdx",
    // Documentos de Office CON macros.
    "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam", "ppsm", "sldm",
];

fn is_executable(path: &std::path::Path) -> bool {
    // Windows recorta los puntos y espacios finales al resolver la ruta:
    // «tarea.exe » se abre como «tarea.exe». Se comprueba el nombre ya recortado,
    // y un flujo alterno («nota.txt:oculto.exe») se da por ejecutable.
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n.trim_end_matches(|c: char| c == '.' || c == ' ').to_ascii_lowercase(),
        None => return true,
    };
    if name.contains(':') {
        return true;
    }
    match name.rsplit_once('.') {
        Some((_, ext)) => EXECUTABLE_EXTENSIONS.contains(&ext.trim()),
        None => false,
    }
}

/// ¿`path` está DE VERDAD dentro de `dir`? Se resuelven `..` y enlaces antes
/// de comparar: `starts_with` a secas da por bueno "carpeta\..\..\otro".
fn is_inside(dir: &std::path::Path, path: &std::path::Path) -> bool {
    match (dir.canonicalize(), path.canonicalize()) {
        (Ok(dir), Ok(path)) => path.starts_with(dir),
        _ => false,
    }
}

/// Marca de «descargado de Internet» (Mark of the Web, 1.7.0): un adjunto
/// puede venir de cualquier parte; con la marca, Windows y Office lo tratan con
/// cautela (SmartScreen, Vista protegida), como a cualquier descarga.
fn mark_from_internet(path: &std::path::Path) {
    #[cfg(windows)]
    {
        let mut stream = path.as_os_str().to_owned();
        stream.push(":Zone.Identifier");
        let _ = std::fs::write(std::path::PathBuf::from(stream), "[ZoneTransfer]\r\nZoneId=3\r\n");
    }
    #[cfg(not(windows))]
    let _ = path;
}

/// ¿Es un archivo que Frame dejó en el equipo? Descargas, Documentos (las
/// grabaciones y el plan B de Descargas) y los datos de la app. Una ruta de
/// red (\\equipo\carpeta) se rechaza antes de tocar el disco: solo
/// comprobar si existe ya hace que Windows se identifique ante ese equipo.
fn own_file(app: &tauri::AppHandle, path: &std::path::Path) -> bool {
    let raw = path.to_string_lossy();
    if raw.starts_with("\\\\") || raw.starts_with("//") {
        return false;
    }
    [app.path().download_dir().ok(), app.path().document_dir().ok(), app.path().app_data_dir().ok()]
        .iter()
        .flatten()
        .any(|dir| is_inside(dir, path))
}

/// Guarda un adjunto de nota (Word, Excel, PDF…) en la carpeta temporal y lo
/// abre con la aplicación predeterminada del sistema, sin que el usuario
/// tenga que descargarlo de nuevo.
#[tauri::command]
fn open_note_file(file_name: String, data_base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Adjunto ilegible: {e}"))?;

    let dir = std::env::temp_dir().join("frame-notes");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let safe: String = file_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let name = if safe.trim().is_empty() { "archivo".to_string() } else { safe };
    let path = dir.join(name);
    if is_executable(&path) {
        return Err("Por seguridad, Frame no abre programas ni scripts adjuntos.".into());
    }

    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    mark_from_internet(&path);
    tauri_plugin_opener::open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Escribe un archivo generado o guardado en el frontend dentro de Descargas
/// y devuelve la ruta completa. Si el nombre ya existe, se numera (2), (3)…
/// en vez de pisar el anterior. `allowed`: extensiones admitidas (None, todas).
fn save_in_downloads(
    app_handle: &tauri::AppHandle,
    file_name: &str,
    data_base64: &str,
    allowed: Option<&[&str]>,
    fallback: &str,
    mark: bool,
) -> Result<String, String> {
    save_in_downloads_at(app_handle, None, file_name, data_base64, allowed, fallback, mark)
}

/// Igual, pero dentro de una carpeta propia de Descargas (`folder`, un solo
/// nombre: sin barras ni «..»).
fn save_in_downloads_at(
    app_handle: &tauri::AppHandle,
    folder: Option<&str>,
    file_name: &str,
    data_base64: &str,
    allowed: Option<&[&str]>,
    fallback: &str,
    mark: bool,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Informe ilegible: {e}"))?;

    let mut dir = app_handle
        .path()
        .download_dir()
        .or_else(|_| app_handle.path().document_dir())
        .map_err(|e| format!("Sin carpeta de descargas: {e}"))?;
    if let Some(folder) = folder {
        let clean: String = folder
            .chars()
            .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
            .take(80)
            .collect();
        let clean = clean.trim().trim_matches('.').trim();
        dir = dir.join(if clean.is_empty() { "Frame" } else { clean });
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let safe: String = file_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let safe = if safe.trim().is_empty() { fallback.to_string() } else { safe };

    let (stem, extension) = match safe.rfind('.') {
        Some(index) => (safe[..index].to_string(), safe[index..].to_string()),
        None => (safe.clone(), String::new()),
    };
    if let Some(allowed) = allowed {
        if !allowed.contains(&extension.to_ascii_lowercase().as_str()) {
            return Err("Formato de informe no admitido.".into());
        }
    }

    let mut path = dir.join(&safe);
    let mut attempt = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({attempt}){extension}"));
        attempt += 1;
        if attempt > 500 {
            break;
        }
    }

    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    if mark {
        mark_from_internet(&path);
    }
    Ok(path.to_string_lossy().to_string())
}

/// Guarda un informe en Descargas para que el aviso de «informe listo» pueda
/// ABRIRLO: la descarga del navegador no dice dónde acabó el archivo.
///
/// Solo los formatos de informe: con cualquier extensión, sumado a
/// `open_local_file`, era una forma de dejar un programa en Descargas y
/// lanzarlo.
#[tauri::command]
fn save_report_file(
    app_handle: tauri::AppHandle,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    // «.md»: el Reporte del Panel de uso también sale en Markdown (1.6.9).
    const REPORT_EXTENSIONS: &[&str] = &[".docx", ".pdf", ".md", ".html", ".txt", ".csv"];
    save_in_downloads(&app_handle, &file_name, &data_base64, Some(REPORT_EXTENSIONS), "Informe.docx", false)
}

/// Copia en Descargas de un adjunto o del archivo de una anotación (1.6.7).
/// Sustituye a la descarga del motor web, cuyo aviso sale en el idioma de
/// Windows. Admite cualquier extensión porque es un archivo del propio
/// usuario, y por eso Frame nunca lo abre: solo puede mostrarlo en su carpeta.
#[tauri::command]
fn save_file_copy(
    app_handle: tauri::AppHandle,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    save_in_downloads(&app_handle, &file_name, &data_base64, None, "Archivo", true)
}

/// «Descarga por colección» de la Biblioteca (1.9.2): cada archivo va a una
/// carpeta propia de Descargas («Biblioteca 2026-11-09»), no suelto.
#[tauri::command]
fn save_file_in_folder(
    app_handle: tauri::AppHandle,
    folder: String,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    save_in_downloads_at(&app_handle, Some(&folder), &file_name, &data_base64, None, "Archivo", true)
}

// ============================================================
// «Importar» (Música): canciones o carpetas del propio usuario.
//
// El diálogo es el explorador de archivos de Windows. Lo elegido queda
// registrado y `music_read` SOLO lee esos archivos: el comando no sirve para
// leer nada más del disco.
// ============================================================

#[derive(Serialize)]
struct PickedFile {
    path: String,
    /// Ruta relativa a la carpeta elegida, con «/» («Portadas/x.jpg»).
    rel: String,
    name: String,
    size: u64,
}

#[derive(Serialize)]
struct PickedSource {
    kind: &'static str,
    name: String,
    files: Vec<PickedFile>,
}

static PICKED: std::sync::Mutex<Option<std::collections::HashSet<std::path::PathBuf>>> = std::sync::Mutex::new(None);

const AUDIO_EXTENSIONS: [&str; 11] = ["mp3", "m4a", "m4b", "aac", "ogg", "oga", "opus", "flac", "wav", "webm", "weba"];
/// Audio que el motor de Frame (WebView2) no reproduce. Se recoge igual, sin
/// leerlo nunca, para decirle al usuario cuántos quedaron fuera y por qué en
/// vez de ignorarlos en silencio.
const UNSUPPORTED_AUDIO_EXTENSIONS: [&str; 15] = [
    "wma", "aif", "aiff", "aifc", "ape", "wv", "tta", "dsf", "dff", "amr", "ac3", "dts", "mka", "mid", "midi",
];
/// En una carpeta, además del audio: letras (.lrc, o .txt con el mismo nombre
/// que la canción), portadas y el índice de una exportación de Frame
/// (frame-musica.json).
const COMPANION_EXTENSIONS: [&str; 11] = ["lrc", "txt", "jpg", "jpeg", "jpe", "jfif", "png", "webp", "bmp", "gif", "json"];

fn is_music_extension(ext: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&ext) || UNSUPPORTED_AUDIO_EXTENSIONS.contains(&ext) || COMPANION_EXTENSIONS.contains(&ext)
}
const MAX_PICKED: usize = 20_000;

fn extension_of(path: &std::path::Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Niveles de subcarpetas que se recorren (Artista/Álbum/Disco 1/… cabe de sobra).
const MAX_DEPTH: usize = 16;

fn walk_music(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<PickedFile>, depth: usize) {
    if depth > MAX_DEPTH || out.len() >= MAX_PICKED {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            // Papelera, carpetas de sistema y ocultas: nada que importar, y
            // recorrerlas gastaba el tope de archivos.
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.starts_with('.') || name.starts_with('$') || name == "system volume information" {
                continue;
            }
            walk_music(root, &path, out, depth + 1);
        } else if meta.is_file() {
            if is_music_extension(&extension_of(&path)) {
                let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                out.push(PickedFile {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    rel,
                    size: meta.len(),
                });
                if out.len() >= MAX_PICKED {
                    return;
                }
            }
        }
    }
}

/// Abre el explorador para elegir canciones (`folder = false`) o una carpeta
/// entera, con subcarpetas. None si se canceló.
///
/// Recibe la VENTANA (`Window`), no `WebviewWindow`: la principal lleva
/// webviews hijos (Gmail, Calendar, YouTube) y, en cuanto existe uno, Tauri
/// deja de tratarla como WebviewWindow y el comando fallaba con «current
/// webview is not a WebviewWindow» antes de abrir nada.
#[tauri::command]
async fn music_pick(window: tauri::Window, folder: bool) -> Result<Option<PickedSource>, String> {
    let dialog = rfd::AsyncFileDialog::new().set_parent(&window);
    let (kind, name, files) = if folder {
        let Some(dir) = dialog.set_title(ui("Elige la carpeta con tu música", "Choose the folder with your music")).pick_folder().await else {
            return Ok(None);
        };
        let root = dir.path().to_path_buf();
        // Recorrer una biblioteca grande toca miles de archivos: fuera del
        // hilo de los comandos, para no frenar al resto de la app.
        let walk_root = root.clone();
        let files = tauri::async_runtime::spawn_blocking(move || {
            let mut files = Vec::new();
            walk_music(&walk_root, &walk_root, &mut files, 0);
            files
        })
        .await
        .map_err(|e| e.to_string())?;
        let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| ui("Carpeta", "Folder").into());
        ("folder", name, files)
    } else {
        // Sin el índice .json: suelto no significa nada.
        let exts: Vec<&str> = AUDIO_EXTENSIONS
            .iter()
            .chain(UNSUPPORTED_AUDIO_EXTENSIONS.iter())
            .chain(COMPANION_EXTENSIONS.iter().filter(|ext| **ext != "json"))
            .copied()
            .collect();
        let Some(handles) = dialog
            .set_title(ui(
                "Elige tus canciones (y, si las tienes, sus letras y portadas)",
                "Choose your songs (and their lyrics and covers, if you have them)",
            ))
            .add_filter(ui("Canciones, letras y portadas", "Songs, lyrics and covers"), &exts)
            .pick_files()
            .await
        else {
            return Ok(None);
        };
        let files = handles
            .iter()
            .filter_map(|handle| {
                let path = handle.path();
                let meta = std::fs::metadata(path).ok()?;
                let name = path.file_name()?.to_string_lossy().to_string();
                Some(PickedFile { path: path.to_string_lossy().to_string(), rel: name.clone(), name, size: meta.len() })
            })
            .collect();
        ("files", "Canciones".to_string(), files)
    };
    let allowed = files.iter().map(|f: &PickedFile| std::path::PathBuf::from(&f.path)).collect();
    *PICKED.lock().map_err(|e| e.to_string())? = Some(allowed);
    Ok(Some(PickedSource { kind, name, files }))
}

/// Bytes de un archivo elegido en `music_pick` (como mucho `max`, si se da:
/// para leer solo las etiquetas del principio).
#[tauri::command]
async fn music_read(path: String, max: Option<u64>) -> Result<tauri::ipc::Response, String> {
    let path = std::path::PathBuf::from(path);
    let allowed = PICKED.lock().map_err(|e| e.to_string())?.as_ref().map_or(false, |set| set.contains(&path));
    if !allowed {
        return Err("Ese archivo no se eligió para importar.".into());
    }
    let bytes = match max {
        Some(limit) => {
            use std::io::Read;
            let mut buffer = Vec::new();
            std::fs::File::open(&path)
                .and_then(|file| file.take(limit).read_to_end(&mut buffer))
                .map_err(|e| e.to_string())?;
            buffer
        }
        None => std::fs::read(&path).map_err(|e| e.to_string())?,
    };
    Ok(tauri::ipc::Response::new(bytes))
}

/// Terminada la importación, lo elegido deja de poder leerse.
#[tauri::command]
fn music_pick_release() {
    if let Ok(mut picked) = PICKED.lock() {
        *picked = None;
    }
}

/// Abre un archivo del equipo con el programa que el sistema tenga asociado.
#[tauri::command]
fn open_local_file(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    // Solo lo que Frame guardó (informes, grabaciones): no cualquier ruta.
    if !own_file(&app_handle, &p) || !p.exists() {
        return Err("El archivo ya no está en el disco.".into());
    }
    if is_executable(&p) {
        return Err("Por seguridad, Frame no abre programas ni scripts.".into());
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

fn recordings_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .document_dir()
        .map(|d| d.join("Frame").join("Grabaciones"))
        .or_else(|_| app.path().app_data_dir().map(|d| d.join("Grabaciones")))
        .map_err(|e| format!("Sin carpeta de grabaciones: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

#[derive(serde::Serialize)]
struct SavedRecording {
    path: String,
    format: String,
}

/// Guarda una grabación de voz como archivo permanente, en el formato en que la
/// grabó el motor web: M4A (AAC) donde se puede, WebM (Opus) si no. Los dos se
/// abren con el reproductor de Windows. Devuelve la ruta final en disco.
///
/// El audio llega en crudo, sin base64: con 4 h de grabación, la cadena y sus
/// copias para el IPC duplicaban la memoria. El nombre y la extensión van en
/// cabeceras; el nombre, como cadena JSON escapada a ASCII, que es lo único
/// que admite una cabecera.
#[tauri::command]
async fn save_recording(
    app_handle: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<SavedRecording, String> {
    use serde::Deserialize;
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let file_name: String = header("frame-file-name")
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_default();
    let ext = match header("frame-ext") {
        Some("m4a") => "m4a",
        _ => "webm",
    };
    let bytes: std::borrow::Cow<[u8]> = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => std::borrow::Cow::Borrowed(bytes.as_slice()),
        // Sin el protocolo propio del IPC (respaldo por postMessage), los bytes
        // llegan como una lista JSON de números.
        tauri::ipc::InvokeBody::Json(value) => std::borrow::Cow::Owned(
            Vec::<u8>::deserialize(value).map_err(|e| format!("Audio ilegible: {e}"))?,
        ),
    };

    let dir = recordings_dir(&app_handle)?;
    let safe: String = file_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let stem = if safe.trim().is_empty() { "Grabacion".to_string() } else { safe.trim().to_string() };

    // Nombre único: "Nombre.m4a", "Nombre (2).m4a", …
    let mut path = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("No se pudo escribir el audio: {e}"))?;
    Ok(SavedRecording { path: path.to_string_lossy().to_string(), format: ext.to_string() })
}

/// Renombra el archivo de una grabación en disco cuando el usuario cambia su
/// nombre en la app. Devuelve la nueva ruta (o error si el original no existe).
#[tauri::command]
fn rename_recording_file(
    app_handle: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let old = std::path::PathBuf::from(&path);
    if !old.exists() {
        return Err("El archivo original ya no existe".to_string());
    }
    if !is_inside(&recordings_dir(&app_handle)?, &old) {
        return Err("Ese archivo no es una grabación de Frame.".to_string());
    }
    let ext = old.extension().and_then(|e| e.to_str()).unwrap_or("mp3").to_string();
    let dir = old.parent().ok_or("Ruta inválida")?.to_path_buf();
    let safe: String = new_name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let stem = if safe.trim().is_empty() { "Grabacion".to_string() } else { safe.trim().to_string() };

    let mut target = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while target.exists() && target != old {
        target = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    if target == old {
        return Ok(path);
    }
    std::fs::rename(&old, &target).map_err(|e| format!("No se pudo renombrar: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// Abre el Explorador de Windows con el archivo seleccionado (o la carpeta
/// de grabaciones si el archivo ya no existe).
#[tauri::command]
fn reveal_recording(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if own_file(&app_handle, &p) && p.exists() {
        // La vía de la shell de Windows (SHOpenFolderAndSelectItems) abre la
        // carpeta EXACTA con el archivo ya seleccionado.
        if tauri_plugin_opener::reveal_item_in_dir(&p).is_ok() {
            return Ok(());
        }
        #[cfg(windows)]
        {
            // Plan B: explorer. El argumento va CRUDO: si Rust lo entrecomilla
            // entero (lo hace en cuanto la ruta tiene espacios), explorer no
            // entiende «/select» y abre otra carpeta —era el fallo de antes—.
            use std::os::windows::process::CommandExt;
            let native = p.to_string_lossy().replace('/', "\\");
            silent_command(std::path::Path::new("explorer"))
                .raw_arg(format!("/select,\"{native}\""))
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            return Err("No se pudo abrir la ubicación del archivo.".into());
        }
    }
    let dir = recordings_dir(&app_handle)?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Borra el archivo en disco de una grabación eliminada en la app.
#[tauri::command]
fn delete_recording_file(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    // La ruta viene guardada en el almacenamiento de la interfaz: borrarla "tal
    // cual" permitía eliminar CUALQUIER archivo del usuario con solo alterar
    // ese dato. Solo se borra lo que vive en la carpeta de grabaciones.
    if !is_inside(&recordings_dir(&app_handle)?, &p) {
        return Err("Ese archivo no es una grabación de Frame.".into());
    }
    std::fs::remove_file(&p).map_err(|e| e.to_string())
}

/// Desde la 1.6.1 Frame no descarga nada. Al actualizar encima, el
/// instalador deja los motores de las versiones anteriores (yt-dlp y ffmpeg,
/// unos 150 MB) junto al programa y en la carpeta de datos: se quitan, junto
/// con las carpetas temporales de descargas a medias.
fn remove_download_leftovers(app: &tauri::AppHandle) {
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        for name in ["yt-dlp", "ffmpeg", "ffprobe"] {
            let _ = std::fs::remove_file(dir.join(format!("{name}.exe")));
            let _ = std::fs::remove_file(dir.join(format!("{name}-x86_64-pc-windows-msvc.exe")));
        }
    }
    if let Ok(data) = app.path().app_data_dir() {
        let _ = std::fs::remove_dir_all(data.join("bin"));
    }
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // `Frame-<versión>-updater-<azar>`: la carpeta donde el actualizador
            // dejó cada instalador descargado (1.7.5). Si Frame ya arrancó, la
            // actualización terminó y no sirve de nada: no queda rastro.
            let updater = name.starts_with("Frame-") && name.contains("-updater-");
            if name.starts_with("frame_dl_") || updater {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// rustls necesita un proveedor criptográfico antes del primer cliente HTTP
/// (sin él, `reqwest::Client::new()` entra en pánico). Es el mismo `ring`
/// que instala el actualizador; si ya hay uno, no se toca.
fn install_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_tls_provider();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            set_ui_language,
            read_clipboard_text,
            oauth_wait_callback,
            oauth_cancel_wait,
            open_auth_window,
            close_auth_window,
            google_token_request,
            http_get_text,
            http_get_data_url,
            playlist_page,
            google_embed_update,
            google_embed_close_all,
            clear_shared_google_session,
            youtube_embed_current_url,
            open_local_file,
            music_pick,
            music_read,
            music_pick_release,
            extensions::ext_forget,
            extensions::ext_device_name,
            extensions::ext_music_folder_pick,
            extensions::ext_music_folder,
            extensions::ext_music_folder_scan,
            extensions::ext_secret_set,
            extensions::ext_secret_get,
            extensions::ext_secret_delete,
            extensions::ext_app_launch,
            extensions::ext_app_install,
            ia_bridge::ia_bridge_start,
            ia_bridge::ia_bridge_stop,
            ia_bridge::ia_bridge_reply,
            ia_bridge::ia_exe_path,
            ia_bridge::ia_config_read,
            ia_bridge::ia_config_write,
            ia_bridge::ia_client_installed,
            open_mini_timer,
            schedule_wake,
            close_mini_timer,
            focus_main_window,
            save_report_file,
            save_file_copy,
            save_file_in_folder,
            schedule_peek,
            schedule_peek_enable,
            schedule_peek_resize,
            quit_app,
            cancel_quit,
            open_note_file,
            save_recording,
            rename_recording_file,
            reveal_recording,
            delete_recording_file
        ])
        .setup(|app| {
            // Las copias temporales de adjuntos abiertos en otras apps
            // (`open_note_file`) no deben acumularse en el equipo: se purgan
            // en cada arranque.
            let _ = std::fs::remove_dir_all(std::env::temp_dir().join("frame-notes"));
            // Restos de las descargas de versiones anteriores, sin frenar el arranque.
            let cleanup = app.handle().clone();
            std::thread::spawn(move || remove_download_leftovers(&cleanup));

            // Réplica de la regla de Electron: tamaño mínimo = 50% del área
            // de trabajo del monitor principal.
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let scale = monitor.scale_factor();
                    let size = monitor.size().to_logical::<f64>(scale);
                    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                        (size.width * 0.5).floor(),
                        (size.height * 0.5).floor(),
                    )));
                }
                // Tal como se cerró (1.7.3): tamaño, posición, maximizada o
                // pantalla completa. Nace oculta y aquí se muestra ya colocada.
                window_state::restore(&window);
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/taskbar.png")) {
                    let _ = window.set_icon(icon);
                }
                if let Ok(hwnd) = window.hwnd() {
                    set_titlebar_icon(hwnd.0 as isize);
                }
            }


            // Vigilante del borde izquierdo para el vistazo al horario. Nace
            // apagado: lo enciende el frontend cuando hay imagen guardada.
            spawn_hot_corner(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        window_state::capture(window)
                    }
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                        window_state::capture(window);
                        window_state::save(window.app_handle());
                    }
                    _ => {}
                }
            }
            // Cerrar Frame cierra Frame: nada de seguir vivo en la bandeja.
            // Lo único que se interpone es la despedida de una sesión de
            // estudio en curso, y de eso decide el frontend.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return; // Gmail, Drive y demás se cierran sin ceremonia.
                }

                // Segunda pulsación de la X: se cierra sin preguntar. Es la
                // válvula de escape si la interfaz no respondiera.
                if CLOSE_ASKED.swap(true, Ordering::SeqCst) {
                    return;
                }

                match window.app_handle().emit("main-close-requested", ()) {
                    Ok(()) => api.prevent_close(),
                    // Sin frontend al que preguntar, cerrar es lo correcto.
                    Err(_) => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Frame");
}

/// Icono pequeño de la barra de título (1.7.6): el mismo logo con margen, para
/// que no se vea más grande que el texto «Frame». La barra de tareas sigue con
/// el icono sin margen (`set_icon` pone los dos; este reemplaza solo el pequeño).
#[cfg(windows)]
fn set_titlebar_icon(hwnd: isize) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIcon, SendMessageW, ICON_SMALL, WM_SETICON};
    let Ok(image) = tauri::image::Image::from_bytes(include_bytes!("../icons/titlebar.png")) else { return };
    let (w, h) = (image.width() as i32, image.height() as i32);
    // CreateIcon quiere BGRA; la máscara AND va vacía (manda el alfa).
    let mut bgra = image.rgba().to_vec();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let mask = vec![0u8; ((w + 15) / 16 * 2 * h) as usize];
    unsafe {
        let icon = CreateIcon(std::ptr::null_mut(), w, h, 1, 32, mask.as_ptr(), bgra.as_ptr());
        if !icon.is_null() {
            SendMessageW(hwnd as _, WM_SETICON, ICON_SMALL as usize, icon as isize);
        }
    }
}

#[cfg(not(windows))]
fn set_titlebar_icon(_hwnd: isize) {}
