// Frame · Biblioteca: envía el código de activación al correo institucional.
//
// Es un Apps Script de la cuenta de Asvent, publicado como aplicación web
// («Ejecutar como: yo», «Acceso: cualquier usuario»). Solo lo llama la nube de
// Frame (nube-ia/src/lore-acceso.ts), con su clave, y solo acepta códigos de
// 6 dígitos hacia el dominio del colegio: aunque la clave se filtrara, no
// sirve para escribir a nadie más ni para mandar otro texto. Una cuenta
// gratuita de Google envía 100 correos al día.
//
// Esta copia del repositorio no lleva ni la clave ni el dominio: los de verdad
// están en el script publicado y en Frame/keys/biblioteca-correo.env.
// Para cambiarlo: script.google.com → «Frame · Biblioteca (códigos)» → pegar →
// Implementar → Gestionar implementaciones → editar → Versión nueva (la
// dirección /exec no cambia).
const CLAVE = 'PENDIENTE';
const DOMINIO = 'PENDIENTE';

function doPost(e) {
  let out = { ok: false, error: 'input' };
  try {
    const d = JSON.parse(e.postData.contents);
    const to = String(d.to || '').trim().toLowerCase();
    const code = String(d.code || '');
    const minutes = Math.min(60, Math.max(1, Number(d.minutes) || 10));
    const parts = to.split('@');
    if (d.key !== CLAVE) out.error = 'key';
    else if (parts.length !== 2 || !/^[a-z0-9._%+-]+$/.test(parts[0]) || parts[1] !== DOMINIO || !/^\d{6}$/.test(code)) out.error = 'input';
    else if (MailApp.getRemainingDailyQuota() < 1) out.error = 'quota';
    else {
      MailApp.sendEmail({
        to: to,
        name: 'Frame',
        subject: code + ' es tu código de la Biblioteca de Frame',
        body:
          'Tu código para activar la Biblioteca de Frame es ' + code + '.\n\n' +
          'Vale ' + minutes + ' minutos. Escríbelo en Frame para terminar.\n\n' +
          'Si no lo pediste, ignora este correo: sin el código nadie puede activar nada.\n\n' +
          'Frame, de Asvent · vt.asvent@gmail.com',
        htmlBody:
          '<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">' +
          '<p style="font-size:15px;margin:0 0 12px">Tu código para activar la <b>Biblioteca de Frame</b>:</p>' +
          '<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 12px;color:#1e3a8a">' + code + '</p>' +
          '<p style="font-size:13px;margin:0 0 16px;color:#475569">Vale ' + minutes + ' minutos. Escríbelo en Frame para terminar.</p>' +
          '<p style="font-size:12px;margin:0;color:#64748b">Si no lo pediste, ignora este correo: sin el código nadie puede activar nada.<br>Frame, de Asvent · vt.asvent@gmail.com</p>' +
          '</div>',
      });
      out = { ok: true };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err).slice(0, 120) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Frame');
}
