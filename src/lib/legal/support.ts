// ============================================================
// Bloque III — Pantalla «Reportar un error».
//
// No es una pantalla de cortesía: describe qué se puede reportar, cómo se
// redacta un reporte que se pueda reproducir —que es la mitad del arreglo—,
// qué NUNCA hay que enviar y el puerto seguro para quien investigue una
// vulnerabilidad de buena fe.
// ============================================================

import { SUPPORT_VERSION } from './versions.ts';

export { SUPPORT_VERSION };

export function supportDocument({
  appVersion,
  installId,
  effectiveDate,
}: {
  appVersion: string;
  installId: string;
  effectiveDate: string;
}): string {
  return `# Soporte y reporte de errores

**Versión ${SUPPORT_VERSION} · ${effectiveDate}**

## 1. Qué cubre este canal

Este canal atiende **fallos de funcionamiento**, **dudas sobre el uso** de la Aplicación y **solicitudes relacionadas con tu cuenta y tus datos**.

**Atajos dentro de Frame:** «Información y novedades» (en Ajustes) explica qué hace cada parte de Frame; las **dudas de uso** y las **propuestas de mejora** se envían por correo, igual que los reportes; y los fallos que rompen una pantalla **se reportan solos**, sin datos tuyos, para corregirlos en la siguiente versión.

Frame la mantiene Asvent, un equipo reducido. Todos los mensajes se registran y se revisan. **No garantizamos una respuesta individual a cada mensaje**, y sí garantizamos que todo reporte que describa un fallo reproducible entra en la cola de trabajo.

Los tiempos que siguen son **objetivos de servicio, no compromisos contractuales**: un fallo que impide usar la Aplicación se atiende con prioridad; uno que afecta a una función concreta con alternativa disponible, después; una propuesta de función se evalúa en la planificación de la siguiente versión.

## 2. Antes de escribir

Tres comprobaciones resuelven una parte considerable de los casos:

- Confirma que usas la **última versión** disponible, ya que el fallo puede estar corregido.
- Comprueba si el problema persiste **tras cerrar y volver a abrir la aplicación**.
- Si el fallo afecta a Gmail, YouTube o Classroom, comprueba si el mismo servicio funciona en tu navegador: si tampoco funciona allí, el problema es de Google y no de Frame.

## 3. Cómo redactar un reporte que se pueda resolver

Un fallo que puede reproducirse está medio resuelto. Envía un correo a la dirección de soporte con esta estructura:

**Asunto:** \`Reporte Frame ${appVersion} — [resumen en una línea]\`

**Cuerpo del mensaje:**

### 1. Qué esperabas que ocurriera
Una frase.

### 2. Qué ocurrió en su lugar
Con precisión. «La ventana flotante se cerró sola al minuto de iniciar la sesión» es útil; «no funciona» obliga a escribir tres correos antes de empezar.

### 3. Pasos exactos para reproducirlo
Numerados, desde una situación conocida —por ejemplo, «con la aplicación recién abierta»— hasta el momento del fallo. Incluye qué pantalla, qué botón y en qué orden.

### 4. Frecuencia
Siempre, de forma intermitente, o una sola vez.

### 5. Tu identificador de cuenta
El tuyo es **${installId}**. Lo ves en Ajustes, junto a tu perfil (un clic lo copia), y en la parte superior de la pantalla «Información del sistema».

### 6. Entorno
Versión de Frame, versión de Windows y, si el fallo es de rendimiento, características del equipo.

### 7. Evidencia
Captura de pantalla o grabación breve, si el fallo es visible. Cubre o recorta cualquier dato personal que aparezca.

### 8. Cuándo empezó
Si funcionaba antes, indica desde qué versión o desde qué cambio dejó de hacerlo. Es el dato que más acorta el diagnóstico.

## 4. Si propones una función

Describe **el problema que quieres resolver antes que la solución que imaginas**. Explica en qué momento de tu estudio aparece, qué haces hoy para sortearlo y qué te cuesta. Casi siempre hay más de una forma de resolver un problema, y la primera que se ocurre no suele ser la mejor. Las propuestas que llegan planteadas como problema tienen bastantes más posibilidades de acabar implementadas que las que llegan planteadas como especificación.

## 5. Qué no debes enviar nunca

**No incluyas contraseñas** —ni la de Frame ni la de ningún otro servicio—, ni el contenido de tus documentos, grabaciones, correos o archivos personales, ni datos personales de terceros, ni capturas donde aparezcan datos sensibles sin cubrir.

Nunca los necesitaremos para diagnosticar un fallo, y si los recibimos los eliminaremos.

Los datos que envíes se tratarán exclusivamente para atender tu reporte, conforme a la Política de Privacidad, y se conservarán durante veinticuatro (24) meses desde el cierre del caso.

## 6. Ciclo de vida de un reporte

Todo reporte pasa por: **recibido** —se registra y se acusa recibo cuando es posible—; **reproducido o no reproducido** —se intenta replicar el fallo con tus pasos—; **en cola** —confirmado y priorizado—; **corregido** —resuelto en una versión concreta, que se indica en el historial de versiones—; o **cerrado sin acción** —cuando no se reproduce, corresponde a un servicio de terceros o queda fuera del alcance del producto, en cuyo caso se explica el motivo.

## 7. Reporte de vulnerabilidades de seguridad

**7.1.** Si detectas una vulnerabilidad, **no la publiques ni la difundas** antes de comunicárnosla. Escribe a **vt.asvent@gmail.com** con el asunto \`Seguridad — [componente afectado]\`, describiendo el hallazgo, su impacto potencial y los pasos para reproducirlo.

**7.2. Compromiso del Proveedor.** Acusaremos recibo en un plazo objetivo de setenta y dos (72) horas, te mantendremos informado del avance y, si lo deseas, reconoceremos públicamente tu contribución en el historial de versiones.

**7.3. Puerto seguro.** El Proveedor **no emprenderá acciones legales** contra quien investigue de buena fe, se limite a sus propios datos y a su propia instalación, no acceda a datos de otros usuarios, no degrade el servicio, no extraiga ni conserve información ajena y respete un plazo razonable de corrección antes de cualquier divulgación.

**7.4.** Quedan fuera de este puerto seguro los ataques de denegación de servicio, la ingeniería social sobre personas, el acceso físico no autorizado y cualquier actuación que cause daño real.

## 8. Otras vías

**Ejercicio de derechos sobre tus datos personales** —acceso, rectificación, cancelación, oposición, revocación del consentimiento—: vt.asvent@gmail.com. Esta vía es distinta del soporte técnico y está sujeta a los plazos legales.

## 9. Contacto de soporte

**vt.asvent@gmail.com** · Asvent`;
}
