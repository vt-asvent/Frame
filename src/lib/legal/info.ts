// ============================================================
// Bloque I — Pantalla «Información y novedades».
//
// El texto se guarda como Markdown y lo pinta <LegalDocument />. Los campos
// entre corchetes son los que solo el titular puede rellenar: se muestran
// resaltados en ámbar dentro de la app, a propósito, para que ninguno se
// publique por olvido.
//
// Versionado propio: al cambiar este texto se sube INFO_VERSION, no la de los
// otros documentos.
// ============================================================

import { INFO_VERSION, TERMS_VERSION } from './versions.ts';

export { INFO_VERSION };

export function infoDocument({
  appVersion,
  installId,
  releaseDate,
}: {
  appVersion: string;
  installId: string;
  releaseDate: string;
}): string {
  return `# Frame

**Versión ${appVersion}** · Canal estable · Compilación ${appVersion} (NSIS x64) · ${releaseDate}
Sistema de productividad académica para Windows y Android
Desarrollado por **Asvent**, entidad de desarrollo de software en formación · Perú

Disponible en español, inglés, alemán, francés, italiano, portugués, ruso y japonés (Ajustes → «Idioma»).

Frame reúne en una sola aplicación lo que normalmente exige cinco: gestión de asignaturas y tareas, cronometraje del estudio con calificación diaria, seguimiento de hábitos, calendario, reproductor de tu propia música, grabación de voz y los servicios de Google. Su núcleo académico funciona sin conexión, toda tu información se guarda primero en tu propio equipo y, con una cuenta, se sincroniza en segundos con Frame para Android.

---

## 1 · Requisitos del sistema

**Sistema operativo.** Windows 10 versión 1809 (compilación 17763) o superior, o Windows 11, en equipos x64. Para tablets y teléfonos existe **Frame para Android** (Android 8.0 o superior), que se descarga desde la misma página y comparte cuenta y datos. No hay versión para macOS, Linux ni iOS.

**Componente requerido.** Frame utiliza el runtime **Microsoft Edge WebView2**, distribuido por Microsoft e incluido de fábrica en Windows 11 y en las instalaciones actualizadas de Windows 10. Si no está presente, el instalador lo detecta y solicita su instalación. Sin este componente la aplicación no arranca.

**Recursos.** 4 GB de memoria y 300 MB de espacio libre, más el espacio que ocupen tu biblioteca de música y tus grabaciones, que crece sin límite fijado por la aplicación.

**Conexión a internet.** No es necesaria para el núcleo académico —asignaturas, tareas, sesiones de estudio, hábitos, calendario local, tu música y tus grabaciones—. Sí lo es para crear tu cuenta e iniciar sesión —una vez dentro, lo anterior sigue funcionando sin ella—, para la sincronización en la nube, las interfaces de YouTube, Gmail y Classroom, los vídeos de estudio, la tarjeta de clima y la comprobación de actualizaciones.

**Permisos del sistema.** Frame solicita acceso al micrófono para la grabación de voz, al sistema de archivos para adjuntos, portadas, informes y la biblioteca musical, y permiso para mostrar notificaciones nativas y una ventana siempre visible sobre las demás aplicaciones (la vista flotante del reloj). Estos permisos se emplean únicamente para las funciones descritas.

---

## 2 · Tu identificador de cuenta

**${installId}**

Es un identificador **seudónimo** de doce cifras, el mismo que los Términos llaman «identificador de instalación». Se obtiene del código interno, aleatorio, que el servicio de cuentas asignó a tu cuenta al crearla; en los perfiles locales anteriores a la versión 1.4.9 se generó al azar al crear el perfil. No se deriva de tu nombre, tu correo, tu hardware ni de ningún dato de tu equipo, y por sí solo no permite identificarte.

Cumple una sola función: que un reporte de soporte o una solicitud sobre tus datos se asocie a la cuenta correcta sin que tengas que dar tu correo. Lo ves también en Ajustes, junto a tu perfil, y se copia con un clic. Inclúyelo siempre que escribas a soporte. No lo publiques en foros ni redes: aunque no te identifica, sí identifica de forma única a tu cuenta.

Como pertenece a tu cuenta, es el mismo en todos los equipos donde inicies sesión y no cambia aunque desinstales y vuelvas a instalar Frame.

---

## 3 · Dónde vive cada dato

Frame distingue tres lugares de almacenamiento. Conocer la diferencia es lo que evita una pérdida irreversible.

**En tu equipo, siempre.** Todo lo que registras se escribe primero en tu disco: asignaturas, colecciones, tareas, adjuntos, sesiones de estudio, calificaciones, hábitos, eventos del calendario local, recursos, imágenes, grabaciones de voz y biblioteca de música. Las grabaciones se conservan además como archivos de audio (M4A) en \`Documentos\\Frame\\Grabaciones\`, accesibles fuera de la aplicación.

**En tu cuenta, si iniciaste sesión.** Tu **estado académico** —asignaturas, tareas, sesiones, calificaciones, hábitos, eventos, horarios con sus clases, playlists con su orden, vídeos de estudio y configuración— se replica en la nube y se fusiona entre equipos: cada cambio llega a tus otros dispositivos en menos de un segundo, cifrado. Esta réplica es la que te permite cambiar de máquina, o usar el celular, sin perder nada. Siguen también a tu cuenta el **idioma**, la **proporción de las imágenes** de las tarjetas y la ciudad del clima que eliges a mano; el tema es de cada dispositivo. Tu **foto de perfil** y las **fotos de tus horarios** viajan en una carpeta privada de tu cuenta; las imágenes de la **galería de Frame** que pones a tus playlists, asignaturas y colecciones viajan como una referencia (cuál es y cómo la encuadraste) y cada dispositivo la rehace. Ajustes → **«Dispositivos»** enseña en qué equipos está abierta tu cuenta, si todos tienen lo mismo y, si no, lo corrige.

**En ningún sitio salvo tu equipo, siempre.** La **música** (con sus portadas y letras), las **grabaciones de voz**, los **adjuntos** y las **imágenes que subes tú** a playlists, asignaturas y colecciones quedan excluidos de la nube por su tamaño. Tus **estadísticas de escucha** tampoco salen de tu equipo. Para tener tu música en otro dispositivo, copia allí tus archivos e impórtalos, o activa **Wire**: lleva tus canciones, adjuntos, archivos de recursos e imágenes propias a tus otros dispositivos pasando por tu Google Drive, de donde los borra en cuanto todos los tienen (es un relevo, no una copia de seguridad). La campana te dice qué no está igual en tus dispositivos, dónde y por qué (verificador de sincronización).

**Un perfil de invitado no tiene nada en la nube.** «Entrar como invitado» crea un perfil local para probar Frame al instante: toda su información vive únicamente en este equipo. Para ponerla a salvo, vincula tu cuenta con Google o con tu correo (la «G» junto a tu perfil, abajo en el menú, o Ajustes → rueda → «Vincular mi cuenta»): todo pasa a tu cuenta, se suma a lo que ya tuviera sin borrar nada y queda respaldado.

---

## 4 · Qué incluye esta versión

### 4.1 Núcleo académico

Asignaturas con imagen de portada, agrupables en colecciones, con profesor y estadísticas propias; recursos (anotaciones, enlaces, archivos y grabaciones) ordenados en su propia pestaña, y un registro permanente de lo culminado.

El botón **«+»** de la barra superior crea una tarea o una anotación sin ir hasta la asignatura; una anotación sin asignatura queda como tarjeta al final de Inicio. Tareas con descripción, asignatura, fecha de entrega, importancia, tipo, dificultad, tiempo estimado y porcentaje de avance, que puedes ajustar a mano o que sube solo con tus sesiones de estudio en proporción al tiempo estimado. Recordatorios tarea por tarea, con días, hora y repetición. Adjuntos enlazados al archivo original de tu disco —se eligen con un clic o se arrastran, uno o varios, al recuadro «Adjuntar archivo»—: si sigues editándolo, Frame ve siempre la versión actual.

Archivo de tareas culminadas e incompletas, con tiempo dedicado y puntualidad; aviso diario de tareas vencidas para reprogramarlas, culminarlas o descartarlas. Junto a «Filtros», cuántas tareas ves y cuánto suma su tiempo estimado.

**Importar de Notion** (Ajustes → rueda de la cuenta) trae tus tareas y fechas desde la exportación de una base de datos de Notion (el .zip o el .csv), sin conectarse a tu cuenta.

### 4.2 Estudio y medición del estudio

Temporizador o cronómetro, con **vista flotante** siempre visible en dos tamaños. En **modo rendimiento** valoras tu concentración de 1 a 20 y Frame calcula la nota del día (AD, A, B, C); en **modo tiempo** solo cuentan los minutos frente a tu meta.

Al terminar, el formulario recoge el tiempo exacto, tu enfoque, las asignaturas y tareas trabajadas y **lo que hiciste, con un editor de texto con negrita, cursiva y listas**; las asignaturas y sus tareas se eligen con tarjetas. Durante la sesión puedes anotar avances con su minuto. Si Frame se cierra con una sesión en marcha, al volver el mismo día puedes retomarla.

Cada sesión es una tarjeta con su asignatura, su tiempo y su rendimiento, y se abre con todo su detalle. Calendario de calificaciones con el detalle de cada jornada (tiempo frente a la meta, sesiones, enfoque medio, nota y cuándo estudiaste: mañana, tarde o noche), progreso académico semanal o mensual y vídeos de estudio de YouTube, que se ven con su reproductor.

### 4.3 Análisis e informes

La barra superior muestra frases con tus datos recientes que cambian solas. Inicio resume tu día: tu **horario** —la línea del día con la clase de ahora siempre al medio, cada clase con la imagen de su asignatura, su docente, sus tareas y su hora; la semana como un calendario y la foto original, un horario por mes—, el clima, «Tareas pendientes» (las dos que vencen antes), un pomodoro con su temporizador y su cronómetro y lo que estudiaste hoy y ayer, tu playlist más escuchada y tu racha; en modo Avanzado, además, «Tu semana en datos»: ritmo con el promedio semanal, constancia y tareas culminadas. Hábitos con fases del día, anillos, semana tipo y mapa de constancia. **Informes** de rendimiento y de pendientes en PDF y Word —semanales, mensuales o anuales—, en Ajustes, con un resumen y la vista previa real del documento.

### 4.4 Calendario, Google y música

Calendario local sin conexión, con casillas que se adaptan al alto de la ventana: eventos de uno o varios días, con hora y el mismo recordatorio que las tareas (días, hora y repetición), colores en las casillas y selección de varios días a la vez arrastrando; **YouTube, Gmail y Classroom** integrados en la barra lateral, y **Drive** bajo Classroom cuando Wire está activa. Biblioteca con **tu propia música**: «Importar» trae canciones sueltas o carpetas enteras de tu equipo —MP3, M4A, AAC, OGG, Opus, FLAC, WAV y WebM— con su portada (la que trae el archivo, una imagen con su mismo nombre o la de su carpeta) y su letra (la de sus etiquetas, o un .lrc o .txt con su mismo nombre); separa el título del artista aunque el archivo no traiga etiquetas y avisa de lo que no puede reproducir. Se reproduce con letras sincronizadas —que también puedes añadir después, desde un archivo tuyo, en «Reproduciendo», y ver **traducidas** al idioma de Frame, línea por línea—, playlists con su duración total y favoritas, y **«Tu música en datos»**: cuánto escuchas cada canción, playlist y artista por semana, mes o año, contando solo lo que de verdad suena; al pulsar el nombre de la playlist en el reproductor se ubica la canción que suena. Grabación de voz desde cualquier pantalla (\`Ctrl+Shift+F\`), con el límite que elijas, hasta 4 horas. Las actualizaciones muestran su peso, el tiempo estimado y el avance real antes y durante la instalación. Con la extensión **Biblioteca**, que se activa con un código enviado a tu correo institucional, el menú gana **«Biblioteca»**: el material recopilado, con sus guías destacadas, buscador, filtros, favoritos y descarga de uno o de varios archivos a la vez.

---

## 5 · Límites conocidos y comportamiento esperado

Se documentan aquí para que ninguno te sorprenda. No son fallos.

Frame avisa de cada versión nueva (botón «Actualizar ahora» y campana) y **no se instala sin tu confirmación**.

Cerrar la ventana cierra Frame. Si hay una sesión de estudio en marcha, antes te ofrece pausarla, registrarla o seguir estudiando. Los recordatorios suenan mientras Frame está abierta.

Los adjuntos de tipo documento dejan de resolver si el archivo original se mueve, se renombra o se elimina: vuelve a adjuntarlo.

Las calificaciones diarias se calculan exclusivamente sobre los datos que tú registras. No provienen de ninguna institución y no tienen validez académica.

La música, las grabaciones, los adjuntos y las imágenes que subes tú no se respaldan en la nube: se quedan en el dispositivo donde los añadiste.

Por sí mismo, Frame no busca ni descarga música, vídeos, portadas ni letras: muestra la letra y la portada que traen tus archivos o las que tú añades; lo que versiones anteriores ya guardaron en tu equipo se conserva. Si activas una extensión de descargas, Frame instala en tu equipo el programa de terceros que la acompaña —solo si viene firmado por su autor— y lo mantiene al día (en la versión de Microsoft Store lo instalas tú); «+ Añadir» de Música le pide cada canción que añades, y es ese programa el que la descarga (en MP3 de 320 kbps) y consulta servicios públicos de letras y portadas para completarla; Frame solo importa el archivo que entrega. Con ella, «Añadir música» lee también una lista por su **enlace** —de Spotify, Deezer, YouTube o Apple Music— o por su CSV: de Spotify y Apple Music, que por enlace solo enseñan las primeras 100 canciones, las listas más largas se traen con su CSV. Los formatos que el motor de audio de Windows no reproduce (WMA, AIFF, ALAC, APE y otros) no se importan, y Frame dice cuáles quedaron fuera.

Las interfaces de Google requieren conexión y sesión iniciada en Google, y su funcionamiento depende íntegramente de Google.

Leer las clases de un horario requiere conexión y una cuenta de Frame, y cada cuenta puede leer hasta 6 fotos al día. La IA puede equivocarse: revisa lo leído en «Semanal».

Traducir una letra requiere conexión y una cuenta de Frame; cada cuenta puede traducir hasta 30 letras al día, y cada una se pide una sola vez (queda guardada en tu equipo). Una letra que ya está en el idioma de Frame no se envía.

La Biblioteca es para cuentas del colegio y necesita conexión; cada cuenta puede descargar hasta 300 archivos o 3 GB al día.

---

## 6 · Componentes y servicios de terceros

Frame está construida sobre software de terceros distribuido bajo licencias abiertas, cuya relación completa figura en la sección **Avisos de terceros** de los Términos y Condiciones.

Los servicios de Google —Gmail, YouTube, Classroom y Drive— son operados por Google LLC; su disponibilidad, contenido y condiciones dependen de Google. La copia en la nube y la autenticación se ejecutan sobre la infraestructura de **Supabase**.

El pronóstico del clima procede de **Open-Meteo**.

Los chats de IA en la web (claude.ai, ChatGPT y otros) llegan a Frame a través de un relé alojado en **Cloudflare**, que pasa cada llamada sin guardarla (Política de Privacidad, 3.7). La lectura de horarios usa los modelos abiertos **Qwen 3.8** y **Gemma 4** (licencia Apache 2.0) en **Cloudflare Workers AI**, que no guarda las fotos (Política de Privacidad, 3.8); la traducción de letras usa Gemma 4, y tampoco se guardan (3.10). El material de la Biblioteca llega a través de ese mismo servicio de Frame en Cloudflare (3.11). Claude es una marca de Anthropic, PBC; ChatGPT, de OpenAI; Gemini y Gemma, de Google LLC; y Qwen, de Alibaba Group. Frame no está afiliada a esas empresas ni cuenta con su respaldo.

Notion es una marca de Notion Labs, Inc.; la extensión solo lee los archivos que exportas tú y no se conecta a su servicio.

Spotify, Deezer, YouTube y Apple Music son marcas de sus titulares. Al leer una lista por su enlace, Frame consulta desde tu equipo la página pública de esa lista, sin tu cuenta de ese servicio; no está afiliada a esas empresas ni cuenta con su respaldo.

Frame **reproduce archivos de audio presentes en tu equipo**. La aplicación no provee catálogo musical ni licencia alguna sobre obras protegidas: eres responsable de contar con los derechos necesarios sobre los archivos que incorpores a tu biblioteca.

---

## 7 · Canal de versiones y ciclo de actualización

Frame se distribuye en un único canal, **estable**. La numeración sigue el esquema \`MAYOR.MENOR.PARCHE\`. Cuando una actualización modifique el formato de los datos, Frame realizará la migración de forma automática al primer arranque.

Se ofrece soporte para la versión estable vigente y para la inmediatamente anterior. Las versiones más antiguas pueden dejar de sincronizar con el servicio de copia de seguridad sin aviso individual.

---

## 8 · Historial de versiones

**${appVersion} — ${releaseDate}**

*1.9.7:* **Biblioteca nueva**: el material llega ordenado por asignaturas, con «Guía y programa» arriba y luego Temas, Exámenes (por convocatoria) y Trabajos; cada archivo tiene su portada y su descripción, y al tocarlo se abre con su vista previa, que se agranda con un clic · **tarjetas de estudio** para repasar dentro de Frame o descargar (CSV, para Anki o Quizlet) · eliges cuándo das los exámenes del IB y la Biblioteca te avisa de lo que es de un programa anterior · «Para tu examen de…»: lo que sirve para los exámenes que tienes en Tareas · el material nuevo aparece solo, sin actualizar Frame · Términos y Política de privacidad 6.0: también viajan entre tus dispositivos la convocatoria que eliges y tu avance con las tarjetas.

*1.9.6:* **Wire, a prueba de todo** (y desde Frame móvil 1.3.5, también en el celular y la tablet): lo que baja de tu Drive se comprueba antes de entrar, y lo que sube, que llegó entero · una canción que se quedó sin audio se repara sola desde tus otros equipos, y perder el almacén de música ya no se toma por «lo borraste todo»: solo lo que tú borras en un equipo deja de volver a él · con muchas canciones en cola ya no llegan repetidas (un fallo de la 1.9.5) · si borras la carpeta «Frame · Wire» de tu Drive se crea otra, y si dos equipos crean una a la vez acaban en la misma · la hora que cuenta es la de Drive: un reloj mal puesto no deja a ningún equipo fuera · sin conexión no insiste; si Google pide ir más despacio, espera; y si retiró el permiso, te lo dice con un botón para **volver a conectar** · **tu Drive no se llena**: lo que espera ahí tiene tope y siempre queda espacio libre · avisa si otro equipo usa una cuenta de Drive distinta o una Frame anterior.

*1.9.5:* **tu cuenta no se desconecta sola**: Frame ya no toma por «sesión cerrada» un tropiezo de la red, una espera del servidor o la página del wifi del colegio, ni se confunde si la hora del equipo está mal o si se queda sin sitio para guardar; cuando la nube rechaza una llave que solo acababa de caducar, la renueva y repite la petición sin que lo notes (la Biblioteca, el lector de horarios, la traducción de letras y los chats con IA) · si de verdad se cierra (por ejemplo, al cambiar la contraseña), lo sabes al momento y la **vuelves a conectar sin salir de donde estás**, desde la campana o desde Ajustes → Dispositivos: tus datos y lo que tenías abierto siguen ahí.

*1.9.4:* **Horario**: cada tarjeta lleva la imagen de su asignatura con la proporción que elegiste en Asignaturas y, debajo, solo su nombre; al leer la foto, Frame reconoce a qué asignatura corresponde cada clase aunque esté escrita distinto («Mat. AyE» es «Matemática») y, si duda, te lo pregunta una vez; tocando una tarjeta lo cambias · **Biblioteca**: la extensión se llama así, aparece al buscarla y se activa con un código que llega a tu correo institucional, entres a Frame con el correo que entres; arriba, «Destacados»: las guías de cada asignatura en un carrusel, con su vista previa · **«Añadir música»**, más simple: pegas el enlace de una canción o de una playlist, ves qué es y cuánto pesa, y «Descargar»; a la derecha, lo que se está bajando · Términos y Política de Privacidad 5.8: apartados 3.8 (horario) y 3.11 (Biblioteca) y cláusula 15.3 (programas de seguridad).

*1.9.3:* las ventanas emergentes ya no pueden medir más que la pantalla: en pantallas bajas, la de instalar una extensión dejaba sus botones fuera.

*1.9.2:* **Dispositivos** en Ajustes: en qué equipos está abierta tu cuenta —laptop, celular o tablet—, si todos tienen lo mismo y un botón para corregirlo · **Wire** lleva también las imágenes que subes a asignaturas, colecciones y playlists, borra de Drive lo que ya está en todos tus equipos y avisa a los demás al momento · **Biblioteca** (extensión AK Lore, para cuentas del colegio): el material en tarjetas, con buscador, filtros, favoritos y descarga de uno o de varios archivos · **«Añadir música»** lee una lista por su enlace —Spotify, Deezer, YouTube y Apple Music— o por su CSV (Exportify, TuneMyMusic, Soundiiz, Takeout, iTunes), la guarda como CSV y la descarga entera: sin repetidas, con reintentos, «Cancelar todo» y una pausa automática si la conexión falla o el equipo se queda sin espacio · **traducción de letras** al idioma de Frame, línea por línea · **Inicio**: el horario con la imagen, el docente, las tareas y la hora de cada clase; un pomodoro más alto, con temporizador y cronómetro; «Constancia» y «Tareas culminadas», lado a lado · **sesión más firme**: entrar y salir ya no se quedan esperando si la red falla, y la sincronización se recupera sola en segundos al volver · Términos y Política de Privacidad 5.7: apartados 3.9 (dispositivos), 3.10 (traducción de letras), 3.11 (Biblioteca) y 6.3 bis (Wire).

*1.9.1:* el **horario se lee mejor**: Frame usa Qwen 3.8, que acierta casi todas las clases también en fotos torcidas o borrosas, y Gemma 4 cuando Qwen no responde o se acerca el límite diario gratuito · Términos y Política de Privacidad 5.6: el apartado 3.8 nombra los dos modelos.

*1.9.0:* **Horario en Inicio**: sube la foto del horario de cada mes («Noviembre», «Noviembre 2»…) y Frame lee sus clases con IA; la línea del día pone siempre al medio la clase de ahora, con las de antes y después a los lados, y avanza con el reloj · **«Semanal»**: la semana como un calendario, donde corriges o añades clases con un clic · **«Ver original»**: la foto tal cual · **Inicio reordenado**: horario, clima, «Tareas pendientes» con el pomodoro, la playlist y la racha a su derecha, y «Tu semana en datos» con el ritmo en la mitad izquierda; se retira la matriz de competencias · **Música → «+ Añadir»** es una página propia, con YouTube a la izquierda en tres quintos del ancho · las **extensiones de descargas** instalan, abren y ponen al día su programa solas, y lo reparan si falla · **más ligera**: gráficos propios en lugar de una biblioteca de casi 400 KB, imágenes de la galería un 26 % más livianas y un arranque que carga menos código, con todas sus funciones · **Términos y Política de Privacidad 5.5**: el apartado 3.8 explica la lectura de horarios y el 6.4 bis, el programa de las extensiones de descargas.

*1.8.1:* **Música → «+ Añadir»** con una extensión de descargas: YouTube incrustado a la derecha y, a la izquierda, la cola de descargas con «Añadir» (el vídeo que tienes abierto) e «Iniciar descarga»; cada canción en MP3 de 320 kbps con su portada y su letra oficiales, y el peso de cada una · **CSV de canciones** (por ejemplo, una playlist de Spotify): un resumen antes de empezar y su playlist en el mismo orden · **indicador de descargas** junto a «Aleatorio»: descargadas, faltantes y con errores, la velocidad y qué tal es, el tamaño total, el tiempo que falta y una pausa · la descarga sigue al cerrar la ventana o cambiar de interfaz, y continúa al volver a abrir Frame · **Términos y Política de Privacidad 5.4**: el apartado 6.4 bis explica las extensiones de descargas.

*1.8.0:* **Tu música en datos**: cuánto escuchas cada canción, playlist y artista por semana, mes o año —solo lo que suena de verdad, y sin salir de tu equipo—, con las reproducciones y el tiempo de cada playlist y de la canción en «Reproduciendo» · **Inicio renovado**: un pomodoro con lo estudiado hoy y ayer, tu playlist más escuchada, la racha y «Tareas pendientes»; en modo Avanzado, ritmo, constancia y tareas culminadas · en Ajustes, el modo Avanzado se explica en una línea · **Extensiones** a un tercio del ancho, con un buscador que cuenta las que tienes en uso y una página propia para cada una · **Animaciones**: Aurora boreal, Matrix ascendente, Tipoaurora y Mosaico de figuras; figuras en la barra lateral y la cabecera, encuadre de la imagen de fondo y letra de los títulos · **chats de IA en la web**: claude.ai, ChatGPT y otros chats con conectores manejan Frame a través de su nube (Política de Privacidad 5.3) · **Drive** en el menú, bajo Classroom, con la cuenta de Wire.

*1.7.6:* **Extensiones en tarjetas** con vista previa (los vídeos se reproducen al pasar el cursor) · extensiones de terceros que se activan para todos y aparecen al **buscarlas por su nombre** · con una extensión de descargas compatible, «Importar» abre una ventana propia: vídeo de YouTube, **descarga en MP3 de 320 kbps** con portada y letra, o un **CSV** de canciones · en Ajustes, **color propio** con selector profesional (HEX, RGB, HSL, cuentagotas) y una **comparativa** de lo que cambia el modo Avanzado · Wire y las Conexiones con IA con su logo · logos más pequeños en la barra lateral y en la barra de título.

*1.7.5:* al actualizarse, Frame **no deja rastros** de las versiones anteriores en el equipo · el logo de la barra lateral se ve entero.

*1.7.4:* **logo definitivo** de Frame en la app, la barra de tareas, el instalador y la web · **Extensiones** salen de Ajustes a su propia sección, con buscador: cada una es una fila con su interruptor y su panel aparte (Wire, con su relevo en vivo dentro).

*1.7.3:* **seis idiomas más**: alemán, francés, italiano, portugués, ruso y japonés, además de español e inglés; los documentos legales siguen siendo auténticos en español · **extensiones**: un centro en Ajustes para instalar, desactivar o quitar funciones sin dejar rastro; las de otros autores son solo datos (nunca código) y piden sus permisos al instalarse · **Wire** lleva tus canciones y adjuntos a tus otros equipos usando tu Google Drive como relevo, y los saca de Drive cuando todos los tienen · **Animaciones**: vuelve la constelación, junto a Olas y Aurora, con imagen de fondo propia y mods de apariencia · **Conexiones con IA**: Claude, Gemini y otras IA de escritorio pueden manejar Frame en este equipo, y para borrar Frame te pide confirmación · **AK Lore**: busca, mira y descarga las guías del material recopilado del colegio, con la cuenta del colegio · **Notion** pasa a ser una extensión, crea las asignaturas que faltan y no duplica nada al reimportar · Música → Importar → **Descargar**, con una extensión de descargas · **modo Avanzado**: Frame muestra lo esencial y el interruptor de Ajustes añade el modo Rendimiento, las calificaciones, las metas diarias y los informes; ocultarlo no borra nada · **identidad nueva**: logo de Frame, acento azul marino (ocho colores en Ajustes → Tema) y la firma pasa a llamarse Asvent · la ventana se abre como la cerraste · en Inicio, cada tarea sin asignatura ocupa media fila · **playlists**: reordenarlas en un equipo ya no se deshace en otro ni pierde copias.

*1.7.2:***entrar a Frame es casi instantáneo**: Inicio se pinta con lo que ya tienes en el equipo y la nube se sincroniza por detrás, en lugar de esperar hasta 12 segundos antes de mostrar nada · **actualizaciones obligatorias**: cada versión publicada fija la mínima que sigue funcionando; una Frame anterior muestra el aviso al abrir (también al volver a ella y al recuperar la conexión) y no deja cerrarlo hasta instalar, aunque espera si estás estudiando, grabando o escuchando música · el aviso de versión nueva ya no depende de que la app lleve un rato abierta: se comprueba a los 2 segundos y la versión conocida se recuerda entre arranques · **el corazón de las canciones viaja siempre**: el aviso de cambio sale por un camino que no depende de que la conexión en vivo esté abierta, la comprobación de fondo pasa de cinco minutos a uno, y se corrigió una carrera por la que un cambio llegado de otro dispositivo en mitad de una subida resucitaba un corazón recién quitado · **las 89 imágenes de la galería, redibujadas a 960 píxeles**: la 1.7.1 las había comprimido demasiado; ahora tienen buena definición y pesan unos 70 KB cada una.

*1.7.1:* los **Términos y la Política de Privacidad 5.2** ya no mencionan Drive ni los horarios importados, que Frame dejó de tener.

*1.7.0:* **importar música con subcarpetas**: cada canción encuentra su letra (.lrc o .txt) y su portada aunque estén en otras carpetas («Letras», «Portadas», «Covers»…), con nombres que no coinciden letra a letra («01 - Canción» y «canción.lrc», con o sin tildes, «Artista - Título»); las canciones con el mismo nombre en carpetas distintas (CD1 y CD2) ya no se pierden; también .m4b, .jfif y .gif · la constancia de hábitos cuenta solo los días que toca cada hábito y desde que lo creaste, y crear uno nuevo ya no hunde la racha ni el récord · la misma racha en Inicio y en Ajustes · una fecha dañada que llegue de otro dispositivo ya no impide abrir Frame · un borrado que aún puedes deshacer ya no reaparece al llegar cambios de otro dispositivo · menos tráfico con la nube (comprobaciones más espaciadas, imágenes que se suben reducidas) y avisos de actualización cada 6 horas · Frame ya no guarda tokens de Google en el equipo · copias de adjuntos marcadas como descargadas de Internet · la ventana flotante de Enfoque abre más rápido · Frame más ligera: menos código y textos legales que se cargan al abrirlos · el panel de uso del responsable sale de la app.

*1.6.9:* las **imágenes de la galería** que pones a asignaturas, colecciones y playlists por fin aparecen en tus otros dispositivos (llegaban, pero no se dibujaban) · **el corazón de las canciones** también viaja entre tus dispositivos, por su título y artista · Frame guarda lo que una versión más nueva añada a tu respaldo, aunque no lo use · **Panel de uso** a fondo para el responsable de Frame: mapa del mundo, continentes, países y ciudades, una tarjeta por estudiante con su detalle, plazos de un día a un año o a elegir, en qué horas se estudia, qué funciones se usan, retención por cohortes y un **Reporte** en Word, PDF o Markdown · Términos y Política de privacidad 5.1: el perfil de uso que se envía (ciudad aproximada, zona horaria, idiomas, tipo de equipo, horas de estudio y cuántos elementos tienes de cada función, nunca su contenido).

*1.6.8:* **sincronización a fondo**: cada cambio llega a tus otros dispositivos en menos de un segundo, cifrado, por el canal de tu cuenta, y la nube recibe solo lo necesario; el respaldo ya no se reenvía sin parar · ahora también viajan **el orden de las playlists y de sus canciones**, **el idioma**, **la proporción de las imágenes** de las tarjetas, la ciudad del clima elegida a mano, los **vídeos de estudio** y las imágenes de la galería de Frame en asignaturas, colecciones y playlists (como un código, no la imagen entera); las imágenes que subes tú se quedan en su dispositivo y Frame te explica por qué · **verificador de sincronización** en la campana: cuántas cosas no están igual en tus dispositivos, dónde y por qué · si dos dispositivos cambian lo mismo, gana el cambio más reciente, aunque uno estuviera sin conexión · **Gmail y Classroom** vuelven a dejarte iniciar sesión · **calendario**: el mes y sus flechas con más aire, y casillas que se adaptan al alto de la ventana; «Nuevo evento» más compacto, con la hora y **el mismo recordatorio que las tareas** · **Ajustes** en orden también con Frame a media pantalla; en Informes, selectores neutros, «PDF» en gris y «Word» en azul · fondo sin constelación · menú lateral con menos margen arriba y abajo · Términos y Política de privacidad 5.0: qué imágenes viajan y cuáles no.

*1.6.7:* **Frame en inglés**: Ajustes → «Idioma» cambia toda la app entre español e inglés al instante, sin reiniciar · **calendario renovado**: mes centrado con solo flechas, casillas más bajas y bordes finos; «Nuevo evento» con el tipo en un desplegable (también uno escrito por ti), recursos, «Todo el día» que pinta la casilla, selector de color y nota con formato; al vaciar varios días con más de una actividad, una lista para marcar qué se elimina · el detalle de cada **sesión de estudio**, con sus datos en tres tercios · **privacidad entre perfiles**: cada cuenta de un mismo equipo ve solo su música, la imagen de su horario y su clima · **Frame pesa menos**: código depurado e imágenes recomprimidas · la pantalla de acceso, sin el aro que seguía al cursor · **tu música, a fondo**: Frame lee las etiquetas de MP3, M4A, FLAC, OGG, Opus, WAV y WebM —título, artista, álbum, portada, letra (también la sincronizada) y duración—, separa el título del artista aunque el archivo no traiga etiquetas, usa la portada de la carpeta si la canción no trae una y avisa al importar de lo que no puede reproducir y por qué · **las letras son solo tuyas**: Frame deja de buscarlas en internet; muestra la que trae la canción o la que añades desde un archivo .lrc o .txt en «Reproduciendo» · las **playlists** muestran su duración total y su cabecera funde la imagen con el fondo sin cortes · **Tareas**: junto a «Filtros», cuántas tareas ves y cuánto suma su tiempo estimado · se retira el **Centro de ayuda** · la palabra de fondo queda solo en los recuadros que se abren con un clic, y quieta; solo se mueve en cada asignatura · los botones de formato apilados miden lo mismo que el recuadro de escribir · en Música, sin flechas al pie de la lista · Términos y Política de privacidad 4.9: sin servicios de letras ni conversaciones con la ayuda.

*1.6.6:* **Centro de ayuda** por temas y preguntas, sin barra ni historial, con un **dodecaedro** que gira de lado y frases que cambian a las 6, a las 12 y a las 18 · **cada asignatura**: «Clases» pasa a ser **«Recursos»** (anotaciones, enlaces, archivos y grabaciones, en orden) y se retira el horario del mes · **encuadre** con la imagen completa a la vista y lo que no se usa, oscurecido · las tarjetas guardan la **proporción** de imagen que elijas · **Inicio**: «Ayer», «Promedio semanal», «Días de racha» y «Próxima tarea» rediseñados · **Ajustes**: «Tu racha» bajo Rendimiento y Tiempo, con **Informes** a su derecha · cabeceras con línea divisoria y palabra de fondo en todos los recuadros · textos sin mayúsculas sostenidas · formato de anotaciones sin subrayado, deshacer ni rehacer · Términos y Política de privacidad 4.8: se retira la cláusula de la importación de horarios.

*1.6.5:* **las respuestas de la ayuda, reescritas** para quien empieza: cordiales, en párrafos, con negritas y diciendo dónde está cada botón; entiende más formas de preguntar · se retira «Mostrar cómo» · la figura de la ayuda es ahora un **balón de fútbol**, «Relacionado» se pliega y el botón estrena icono de **dos estrellas** · **«Anotación nueva»** y las grabaciones, con los botones de formato apilados a la izquierda · **tareas**: botones en el orden fecha, tipo, importancia, dificultad, tiempo estimado, recordatorio, documento y enlace; **«Adjuntar archivo»** con un clic o arrastrando varios archivos; el tiempo estimado se elige con ruedas de horas y minutos · las tarjetas de colecciones y asignaturas siguen el **alto de imagen** que elijas (hasta 200) en todas las pantallas · **detalle de cada sesión** con la imagen de su asignatura de borde a borde · Política de privacidad 4.7: deja de mencionar los recorridos «Descubrir», que ya no existen.

*1.6.4:* **Centro de ayuda** con «Historial» a la izquierda (por días), figura de pentágonos que respira al escribir, frases que rotan y tema nuevo **«Curiosidades»** · **la campana guarda el registro** de tus notificaciones, con su hora, y un engranaje para el sonido, activarlas o borrarlas · **«Anotación nueva»** y la descripción de las grabaciones con botones de formato como en Word · **«Guardar grabación»**: importancia y **tipo de audio** en desplegables · **vuelven las letras reconocidas en internet** · **89 imágenes nuevas** en la galería · engranaje en Asignaturas para el **alto de las imágenes** · los avisos de la esquina ya no se quedan clavados al minimizar · al terminar una sesión con la vista flotante, Frame se pone delante.

*1.6.3:* **Centro de ayuda renovado**: una conversación como en un chat, temas en tarjetas en lugar de adivinar la pregunta, «Mostrar cómo» y «Nueva conversación», con su botón en la barra superior · **Informes en Ajustes**: rendimiento y pendientes, semanal, mensual o anual, con resumen y **vista previa real** del documento · **menú lateral** en tres bloques · **Calendario** solo local y con la cuadrícula del calendario de Estudio: Frame deja de conectarse con Google Calendar · botones de cancelar y descartar en gris; el rojo, solo para confirmar un borrado · el temporizador de Estudio, centrado · «Crear» respeta el tema oscuro.

*1.6.2:* **la barra superior habla de ti**: frases con tus datos recientes que cambian solas · **Centro de informes** en la barra superior · **anotaciones sin asignatura** en Inicio · **Estudio**: tarjetas de sesión con su detalle, editor de texto tipo Word, asignaturas y tareas elegidas con tarjetas · **calendario local rediseñado**: varios días a la vez, recordatorios y colores de casilla · grabaciones con el límite que elijas (hasta 4 h) · **actualizar** muestra peso, tiempo estimado y avance real · Ajustes con un menú de cuenta pequeño e «Importar de Notion» · la Ayuda guarda una conversación por cada vez que abres Frame · **corregido**: «Importar» de Música no abría el explorador («current webview is not a WebviewWindow»).

*1.6.1:* **la Ayuda tiene su propia pantalla**: un botón redondo abajo a la derecha la abre a pantalla completa, con el menú y la barra superior a la vista, y Apex junto a la barra; tus preguntas quedan en «Conversaciones» · **Inicio, más ligero**: fuera la esfera · **«Enfoque» pasa a llamarse «Estudio»** en el menú · **tu música, desde tu equipo**: el botón «Importar» de Música abre el explorador de archivos para traer canciones sueltas o carpetas enteras, con su portada y su letra; Frame deja de descargar canciones, vídeos, portadas y letras · Música empieza siempre arriba de la primera carpeta de 100 al abrir Frame · Asignaturas ofrece las diez áreas del **CNEB** · las grabaciones de voz se guardan en M4A · **Frame pesa mucho menos y gasta menos procesador**: el instalador baja a una fracción del anterior y las animaciones se detienen cuando no se ven · fuera la pantalla de presentación y «Exportar música».

*1.6.0:* la ayuda respondía a toda pantalla y guardaba tus conversaciones · **«Descubrir»**: tras la respuesta, un recorrido guiado oscurece la pantalla, ilumina solo el botón que toca y avanza contigo hasta completar la acción, con **Apex**, la mascota de VT Asvent, cambiando de pose a tu lado · **la ayuda entiende muchas más preguntas**: erratas, frases coloquiales y averías («no carga», «no suena») incluidas · respuestas nuevas: volumen y controles de la música, letra desfasada, tareas en la asignatura equivocada y los problemas más frecuentes.

*1.5.9:* **código más simple**: un 17 % menos de líneas, sin las funciones que ya no se usaban · **fuera la calculadora, el diccionario y el traductor**: las extensiones se quedan con el importador de Notion · **fuera «Sugerencias» e «Institución Educativa»**: los errores y las propuestas se envían por correo a vt.asvent@gmail.com.

*1.5.8:* **Inicio estrena ayuda**: una barra para preguntar cómo usar cualquier función de Frame con tus palabras; responde al instante y sin internet desde una guía escrita función por función · al terminar una sesión, «¿Qué hiciste?» admite **lista de avances** además de texto continuo · el nombre de la playlist en el reproductor **te lleva a la canción que suena** · **YouTube** vuelve a la barra lateral · **corregido**: las imágenes de la cuenta no llegaban a subirse a la nube por un nombre de archivo que el servicio rechazaba; ahora sí viajan · los fallos que rompen una pantalla se reportan solos, con su ubicación en el código y nunca con contenido tuyo.

*1.5.6:* **vincular tu cuenta, más a mano**: quien está como invitado tiene una «G» pequeña junto a su perfil, abajo en el menú; abre el mismo recuadro de acceso, con Google o con correo y contraseña, y todo lo suyo pasa a la cuenta sin perder nada · **«Sin conexión»**: un aviso breve abajo a la izquierda que sube a la campana y queda allí como notificación; si se cerró la sesión, desde ella vuelves a entrar.

*1.5.5:* **las imágenes viajan entre tus dispositivos**: la foto de perfil, la imagen del horario y las de tus playlists, asignaturas y colecciones aparecen solas en el celular o la tablet, y al revés, en segundos · al encuadrar una imagen también se puede acercar pellizcando en una pantalla táctil.

*1.5.4:* **sincronización en vivo**: lo que cambias en el celular o la tablet aparece en la laptop en unos segundos, y al revés · **la sesión ya no se pierde**: si la nube cierra tu sesión por su cuenta, sigues en Frame con tus datos y una franja te ofrece volver a entrar · **encuadrar las imágenes** con zoom, en un marco con la forma exacta del hueco · el día del calendario de calificaciones muestra **cuándo estudiaste** (mañana, tarde o noche).

*1.5.3:* **vuelve «Entrar como invitado»**: se entra al instante, sin cuenta ni formularios, para probar Frame · **vincular con Google sin perder nada**: todo lo que hizo el invitado pasa a su cuenta, se suma a lo que ya tuviera sin borrar ni duplicar y queda respaldado en la nube.

Historial completo: en la página de descarga de Frame.

---

## 9 · Documentos aplicables

Términos y Condiciones de Uso y Política de Privacidad, versión ${TERMS_VERSION}, vigentes desde el ${releaseDate} · pantalla «Términos de servicio»
Política de Uso Aceptable · Anexo C de los Términos
Avisos de software de terceros · Anexo E de los Términos

Contacto: vt.asvent@gmail.com · Asvent`;
}
