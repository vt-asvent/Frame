# ============================================================
#  Paquete MSIX de Frame para Microsoft Store
#
#  Uso (después de publicar la versión normal con release.ps1):
#    pwsh scripts/empaquetar-msix.ps1 `
#         -IdentityName 'XXXXX.Frame' `
#         -Publisher 'CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX' `
#         -PublisherDisplayName 'VT Asvent'
#
#  Los tres valores salen de Partner Center → la app → «Identidad del
#  producto» (Product identity). Se copian tal cual.
#
#  Qué hace:
#    1. Compila Frame SIN instalador y con VITE_STORE_BUILD=1: el actualizador
#       propio no se usa, porque la Store actualiza la app por su cuenta.
#    2. Arma la carpeta del paquete: frame.exe, AppxManifest.xml y los logos
#       (sacados de docs/marca/logo con ImageMagick).
#    3. Empaqueta con makeappx (Windows SDK) → dist-msix/Frame_X.Y.Z_x64.msix
#
#  El paquete va SIN firmar: Partner Center lo firma al publicarlo. Para
#  probarlo en este equipo antes habría que firmarlo con un certificado de
#  prueba cuyo sujeto coincida con -Publisher.
#
#  OJO: compila en src-tauri/target/release, igual que la versión normal.
#  Hazlo cuando el instalador NSIS ya esté publicado.
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$IdentityName,
    [Parameter(Mandatory = $true)][string]$Publisher,
    [string]$PublisherDisplayName = 'VT Asvent',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$conf = Get-Content "$root/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
# MSIX exige cuatro números; el último es siempre 0 en la Store.
$msixVersion = "$version.0"
Write-Host "==> Frame $version para Microsoft Store ($msixVersion)" -ForegroundColor Cyan

# --- makeappx del Windows SDK (la versión más nueva instalada) ---
$makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Directory.Parent.Name) } -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'No se encontró makeappx.exe: instala el Windows SDK.' }

# --- 1. Compilación sin instalador ni actualizador ---
if (-not $SkipBuild) {
    $env:VITE_STORE_BUILD = '1'
    try {
        npx tauri build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación.' }
    } finally {
        Remove-Item Env:VITE_STORE_BUILD -ErrorAction SilentlyContinue
    }
}
$exe = "$root/src-tauri/target/release/frame.exe"
if (-not (Test-Path $exe)) { throw "No está $exe" }

# --- 2. Carpeta del paquete ---
$layout = "$root/dist-msix/layout"
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Force "$layout/Assets" | Out-Null
Copy-Item $exe "$layout/frame.exe"

# Logos del paquete (marca del 4-nov-2026, `docs/marca/logo/`): plano hasta
# 64 px y degradado en los grandes, como pide el LEEME de la marca. El .ico
# empieza en 16 px: ya no sirve de fuente para los mosaicos.
$flat = "$root/docs/marca/logo/Frame-logo-plano.svg"
$grad = "$root/docs/marca/logo/Frame-logo-sin-fondo-1024px.png"
$logos = @(
    @{ Name = 'Square44x44Logo.png'; Size = '44x44'; Src = $flat },
    @{ Name = 'Square44x44Logo.targetsize-44_altform-unplated.png'; Size = '44x44'; Src = $flat },
    @{ Name = 'Square150x150Logo.png'; Size = '150x150'; Src = $grad },
    @{ Name = 'StoreLogo.png'; Size = '50x50'; Src = $flat }
)
foreach ($logo in $logos) {
    magick -background none $logo.Src -resize $logo.Size -gravity center -extent $logo.Size "$layout/Assets/$($logo.Name)"
}
# Mosaico ancho: el logo centrado, con aire a los lados.
magick -background none $grad -resize 120x120 -gravity center -extent 310x150 "$layout/Assets/Wide310x150Logo.png"

$description = 'Asignaturas, tareas, sesiones de estudio con nota diaria, hábitos, calendario y tu música, en una sola app.'
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="$IdentityName" Publisher="$Publisher" Version="$msixVersion" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Frame Estudio</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="es-PE" />
    <Resource Language="es" />
    <Resource Language="en-US" />
    <Resource Language="en" />
  </Resources>
  <Applications>
    <Application Id="Frame" Executable="frame.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Frame Estudio"
        Description="$description"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
    <DeviceCapability Name="microphone" />
  </Capabilities>
</Package>
"@
Set-Content -Path "$layout/AppxManifest.xml" -Value $manifest -Encoding utf8

# --- 3. Empaquetado ---
$out = "$root/dist-msix/Frame_${version}_x64.msix"
if (Test-Path $out) { Remove-Item $out -Force }
& $makeappx.FullName pack /d $layout /p $out /o
if ($LASTEXITCODE -ne 0) { throw 'makeappx no pudo crear el paquete.' }

$size = (Get-Item $out).Length
Write-Host ("==> Listo: {0} ({1:N1} MB)" -f $out, ($size / 1MB)) -ForegroundColor Green
Write-Host '    Súbelo en Partner Center → Envío → Paquetes.'
