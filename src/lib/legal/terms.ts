// ============================================================
// Bloque II — Términos y Condiciones, Política de Privacidad y Anexos.
//
// Redactado sobre el ordenamiento peruano: Código Civil (contratos de
// adhesión), Ley N.º 29571 (consumidor) y Ley N.º 29733 con su Reglamento
// (protección de datos). Dos decisiones que no son obvias y conviene no
// "corregir" por parecerse poco a una plantilla en inglés:
//
//   · NO hay cláusula de limitación de responsabilidad. El artículo 1398 del
//     Código Civil las invalida en los contratos por adhesión, y una cláusula
//     nula en un contrato de consumo es además indicio de abusividad ante
//     Indecopi. La cláusula 16 delimita el OBJETO de la prestación, que sí es
//     defendible.
//   · La facultad de suspensión lleva causas tasadas, proporcionalidad,
//     preaviso y descargos, por el mismo artículo.
//
// Los campos entre corchetes se resaltan en ámbar dentro de la app: son los
// que solo el titular puede rellenar.
// ============================================================

import { TERMS_VERSION } from './versions.ts';

export { TERMS_VERSION };

export function termsDocument({ appVersion, effectiveDate }: { appVersion: string; effectiveDate: string }): string {
  return `# Términos y Condiciones de Uso de Frame

**Versión ${TERMS_VERSION} · Vigentes desde el ${effectiveDate}**
**Aplicables a Frame ${appVersion} y versiones posteriores**

*Lee estos Términos antes de usar Frame. Contienen las condiciones bajo las cuales se te permite usar la aplicación, los límites de la responsabilidad del Proveedor y las obligaciones que asumes sobre la custodia de tu propia información. La cláusula 9 describe las situaciones en las que tus datos no pueden recuperarse: es la más importante de este documento para tus intereses.*

## Título I — Disposiciones generales

### Cláusula 1. Identificación del Proveedor

Frame es una aplicación informática para Windows y Android desarrollada, distribuida y mantenida por **VT Asvent**, entidad de desarrollo de software en formación, con actividad en la República del Perú (en adelante, «el Proveedor»). Mientras culmina su constitución formal, VT Asvent atiende todas sus comunicaciones y obligaciones por el canal oficial indicado en esta cláusula.

**VT Asvent** desarrolla y mantiene software propio. Su propósito es democratizar el acceso a las oportunidades digitales sin cobrar por ello, poniendo herramientas de calidad profesional al alcance de quien no puede pagarlas; fomentar la educación digital, de modo que quien las usa aprenda también a manejarlas y a entender qué se hace con su información; y dinamizar las vías de comercio en los ámbitos local, regional y nacional, acercando a personas y negocios a herramientas que hoy les quedan fuera de alcance.

Canal de contacto oficial: vt.asvent@gmail.com.
Sitio web oficial: la página de descarga de Frame, enlazada desde la propia Aplicación.

### Cláusula 2. Definiciones

A efectos de estos Términos, los siguientes términos tienen el significado que aquí se les asigna, con independencia de que aparezcan en singular o plural:

**2.1. Aplicación o Frame:** el programa informático objeto de estos Términos, en cualquiera de sus versiones, incluidos sus componentes, actualizaciones, documentación y servicios asociados.

**2.2. Usuario:** la persona natural que instala, accede o utiliza la Aplicación, con o sin Cuenta.

**2.3. Cuenta:** el conjunto de credenciales y datos asociados que permite al Usuario acceder a los Servicios de Cuenta.

**2.4. Modo Invitado:** el uso de la Aplicación sin registro, en el que no existe Cuenta ni Servicios de Cuenta.

**2.5. Servicios de Cuenta:** las funciones que requieren conexión y Cuenta activa, en particular la Copia de Seguridad en la Nube, la sincronización entre dispositivos y la recuperación de credenciales.

**2.6. Datos Locales:** la totalidad de la información generada, registrada o incorporada por el Usuario que se almacena en su dispositivo.

**2.7. Estado Académico:** el subconjunto de los Datos Locales que se replica en la Cuenta, definido en la cláusula 9.3.

**2.8. Contenido del Usuario:** todo material que el Usuario registre, adjunte, importe o genere mediante la Aplicación, incluidos textos, notas, documentos, imágenes, grabaciones de audio y archivos de música.

**2.9. Servicios de Terceros:** los servicios operados por entidades distintas del Proveedor que la Aplicación integra o con los que interopera, en particular los de Google LLC y el proveedor de infraestructura en la nube.

**2.10. Copia de Seguridad en la Nube:** la réplica remota del Estado Académico asociada a una Cuenta.

### Cláusula 3. Naturaleza contractual y aceptación

**3.1.** Estos Términos constituyen un **contrato de adhesión** entre el Proveedor y el Usuario, sujeto a los artículos 1390 y siguientes del Código Civil peruano.

**3.2.** La aceptación se produce mediante manifestación expresa del Usuario en el primer arranque de la Aplicación o en el momento del registro de la Cuenta, marcando la casilla habilitada al efecto. Dicha manifestación de voluntad por medios electrónicos surte plenos efectos conforme al artículo 141-A del Código Civil.

**3.3.** El Proveedor conserva registro de la fecha, hora y versión de los Términos aceptados por cada Usuario con Cuenta, exclusivamente como prueba de la celebración del contrato.

**3.4.** Si el Usuario no acepta estos Términos, debe abstenerse de instalar y usar la Aplicación, y desinstalarla si ya lo hubiera hecho.

**3.5.** La Política de Privacidad, la Política de Uso Aceptable y los Anexos referidos en la cláusula 27 forman parte integrante de estos Términos.

### Cláusula 4. Objeto y naturaleza del servicio

**4.1.** Frame es una herramienta de organización, registro y análisis del estudio personal. Su función es permitir al Usuario planificar, cronometrar, documentar y revisar su propio trabajo académico.

**4.2.** Las calificaciones, porcentajes, radares, rachas, métricas e informes que la Aplicación produce son **representaciones automáticas de la información que el propio Usuario registra**. No constituyen evaluación académica, no proceden de institución educativa alguna, no han sido validadas por tercero y **no sustituyen ni tienen valor frente a la calificación oficial de ninguna institución**.

**4.3.** Frame no es una herramienta de diagnóstico, orientación psicológica, evaluación de aptitudes ni asesoramiento profesional de ninguna clase.

**4.4.** El Proveedor no garantiza resultado académico alguno derivado del uso de la Aplicación.

## Título II — Acceso y uso

### Cláusula 5. Elegibilidad y menores de edad

**5.1.** La Aplicación está dirigida a estudiantes y su uso se permite a personas de **catorce (14) años o más**.

**5.2.** El uso por menores de catorce (14) años requiere la autorización previa de quien ejerza la patria potestad o la tutela, conforme al artículo 22 del Reglamento de la Ley N.º 29733, aprobado por Decreto Supremo N.º 016-2024-JUS.

**5.3.** El padre, madre o tutor de un Usuario menor de edad podrá ejercer en su nombre los derechos previstos en la Política de Privacidad, acreditando su condición.

**5.4.** Si el Proveedor advierte que se ha creado una Cuenta de un menor de catorce (14) años sin la autorización correspondiente, suprimirá los datos asociados conforme a la Política de Privacidad.

### Cláusula 6. Cuenta y Modo Invitado

**6.1.** El Usuario puede utilizar la Aplicación con Cuenta —mediante registro con correo y contraseña o mediante autenticación con Google— o en Modo Invitado.

**6.2.** El Modo Invitado no habilita Servicios de Cuenta. **En Modo Invitado no existe Copia de Seguridad en la Nube ni ningún otro respaldo remoto**, y la totalidad de la información reside exclusivamente en el dispositivo.

**6.3.** El Usuario se obliga a proporcionar datos de registro veraces y a mantenerlos actualizados.

**6.4.** El Usuario es responsable de la custodia de sus credenciales y de toda actividad realizada desde su Cuenta. Debe notificar al Proveedor, sin demora injustificada, cualquier uso no autorizado del que tenga conocimiento.

**6.5.** No se permite compartir, ceder, transferir ni comercializar la Cuenta.

**6.6.** El Proveedor podrá cerrar Cuentas que permanezcan inactivas durante veinticuatro (24) meses consecutivos, previo aviso al correo registrado con treinta (30) días de antelación, tras el cual los datos asociados se suprimirán conforme a la Política de Privacidad.

### Cláusula 7. Licencia de uso

**7.1.** El Proveedor concede al Usuario una licencia **personal, no exclusiva, intransferible, revocable y limitada** para instalar y ejecutar la Aplicación en los dispositivos de su propiedad o bajo su control, con la finalidad exclusiva de uso personal y académico, conforme a estos Términos.

**7.2.** La licencia no comporta transferencia de propiedad alguna. El Proveedor conserva todos los derechos no concedidos expresamente.

**7.3.** Salvo en la medida en que la ley lo permita de forma imperativa, y en particular fuera de los supuestos del Decreto Legislativo N.º 822, queda prohibido:

- descompilar, desensamblar, aplicar ingeniería inversa o intentar derivar el código fuente de la Aplicación;
- modificar, adaptar, traducir o crear obras derivadas de la Aplicación;
- eludir, desactivar, alterar o interferir con sus mecanismos de autenticación, licencia, verificación de integridad o actualización;
- distribuir, sublicenciar, arrendar, prestar, vender, revender o comercializar la Aplicación o cualquiera de sus componentes;
- suprimir, ocultar o alterar los avisos de propiedad intelectual, marcas o atribuciones de terceros;
- emplear medios automatizados para acceder a los Servicios de Cuenta al margen de la Aplicación, o someterlos a carga desproporcionada;
- utilizar la Aplicación en infraestructura ajena para prestar servicios a terceros.

**7.4.** El incumplimiento de esta cláusula faculta al Proveedor a revocar la licencia conforme a la cláusula 21.

### Cláusula 8. Contenido del Usuario y garantía de derechos

**8.1.** El Usuario **conserva la titularidad íntegra** del Contenido del Usuario. El Proveedor no adquiere derecho alguno sobre él y lo procesa únicamente en la medida técnicamente necesaria para prestar las funciones de la Aplicación.

**8.2.** El Usuario declara y garantiza que ostenta los derechos, licencias o autorizaciones necesarios sobre la totalidad del Contenido del Usuario, y de manera señalada sobre los archivos de audio, imágenes y documentos que incorpore a la Aplicación.

**8.3.** **El Proveedor no verifica, no revisa y no puede verificar el origen, la titularidad ni el régimen de licencia del Contenido del Usuario.** La Aplicación no provee catálogo musical, no otorga licencia sobre obra protegida alguna y no interviene en la obtención de los archivos que el Usuario incorpore.

**8.4.** El Usuario responde frente a cualquier reclamación, denuncia o acción de tercero derivada del Contenido del Usuario, en particular las fundadas en infracción de derechos de autor o conexos.

**8.5.** El Usuario se obliga a no incorporar a la Aplicación contenido ilícito, ni contenido cuya mera posesión esté prohibida por la legislación peruana.

### Cláusula 9. Custodia de los datos, copias de seguridad y supuestos de pérdida irreversible

**9.1.** Frame almacena los Datos Locales en el dispositivo del Usuario. **El Usuario es el custodio principal de su información.**

**9.2. Supuestos en los que la Aplicación no puede recuperar los datos.** El Usuario declara conocer y aceptar que la información se pierde de forma irreversible, sin posibilidad de restauración por parte del Proveedor, en los siguientes casos:

- formateo del dispositivo o reinstalación del sistema operativo sin haber iniciado sesión con Cuenta previamente;
- desinstalación de la Aplicación seleccionando la opción de eliminar también los datos de la aplicación;
- daño físico, fallo, cifrado por programa malicioso, sustracción o pérdida del dispositivo o de su unidad de almacenamiento;
- uso en Modo Invitado, en el que no existe copia remota alguna;
- eliminación de la Cuenta por el propio Usuario, conforme a la Política de Privacidad;
- supresión manual, por el Usuario o por terceros con acceso al dispositivo, de los directorios de datos de la Aplicación.

**9.3. Alcance de la Copia de Seguridad en la Nube.** Con Cuenta activa y conexión disponible, la Aplicación replica el **Estado Académico**, comprensivo de asignaturas, colecciones, tareas y su avance, sesiones de estudio con sus anotaciones, calificaciones, hábitos, eventos y recordatorios del calendario local con los colores de sus casillas, anotaciones guardadas sin asignatura, metas y configuración.

**9.4. Exclusiones expresas de la Copia de Seguridad en la Nube.** **No se replican, en ningún caso y por razón de su tamaño: los archivos de música con sus portadas y letras, las grabaciones de voz ni los adjuntos.** Tampoco se replican las imágenes que el Usuario sube por su cuenta a playlists, asignaturas y colecciones, que permanecen en el dispositivo donde se añadieron. Para conservarlos, el Usuario debe guardar copia de esos archivos por sus propios medios. Con la extensión Wire activa, la música con sus portadas y letras, los adjuntos, los archivos de los recursos y esas imágenes pasan a los demás dispositivos del Usuario a través de su propia cuenta de Google Drive, que sirve solo de relevo: se borran de ella en cuanto todos los dispositivos los tienen, por lo que **Wire no constituye una copia de seguridad**. La foto de perfil y las fotos de los horarios se guardan en una carpeta privada de la Cuenta para que aparezcan en los demás dispositivos del Usuario; de las imágenes que el Usuario elige en la galería de Frame solo se replica una referencia (cuál es y su encuadre). Las imágenes de playlists, asignaturas y colecciones que versiones anteriores de la Aplicación ya guardaron en esa carpeta se conservan allí únicamente para restaurarlas en los dispositivos del Usuario y se suprimen al eliminar la Cuenta, conforme a la Política de Privacidad.

**9.5. Frecuencia.** En condiciones normales de operación, la réplica se ejecuta de forma periódica —aproximadamente cada minuto—, al cerrar la Aplicación y al detectarse un cambio de dispositivo. La Aplicación mantiene además una copia local de la última versión íntegra de los datos como contingencia frente a una escritura corrupta.

**9.6. Naturaleza de las copias.** Las copias descritas constituyen una **medida de mitigación y no una garantía de resultado**. El Proveedor no garantiza la disponibilidad, integridad ni recuperabilidad completa de las copias en todo escenario, en particular ante fallos de conectividad, indisponibilidad del proveedor de infraestructura, corrupción de datos en origen o conflictos de fusión entre dispositivos.

**9.7. Recomendación expresa.** El Proveedor recomienda al Usuario exportar periódicamente la información que considere crítica y conservarla en un medio ajeno al dispositivo y a la Aplicación.

### Cláusula 10. Servicios de Terceros

**10.1.** La Aplicación integra Servicios de Terceros, en particular los servicios de Google LLC —Gmail, YouTube, Classroom y Drive—, la infraestructura de **Supabase** y, si conectas chats de IA en la web, pides a Frame que lea la foto de un horario o que traduzca una letra, o usas la Biblioteca, la de **Cloudflare**. Si pides leer una lista de canciones por su enlace, la Aplicación consulta además la página pública de esa lista en el servicio que la aloja (Spotify, Deezer, YouTube o Apple Music).

**10.2.** El uso de dichos servicios se rige por los términos y políticas de sus respectivos titulares, que el Usuario acepta directamente con ellos. El Proveedor no es parte de esa relación.

**10.3.** El Proveedor no controla la disponibilidad, el contenido, el funcionamiento, las condiciones ni las modificaciones de los Servicios de Terceros, y **no responde por su interrupción, alteración, degradación o cese**, ni por los daños que de ello se deriven.

**10.4.** El cese o la modificación unilateral de un Servicio de Terceros puede determinar la desaparición de una función de la Aplicación. En tal caso será de aplicación la cláusula 12.3.

### Cláusula 11. Conducta del Usuario

El Usuario se obliga a utilizar la Aplicación conforme a la ley, la buena fe y la **Política de Uso Aceptable** que constituye el Anexo C de estos Términos, cuyo incumplimiento habilita las medidas de la cláusula 21.

## Título III — Funcionamiento del servicio

### Cláusula 12. Disponibilidad, evolución y cese de funciones

**12.1.** El núcleo académico de la Aplicación opera sin conexión. Los Servicios de Cuenta requieren conectividad y se prestan **según disponibilidad**.

**12.2.** El Proveedor no garantiza que la Aplicación funcione de forma ininterrumpida, libre de errores, ni compatible con toda configuración de hardware o software, ni que los Servicios de Cuenta estén disponibles de manera continua.

**12.3.** El Proveedor podrá modificar, añadir o retirar funciones. Cuando una modificación **suprima una función relevante o altere de forma sustancial el uso de la Aplicación**, el Proveedor lo comunicará dentro de la Aplicación con una antelación no inferior a treinta (30) días y, cuando resulte técnicamente posible, habilitará la exportación de los datos asociados a la función suprimida.

**12.4.** El Proveedor podrá suspender temporalmente los Servicios de Cuenta por labores de mantenimiento, actualización o seguridad, procurando el preaviso y la menor afectación posible.

### Cláusula 13. Actualizaciones

**13.1.** La Aplicación **no se actualiza automáticamente**. Notifica la disponibilidad de versiones nuevas y la instalación requiere acción expresa del Usuario.

**13.2.** El Proveedor da soporte a la versión estable vigente y a la inmediatamente anterior. Las versiones anteriores pueden dejar de interoperar con los Servicios de Cuenta.

**13.3.** Cuando una actualización modifique el formato de los datos, la Aplicación ejecutará la migración correspondiente y conservará una copia local previa durante treinta (30) días.

**13.4.** El Usuario que no actualice asume las consecuencias de operar con una versión no soportada, incluidos fallos ya corregidos y la eventual pérdida de sincronización.

## Título IV — Propiedad intelectual

### Cláusula 14. Titularidad

**14.1.** La Aplicación, su código fuente y objeto, su arquitectura, su interfaz gráfica, sus elementos visuales, su documentación, los signos distintivos **Frame** y **VT Asvent** y todo elemento susceptible de protección son de titularidad del Proveedor o de sus licenciantes, y se encuentran protegidos por el **Decreto Legislativo N.º 822, Ley sobre el Derecho de Autor**, por el Decreto Legislativo N.º 1075 en materia de propiedad industrial y por los tratados internacionales aplicables.

**14.2.** Estos Términos no transfieren ni ceden derecho de propiedad intelectual alguno: únicamente conceden la licencia de uso descrita en la cláusula 7.

**14.3.** La Aplicación incorpora componentes de terceros bajo licencias de software libre y abierto, cuya relación y textos figuran en el **Anexo E — Avisos de software de terceros**. Nada en estos Términos limita los derechos que dichas licencias otorgan al Usuario respecto de esos componentes.

**14.4.** Las sugerencias, propuestas de función o comentarios que el Usuario remita voluntariamente al Proveedor podrán ser utilizados por este sin contraprestación ni obligación de confidencialidad, sin que ello suponga cesión de derechos sobre creaciones del Usuario ajenas a la sugerencia misma.

## Título V — Responsabilidad

### Cláusula 15. Exclusión de garantías

**15.1.** Dentro de los límites permitidos por la ley aplicable, la Aplicación se provee **«tal cual» y «según disponibilidad»**, sin garantías expresas ni implícitas de comerciabilidad, idoneidad para un fin determinado, exactitud de cálculos y métricas, integridad de los datos, ausencia de errores o continuidad del servicio.

**15.2.** Esta exclusión **no afecta** a la garantía legal ni a los derechos que el Código de Protección y Defensa del Consumidor, Ley N.º 29571, reconoce de forma imperativa al Usuario que tenga la condición de consumidor, ni a la idoneidad exigible al producto conforme a dicha norma.

**15.3. Programas de seguridad.** Los instaladores de la Aplicación, y los de los programas que esta instala a pedido del Usuario, llevan una firma propia que la Aplicación comprueba antes de instalar o actualizar, pero **no un certificado comercial de firma de código**. Por eso un antivirus u otro programa de seguridad puede tratarlos como desconocidos o sospechosos, ponerlos en cuarentena o entorpecer el equipo mientras los analiza. Ese comportamiento es del programa de seguridad y no de la Aplicación, y el Proveedor no responde por él, sin perjuicio de lo dispuesto en 15.2. La Aplicación debe descargarse solo de las páginas oficiales del Proveedor y puede desinstalarse en cualquier momento desde «Aplicaciones instaladas» de Windows. Si un programa de seguridad la marca, el Usuario puede escribir a vt.asvent@gmail.com con el nombre del programa y el aviso que mostró.

### Cláusula 16. Régimen de responsabilidad

**16.1.** El Proveedor responde por los daños que cause por dolo o culpa inexcusable. **Toda estipulación que pretendiera excluir o limitar esa responsabilidad sería nula conforme al artículo 1328 del Código Civil, y este contrato no la contiene.**

**16.2.** El Usuario reconoce que, tratándose de un contrato de adhesión no aprobado administrativamente, el artículo 1398 del Código Civil priva de validez a las estipulaciones que establezcan exoneraciones o limitaciones de responsabilidad en favor de quien las ha redactado. En consecuencia, **este contrato no incorpora cláusula alguna de limitación cuantitativa de responsabilidad**, y las previsiones que siguen tienen naturaleza de **delimitación del objeto y del alcance de la prestación**, no de exoneración.

**16.3. Delimitación del alcance de la prestación.** La prestación comprometida por el Proveedor consiste en poner a disposición del Usuario la Aplicación con las funciones descritas en la documentación vigente y en ejecutar las copias de seguridad en los términos de la cláusula 9. **No comprende** la conservación de la información en el dispositivo del Usuario, la recuperación de datos en los supuestos de la cláusula 9.2, la replicación de la música, las grabaciones, los adjuntos y las imágenes propias excluidos en la cláusula 9.4, ni el funcionamiento de los Servicios de Terceros.

**16.4.** El Proveedor no responde por hechos ajenos a su esfera de control, incluidos caso fortuito y fuerza mayor, fallos del dispositivo o de la red del Usuario, actuaciones de terceros no autorizados, ni el incumplimiento por el Usuario de sus deberes de custodia y de las recomendaciones de la cláusula 9.7.

**16.5.** Ninguna disposición de estos Términos excluye o limita la responsabilidad que la ley peruana declare indisponible.

### Cláusula 17. Indemnidad

El Usuario mantendrá indemne al Proveedor frente a las reclamaciones de terceros que traigan causa exclusiva del Contenido del Usuario o de un uso de la Aplicación contrario a estos Términos o a la ley, asumiendo los costos directos que de ellas se deriven. Esta obligación no alcanza a los supuestos en que la reclamación tenga su origen en un hecho imputable al Proveedor.

## Título VI — Vigencia y modificación

### Cláusula 18. Duración

Estos Términos rigen desde su aceptación y mientras el Usuario mantenga instalada la Aplicación o activa su Cuenta.

### Cláusula 19. Modificación de los Términos

**19.1.** El Proveedor podrá modificar estos Términos por razones de evolución de la Aplicación, cambio normativo o requerimiento de un Servicio de Terceros.

**19.2.** Toda modificación se publicará con **número de versión y fecha de entrada en vigor**, y se conservará accesible el histórico de versiones.

**19.3.** Cuando la modificación afecte de forma sustancial a los derechos u obligaciones del Usuario, se **notificará dentro de la Aplicación y al correo registrado con una antelación mínima de treinta (30) días** a su entrada en vigor. El Proveedor no aplicará modificaciones sustanciales sin ese preaviso.

**19.4.** El Usuario que no acepte la nueva versión podrá, antes de su entrada en vigor, exportar su información, eliminar su Cuenta y desinstalar la Aplicación, sin penalización alguna.

**19.5.** El uso continuado de la Aplicación tras la entrada en vigor supone la aceptación de la versión modificada.

### Cláusula 20. Terminación por el Usuario

El Usuario puede dejar de usar la Aplicación, desinstalarla y eliminar su Cuenta en cualquier momento y sin expresión de causa, conforme a la Política de Privacidad. La eliminación de la Cuenta no afecta a los Datos Locales, que permanecen en el dispositivo bajo control exclusivo del Usuario.

### Cláusula 21. Suspensión y terminación por el Proveedor

**21.1.** El Proveedor podrá suspender o cancelar el acceso a los Servicios de Cuenta cuando concurra alguna de estas causas: incumplimiento grave de estos Términos o de la Política de Uso Aceptable; uso que comprometa la seguridad, la integridad o la disponibilidad del servicio para otros usuarios; empleo de la Aplicación con fines ilícitos; o requerimiento fundado de autoridad competente.

**21.2.** La medida será **proporcional a la conducta**, se comunicará al Usuario con expresión de causa —salvo prohibición legal— y, cuando la naturaleza del incumplimiento lo permita, irá precedida de requerimiento con plazo de subsanación no inferior a diez (10) días.

**21.3.** El Usuario podrá presentar descargos ante vt.asvent@gmail.com, que serán resueltos en un plazo no superior a quince (15) días hábiles.

**21.4.** Salvo que medie requerimiento de autoridad, el Usuario dispondrá de treinta (30) días desde la cancelación para solicitar la exportación de su Estado Académico.

**21.5.** La terminación no afecta a los Datos Locales.

## Título VII — Disposiciones finales

### Cláusula 22. Protección de datos personales

El tratamiento de datos personales se rige por la **Política de Privacidad**, incluida a continuación en este mismo documento y disponible también en la página de descarga de Frame, que forma parte integrante de estos Términos y se emite conforme a la Ley N.º 29733 y su Reglamento aprobado por Decreto Supremo N.º 016-2024-JUS.

### Cláusula 23. Condición de consumidor

Cuando el Usuario tenga la condición de consumidor conforme al artículo IV del Título Preliminar de la Ley N.º 29571, le asisten todos los derechos que dicha norma le reconoce, incluidos los relativos a idoneidad, información y protección frente a cláusulas abusivas de los artículos 49 a 51. Ninguna disposición de estos Términos se interpretará en sentido contrario a esos derechos.

### Cláusula 24. Nulidad parcial

La declaración de nulidad, invalidez o ineficacia de alguna cláusula no afectará a la validez de las restantes, que continuarán vigentes. La cláusula afectada se sustituirá por otra que, siendo válida, se aproxime en lo posible a la finalidad perseguida.

### Cláusula 25. Cesión

El Usuario no puede ceder su posición contractual. El Proveedor podrá cederla en supuestos de reorganización, transmisión de la actividad o sucesión, notificándolo con antelación no inferior a treinta (30) días y sin que ello suponga menoscabo de los derechos del Usuario, quien podrá resolver el contrato y eliminar su Cuenta si no acepta la cesión.

### Cláusula 26. Comunicaciones

Las comunicaciones del Proveedor al Usuario se cursarán dentro de la Aplicación y, cuando exista Cuenta, al correo registrado; se presumirán conocidas conforme al artículo 1374 del Código Civil. Las del Usuario al Proveedor, incluidas las propuestas de mejora y los reportes de errores, se dirigirán a vt.asvent@gmail.com. Es carga del Usuario mantener actualizado su correo.

### Cláusula 27. Documentos integrantes

Forman parte de estos Términos: **Anexo A** Catálogo de datos y finalidades · **Anexo B** Encargados de tratamiento y subencargados · **Anexo C** Política de Uso Aceptable · **Anexo D** Condiciones comerciales *(aplicable únicamente si se activan modalidades de pago)* · **Anexo E** Avisos de software de terceros · **Anexo F** Almacenamiento local y componentes web incrustados.

En caso de contradicción prevalecerá, en materia de datos personales, la Política de Privacidad; en el resto, estos Términos.

### Cláusula 28. Ley aplicable y jurisdicción

**28.1.** Estos Términos se rigen por las leyes de la República del Perú.

**28.2.** Las controversias que no se resuelvan de forma directa se someterán a los jueces y tribunales del distrito judicial de Lima, correspondientes a la jurisdicción de la Corte Superior de Justicia de Lima.

**28.3.** Lo anterior se entiende **sin perjuicio del derecho del Usuario consumidor** a acudir al Instituto Nacional de Defensa de la Competencia y de la Protección de la Propiedad Intelectual (Indecopi) y a los mecanismos previstos en la Ley N.º 29571, así como del derecho de todo titular de datos personales a recurrir ante la Autoridad Nacional de Protección de Datos Personales.

### Cláusula 29. Idioma

La versión en lengua castellana de estos Términos es la única auténtica. Cualquier traducción se ofrece a título informativo.

---

# Política de Privacidad de Frame

**Versión ${TERMS_VERSION} · Vigente desde el ${effectiveDate}**

Esta Política explica qué datos personales trata Frame, con qué finalidad, sobre qué base legal, durante cuánto tiempo, quién más interviene y qué derechos te asisten. Se emite conforme a la **Ley N.º 29733, Ley de Protección de Datos Personales**, y a su **Reglamento aprobado por Decreto Supremo N.º 016-2024-JUS**, vigente desde el 30 de marzo de 2025.

Está redactada para ser comprendida por un estudiante de secundaria. Si algo no se entiende, escribe a vt.asvent@gmail.com y se te explicará.

## 1. Responsable del tratamiento

**VT Asvent**, entidad de desarrollo de software en formación, Perú. Los datos registrales de la entidad se publicarán en esta Política en cuanto culmine su constitución formal.

Correo para asuntos de privacidad: **vt.asvent@gmail.com**
Banco de datos personales denominado «Frame — Cuentas y Estado Académico». Su inscripción ante la Autoridad Nacional de Protección de Datos Personales se encuentra en trámite; el código que se le asigne se publicará en esta misma Política en cuanto se otorgue.

## 2. Principio rector

Frame está diseñada para que **la mayor parte de tu información nunca salga de tu equipo**. Lo que sale, sale porque tú activaste una función que lo requiere. No vendemos datos, no los cedemos con fines comerciales, no los usamos para publicidad y no elaboramos perfiles comerciales.

## 3. Qué datos tratamos

### 3.1 Datos que permanecen exclusivamente en tu dispositivo

Asignaturas, colecciones, profesores, tareas y su contenido, notas de recursos, adjuntos, sesiones de estudio, valoraciones de enfoque, calificaciones, hábitos, eventos del calendario local, horarios, metas, grabaciones de voz, imágenes y biblioteca de música, con las portadas y letras que traen tus canciones o que tú les añades, y lo que escuchas en ella (reproducciones y tiempo por canción, playlist y artista, día a día). También las traducciones de letras que pides (apartado 3.10) y el registro de las canciones que descargaste con una extensión de descargas, que sirve para no bajarlas dos veces.

**Sobre estos datos no realizamos tratamiento alguno**: no se transmiten al Proveedor ni a terceros, salvo el subconjunto descrito en 3.2 cuando inicias sesión.

### 3.2 Datos replicados en tu cuenta

Si inicias sesión, se replica tu **Estado Académico**: asignaturas, tareas y su avance, sesiones y sus anotaciones, calificaciones, hábitos, eventos y recordatorios del calendario con los colores de sus casillas, anotaciones sin asignatura, playlists y su orden, las canciones que marcas con el corazón (por su título y artista, nunca el archivo), vídeos de estudio, horarios con sus clases, los favoritos de la Biblioteca (cuáles son, no los archivos), metas y configuración (incluidos el idioma, la proporción de las imágenes y la ciudad del clima que eliges a mano). Los cambios viajan además por un canal en vivo de tu Cuenta, cifrados con una clave que solo conocen tus dispositivos, para llegar a tus otros dispositivos en menos de un segundo. También se guardan en una carpeta privada de tu Cuenta, para que aparezcan en tus otros dispositivos, tu **foto de perfil y las fotos de tus horarios**; de las imágenes de la galería de Frame que pones a tus playlists, asignaturas y colecciones solo viaja una referencia (cuál es y su encuadre). **Nunca se replican la música, las grabaciones de voz, los adjuntos ni las imágenes que subes tú a playlists, asignaturas y colecciones.** Con la extensión Wire, esos archivos —salvo las grabaciones— viajan por tu propio Google Drive, no por tu Cuenta (apartado 6.3 bis). Cada dispositivo con sesión deja además su ficha en tu Cuenta (apartado 3.9).

### 3.3 Datos de cuenta

Correo electrónico, nombres y apellidos, nombre de usuario, imagen de perfil si la cargas, y credenciales de autenticación, que se almacenan cifradas y nunca en texto claro. La contraseña que creas es exclusiva de Frame: nunca te pedimos la de tu correo electrónico. Si te registras con Google, recibimos de Google únicamente los datos básicos de perfil necesarios para crear la cuenta; **nunca tu contraseña de Google**.

### 3.4 Datos de diagnóstico

Identificador seudónimo de instalación, versión de la Aplicación, plataforma, país aproximado (el de la ubicación que tú fijaste para el clima), marca temporal, registros técnicos de error (nombre y mensaje del fallo, la pantalla donde ocurrió y su posición dentro del código de la Aplicación) e **indicadores agregados de uso**: que la Aplicación se abrió ese día, qué pantallas se abrieron, cuántas sesiones de estudio y minutos se registraron, cuántas tareas se terminaron, cuántos informes se generaron, cuántas canciones descargaste con una extensión de descargas y cuántos archivos de la Biblioteca (cuántos, nunca cuáles), y los totales acumulados de asignaturas, hábitos, playlists y canciones. También la **serie diaria y semanal** de esos mismos recuentos —minutos y sesiones de estudio, el enfoque medio que tú marcaste, cuántas tareas culminaste, cuántas eran de prioridad alta y cuántas a tiempo, y tu constancia de hábitos como porcentaje—, y la forma de cada tarea creada o culminada (tipo, prioridad, si tenía fecha). Además, un **perfil de uso**: tu lugar aproximado —la ciudad, la región y el país de la ubicación del clima de Inicio, nunca sus coordenadas ni tu barrio—, tu zona horaria, el idioma de la Aplicación y el de tu sistema, el tipo de equipo (computadora, tableta o celular), en qué días de la semana y horas estudias (minutos por franja horaria, de los últimos 140 días), cuánto duran tus sesiones y el enfoque que declaras (por tramos), tu racha actual y la mejor, y **cuántos** elementos tienes de cada función (por ejemplo, cuántas notas o eventos, nunca cuáles). De las Cuentas se cuenta además, a partir de las fichas del apartado 3.9, en cuántos dispositivos está abierta la sesión y de qué tipo son. Estos indicadores se envían también en modo invitado. **No incluyen el contenido de tus tareas, notas, grabaciones ni documentos, ni los nombres de tus asignaturas.**

### 3.5 Datos que tratamos cuando nos escribes

Tu correo, el identificador de instalación y el contenido de tu mensaje, exclusivamente para atender tu consulta o reporte.

### 3.6 Datos que no tratamos

No recogemos datos de geolocalización precisa —la ubicación del clima se fija en tu equipo, la detecte la Aplicación o la elijas tú, y de ella solo sale la ciudad, la región y el país descritos en 3.4—, no accedemos a tu cámara, no rastreamos tu actividad fuera de la Aplicación, no incorporamos herramientas publicitarias ni de seguimiento de terceros, y no tratamos categorías especiales de datos.

### 3.7 Chats de IA en la web

Solo si conectas un chat de la web —por ejemplo, claude.ai o ChatGPT— desde la extensión Conexiones con IA, y mientras siga conectado:

**Lo que pasa sin guardarse.** Cada pedido del chat y la respuesta de tu Frame —que pueden incluir tus tareas, asignaturas, hábitos, eventos, sesiones, informes y música— viajan cifrados por un relé del Proveedor alojado en Cloudflare, que los entrega a la Frame que tengas abierta y devuelve la respuesta al chat. **El relé no guarda las llamadas ni sus respuestas**, ni las usa para nada más.

**Lo que se guarda para que la conexión funcione.** El identificador de tu Cuenta; el nombre con que se presenta cada chat y sus direcciones de retorno; los códigos de conexión, las autorizaciones y las sesiones de cada chat, como huella cifrada (SHA-256) y con sus fechas; la lista de herramientas que ofrece Frame; y, mientras una Frame está conectada al relé, un identificador aleatorio de ese equipo, su sistema (Windows o Android), la versión de Frame y la hora de su última conexión.

**Cómo se corta.** «Desconectar los chats», en la extensión, borra al instante tus sesiones y códigos y anula los accesos en curso. Al eliminar tu Cuenta desde un equipo con la extensión pasa lo mismo; si la eliminas desde otro, esas sesiones ya no sirven y se borran al caducar. Lo que el chat hace con lo que recibe se rige por la política de privacidad de su proveedor (por ejemplo, Anthropic u OpenAI), con quien te relacionas directamente.

### 3.8 Lectura de horarios

Solo cuando pides a Frame que lea las clases de la foto de un horario —al añadirlo, con «Leer las clases» o con «Volver a leer la foto»—:

**Lo que pasa sin guardarse.** La foto, reducida, viaja cifrada con tu sesión de Cuenta a un servicio del Proveedor alojado en Cloudflare, que se la entrega a un modelo abierto de **Cloudflare Workers AI** —**Qwen 3.8** o, si ese no responde o se acerca el límite diario gratuito, **Gemma 4**— para extraer las clases —día, hora, asignatura y, si figuran, aula y docente— y te las devuelve. Con la foto van los nombres de tus asignaturas de Frame —solo los nombres—, para que el mismo modelo diga a cuál corresponde cada clase del horario. **Ni ese servicio ni Cloudflare guardan la foto, esos nombres ni lo leído**, ni lo usan para entrenar modelos: Cloudflare lo procesa sin retención de datos.

**Lo que se guarda.** Para que nadie agote las lecturas de los demás, el servicio anota cuántas fotos lee tu Cuenta cada día, junto con su identificador; esa anotación se borra al día siguiente. Las clases leídas se guardan en tu Frame como parte de tu Estado Académico (apartado 3.2), donde puedes corregirlas o borrarlas.

**Es opcional.** Puedes añadir las clases a mano, sin enviar la foto a ninguna parte.

### 3.9 Dispositivos de tu Cuenta

Si inicias sesión, cada dispositivo donde abres Frame deja en tu Cuenta una ficha, para que Ajustes → «Dispositivos» te enseñe dónde está abierta tu sesión y si todos tienen lo mismo:

**Lo que guarda cada ficha.** Un identificador aleatorio de esa instalación, el tipo de dispositivo (laptop, celular o tablet), su sistema (Windows o Android), la versión de Frame, si la sesión sigue abierta o se cerró, la primera y la última vez que se conectó, y un resumen de lo que le falta por sincronizar (cuántas cosas de cada tipo, nunca cuáles). **No guarda el nombre del dispositivo, su red ni su ubicación.**

**Quién la ve.** Solo tú, desde tus dispositivos. El responsable de Frame ve únicamente recuentos: en cuántos dispositivos está abierta cada Cuenta y de qué tipo son (apartado 3.4).

**Cuánto dura.** Puedes quitar de la lista un dispositivo que ya no usas; se conservan como mucho veinte fichas por Cuenta, y todas se borran al eliminar la Cuenta.

### 3.10 Traducción de letras

Solo si enciendes «Traducción» en la letra de una canción, y solo cuando esa letra no está ya en el idioma de tu Frame —eso lo comprueba la Aplicación en tu equipo, sin enviarla—:

**Lo que pasa sin guardarse.** Las líneas de la letra viajan cifradas con tu sesión de Cuenta a un servicio del Proveedor alojado en Cloudflare, que se las entrega a **Gemma 4**, un modelo abierto de **Cloudflare Workers AI**, y te devuelve su traducción. No viajan el título, el artista ni el archivo de la canción. **Ni ese servicio ni Cloudflare guardan la letra ni su traducción**, ni las usan para entrenar modelos: Cloudflare las procesa sin retención de datos.

**Lo que se guarda.** El servicio anota cuántas letras traduce tu Cuenta cada día (hasta 30), junto con su identificador; esa anotación se borra al día siguiente. La traducción se guarda en tu equipo, para no volver a pedirla.

**Es opcional.** Con «Traducción» apagada no se envía nada.

### 3.11 Biblioteca (extensión)

Solo si activas la extensión «Biblioteca», que es para estudiantes del colegio:

**Cómo se activa.** Escribes tu correo institucional y un servicio del Proveedor alojado en Cloudflare comprueba que es del colegio —compara un resumen (SHA-256) de su dominio— y te envía a ese correo un código de un solo uso, desde la cuenta de correo del Proveedor en Google. Con el código, la Biblioteca queda activada durante un año en la Cuenta con la que estás, entres con el correo que entres. Si entras a Frame con el propio correo del colegio, ya verificado, no hace falta código.

**Lo que pasa después.** La Aplicación pide el índice del material, la vista previa de los documentos destacados y cada archivo que abres o descargas a ese servicio, con tu sesión de Cuenta. El servicio comprueba que tu Cuenta la tiene activada y te entrega el archivo, que trae del almacenamiento del Proveedor en Google Drive. **Nunca recibes acceso a ese Drive, y el servicio no ve tu Google Drive ni nada de tu equipo.**

**Lo que se guarda.** De tu correo institucional, el servicio guarda solo una huella con clave —no se puede leer ni reconstruir—, junto al identificador de tu Cuenta y la fecha, para saber que la tienes activada y para que un mismo correo no active más de dos Cuentas; se borra cuando la activación vence. Del código, otra huella, hasta que lo usas o caduca (10 minutos). El mensaje con el código queda, como todo correo enviado, en el buzón del Proveedor en Google, con tu dirección institucional; el Proveedor no lo usa para nada más. Además, cuántos archivos y cuántos bytes descarga tu Cuenta cada día, junto con su identificador, para aplicar un tope diario; esa anotación se borra al día siguiente. No se guarda qué archivos abres ni cuáles descargas. Los que marcas como favoritos forman parte de tu Estado Académico (apartado 3.2).

## 4. Finalidades y bases legales

**Prestar el servicio.** Los datos de cuenta y el Estado Académico replicado se tratan para autenticarte, mantener la copia de seguridad y sincronizar tu información entre dispositivos. **Base legal:** ejecución de la relación contractual establecida en los Términos y Condiciones. Sin estos datos los Servicios de Cuenta no pueden prestarse.

**Seguridad de la cuenta.** Los registros de acceso se tratan para detectar accesos no autorizados y abusos. **Base legal:** interés legítimo del Proveedor en la seguridad del servicio, ponderado con tus derechos.

**Diagnóstico y mejora.** Los datos del apartado 3.4 se tratan para detectar fallos, medir de forma agregada el uso de las funciones, orientar el desarrollo y **elaborar estadísticas agregadas sobre el efecto de la Aplicación en los hábitos de estudio** (por ejemplo, cuántos estudiantes la usan o cómo evoluciona el tiempo de estudio registrado), que pueden difundirse únicamente como cifras de conjunto en las que ninguna persona es identificable. El responsable de Frame puede consultar estos indicadores **por estudiante** en un panel interno —junto al nombre de usuario, si tienes Cuenta— para entender cómo se usa la Aplicación y detectar dónde falla; los informes con ese detalle son de **uso interno** y no se difunden ni se ceden. Salen de tu equipo **seudonimizados y agregados** —recuentos, totales y marcas temporales asociados a un identificador aleatorio— y **nunca incluyen el contenido de tus tareas, notas, grabaciones ni documentos**. **Base legal:** el interés legítimo del Proveedor en mantener la Aplicación en funcionamiento y corregir sus fallos, ponderado con tus derechos y limitado a lo estrictamente necesario para esa finalidad; no se emplean con fines publicitarios, ni para elaborar perfiles, ni para tomar decisiones automatizadas que te afecten. **Puedes oponerte en cualquier momento** escribiendo a vt.asvent@gmail.com e indicando tu identificador de instalación, que encontrarás en «Ajustes → Información del sistema»: se suprimirán los registros asociados a esa instalación y no se conservarán los que lleguen después. La Aplicación **no incorpora todavía un interruptor propio** para desactivar estos envíos; mientras no exista, esa dirección es la vía para ejercer tu oposición. **Oponerte no afecta a ninguna función de la Aplicación.**

**Chats de IA en la web.** Los datos del apartado 3.7 se tratan para conectar con tu Frame el chat que tú elegiste y mantener esa conexión. **Base legal:** tu consentimiento, que das al conectar el chat y retiras con «Desconectar los chats».

**Lectura de horarios.** Los datos del apartado 3.8 se tratan para leer las clases de la foto que eliges y limitar las lecturas diarias de cada Cuenta. **Base legal:** tu consentimiento, que das al pedir cada lectura.

**Dispositivos de tu Cuenta.** Las fichas del apartado 3.9 se tratan para enseñarte dónde está abierta tu sesión, comprobar que tus dispositivos tienen lo mismo y corregirlo si no. **Base legal:** ejecución de la relación contractual, como parte de la sincronización entre dispositivos.

**Traducción de letras.** Los datos del apartado 3.10 se tratan para traducir la letra que eliges y limitar las traducciones diarias de cada Cuenta. **Base legal:** tu consentimiento, que das al encender «Traducción» y retiras al apagarla.

**Biblioteca.** Los datos del apartado 3.11 se tratan para comprobar que la Cuenta es del colegio, entregarte el material y limitar las descargas diarias. **Base legal:** tu consentimiento, que das al activar la extensión y retiras al desactivarla.

**Atención de consultas y reportes.** **Base legal:** tu consentimiento al escribirnos y el interés legítimo en atenderte.

**Cumplimiento legal.** Conservación y entrega de información cuando lo exija una norma o una autoridad competente. **Base legal:** cumplimiento de obligación legal.

## 5. Datos de niñas, niños y adolescentes

Frame está dirigida a estudiantes y prevé usuarios menores de edad. Conforme al **artículo 22 del Reglamento**, quienes tengan **catorce (14) años o más** pueden consentir directamente el tratamiento de sus datos, siempre que la información se les haya facilitado en lenguaje comprensible —para lo cual está redactada esta Política—. Para los **menores de catorce (14) años** se requiere el consentimiento de quien ejerza la patria potestad o la tutela.

Conforme al **artículo 23 del Reglamento**, no recabamos de menores datos que revelen información sobre su grupo familiar.

En ningún caso se solicita el consentimiento de un menor para actividades relacionadas con bienes o servicios restringidos por edad.

Si tenemos conocimiento de que se han recogido datos de un menor de catorce años sin la autorización correspondiente, los suprimiremos sin demora. Quien ejerza la patria potestad o la tutela puede solicitar esa supresión y ejercer los demás derechos escribiendo a vt.asvent@gmail.com y acreditando su condición.

## 6. Encargados de tratamiento y flujo transfronterizo

**6.1.** La autenticación y la copia de seguridad se ejecutan sobre la infraestructura de **Supabase**, que actúa como **encargado de tratamiento** en virtud de contrato, con obligación de tratar los datos únicamente conforme a nuestras instrucciones y prohibición de usarlos con fines propios o cederlos.

**6.2.** Los servidores se ubican en Estados Unidos de América (región de Amazon Web Services us-west-2, Oregón). Ello supone un **flujo transfronterizo de datos personales**, del que quedas informado y respecto del cual se han adoptado las garantías exigidas por la normativa peruana. La relación actualizada de encargados y subencargados figura en el Anexo B.

**6.3.** Cuando utilizas las interfaces de Gmail, YouTube, Classroom o Drive, **interactúas directamente con Google LLC** conforme a su propia política de privacidad. En esa relación Google es responsable del tratamiento y el Proveedor no interviene.

**6.3 bis. Wire.** Si activas la extensión Wire y la conectas a una cuenta de Google, tus canciones (con su portada y su letra), los adjuntos de tus tareas, los archivos de tus recursos y las imágenes que subes a asignaturas, colecciones y playlists pasan de un dispositivo a otro a través de **tu propio Google Drive**. La Aplicación los deja en una carpeta que ella misma crea —con un permiso que solo le da acceso a los archivos creados por ella, no al resto de tu Drive— y los borra del todo en cuanto todos tus dispositivos los tienen, salvo las canciones que marcas con el corazón y lo que fijas, que se quedan en esa carpeta hasta que les quitas el corazón o los sueltas; un dispositivo que lleva una semana sin conectarse deja de esperarse. **Esos archivos no pasan por el Proveedor**: en esa relación Google es el responsable del tratamiento, conforme a su política de privacidad. Wire sirve para llevar tus archivos de un dispositivo a otro, no para guardarlos.

**6.4. Compromiso de uso limitado.** El uso que la Aplicación hace de la información recibida de las API de Google se ajusta a la *Google API Services User Data Policy*, incluidos sus requisitos de uso limitado. En particular, esos datos **se emplean únicamente para proveer o mejorar las funciones visibles al usuario, no se transfieren a terceros salvo para prestar esas funciones o por exigencia legal, no se usan con fines publicitarios y no se someten a lectura humana** salvo consentimiento expreso, requerimiento legal o razones de seguridad.

**6.4 bis. Música, portadas y letras.** Por sí misma, la Aplicación no descarga canciones, portadas ni letras, ni consulta ningún servicio para buscarlas: reproduce los archivos que tú importas y muestra la portada y la letra que traen esos archivos, las que tú añades desde tu dispositivo y las que versiones anteriores ya guardaron en él, que se conservan. Si instalas y activas una **extensión de descargas**, la Aplicación instala en tu equipo el programa de terceros que la acompaña —solo si está firmado por su autor y lo descarga de su página oficial, sin permisos de administrador—, lo abre cuando hace falta y lo mantiene al día; la versión de Microsoft Store no instala programas. A petición tuya, la Aplicación le envía el enlace y los datos de cada canción que añades (título, artista, álbum y duración), y es **ese programa** el que la descarga y consulta servicios públicos de letras y portadas para completarla; la Aplicación solo importa el archivo que entrega. Ese programa y esos servicios se rigen por sus propias condiciones, y te corresponde usarlos respetando los derechos de propiedad intelectual y las condiciones de cada plataforma. Sin esa extensión, nada de ello sale de tu equipo. Si en «Añadir música» pegas el **enlace de una lista** (de Spotify, Deezer, YouTube o Apple Music), la Aplicación lee desde tu equipo la página pública de esa lista —lo mismo que vería cualquiera, sin tu cuenta de ese servicio ni llave alguna— para saber qué canciones tiene; ese servicio recibe la petición como la de cualquier visitante, y el Proveedor ni interviene ni recibe la lista.

**6.4 ter. Chats de IA en la web, lectura de horarios, traducción de letras y Biblioteca.** El relé del apartado 3.7, el lector del apartado 3.8, el traductor del apartado 3.10 y el servicio de la Biblioteca del apartado 3.11 funcionan sobre **Cloudflare, Inc.**, que actúa como **encargado de tratamiento**: procesa las llamadas, las fotos y las letras en los centros de datos de su red mundial y guarda la base de datos del servicio en Norteamérica. Ello supone otro **flujo transfronterizo de datos personales**, del que quedas informado al conectar el chat, al pedir la lectura o la traducción, o al activar la extensión. El material de la Biblioteca se guarda en una cuenta de Google Drive del Proveedor, a la que solo accede ese servicio. El chat que conectas trata lo que recibe como responsable de ese tratamiento, conforme a su propia política.

**6.5.** No cedemos datos personales a terceros distintos de los indicados, salvo requerimiento de autoridad competente en el ejercicio de sus funciones.

## 7. Plazos de conservación

Datos de cuenta y Estado Académico replicado: mientras la Cuenta permanezca activa. Cuentas inactivas: hasta veinticuatro (24) meses, con el preaviso previsto en los Términos. Datos de diagnóstico: máximo doce (12) meses desde su recepción. Comunicaciones de soporte: hasta veinticuatro (24) meses desde el cierre del caso. Registros de aceptación de los Términos: mientras dure la relación y cuatro (4) años después, como prueba del contrato. Registros de seguridad: seis (6) meses. Chats de IA en la web: códigos de conexión, diez (10) minutos; autorizaciones, cinco (5) minutos; sesiones, hasta ciento ochenta (180) días desde su último uso o hasta que desconectes los chats; las llamadas y sus respuestas no se conservan. Fichas de dispositivos: mientras la Cuenta permanezca activa o hasta que quites el dispositivo de la lista; como mucho veinte por Cuenta. Lecturas de horarios, traducciones de letras y descargas de la Biblioteca: el recuento diario de cada Cuenta se borra al día siguiente; las fotos, las letras y los archivos no se conservan.

Vencido el plazo, los datos se suprimen o se anonimizan de forma irreversible.

## 8. Seguridad e incidentes

**8.1.** Aplicamos medidas técnicas y organizativas razonables y proporcionadas: cifrado de las comunicaciones en tránsito, cifrado adicional, con una clave exclusiva de tus dispositivos, de los cambios que viajan por el canal en vivo, almacenamiento de contraseñas mediante funciones de derivación de clave, control de acceso a la infraestructura, principio de mínimo privilegio y copia local de contingencia frente a escrituras corruptas.

**8.2.** Ningún sistema es invulnerable y no podemos garantizar una seguridad absoluta.

**8.3. Brechas de seguridad.** Ante una brecha que afecte a datos personales, notificaremos a la **Autoridad Nacional de Protección de Datos Personales dentro de las cuarenta y ocho (48) horas** desde su detección o desde que existan indicios de ella, conforme al Reglamento, y comunicaremos a los titulares afectados cuando el incidente represente un riesgo para sus derechos, indicando la naturaleza del incidente, los datos comprometidos, las medidas adoptadas y las recomendaciones aplicables.

## 9. Tus derechos

**9.1.** Puedes ejercer en todo momento los derechos de **información, acceso, actualización, inclusión, rectificación, supresión o cancelación, oposición y tratamiento objetivo** de tus datos personales, así como **revocar el consentimiento** prestado.

**9.2.** Para ejercerlos, escribe a **vt.asvent@gmail.com** indicando el derecho que ejerces, tu identificador de instalación y un medio de contacto. Podremos solicitarte acreditación de identidad, exclusivamente para evitar que un tercero acceda a tus datos.

**9.3.** Atenderemos tu solicitud dentro de los plazos legales y de forma gratuita.

**9.4.** Si consideras que tu solicitud no fue atendida debidamente, puedes presentar una reclamación ante la **Autoridad Nacional de Protección de Datos Personales**, adscrita al Ministerio de Justicia y Derechos Humanos.

## 10. Portabilidad y exportación

Con independencia del ejercicio de los derechos anteriores, la Aplicación te permite exportar en cualquier momento tus informes en PDF y Word; tus archivos de música y tus grabaciones están siempre en tu equipo. Puedes además solicitar a vt.asvent@gmail.com una copia de tu Estado Académico en formato estructurado y legible por máquina.

## 11. Eliminación de la cuenta

**11.1.** Puedes eliminar tu Cuenta en cualquier momento desde la rueda de **Ajustes de cuenta** de la pantalla de perfil.

**11.2.** La eliminación es **definitiva y no reversible**. Los datos se suprimen de los sistemas activos de forma inmediata y de las copias de seguridad y registros técnicos en un plazo máximo de **treinta (30) días**, transcurrido el cual la supresión es irreversible en su totalidad. **No conservamos copias con las que restaurar tu información.**

**11.3.** Se exceptúan de la supresión los datos cuya conservación resulte legalmente exigible, que se mantendrán bloqueados y accesibles únicamente para atender el requerimiento correspondiente, durante el plazo legal y no más.

**11.4.** **Antes de eliminar tu Cuenta, exporta lo que quieras conservar.**

**11.5.** La eliminación de la Cuenta **no afecta a los datos almacenados localmente** en tu equipo, que permanecen bajo tu control hasta que los borres o desinstales la Aplicación seleccionando el borrado de datos.

## 12. Cambios en esta Política

Toda modificación se publicará con nueva versión y fecha y se anunciará dentro de la Aplicación. Si el cambio amplía las finalidades del tratamiento o incorpora nuevos destinatarios, **solicitaremos nuevamente tu consentimiento** antes de aplicarlo.

## 13. Contacto

vt.asvent@gmail.com · VT Asvent · Perú

---

# Anexos

## Anexo A — Catálogo de datos y finalidades

Este anexo detalla, categoría por categoría, qué se trata y para qué. Cumple el deber de información del Reglamento y sirve de referencia rápida.

| Dato | Para qué | Dónde |
|---|---|---|
| Identificador de instalación | Vincular los datos locales y los reportes de soporte | Sale del dispositivo solo con el diagnóstico y los reportes que tú envías |
| Correo electrónico | Identificar la Cuenta, recuperar credenciales, avisos contractuales | Solo existe si te registras |
| Nombre de usuario e imagen de perfil | Personalizar la interfaz | Replicados con la Cuenta |
| Credenciales | Autenticación | Cifradas; nunca legibles por el Proveedor |
| Estado Académico | Copia de seguridad y sincronización | Replicado solo con Cuenta activa |
| Música, grabaciones, adjuntos e imágenes que subes a playlists, asignaturas y colecciones | Reproducción, grabación y consulta | **No pasan por el Proveedor**; con Wire, y salvo las grabaciones, por tu propio Google Drive hasta que todos tus dispositivos los tienen |
| Imágenes de la Cuenta (perfil y horario) | Que aparezcan en tus otros dispositivos | Carpeta privada de tu Cuenta; se borran al eliminar la Cuenta |
| Referencias a imágenes de la galería de Frame (cuál es y su encuadre) | Que la misma imagen aparezca en tus otros dispositivos | Replicadas con el Estado Académico |
| Registros de error, versión e indicadores de uso (incluida su serie diaria) | Diagnóstico, mejora y estadísticas agregadas de impacto | Seudonimizados; puedes oponerte por correo |
| Perfil de uso: ciudad, región y país aproximados, zona horaria, idiomas, tipo de equipo, horas de estudio, rachas y cuántos elementos tienes de cada función | Entender dónde, cuándo y cómo se usa Frame (panel interno del responsable) | Seudonimizado; nunca coordenadas ni contenido; puedes oponerte por correo |
| Registros de acceso | Seguridad de la Cuenta | Conservación de 6 meses |
| Comunicaciones de soporte | Atención del caso | Conservación de 24 meses |
| Sesiones de los chats de IA en la web (identificador de la Cuenta, nombre del chat, huellas y fechas) | Conectar con tu Frame el chat que elegiste | Cloudflare, solo si conectas un chat; las llamadas no se guardan |
| Fichas de tus dispositivos (tipo, sistema, versión de Frame, sesión abierta o cerrada, fechas y resumen de lo pendiente) | Enseñarte dónde está abierta tu sesión y si todo está sincronizado | Replicadas con la Cuenta; sin nombre del dispositivo, red ni ubicación |
| Letras que pides traducir | Traducirlas al idioma de tu Frame | Cloudflare Workers AI, sin guardarse; la traducción queda en tu equipo |
| Recuentos diarios de lecturas de horarios, traducciones de letras y descargas de la Biblioteca | Aplicar el tope diario de cada Cuenta | Cloudflare; se borran al día siguiente |

## Anexo B — Encargados de tratamiento y subencargados

Relación vigente a ${effectiveDate}:

- **Supabase** — autenticación, base de datos y almacenamiento de la copia de seguridad — servidores en Estados Unidos de América (región de Amazon Web Services us-west-2, Oregón) — contrato de encargo: por definir; rige entretanto el acuerdo de tratamiento de datos incorporado a las condiciones de servicio de Supabase.
- **GitHub, Inc.** — alojamiento de los instaladores y del canal de actualizaciones — Estados Unidos.
- **Cloudflare, Inc.** — relé de los chats de IA en la web, solo si los conectas (apartado 3.7); lectura de horarios y traducción de letras con Workers AI, solo si las pides (apartados 3.8 y 3.10); y servicio de la Biblioteca, solo con su extensión (apartado 3.11) — red mundial de centros de datos; base de datos en Norteamérica — rige el acuerdo de tratamiento de datos incorporado a las condiciones de servicio de Cloudflare.
- **Google LLC** — almacenamiento del material de la Biblioteca (Google Drive) y envío del código que la activa (correo de la cuenta del Proveedor), solo con su extensión (apartado 3.11) — Estados Unidos y otros países donde Google opera — rigen las condiciones de servicio de Google.

Toda incorporación o sustitución de encargado se comunicará conforme al apartado 12 de la Política de Privacidad.

## Anexo C — Política de Uso Aceptable

Al usar Frame te obligas a **no**:

**En relación con la Aplicación.** Eludir sus mecanismos de autenticación, licencia o actualización; someter los Servicios de Cuenta a carga automatizada o desproporcionada; acceder a ellos por medios distintos de la Aplicación; suplantar la identidad de otro usuario; ni intentar acceder a cuentas, datos o infraestructura ajenos.

**En relación con el contenido.** Incorporar contenido ilícito, contenido cuya posesión esté prohibida, ni material sobre el que no ostentes derechos suficientes; ni utilizar la Aplicación para almacenar u organizar la comisión de actos contrarios a la ley.

**En relación con terceros.** Utilizar la Aplicación para vulnerar derechos de terceros, incluidos los de propiedad intelectual, honor, intimidad y protección de datos; ni registrar datos personales de terceros sin base legítima para hacerlo.

**En relación con la seguridad.** Introducir programas maliciosos; explotar vulnerabilidades para fines distintos de la divulgación responsable descrita en la pantalla de soporte; ni interferir con el funcionamiento del servicio para otros usuarios.

El incumplimiento habilita las medidas de la cláusula 21 de los Términos, aplicadas con proporcionalidad y previo requerimiento cuando la conducta admita subsanación.

## Anexo D — Condiciones comerciales

> Este anexo permanece **inaplicable** mientras Frame se distribuya sin contraprestación. Se activa en el momento en que exista cualquier modalidad de pago. Escribir hoy condiciones comerciales que no aplican sería peor que no tenerlas: cualquier discordancia entre lo que dice el texto y lo que hace el producto es materia sancionable.

Cuando se active, este anexo regulará: modalidades y precios con tributos incluidos; formación del contrato y comprobante de pago; renovación automática con preaviso de siete (7) días; cancelación desde la propia Aplicación, por un procedimiento no más gravoso que el de contratación; devolución íntegra sin expresión de causa durante catorce (14) días calendario; modificación de precios con treinta (30) días de antelación; consecuencias del impago con plazo de subsanación de diez (10) días; y **Libro de Reclamaciones virtual** accesible de forma permanente conforme a los artículos 150 y 151 de la Ley N.º 29571, al Decreto Supremo N.º 011-2011-PCM modificado por Decreto Supremo N.º 101-2022-PCM y a la Ley N.º 32495, con respuesta escrita en quince (15) días hábiles improrrogables.

## Anexo E — Avisos de software de terceros

Frame incorpora componentes de software libre y abierto, entre ellos el marco de aplicación de escritorio **Tauri** (MIT/Apache-2.0), la biblioteca de interfaz **React** (MIT), el compilador **Vite** (MIT), el sistema de estilos **Tailwind CSS** (MIT), los componentes accesibles **Radix UI** (MIT), la biblioteca de fechas **date-fns** (MIT), los iconos **Lucide** (ISC), el cliente **supabase-js** (MIT) y el selector de archivos **rfd** (MIT).

> La relación anterior es orientativa. Antes de cualquier distribución comercial debe generarse el inventario completo de licencias sobre el árbol de dependencias y verificarse la compatibilidad de cada una con esa distribución.

## Anexo F — Almacenamiento local y componentes web incrustados

**F.1.** Frame no utiliza cookies publicitarias ni de seguimiento propias.

**F.2.** La Aplicación emplea almacenamiento local en el dispositivo para conservar tu sesión, tus preferencias de interfaz y el estado de la aplicación. Es imprescindible para su funcionamiento.

**F.3.** Las interfaces de Gmail, YouTube, Classroom y Drive se muestran mediante componentes web incrustados que cargan directamente los servicios de Google. **Google puede instalar sus propias cookies y tecnologías de seguimiento en el contexto de esos componentes**, conforme a su política de privacidad, sobre la que el Proveedor no tiene control ni visibilidad.

**F.4.** Cerrar sesión en Google desde esas interfaces elimina la sesión persistente correspondiente.`;
}
