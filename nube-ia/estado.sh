#!/usr/bin/env bash
# Frame · IA en la nube: cómo está la Biblioteca y cuánto lleva gastado la base. Solo lee.
#
#   bash estado.sh
#
# El plan gratis de Cloudflare da a toda la cuenta 100 000 filas escritas y 5 millones
# leídas al día en D1 (se reinicia a medianoche UTC). Al pasarse, la base rechaza las
# escrituras: la lectura de Drive se detiene y lo que necesita anotar algo falla. La
# lectura de la Biblioteca lleva su propia cuenta («gasto») y se detiene sola mucho antes
# (biblioteca.ts). Si «filas escritas en 24 h» se acerca a 100 000, algo escribe de más.
set -euo pipefail
cd "$(dirname "$0")"
export WRANGLER_SEND_METRICS=false
wrangler() { node node_modules/wrangler/bin/wrangler.js "$@"; }

echo "Base (últimas 24 h):"
wrangler d1 info frame-ia 2>/dev/null | grep -E "database_size|rows_read_24h|rows_written_24h" | sed 's/[│]/ /g; s/  */ /g'

echo "Biblioteca:"
wrangler d1 execute frame-ia --remote --json --command "SELECT
  (SELECT v FROM lore_estado WHERE k = 'actualizado') AS indice_del,
  (SELECT v FROM lore_estado WHERE k = 'gasto') AS gasto_de_la_lectura_hoy,
  (SELECT datetime(CAST(v AS INTEGER) / 1000, 'unixepoch') FROM lore_estado WHERE k = 'releida') AS carpeta_leida_entera_utc,
  (SELECT count(*) FROM lore_nodos) AS nodos,
  (SELECT count(*) FROM lore_nodos WHERE pendiente = 1) AS portadas_por_copiar,
  (SELECT count(*) FROM lore_vistas) AS portadas_copiadas,
  (SELECT count(*) FROM lore_descargas WHERE day = date('now')) AS cuentas_con_descargas_hoy" 2>/dev/null |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s)[0].results[0];for(const[k,v]of Object.entries(r))console.log('  '+k.replace(/_/g,' ')+': '+v)})"
