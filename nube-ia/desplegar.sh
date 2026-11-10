#!/usr/bin/env bash
# Frame · despliega la IA en la nube en Cloudflare (cuenta de VT Asvent). Idempotente.
# Lee la URL y la llave pública de Supabase de ../.env y la clave propia de
# ../keys/frame-ia.env (se crea la primera vez, fuera de git); nunca las imprime.
# Usa la sesión de wrangler de la laptop (`wrangler login`, cuenta vt.asvent).
set -euo pipefail
cd "$(dirname "$0")"
export WRANGLER_SEND_METRICS=false
[ -d node_modules ] || npm install --no-audit --no-fund > /dev/null
wrangler() { node node_modules/wrangler/bin/wrangler.js "$@"; }

# Antes de nada, las pruebas.
npm test > /dev/null 2>&1 || { echo "Las pruebas fallan: no se despliega (npm test para verlas)."; exit 1; }

# Base de datos: se crea la primera vez y su id queda en wrangler.toml.
id_de() { wrangler d1 list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).find(x=>x.name===process.argv[1]);console.log(d?d.uuid:'')})" "$1"; }
if grep -q 'database_id = "PENDIENTE"' wrangler.toml; then
  ID=$(id_de frame-ia)
  if [ -z "$ID" ]; then
    # En Norteamérica, como dice la Política de Privacidad (Anexo B).
    wrangler d1 create frame-ia --location wnam > /dev/null
    ID=$(id_de frame-ia)
  fi
  sed -i "s/database_id = \"PENDIENTE\"/database_id = \"$ID\"/" wrangler.toml
  echo "D1: frame-ia ($ID)"
fi
wrangler d1 migrations apply frame-ia --remote 2>&1 | tail -2

wrangler deploy 2>&1 | grep -E "Uploaded|Deployed|https://|schedule|Error|error" | head -10

# Secretos: la clave propia se genera una vez y se guarda en keys/ (fuera de git).
mkdir -p ../keys
if [ ! -f ../keys/frame-ia.env ]; then
  printf 'FRAME_IA_KEY=%s\n' "$(openssl rand -base64 32)" > ../keys/frame-ia.env
  NUEVA=1
fi
valor() { grep -E "^$1=" "$2" | head -1 | cut -d= -f2- | tr -d '\r"'; }
if [ "${NUEVA:-0}" = 1 ] || [ "${SECRETOS:-0}" = 1 ]; then
  valor FRAME_IA_KEY ../keys/frame-ia.env | wrangler secret put FRAME_IA_KEY > /dev/null
  valor VITE_SUPABASE_URL ../.env | wrangler secret put SUPABASE_URL > /dev/null
  valor VITE_SUPABASE_ANON_KEY ../.env | wrangler secret put SUPABASE_ANON_KEY > /dev/null
  # Biblioteca: el Apps Script de Asvent que envía el código de activación (correo/Codigo.gs) y su clave.
  if [ -f ../keys/biblioteca-correo.env ]; then
    valor LORE_MAIL_URL ../keys/biblioteca-correo.env | wrangler secret put LORE_MAIL_URL > /dev/null
    valor LORE_MAIL_KEY ../keys/biblioteca-correo.env | wrangler secret put LORE_MAIL_KEY > /dev/null
  fi
  echo "Secretos guardados en el Worker."
fi
