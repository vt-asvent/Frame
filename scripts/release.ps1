# ============================================================
#  Release de Frame — un solo comando publica una nueva versión
#
#  Uso:
#    1. Sube la versión en: src-tauri/tauri.conf.json, src-tauri/Cargo.toml
#       y package.json (las tres iguales, p. ej. 1.0.2).
#    2. pwsh scripts/release.ps1            (compila + publica)
#       pwsh scripts/release.ps1 -SkipBuild (solo publica lo ya compilado)
#
#  Qué hace: compila el instalador NSIS FIRMADO (clave keys/frame-updater.key),
#  genera latest.json, crea el Release vX.Y.Z en GitHub y sube:
#    - Frame_X.Y.Z_x64-setup.exe   (instalador versionado; lo usa el updater)
#    - Frame-Setup.exe             (copia con nombre estable; lo usa la web)
#    - latest.json                 (manifiesto firmado del auto-updater)
#    - SHA256SUMS.txt              (huella para verificar la descarga)
#  Al final actualiza website/version.json (versión, fecha, tamaño y huella
#  que muestra la página) y publica la web.
#  Con eso: la página web ya entrega la nueva versión (enlace /latest) y
#  todas las apps instaladas se actualizan solas.
# ============================================================
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$OWNER = 'GasparRojasDiego'
$REPO  = 'frame-app'

# --- Versión desde tauri.conf.json ---
$conf = Get-Content "$root/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
Write-Host "==> Versión a publicar: $version" -ForegroundColor Cyan

# --- Compilación firmada ---
if (-not $SkipBuild) {
    Get-Process frame -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    # El build lee TAURI_SIGNING_PRIVATE_KEY (contenido de la clave, no la ruta).
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$root/keys/frame-updater.key" -Raw
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
    npx tauri build
    if ($LASTEXITCODE -ne 0) { throw 'La compilación falló.' }
}

# --- Artefactos ---
$bundle = "$root/src-tauri/target/release/bundle/nsis"
$setup  = "$bundle/Frame_${version}_x64-setup.exe"
$sig    = "$setup.sig"
if (-not (Test-Path $setup)) { throw "No existe $setup (¿compilaste esta versión?)" }
if (-not (Test-Path $sig)) {
    # Respaldo: firma manual si el build no generó la firma.
    npx tauri signer sign -f "$root/keys/frame-updater.key" -p '""' $setup
    if (-not (Test-Path $sig)) { throw "No se pudo firmar $setup" }
}

# --- Huella SHA-256 (se publica en el release y en la página) ---
$hash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $setup).Length
$sums = "$bundle/SHA256SUMS.txt"
"$hash  Frame_${version}_x64-setup.exe`n$hash  Frame-Setup.exe`n" | Set-Content -Path $sums -Encoding utf8NoBOM -NoNewline
Write-Host "==> SHA-256: $hash" -ForegroundColor Cyan

# --- latest.json (manifiesto del auto-updater) ---
# `frame` es nuestro (el plugin de Tauri lo ignora): el peso exacto del
# instalador, para que el recuadro de actualizar diga cuánto pesa y cuánto
# tardará ANTES de empezar a descargar (src/lib/updater.ts lo lee de rawJson),
# y `minimum`, la versión mínima que se puede seguir usando (1.7.2): toda
# versión anterior obliga a actualizar. Se publica la recién publicada; para
# permitir una anterior, bajar este número a mano en el latest.json del release.
$latest = @{
    version  = $version
    notes    = "Frame $version"
    pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    frame    = @{ size = $size; minimum = $version }
    platforms = @{
        'windows-x86_64' = @{
            signature = (Get-Content $sig -Raw).Trim()
            url = "https://github.com/$OWNER/$REPO/releases/download/v$version/Frame_${version}_x64-setup.exe"
        }
    }
}
$latestPath = "$bundle/latest.json"
$latest | ConvertTo-Json -Depth 5 | Set-Content -Path $latestPath -Encoding utf8NoBOM
Write-Host "==> latest.json generado" -ForegroundColor Cyan

# --- Token de GitHub (del Administrador de credenciales de Git) ---
$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred | Select-String '^password=').ToString().Substring(9)
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' }

# --- Crear (o reutilizar) el Release vX.Y.Z ---
$tag = "v$version"
$fence = '```'
$notes = @"
Frame $version — instalador para Windows 10 y 11 (64 bits). La app instalada avisa de la versión nueva y se actualiza con un clic.

**SHA-256 del instalador:** ``$hash``

Compruébalo en PowerShell antes de instalar:

${fence}powershell
Get-FileHash .\Frame-Setup.exe -Algorithm SHA256
${fence}

Cada versión va firmada: Frame solo instala actualizaciones con la firma de Asvent.
"@
try {
    $release = Invoke-RestMethod -Method Post -Headers $headers `
        -Uri "https://api.github.com/repos/$OWNER/$REPO/releases" `
        -Body (@{ tag_name = $tag; name = "Frame $version"; body = $notes; make_latest = 'true' } | ConvertTo-Json)
} catch {
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$OWNER/$REPO/releases/tags/$tag"
    # Re-publicación: las notas se rehacen con la huella del instalador nuevo.
    Invoke-RestMethod -Method Patch -Headers $headers -Uri "https://api.github.com/repos/$OWNER/$REPO/releases/$($release.id)" `
        -Body (@{ body = $notes } | ConvertTo-Json) | Out-Null
    Write-Host "==> Release $tag ya existía: se reutiliza" -ForegroundColor Yellow
}
Write-Host "==> Release $tag listo (id $($release.id))" -ForegroundColor Cyan

function Upload-Asset([string]$path, [string]$name, [string]$mime) {
    # Si ya existe un asset con ese nombre (re-publicación), se reemplaza.
    $existing = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$OWNER/$REPO/releases/$($release.id)/assets"
    $dup = $existing | Where-Object { $_.name -eq $name }
    if ($dup) { Invoke-RestMethod -Method Delete -Headers $headers -Uri "https://api.github.com/repos/$OWNER/$REPO/releases/assets/$($dup.id)" | Out-Null }
    Write-Host "==> Subiendo $name ($([math]::Round((Get-Item $path).Length/1MB)) MB)…" -ForegroundColor Cyan
    Invoke-RestMethod -Method Post -Uri "https://uploads.github.com/repos/$OWNER/$REPO/releases/$($release.id)/assets?name=$name" `
        -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = $mime } -InFile $path | Out-Null
}

Upload-Asset $setup "Frame_${version}_x64-setup.exe" 'application/octet-stream'
Upload-Asset $setup 'Frame-Setup.exe' 'application/octet-stream'
Upload-Asset $sums 'SHA256SUMS.txt' 'text/plain'
Upload-Asset $latestPath 'latest.json' 'application/json'

# --- La página muestra versión, fecha, tamaño y huella (website/version.json) ---
$site = "$root/website"
$info = [ordered]@{
    version = $version
    date    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    size    = $size
    sha256  = $hash
}
$info | ConvertTo-Json | Set-Content -Path "$site/version.json" -Encoding utf8NoBOM
try {
    git -C $site add version.json
    git -C $site commit --quiet -m "Versión $version"
    git -C $site push --quiet
    Write-Host "==> Página actualizada con la versión $version" -ForegroundColor Cyan
    # Espejo en vt-asvent/frame-app (14-oct-2026) → scripts/espejo-web.ps1
    & (Join-Path $PSScriptRoot 'espejo-web.ps1') "Versión $version"
} catch {
    Write-Host "==> Aviso: no se pudo publicar version.json ($_). El release ya está publicado." -ForegroundColor Yellow
}

Write-Host ''
Write-Host "✔ Versión $version publicada." -ForegroundColor Green
Write-Host "  Página:    https://gasparrojasdiego.github.io/frame-app/"
Write-Host "  Descarga:  https://github.com/$OWNER/$REPO/releases/latest/download/Frame-Setup.exe"
Write-Host "  Updater:   https://github.com/$OWNER/$REPO/releases/latest/download/latest.json"
