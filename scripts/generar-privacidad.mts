// Genera website/privacidad/index.html a partir de la Política de Privacidad de
// src/lib/legal/terms.ts. Volver a ejecutarlo cada vez que cambie la Política:
//   npx tsx scripts/generar-privacidad.mts
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { termsDocument, TERMS_VERSION } = await import(pathToFileURL(path.join(root, 'src/lib/legal/terms.ts')).href);
const appVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
// Se regenera cuando cambia la Política: la fecha de hoy es la de su vigencia.
const effectiveDate = new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
const doc: string = termsDocument({ appVersion, effectiveDate });

const start = doc.indexOf('# Política de Privacidad de Frame');
const anexos = doc.indexOf('# Anexos', start);
let md = doc.slice(start, anexos).trim();
// Anexos que completan la Política: A (datos), B (encargados), F (almacenamiento local).
for (const id of ['A', 'B', 'F']) {
  const a = doc.indexOf(`## Anexo ${id} `, anexos);
  if (a < 0) continue;
  const next = doc.indexOf('\n## ', a + 5);
  md += '\n\n' + doc.slice(a, next < 0 ? undefined : next).trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

const out: string[] = [];
const lines = md.split('\n');
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.trim()) continue;
  let m;
  if ((m = l.match(/^(#{1,4}) (.*)$/))) { const n = Math.min(m[1].length + (m[1].length === 1 ? 0 : 0), 4); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
  if (/^\s*[-·•] /.test(l)) {
    out.push('<ul>');
    while (i < lines.length && /^\s*[-·•] /.test(lines[i])) { out.push(`<li>${inline(lines[i].replace(/^\s*[-·•] /, ''))}</li>`); i++; }
    i--; out.push('</ul>'); continue;
  }
  if (l.trim().startsWith('|')) {
    const rows: string[][] = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      i++;
    }
    i--;
    const [head, ...body] = rows;
    out.push('<div class="tbl"><table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
    continue;
  }
  if (/^-{3,}$/.test(l.trim())) { out.push('<hr />'); continue; }
  const para = [l];
  while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\s*[-·•] |\||-{3,})/.test(lines[i + 1])) para.push(lines[++i]);
  out.push(`<p>${inline(para.join(' '))}</p>`);
}

const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <title>Política de Privacidad · Frame</title>
  <meta name="description" content="Qué datos trata Frame, para qué, cuánto tiempo y qué derechos tienes. Asvent." />
  <meta name="theme-color" content="#ece7dd" />
  <meta name="color-scheme" content="light dark" />
  <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="../favicon.ico" sizes="any" />
  <link rel="stylesheet" href="../assets/site.css" />
  <link rel="stylesheet" href="privacidad.css" />
  <script src="../assets/theme.js"></script>
</head>
<body>
  <a class="skip" href="#contenido">Saltar al contenido</a>
  <header class="nav" id="nav">
    <div class="container nav-inner">
      <a class="brand" href="../" aria-label="Frame, inicio">
        <img class="logo-light" src="../assets/img/logo.svg" alt="" width="32" height="32" /><img class="logo-dark" src="../assets/img/logo-dark.svg" alt="" width="32" height="32" />
        <span>FRAME</span>
      </a>
      <div class="nav-actions">
        <a class="btn btn-soft btn-sm" href="../">Volver a Frame</a>
      </div>
    </div>
  </header>
  <main id="contenido" class="container legal">
${out.map(s => '    ' + s).join('\n')}
  </main>
</body>
</html>
`;
const dir = path.join(root, 'website/privacidad');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'index.html'), html);
console.log('ok', html.length, 'bytes,', out.length, 'bloques');
