# Frame

**Tu sistema operativo de estudio.** Una app de escritorio para Windows que reúne en un solo lugar las asignaturas, las tareas, los hábitos, las sesiones de estudio, la música y los servicios de Google que usa un estudiante. Gratis, sin funciones de pago y pensada primero para estudiantes de Perú y Latinoamérica.

Un producto de **Asvent**, entidad de desarrollo de software (en formación).

- Página oficial y descarga: https://gasparrojasdiego.github.io/frame-app/
- Versión actual: **1.6.1** (Windows 10 y 11, 64 bits). Hay una versión para Android (tablets y teléfonos) en un proyecto aparte.

## Qué hace

- **Inicio:** clima, frase del día, horario, resumen de rendimiento y matriz de competencias.
- **Asignaturas:** cursos con tareas, notas, materiales y repaso espaciado; las 10 áreas del Currículo Nacional (CNEB) listas para añadir.
- **Estudio:** temporizador y cronómetro, registro de sesiones con autoevaluación, grabaciones de voz y vídeos de YouTube para estudiar.
- **Tareas y hábitos:** prioridades, fechas límite, progreso y calendario.
- **Música:** reproductor de tus propios archivos (MP3, M4A, AAC, OGG, Opus, FLAC, WAV y WebM) con sus portadas y letras sincronizadas, playlists con su duración total y favoritos. Frame no descarga nada: solo reproduce lo que tú importas.
- **Google:** Gmail, Classroom y YouTube integrados.
- **Informes** en PDF y Word, copias de seguridad locales y sincronización opcional en la nube.

Funciona **sin conexión** desde el primer momento: los datos viven en el equipo y la nube es opcional.

## Cómo está hecha

| Capa | Tecnología |
|---|---|
| Escritorio | [Tauri 2](https://tauri.app) — núcleo nativo en Rust, WebView2 |
| Interfaz | React 19, TypeScript, Vite, Tailwind, Radix UI |
| Datos locales | IndexedDB y localStorage (local-first) |
| Nube opcional | Supabase (Auth, Postgres con RLS, Realtime, Storage) |
| Actualizaciones | Actualizador de Tauri con firma Ed25519 y publicación en GitHub Releases |

Algunos detalles de ingeniería:

- **Instalador de 7 MB** (antes 66 MB): sin binarios de terceros, rutas cargadas en trozos y precarga en segundo plano.
- **Sincronización entre dispositivos:** cada cambio viaja cifrado (AES-GCM) por el canal en vivo de la cuenta y llega al otro dispositivo en unos 250 ms; la nube, con escritura condicionada, lo confirma y resuelve los choques por la hora de la edición, sin reenviar lo que ya tiene; lo que añada una versión más nueva viaja intacto. Verificada con dos y tres dispositivos simulados, relojes desfasados, las dos versiones anteriores, las imágenes de la galería y los favoritos: `node scripts/probar-sincronizacion.mjs`.
- **Panel de uso del responsable:** el servidor calcula una foto del panel como mucho cada 6 h (RPC `usage_snapshot`, migración 0012) y la app deriva de ella cualquier plazo y agrupación sin volver a consultar; un año por días con mil estudiantes se calcula en unos 35 ms. Mapa del mundo pretrazado (`scripts/generar-mapa.mjs`) y un reporte en Word (OOXML comprimido a mano), PDF o Markdown.
- **Música local sin dependencias:** lector propio de etiquetas (ID3v2.2–2.4, APEv2, ID3v1, FLAC, comentarios Vorbis y Opus, átomos MP4, RIFF INFO y EBML) que reconoce el formato por su contenido, separa título y artista desde el nombre del archivo y avisa de lo que no puede sonar; verificado con `node scripts/probar-musica.ts <carpeta>`.
- **Seguridad:** las peticiones HTTP nativas solo van a una lista cerrada de servicios; la lectura de archivos solo alcanza los que el usuario eligió; las políticas RLS de Supabase protegen los datos de cada cuenta.
- **Registro de errores:** cada fallo se agrupa por huella en Supabase y se traduce a archivo y línea con los mapas de fuente de cada versión (`docs/registro-de-errores.md`).

## Estructura

```
src/                 Interfaz (React + TypeScript)
  app/               Pantallas: inicio, asignaturas, estudio, música, calendario…
  components/        Componentes de interfaz
  context/           Estado global
  lib/               Datos, sincronización, integraciones de Google, música, informes, textos legales
src-tauri/           Núcleo nativo en Rust (ventanas, OAuth, archivos, actualizador)
supabase/migrations/ Esquema de la base de datos y sus políticas
scripts/             Pruebas de la música y de la sincronización, utilidades y publicación
native_pictures/     Fondos incluidos en la app
```

## Desarrollo

Requisitos: Node 20+, Rust estable y, en Windows, WebView2 (viene con Windows 11).

```bash
npm install
cp .env.example .env   # rellena los valores; sin Supabase, la app funciona solo en local
npm run tauri:dev      # app de escritorio
npm run dev            # solo la interfaz en el navegador (http://localhost:9002)
npm run dist           # instalador NSIS
```

## Historia

Frame nació como **[Aether OS](https://github.com/vt-asvent/Aether-OS)** (2026), una primera versión hecha con Electron y Next.js. Frame la reescribió desde cero sobre Tauri y Rust para que fuera más ligera, más rápida y más segura, y desde entonces ha crecido versión a versión.

## Licencia

© 2026 Asvent. Todos los derechos reservados. El código se publica para consulta; no se permite redistribuir la app ni obras derivadas sin permiso.
