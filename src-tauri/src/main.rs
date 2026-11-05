// Evita la consola en Windows en builds de producción.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `frame.exe --mcp`: servidor MCP para las IA (Conexiones con IA).
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        frame_lib::ia_bridge::run_stdio();
        return;
    }
    frame_lib::run()
}
