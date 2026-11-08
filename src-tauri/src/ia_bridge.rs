//! Conexiones con IA (extensión `frame.ia`, 1.7.3): Frame como servidor MCP.
//!
//! Dos mitades en el mismo ejecutable:
//!
//! - **Dentro de Frame** (`ia_bridge_start`): con la extensión activa y una
//!   sesión abierta, Frame escucha SOLO en 127.0.0.1, en un puerto al azar,
//!   y deja en su carpeta (`%APPDATA%\com.frame.app\extensions\frame.ia`)
//!   `bridge.json` (puerto y una llave al azar de 256 bits) y `tools.json`
//!   (las herramientas, que define la app). Cada petición con la llave
//!   correcta pasa a la ventana, que la ejecuta sobre los datos de Frame
//!   (y pide confirmación en pantalla antes de borrar nada).
//! - **`frame.exe --mcp`**: lo arranca la IA (Claude Desktop, Gemini CLI…)
//!   y habla MCP por stdin/stdout. Lista las herramientas desde `tools.json`
//!   (aunque Frame esté cerrada) y reenvía cada llamada a Frame; si Frame
//!   está cerrada, la abre y espera a que se conecte.
//!
//! Nada sale del equipo: la IA local habla con este proceso, y este con
//! Frame por la interfaz de bucle local.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const EXT: &str = "frame.ia";
/// Lo que puede tardar una llamada, incluida la confirmación en pantalla
/// (50 s en IaRuntime.tsx). Por debajo de los 60 s con los que los clientes
/// MCP habituales dan una petición por perdida.
const CALL_TIMEOUT: Duration = Duration::from_secs(56);
const MAX_LINE: usize = 4 * 1024 * 1024;
const PROTOCOLS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------

fn dir_from_app(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(base.join("extensions").join(EXT))
}

/// La misma carpeta sin `AppHandle` (modo `--mcp`). En MSIX, %APPDATA% está
/// virtualizado igual para los dos procesos: ven la misma.
fn dir_from_env() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("com.frame.app").join("extensions").join(EXT))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn random_bytes(buf: &mut [u8]) -> Result<(), String> {
    use windows_sys::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status == 0 {
        Ok(())
    } else {
        Err(format!("BCryptGenRandom: {status}"))
    }
}

#[cfg(not(windows))]
fn random_bytes(buf: &mut [u8]) -> Result<(), String> {
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(buf)).map_err(|e| e.to_string())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Comparación en tiempo constante (la llave no se adivina por lo que tarda).
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Lee una línea (hasta `\n`) sin pasar de `MAX_LINE`.
fn read_line(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut buf = Vec::new();
    let read = reader.take(MAX_LINE as u64 + 1).read_until(b'\n', &mut buf)?;
    if read == 0 {
        return Ok(None);
    }
    if buf.len() > MAX_LINE {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "línea demasiado larga"));
    }
    Ok(Some(String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string()))
}

// ------------------------------------------------------------
// Dentro de Frame
// ------------------------------------------------------------

struct Running {
    stop: Arc<AtomicBool>,
}

static SERVER: Mutex<Option<Running>> = Mutex::new(None);
static NEXT_CALL: AtomicU64 = AtomicU64::new(1);

fn pending() -> &'static Mutex<HashMap<u64, mpsc::Sender<Value>>> {
    static PENDING: OnceLock<Mutex<HashMap<u64, mpsc::Sender<Value>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Entrega cada llamada a quien la ejecuta (en la app, la ventana principal).
type Dispatch = Arc<dyn Fn(Value) -> Result<(), String> + Send + Sync>;

/// Abre el puente (o lo renueva): puerto y llave nuevos, herramientas al día.
#[tauri::command]
pub fn ia_bridge_start(app: AppHandle, tools: Value, instructions: String) -> Result<(), String> {
    let dir = dir_from_app(&app)?;
    // Solo a la ventana principal (no al mini temporizador ni a otras).
    let dispatch: Dispatch = Arc::new(move |payload| app.emit_to("main", "ia-bridge-call", payload).map_err(|e| e.to_string()));
    start_server(&dir, tools, instructions, dispatch)
}

fn start_server(dir: &Path, tools: Value, instructions: String, dispatch: Dispatch) -> Result<(), String> {
    stop_server();
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut key = [0u8; 32];
    random_bytes(&mut key)?;
    let token = hex(&key);

    write_atomic(&dir.join("tools.json"), serde_json::to_string(&json!({ "tools": tools, "instructions": instructions })).map_err(|e| e.to_string())?.as_bytes())?;
    write_atomic(
        &dir.join("bridge.json"),
        serde_json::to_string(&json!({ "port": port, "token": token, "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION") }))
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )?;

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    *SERVER.lock().unwrap() = Some(Running { stop: stop.clone() });

    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let dispatch = dispatch.clone();
                    let token = token.clone();
                    std::thread::spawn(move || {
                        let _ = serve(stream, &dispatch, &token);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(80)),
                Err(_) => std::thread::sleep(Duration::from_millis(250)),
            }
        }
    });
    Ok(())
}

fn serve(stream: TcpStream, dispatch: &Dispatch, token: &str) -> std::io::Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut writer = stream.try_clone()?;
    let mut reader = BufReader::new(stream);
    let Some(line) = read_line(&mut reader)? else { return Ok(()) };
    let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
    let reply = if !same(request["token"].as_str().unwrap_or(""), token) {
        json!({ "ok": false, "error": "Llave no válida: vuelve a abrir la conexión." })
    } else {
        let id = NEXT_CALL.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        pending().lock().unwrap().insert(id, tx);
        let payload = json!({ "id": id, "tool": request["tool"], "args": request["args"], "client": request["client"] });
        let reply = match dispatch(payload) {
            Ok(()) => rx.recv_timeout(CALL_TIMEOUT).unwrap_or_else(|_| json!({ "ok": false, "error": "Frame no respondió a tiempo." })),
            Err(e) => json!({ "ok": false, "error": e }),
        };
        pending().lock().unwrap().remove(&id);
        reply
    };
    writer.write_all(format!("{}\n", reply).as_bytes())?;
    writer.flush()
}

/// La ventana devuelve el resultado de una llamada.
#[tauri::command]
pub fn ia_bridge_reply(id: u64, reply: Value) {
    if let Some(tx) = pending().lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

fn stop_server() {
    if let Some(running) = SERVER.lock().unwrap().take() {
        running.stop.store(true, Ordering::Relaxed);
    }
}

/// Cierra el puente (extensión apagada o sin sesión): sin `bridge.json`, la
/// IA sabe que no debe abrir Frame por su cuenta.
#[tauri::command]
pub fn ia_bridge_stop(app: AppHandle) {
    stop_server();
    if let Ok(dir) = dir_from_app(&app) {
        let _ = std::fs::remove_file(dir.join("bridge.json"));
    }
}

/// Ruta de este ejecutable, para la configuración de cada IA.
#[tauri::command]
pub fn ia_exe_path() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let text = exe.to_string_lossy().to_string();
    // Instalada desde la Store: WindowsApps no se puede ejecutar desde fuera;
    // se usa su alias (`frame-estudio.exe`, ver empaquetar-msix.ps1).
    if packaged() {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return Ok(PathBuf::from(local).join("Microsoft").join("WindowsApps").join("frame-estudio.exe").to_string_lossy().to_string());
        }
    }
    Ok(text)
}

/// Lee un archivo de configuración de una IA (para saber si ya está Frame).
#[tauri::command]
pub fn ia_config_read(target: String) -> Result<Option<String>, String> {
    let path = config_path(&target)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Escribe la configuración de una IA (la app ya fusionó el JSON existente).
/// Antes guarda una copia `.frame-backup` del archivo tal como estaba.
/// Se escribe EN EL SITIO (sin archivo temporal): una app de la Store puede
/// cambiar un archivo que ya existe fuera de su paquete, pero uno nuevo
/// quedaría solo en su copia privada y la IA no lo vería.
///
/// La ventana manda el archivo ya fusionado (así conserva el orden de las
/// claves), pero aquí se comprueba que lo ÚNICO que cambia es la entrada
/// `frame` y que apunta a este Frame: nada que llegue de la ventana puede
/// añadir a una IA otro comando que ejecutar.
#[tauri::command]
pub fn ia_config_write(target: String, text: String) -> Result<String, String> {
    let next: Value = serde_json::from_str(&text).map_err(|_| "JSON no válido.".to_string())?;
    let path = config_path(&target)?;
    let current = match std::fs::read_to_string(&path) {
        Ok(t) if !t.trim().is_empty() => serde_json::from_str::<Value>(&t).map_err(|_| "INVALID".to_string())?,
        Ok(_) => json!({}),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(e.to_string()),
    };
    check_only_frame_changes(&current, &next, &ia_exe_path()?)?;
    if path.exists() {
        let backup = path.with_extension("json.frame-backup");
        std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
    } else if packaged() {
        return Err("NEEDS_FILE".to_string());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// La configuración nueva solo puede diferir de la actual en `mcpServers.frame`,
/// y esa entrada, si está, debe ser exactamente `<este exe> --mcp`.
fn check_only_frame_changes(current: &Value, next: &Value, exe: &str) -> Result<(), String> {
    if !next.is_object() {
        return Err("JSON no válido.".to_string());
    }
    if let Some(entry) = next.get("mcpServers").and_then(|s| s.get("frame")) {
        if *entry != json!({ "command": exe, "args": ["--mcp"] }) {
            return Err("Solo se puede escribir la entrada de Frame.".to_string());
        }
    }
    fn without_frame(value: &Value) -> Value {
        let mut value = value.clone();
        if let Some(obj) = value.as_object_mut() {
            let empty = match obj.get_mut("mcpServers") {
                Some(Value::Object(servers)) => {
                    servers.remove("frame");
                    servers.is_empty()
                }
                _ => false,
            };
            if empty {
                obj.remove("mcpServers");
            }
        }
        value
    }
    if without_frame(current) != without_frame(next) {
        return Err("Solo se puede cambiar la entrada de Frame.".to_string());
    }
    Ok(())
}

/// ¿Frame se instaló desde la Store (MSIX)?
pub(crate) fn packaged() -> bool {
    std::env::current_exe().map(|p| p.to_string_lossy().to_ascii_lowercase().contains("\\windowsapps\\")).unwrap_or(false)
}

/// Claude Desktop instalado desde la Store guarda su configuración en la
/// carpeta privada de su paquete; el instalador clásico, en %APPDATA%\Claude.
/// Se usa la que Claude lee de verdad.
fn claude_config() -> Option<PathBuf> {
    const FILE: &str = "claude_desktop_config.json";
    let classic = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Claude").join(FILE));
    let packages: Vec<PathBuf> = std::env::var_os("LOCALAPPDATA")
        .map(|l| PathBuf::from(l).join("Packages"))
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_ascii_lowercase();
                    name.starts_with("claude_") || name.starts_with("anthropic.claude_")
                })
                .map(|e| e.path().join("LocalCache").join("Roaming").join("Claude"))
                .filter(|dir| dir.is_dir())
                .collect()
        })
        .unwrap_or_default();
    if let Some(found) = packages.iter().map(|d| d.join(FILE)).find(|p| p.exists()) {
        return Some(found);
    }
    match classic {
        Some(c) if c.exists() => Some(c),
        classic => packages.first().map(|d| d.join(FILE)).or(classic),
    }
}

/// Solo estos archivos, nunca una ruta que mande la app.
fn config_path(target: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    match target {
        "claude-desktop" => claude_config(),
        "gemini-cli" => home.map(|h| h.join(".gemini").join("settings.json")),
        _ => None,
    }
    .ok_or_else(|| "Destino no válido.".to_string())
}

/// ¿Está instalada esa IA? (Para ofrecer la configuración de un clic.)
#[tauri::command]
pub fn ia_client_installed(target: String) -> bool {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    match target.as_str() {
        "claude-desktop" => {
            claude_config().map(|p| p.exists() || p.parent().map(|d| d.is_dir()).unwrap_or(false)).unwrap_or(false)
                || local.as_ref().map(|l| l.join("AnthropicClaude").is_dir()).unwrap_or(false)
        }
        "gemini-cli" => home.map(|h| h.join(".gemini").is_dir()).unwrap_or(false),
        _ => false,
    }
}

// ------------------------------------------------------------
// `frame.exe --mcp`: servidor MCP por stdin/stdout
// ------------------------------------------------------------

fn send(out: &mut impl Write, message: &Value) {
    let _ = writeln!(out, "{message}");
    let _ = out.flush();
}

const OFFLINE: &str = "Frame no está conectada. Abre Frame, inicia sesión y activa «Conexiones con IA» en Ajustes › Extensiones.";

fn load_tools(dir: &Option<PathBuf>) -> (Value, String) {
    let parsed = dir
        .as_ref()
        .and_then(|d| std::fs::read_to_string(d.join("tools.json")).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok());
    match parsed {
        Some(v) if v["tools"].is_array() => (v["tools"].clone(), v["instructions"].as_str().unwrap_or("").to_string()),
        _ => (
            json!([{
                "name": "estado_de_frame",
                "description": "Dice si Frame está lista para conectarse y qué falta.",
                "inputSchema": { "type": "object", "properties": {} },
                "annotations": { "readOnlyHint": true }
            }]),
            String::new(),
        ),
    }
}

struct Bridge {
    port: u16,
    token: String,
}

fn read_bridge(dir: &Option<PathBuf>) -> Option<Bridge> {
    let text = std::fs::read_to_string(dir.as_ref()?.join("bridge.json")).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    Some(Bridge { port: v["port"].as_u64()? as u16, token: v["token"].as_str()?.to_string() })
}

fn connect(bridge: &Bridge) -> Option<TcpStream> {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], bridge.port)), Duration::from_millis(1500)).ok()
}

/// Frame cerrada pero con la extensión activa la última vez: se abre y se
/// espera a que vuelva a escuchar (con llave nueva).
fn launch_and_wait(dir: &Option<PathBuf>, old_token: &str) -> Option<(Bridge, TcpStream)> {
    let exe = PathBuf::from(ia_exe_path().ok()?);
    let mut cmd = std::process::Command::new(&exe);
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Fuera del grupo de procesos de la IA: al cerrarla, Frame sigue.
        const DETACHED: u32 = 0x0000_0008 | 0x0100_0000; // DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB
        cmd.creation_flags(DETACHED);
    }
    if cmd.spawn().is_err() {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let mut plain = std::process::Command::new(&exe);
            plain.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            plain.creation_flags(0x0000_0008);
            plain.spawn().ok()?;
        }
        #[cfg(not(windows))]
        return None;
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(45) {
        std::thread::sleep(Duration::from_millis(500));
        if let Some(bridge) = read_bridge(dir) {
            if bridge.token != old_token {
                if let Some(stream) = connect(&bridge) {
                    return Some((bridge, stream));
                }
            }
        }
    }
    None
}

fn call_frame(dir: &Option<PathBuf>, tool: &str, args: &Value, client: &str) -> Result<Value, String> {
    let bridge = read_bridge(dir).ok_or_else(|| OFFLINE.to_string())?;
    let (bridge, stream) = match connect(&bridge) {
        Some(stream) => (bridge, stream),
        None => launch_and_wait(dir, &bridge.token).ok_or_else(|| "No se pudo abrir Frame. Ábrela tú y vuelve a intentarlo.".to_string())?,
    };
    stream.set_read_timeout(Some(CALL_TIMEOUT + Duration::from_secs(10))).map_err(|e| e.to_string())?;
    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let request = json!({ "token": bridge.token, "tool": tool, "args": args, "client": client });
    writer.write_all(format!("{request}\n").as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let line = read_line(&mut reader).map_err(|e| e.to_string())?.ok_or_else(|| "Frame cerró la conexión.".to_string())?;
    serde_json::from_str(&line).map_err(|e| e.to_string())
}

pub fn run_stdio() {
    let dir = dir_from_env();
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut out = std::io::stdout();
    let mut client = String::from("IA");

    loop {
        let line = match read_line(&mut input) {
            Ok(Some(line)) => line,
            _ => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                send(&mut out, &json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } }));
                continue;
            }
        };
        // Sin `id` es una notificación: no se responde.
        let Some(id) = message.get("id").cloned() else { continue };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let result: Result<Value, (i64, String)> = match message["method"].as_str().unwrap_or("") {
            "initialize" => {
                if let Some(name) = params["clientInfo"]["title"].as_str().or(params["clientInfo"]["name"].as_str()) {
                    client = name.chars().take(60).collect();
                }
                let asked = params["protocolVersion"].as_str().unwrap_or("");
                let version = PROTOCOLS.iter().find(|p| **p == asked).copied().unwrap_or(PROTOCOLS[0]);
                let (_, instructions) = load_tools(&dir);
                Ok(json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "frame", "title": "Frame", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": instructions,
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": load_tools(&dir).0 })),
            "tools/call" => {
                let name = params["name"].as_str().unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let reply = if name == "estado_de_frame" {
                    match read_bridge(&dir) {
                        Some(_) => Ok(json!({ "ok": true, "text": "Frame está lista." })),
                        None => Err(OFFLINE.to_string()),
                    }
                } else {
                    call_frame(&dir, name, &args, &client)
                };
                Ok(match reply {
                    Ok(v) if v["ok"].as_bool() == Some(true) => json!({ "content": [{ "type": "text", "text": v["text"].as_str().unwrap_or("Hecho.") }] }),
                    Ok(v) => json!({ "content": [{ "type": "text", "text": v["error"].as_str().unwrap_or("Frame no pudo hacerlo.") }], "isError": true }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
                })
            }
            _ => Err((-32601, "Method not found".to_string())),
        };
        match result {
            Ok(result) => send(&mut out, &json!({ "jsonrpc": "2.0", "id": id, "result": result })),
            Err((code, message)) => send(&mut out, &json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El servidor de la app y el cliente de `--mcp`, de punta a punta, con
    /// una carpeta temporal y un «Frame» que responde desde otro hilo.
    #[test]
    fn puente_de_punta_a_punta() {
        let dir = std::env::temp_dir().join(format!("frame-ia-test-{}", std::process::id()));
        let dispatch: Dispatch = Arc::new(|payload: Value| {
            std::thread::spawn(move || {
                let id = payload["id"].as_u64().unwrap();
                let text = format!("{} de {} con {}", payload["tool"].as_str().unwrap(), payload["client"].as_str().unwrap(), payload["args"]["nombre"]);
                ia_bridge_reply(id, json!({ "ok": true, "text": text }));
            });
            Ok(())
        });
        start_server(&dir, json!([{ "name": "crear_tarea" }]), "hola".into(), dispatch).unwrap();
        let some_dir = Some(dir.clone());

        // tools.json para cuando Frame está cerrada.
        let (tools, instructions) = load_tools(&some_dir);
        assert_eq!(tools[0]["name"], "crear_tarea");
        assert_eq!(instructions, "hola");

        // Una llamada con la llave correcta llega y vuelve.
        let reply = call_frame(&some_dir, "crear_tarea", &json!({ "nombre": "Ñandú" }), "Claude").unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["text"], "crear_tarea de Claude con \"Ñandú\"");

        // Varias a la vez: cada una recibe la suya.
        let handles: Vec<_> = (0..5)
            .map(|i| {
                let d = some_dir.clone();
                std::thread::spawn(move || call_frame(&d, "t", &json!({ "nombre": i }), "c").unwrap()["text"].as_str().unwrap().to_string())
            })
            .collect();
        let mut texts: Vec<String> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        texts.sort();
        assert_eq!(texts, (0..5).map(|i| format!("t de c con {i}")).collect::<Vec<_>>());

        // Con otra llave, Frame la rechaza.
        let bridge = read_bridge(&some_dir).unwrap();
        assert_eq!(bridge.token.len(), 64);
        let mut stream = connect(&bridge).unwrap();
        writeln!(stream, "{}", json!({ "token": "x".repeat(64), "tool": "crear_tarea" })).unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        assert!(line.contains("Llave no válida"), "{line}");

        // Una línea que no es JSON tampoco pasa.
        let mut stream = connect(&bridge).unwrap();
        writeln!(stream, "basura").unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        assert!(line.contains("Llave no válida"), "{line}");

        stop_server();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn solo_cambia_la_entrada_de_frame() {
        let exe = r"C:\Frame\frame.exe";
        let frame = json!({ "command": exe, "args": ["--mcp"] });
        let current = json!({ "preferences": { "a": 1 }, "mcpServers": { "otro": { "command": "x" } } });
        // Añadir y quitar Frame: sí.
        let added = json!({ "preferences": { "a": 1 }, "mcpServers": { "otro": { "command": "x" }, "frame": frame } });
        assert!(check_only_frame_changes(&current, &added, exe).is_ok());
        assert!(check_only_frame_changes(&added, &current, exe).is_ok());
        // Archivo nuevo.
        assert!(check_only_frame_changes(&json!({}), &json!({ "mcpServers": { "frame": frame } }), exe).is_ok());
        assert!(check_only_frame_changes(&json!({}), &json!({ "mcpServers": {} }), exe).is_ok());
        // Otro comando para Frame: no.
        let evil = json!({ "preferences": { "a": 1 }, "mcpServers": { "otro": { "command": "x" }, "frame": { "command": "cmd.exe", "args": ["/c", "calc"] } } });
        assert!(check_only_frame_changes(&current, &evil, exe).is_err());
        // Tocar otro servidor u otra clave: no.
        let other = json!({ "preferences": { "a": 1 }, "mcpServers": { "otro": { "command": "calc.exe" }, "frame": frame } });
        assert!(check_only_frame_changes(&current, &other, exe).is_err());
        let prefs = json!({ "preferences": { "a": 2 }, "mcpServers": { "otro": { "command": "x" } } });
        assert!(check_only_frame_changes(&current, &prefs, exe).is_err());
        assert!(check_only_frame_changes(&current, &json!([1]), exe).is_err());
    }
}
