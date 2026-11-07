import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Bot } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useCourse } from '@/context/CourseContext';
import { extRead, extWrite, onExtensionTeardown, useExtensionOn } from '@/lib/extensions/store';
import { IA, IA_INSTRUCTIONS, IA_TOOLS, isReadOnly } from '@/lib/extensions/ia/tools';
import { runIaTool, type IaEnv } from '@/lib/extensions/ia/handlers';
import { IA_CLOUD_CHANGED, readCloudOn, revokeCloud, startCloudLink, type CloudReply } from '@/lib/extensions/ia/cloud';
import { tr } from '@/lib/i18n';

// ============================================================
// Conexiones con IA (1.7.3), dentro de la ventana principal.
//
// Con la extensión activa y una sesión abierta, abre el puente local
// (ia_bridge.rs) y, si este equipo atiende a los chats de la web (1.8.0),
// la conexión con el relé en la nube (cloud.ts). Las llamadas de los dos
// lados van a la MISMA cola, UNA A UNA: las funciones del contexto capturan
// el estado del último render, así que entre una llamada y la siguiente se
// deja que React aplique los cambios. Lo que borra espera la confirmación
// del usuario (50 s; si no responde, no se borra).
// ============================================================

interface BridgeCall {
  id: number;
  tool: string;
  args: unknown;
  client?: string;
}

interface Pending {
  client: string;
  what: string;
  resolve: (ok: boolean) => void;
}

export interface IaActivity {
  at: string;
  client: string;
  tool: string;
  ok: boolean;
  /** Llegó por la nube (un chat en la web) y no por el puente local. */
  via?: 'nube';
}

export const IA_ACTIVITY_CHANGED = 'frame-ia-activity';
/** Por debajo de los 60 s tras los que un cliente MCP da la petición por perdida. */
const CONFIRM_MS = 50_000;
const MAX_LOG = 30;

/** El nombre de la IA tal como lo verá el usuario. */
export function clientLabel(raw: string | undefined): string {
  const name = (raw ?? '').toLowerCase();
  if (name.includes('claude')) return 'Claude';
  if (name.includes('gemini')) return 'Gemini';
  if (name.includes('chatgpt') || name.includes('openai')) return 'ChatGPT';
  if (name.includes('cursor')) return 'Cursor';
  if (name.includes('copilot') || name.includes('visual studio') || name.includes('vscode')) return 'Copilot';
  return raw?.trim() ? raw.trim().slice(0, 40) : tr('Una IA');
}

export const readIaActivity = (): IaActivity[] => extRead<IaActivity[]>(IA, 'activity', []);

function logActivity(entry: IaActivity) {
  extWrite(IA, 'activity', [entry, ...readIaActivity()].slice(0, MAX_LOG));
  window.dispatchEvent(new Event(IA_ACTIVITY_CHANGED));
}

/** ¿Este equipo atiende a los chats de la web? Cambia en vivo. */
export function useCloudOn(): boolean {
  const [on, setOn] = useState(readCloudOn);
  useEffect(() => {
    const update = () => setOn(readCloudOn());
    window.addEventListener(IA_CLOUD_CHANGED, update);
    return () => window.removeEventListener(IA_CLOUD_CHANGED, update);
  }, []);
  return on;
}

const settle = () => new Promise<void>((resolve) => window.setTimeout(resolve, 120));
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let teardownRegistered = false;

export default function IaRuntime() {
  const on = useExtensionOn(IA);
  const course = useCourse();
  const ctxRef = useRef(course);
  ctxRef.current = course;
  const uid = course.userProfile?.id;
  // Los chats de la web necesitan una cuenta de Frame: el relé es por cuenta.
  const account = !!uid && course.userProfile?.isGuest !== true;
  const cloudOn = useCloudOn();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [pending, setPending] = useState<Pending | null>(null);

  if (!teardownRegistered) {
    teardownRegistered = true;
    onExtensionTeardown(IA, async () => {
      if (isTauri()) await invoke('ia_bridge_stop').catch(() => undefined);
      // Quitar la extensión de un equipo que atendía a los chats de la web les
      // retira el permiso: no quedan accesos colgando.
      if (readCloudOn()) await revokeCloud().catch(() => undefined);
    });
  }

  // Abrir o cerrar el puente.
  useEffect(() => {
    if (!isTauri()) return;
    if (!on || !uid) {
      void invoke('ia_bridge_stop').catch(() => undefined);
      return;
    }
    void invoke('ia_bridge_start', { tools: IA_TOOLS, instructions: IA_INSTRUCTIONS }).catch((error) => console.error('[frame.ia] puente', error));
  }, [on, uid]);

  // Una sola cola para el puente local y la nube.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(job);
    queueRef.current = run.catch((error) => console.error('[frame.ia]', error));
    return run;
  }, []);

  const execute = async (tool: string, args: unknown, rawClient: string | undefined, via?: 'nube'): Promise<CloudReply> => {
    const client = clientLabel(rawClient);
    const env: IaEnv = {
      ctx: () => ctxRef.current,
      settle,
      confirm: (what) =>
        new Promise<boolean>((resolve) => {
          let done = false;
          const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            setPending(null);
            resolve(ok);
          };
          const timer = window.setTimeout(() => finish(false), CONFIRM_MS);
          setPending({ client, what, resolve: finish });
          void invoke('focus_main_window').catch(() => undefined);
        }),
      notice: (what) => toastRef.current({ title: client, description: capitalize(what) }),
    };
    const reply = await runIaTool(tool, args, env);
    if (!isReadOnly(tool)) await settle();
    logActivity({ at: new Date().toISOString(), client, tool, ok: reply.ok, ...(via ? { via } : {}) });
    return reply;
  };
  const executeRef = useRef(execute);
  executeRef.current = execute;

  // Atender las llamadas del puente local, en orden.
  useEffect(() => {
    if (!isTauri() || !on || !uid) return;
    let disposed = false;
    const unlisten = listen<BridgeCall>('ia-bridge-call', (event) => {
      if (disposed) return;
      const call = event.payload;
      void enqueue(async () => {
        const reply = await executeRef.current(call.tool, call.args, call.client);
        await invoke('ia_bridge_reply', { id: call.id, reply }).catch(() => undefined);
      }).catch(() => undefined);
    });
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, [on, uid, enqueue]);

  // Y las de los chats de la web, por el relé (en la misma cola).
  useEffect(() => {
    if (!on || !account || !cloudOn) return;
    return startCloudLink((call) => enqueue(() => executeRef.current(call.tool, call.args, call.client, 'nube')));
  }, [on, account, cloudOn, uid, enqueue]);

  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && pending?.resolve(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {tr('{client} quiere borrar', { client: pending?.client ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {capitalize(pending?.what ?? '')}.{' '}
            {tr('Solo se borra si lo permites. Si no respondes en menos de un minuto, no se borra.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => pending?.resolve(false)}>{tr('No permitir')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => pending?.resolve(true)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {tr('Borrar')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
