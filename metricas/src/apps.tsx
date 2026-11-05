import type { ReactNode } from 'react';
import FrameLogo from '@/components/layout/FrameLogo';
import chaskiGo from '@m/assets/chaski-go.png';

// ============================================================
// Las apps del panel único de métricas (1.7.3, pedido del 5-nov-2026):
// una tarjeta por app. «inside» se analiza aquí, tras el código del
// autenticador; «link» tiene aún su propio panel (con su propia llave) y se
// abre en otra pestaña mientras se integra; «none» todavía no mide el uso.
// ============================================================

export type AppAccess = { kind: 'inside' } | { kind: 'link'; href: string; note: string } | { kind: 'none'; note: string };

export interface MetricsApp {
  id: string;
  name: string;
  logo: ReactNode;
  /** Qué es, en una línea (se ve siempre). */
  tagline: string;
  access: AppAccess;
}

function WireLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden>
      <rect width="1024" height="1024" rx="232" fill="#1F1F22" />
      <path d="M236 352 L376 704 L512 468 L648 704 L788 352" fill="none" stroke="#7591FF" strokeWidth="84" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="236" cy="352" r="62" fill="#FAFAFA" />
      <circle cx="788" cy="352" r="62" fill="#FAFAFA" />
    </svg>
  );
}

export const METRICS_APPS: MetricsApp[] = [
  {
    id: 'frame',
    name: 'Frame',
    logo: <FrameLogo className="h-full w-full" />,
    tagline: 'Estudio · Windows y Android',
    access: { kind: 'inside' },
  },
  {
    id: 'wire',
    name: 'Wire',
    logo: <WireLogo className="h-full w-full" />,
    tagline: 'Notas y Drive · escritorio y Android',
    access: { kind: 'link', href: 'https://wire.vtasvent.workers.dev/panel/', note: 'Su panel propio, con su propio código, mientras se integra.' },
  },
  {
    id: 'chaski-go',
    name: 'Chaski Go',
    logo: <img src={chaskiGo} alt="" className="h-full w-full rounded-[22%]" />,
    tagline: 'Reservar y recoger · Android',
    access: { kind: 'none', note: 'Aún no mide el uso.' },
  },
];

export const appById = (id: string | null) => METRICS_APPS.find((app) => app.id === id) ?? null;
