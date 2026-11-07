# Frame · IA en la nube

MCP remoto para que **claude.ai** (web, escritorio y celular) y los demás chats que
admiten conectores (ChatGPT en modo desarrollador, herramientas locales con OAuth)
usen Frame. Cloudflare Worker + D1 + un Durable Object por cuenta, en el plan gratis.

**Aquí no viven los datos de Frame.** Cada llamada de un chat pasa, por el relé de
la cuenta, a una Frame abierta (por un WebSocket que hiberna mientras espera) y la
respuesta vuelve igual. No se guardan argumentos ni respuestas.

| Ruta | Para |
|---|---|
| `/.well-known/*`, `/register`, `/authorize`, `/token` | OAuth 2.1 con registro dinámico y PKCE; se autoriza con el código de 8 letras que muestra Frame (10 min, un uso; 20 fallos anulan los vivos). |
| `/mcp` | MCP por HTTP (JSON-RPC sin sesiones). |
| `/app/pair`, `/app/ticket`, `/app/status`, `/app/revoke` | Lo que pide la app con su sesión de Supabase. |
| `/app/socket?ticket=` | El WebSocket de cada Frame (pase de 1 min y un solo uso). |

- D1 (`migraciones/`): chats registrados, códigos, autorizaciones y sesiones; los códigos y llaves, como huella SHA-256.
- Relé (`src/relay.ts`): guarda la lista de herramientas que publicó Frame (los chats la ven con Frame cerrada) y la generación de permisos (retirar permisos corta también los accesos vivos). Responde la Frame más reciente o la que volvió a primer plano; si no confirma la llamada en 6 s, lo que solo lee prueba con otra y lo que cambia no se repite. Máximo 60 llamadas por minuto y cuenta.
- La app (`src/lib/extensions/ia/cloud.ts`): pide el código, abre el WebSocket, publica las herramientas y atiende las llamadas con el mismo motor que el puente local, confirmación para borrar incluida.

```bash
npm test        # Miniflare: OAuth, relé, respaldo entre equipos, cortes, permisos, frenos
bash desplegar.sh   # D1, migraciones, Worker y secretos (cuenta vt.asvent de wrangler)
```

Secretos (nunca en el repositorio): `FRAME_IA_KEY` (se genera en `../keys/frame-ia.env`),
`SUPABASE_URL` y `SUPABASE_ANON_KEY` (de `../.env`). `SECRETOS=1 bash desplegar.sh` los vuelve a subir.
