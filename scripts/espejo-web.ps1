# Espejo de la web en vt-asvent/frame-app (14-oct-2026).
#
# La web vive en `website/` (repo GasparRojasDiego/frame-app, con la historia
# vieja) y, desde el 14-oct, también en `website-vt/` (repo vt-asvent/frame-app,
# historia nueva y sin el correo personal). Los dos sirven lo mismo: el viejo
# sigue siendo el que leen las apps instaladas (latest.json por releases y
# android.json por Pages) hasta que Windows 1.7.3 y Android 1.1.9 lean la
# dirección nueva primero. Este guion copia `website/` sobre `website-vt/`
# (sin .git) y sube un commit si hay cambios. Lo llaman release.ps1 y
# publicar-android.ps1 al final; también se puede correr a mano.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'website'
$dst = Join-Path $root 'website-vt'
if (-not (Test-Path (Join-Path $dst '.git'))) {
    Write-Host "==> No existe $dst (clonar vt-asvent/frame-app ahí); espejo omitido."
    exit 0
}
robocopy $src $dst /MIR /XD .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy falló ($LASTEXITCODE)" }
$changes = git -C $dst status --porcelain
if (-not $changes) { Write-Host "==> Espejo vt-asvent/frame-app al día."; exit 0 }
$msg = if ($args.Count -gt 0) { $args -join ' ' } else { 'Espejo de la web' }
git -C $dst add -A
git -C $dst commit --quiet -m "$msg`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C $dst push --quiet
Write-Host "==> Espejo vt-asvent/frame-app actualizado: $msg"
