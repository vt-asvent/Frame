import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Check, CircleAlert, Cloud, Copy, LoaderCircle, Plug, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { IA_TOOLS } from '@/lib/extensions/ia/tools';
import { errorText, tr } from '@/lib/i18n';
import { IA_ACTIVITY_CHANGED, readIaActivity, type IaActivity } from './IaRuntime';

// ============================================================
// Conexiones con IA (1.7.3) en su tarjeta de Extensiones: configuración de
// un clic para las IA que arrancan servidores locales (Claude Desktop y
// Gemini CLI), lo necesario para copiar en las demás y la actividad reciente.
//
// ChatGPT y la app de Gemini solo conectan servidores REMOTOS: harían falta
// un puente en internet y el visto bueno de Diego antes de exponer datos
// fuera del equipo. Por eso aquí solo se explica.
// ============================================================

type Target = 'claude-desktop' | 'gemini-cli';

const TARGETS: { id: Target; name: string; after: () => string }[] = [
  { id: 'claude-desktop', name: 'Claude Desktop', after: () => tr('Cierra Claude del todo (también de la bandeja) y vuelve a abrirlo.') },
  { id: 'gemini-cli', name: 'Gemini CLI', after: () => tr('Abre una sesión nueva de Gemini CLI; /mcp muestra Frame.') },
];

const SERVER = 'frame';

/** El JSON de configuración con Frame añadida o quitada; null si el archivo no se puede leer como JSON. */
export function mergeConfig(current: string | null, command: string | null): string | null {
  let data: Record<string, unknown> = {};
  if (current && current.trim()) {
    try {
      const parsed: unknown = JSON.parse(current);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      data = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const servers = data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers) ? { ...(data.mcpServers as Record<string, unknown>) } : {};
  if (command) servers[SERVER] = { command, args: ['--mcp'] };
  else delete servers[SERVER];
  return `${JSON.stringify({ ...data, mcpServers: servers }, null, 2)}\n`;
}

function hasFrame(config: string | null, command: string): 'no' | 'yes' | 'other' {
  if (!config) return 'no';
  try {
    const entry = (JSON.parse(config) as { mcpServers?: Record<string, { command?: string }> }).mcpServers?.[SERVER];
    if (!entry) return 'no';
    return entry.command === command ? 'yes' : 'other';
  } catch {
    return 'no';
  }
}

interface TargetState {
  installed: boolean;
  status: 'no' | 'yes' | 'other';
}

function ConnectRow({ target, exe, state, onChange }: { target: (typeof TARGETS)[number]; exe: string; state: TargetState | undefined; onChange: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const apply = async (connect: boolean) => {
    setBusy(true);
    try {
      const current = await invoke<string | null>('ia_config_read', { target: target.id });
      const next = mergeConfig(current, connect ? exe : null);
      if (next === null) {
        toast({ variant: 'destructive', title: tr('No se tocó la configuración de {name}', { name: target.name }), description: tr('El archivo tiene un error de formato. Corrígelo o usa «Copiar configuración».') });
        return;
      }
      const path = await invoke<string>('ia_config_write', { target: target.id, text: next });
      toast({
        title: connect ? tr('Frame quedó conectada a {name}', { name: target.name }) : tr('Frame se quitó de {name}', { name: target.name }),
        description: connect ? target.after() : tr('Copia del archivo anterior junto a {path}', { path }),
      });
    } catch (error) {
      const text = errorText(error);
      toast({
        variant: 'destructive',
        title: tr('No se pudo cambiar la configuración de {name}', { name: target.name }),
        description: text.includes('NEEDS_FILE') ? tr('Abre {name} una vez para que cree su archivo de configuración y vuelve a intentarlo.', { name: target.name }) : text.slice(0, 200),
      });
    } finally {
      setBusy(false);
      onChange();
    }
  };

  const status = state?.status ?? 'no';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="min-w-[8rem] flex-1 text-sm font-medium">{target.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {status === 'yes' ? (
          <span className="flex items-center gap-1 text-primary">
            <Check className="h-3.5 w-3.5" />
            {tr('Conectada')}
          </span>
        ) : status === 'other' ? (
          tr('Apunta a otra copia de Frame')
        ) : state?.installed ? (
          tr('Instalada, sin Frame')
        ) : (
          tr('No parece instalada')
        )}
      </span>
      {status === 'yes' ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void apply(false)}>
          {busy ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Unplug className="mr-1 h-3.5 w-3.5" />}
          {tr('Quitar')}
        </Button>
      ) : (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void apply(true)}>
          {busy ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1 h-3.5 w-3.5" />}
          {status === 'other' ? tr('Actualizar') : tr('Conectar')}
        </Button>
      )}
    </div>
  );
}

const TOOL_TITLES = Object.fromEntries(IA_TOOLS.map((t) => [t.name, t.title]));

function useActivity(): IaActivity[] {
  const [log, setLog] = useState(readIaActivity);
  useEffect(() => {
    const update = () => setLog(readIaActivity());
    window.addEventListener(IA_ACTIVITY_CHANGED, update);
    return () => window.removeEventListener(IA_ACTIVITY_CHANGED, update);
  }, []);
  return log;
}

export function IaPanel() {
  const { toast } = useToast();
  const desktop = isTauri();
  const [exe, setExe] = useState<string | null>(null);
  const [states, setStates] = useState<Partial<Record<Target, TargetState>>>({});
  const activity = useActivity();

  const refresh = useCallback(async () => {
    if (!desktop) return;
    const path = await invoke<string>('ia_exe_path').catch(() => null);
    setExe(path);
    if (!path) return;
    const next: Partial<Record<Target, TargetState>> = {};
    for (const target of TARGETS) {
      const [installed, config] = await Promise.all([
        invoke<boolean>('ia_client_installed', { target: target.id }).catch(() => false),
        invoke<string | null>('ia_config_read', { target: target.id }).catch(() => null),
      ]);
      next[target.id] = { installed, status: hasFrame(config, path) };
    }
    setStates(next);
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast({ title: tr('Copiado'), description: what }),
      () => toast({ variant: 'destructive', title: tr('No se pudo copiar') })
    );

  if (!desktop) {
    return <p className="text-xs text-muted-foreground">{tr('Las IA se conectan a Frame en la app de escritorio.')}</p>;
  }

  const snippet = exe ? JSON.stringify({ mcpServers: { [SERVER]: { command: exe, args: ['--mcp'] } } }, null, 2) : '';
  const claudeCode = exe ? `claude mcp add ${SERVER} -- "${exe}" --mcp` : '';

  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        {tr('Activa: {n} herramientas para tareas, asignaturas, hábitos, calendario, sesiones, recursos, música e informes. Todo pasa dentro de este equipo y, para borrar, Frame te pregunta.', { n: IA_TOOLS.length })}
      </p>

      <div className="space-y-1.5">
        {TARGETS.map((target) => (
          <ConnectRow key={target.id} target={target} exe={exe ?? ''} state={states[target.id]} onChange={() => void refresh()} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{tr('Otras IA de escritorio (Cursor, VS Code, LM Studio…):')}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!exe} onClick={() => copy(snippet, tr('Pégalo en la sección de servidores MCP de tu IA.'))}>
          <Copy className="mr-1 h-3.5 w-3.5" />
          {tr('Copiar configuración')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!exe} onClick={() => copy(claudeCode, tr('Pégalo en una terminal.'))}>
          <Copy className="mr-1 h-3.5 w-3.5" />
          {tr('Copiar comando de Claude Code')}
        </Button>
      </div>

      <div className="flex gap-2 rounded-md bg-muted/60 p-2.5 text-muted-foreground">
        <Cloud className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {tr('ChatGPT y la app de Gemini solo se conectan a servidores en internet (y con planes de pago). Frame no saca tus datos del equipo: esa conexión aún no está disponible.')}
        </p>
      </div>

      {activity.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">{tr('Actividad reciente')}</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
            {activity.slice(0, 12).map((entry) => (
              <li key={`${entry.at}-${entry.tool}`} className="flex items-center gap-2 text-muted-foreground">
                {entry.ok ? <Check className="h-3 w-3 text-primary" /> : <CircleAlert className="h-3 w-3 text-destructive" />}
                <span className="tabular-nums">{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="truncate">
                  {entry.client} · {TOOL_TITLES[entry.tool] ?? entry.tool}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
