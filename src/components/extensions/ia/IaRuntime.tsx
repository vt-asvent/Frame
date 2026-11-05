import { useEffect, useRef, useState } from 'react';
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
import { tr } from '@/lib/i18n';

// ============================================================
// Conexiones con IA (1.7.3), dentro de la ventana principal.
//
// Con la extensión activa y una sesión abierta, abre el puente local
// (ia_bridge.rs) y atiende sus llamadas UNA A UNA: las funciones del
// contexto capturan el estado del último render, así que entre una llamada
// y la siguiente se deja que React aplique los cambios. Lo que borra espera
// la confirmación del usuario (50 s; si no responde, no se borra).
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

const settle = () => new Promise<void>((resolve) => window.setTimeout(resolve, 120));
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let teardownRegistered = false;

export default function IaRuntime() {
  const on = useExtensionOn(IA);
  const course = useCourse();
  const ctxRef = useRef(course);
  ctxRef.current = course;
  const uid = course.userProfile?.id;
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [pending, setPending] = useState<Pending | null>(null);

  if (!teardownRegistered) {
    teardownRegistered = true;
    onExtensionTeardown(IA, async () => {
      if (isTauri()) await invoke('ia_bridge_stop').catch(() => undefined);
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

  // Atender las llamadas, en orden.
  useEffect(() => {
    if (!isTauri() || !on || !uid) return;
    let queue = Promise.resolve();
    let disposed = false;

    const handle = async (call: BridgeCall) => {
      const client = clientLabel(call.client);
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
      const reply = await runIaTool(call.tool, call.args, env);
      if (!isReadOnly(call.tool)) await settle();
      logActivity({ at: new Date().toISOString(), client, tool: call.tool, ok: reply.ok });
      await invoke('ia_bridge_reply', { id: call.id, reply }).catch(() => undefined);
    };

    const unlisten = listen<BridgeCall>('ia-bridge-call', (event) => {
      if (disposed) return;
      queue = queue.then(() => handle(event.payload)).catch((error) => console.error('[frame.ia]', error));
    });
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, [on, uid]);

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
