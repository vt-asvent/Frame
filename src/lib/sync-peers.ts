// ============================================================
// Mensajes entre los equipos de la cuenta por el canal en vivo (1.9.2).
//
// live-sync.ts es el dueño del canal; quien quiera hablar con los demás
// equipos (hoy, Dispositivos) lo hace por aquí, sin conocer el canal. Los
// mensajes no llevan datos del usuario: el canal lo puede escuchar quien
// conozca su nombre, así que solo sirven de aviso («mira», «ya cambié») y
// quien los recibe nunca se fía de ellos para nada más que volver a preguntar
// a la nube.
// ============================================================

export type PeerMessage = Record<string, unknown>;
type Handler = (message: PeerMessage) => void;

const handlers = new Set<Handler>();
let sender: ((message: PeerMessage) => void) | null = null;

/** Lo llama live-sync.ts mientras tiene el canal de la cuenta; devuelve cómo soltarlo. */
export function setPeerSender(next: (message: PeerMessage) => void): () => void {
  sender = next;
  return () => {
    if (sender === next) sender = null;
  };
}

/** Lo llama live-sync.ts con cada mensaje de otro equipo. */
export function deliverPeerMessage(message: PeerMessage): void {
  for (const handler of [...handlers]) {
    try {
      handler(message);
    } catch {
      /* un oyente roto no tumba el canal */
    }
  }
}

/** A los demás equipos de la cuenta. Sin canal (sin sesión, sin red) no hace nada. */
export function sendPeerMessage(message: PeerMessage): void {
  sender?.(message);
}

export function onPeerMessage(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
