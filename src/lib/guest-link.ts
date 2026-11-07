import { useSyncExternalStore } from 'react';
import { buildTransferFile, importTransferFile, type ImportResult } from '@/lib/data-transfer';
import { getImage, saveImage } from '@/lib/music-db';
import { reassignSongs } from '@/lib/profile-scope';
import { moveListening } from '@/lib/listening';
import { SCOPED_KEYS } from '@/lib/storage-snapshot';
import type { UserProfile } from '@/types';

// ============================================================
// Invitado → cuenta de Google, sin perder nada.
//
// Un invitado es un perfil local (id de 12 cifras): todo lo suyo cuelga de
// `*_<idInvitado>`. Al vincular Google, la cuenta estrena un UUID de Supabase
// y, sin este módulo, abriría vacía: por eso se quitó el invitado en la 1.4.9.
//
// Cómo se hace a prueba de fallos:
//   1. Justo antes de abrir la sesión en la nube se deja una MARCA en el disco
//      («este invitado se está vinculando»). Si Frame se cierra a mitad, la
//      marca sigue ahí y el siguiente arranque termina el trabajo.
//   2. Al entrar la cuenta, primero se trae su nube y DESPUÉS se suman los
//      datos del invitado con la fusión de data-transfer.ts: añade lo
//      que falta por id y nunca pisa lo que la cuenta ya tenía. Repetirla no
//      duplica nada, así que reintentar siempre es seguro.
//   3. Los datos del invitado NO se borran: quedan en el equipo como copia.
//   4. La marca solo se quita cuando la fusión terminó bien.
// ============================================================

const PENDING_KEY = 'frameGuestLinkPending';
const linkedKey = (guestId: string) => `guestLinkedTo_${guestId}`;

export interface PendingGuestLink {
  v: 1;
  guestId: string;
  username: string;
  createdAt: string;
  /** Foto de la cuenta de Google, por si el invitado no tenía avatar propio. */
  picture?: string;
  /** Nombres que dio Google: completan el perfil de una cuenta nueva sin preguntar. */
  firstNames?: string;
  lastNames?: string;
  startedAt: string;
}

// --- Progreso (lo pinta GuestLinkOverlay) ---

type GuestLinkPhase = 'idle' | 'ask' | 'merging' | 'uploading' | 'done' | 'error';

interface GuestLinkState {
  phase: GuestLinkPhase;
  message?: string;
  result?: ImportResult;
  /** Solo en «ask»: la respuesta del usuario. */
  answer?: (bring: boolean) => void;
}

let state: GuestLinkState = { phase: 'idle' };
const listeners = new Set<() => void>();

export function setGuestLinkState(next: GuestLinkState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/**
 * ¿Se suman a la cuenta los datos de invitado de este equipo? Lo pregunta el
 * propio Frame (GuestLinkOverlay), no el `confirm` del navegador: ese habla
 * en el idioma de Windows, no en el de la app (1.6.7).
 */
export function askToBringGuest(guestName?: string): Promise<boolean> {
  return new Promise((resolve) =>
    setGuestLinkState({
      phase: 'ask',
      message: guestName,
      answer: (bring) => {
        setGuestLinkState({ phase: 'idle' });
        resolve(bring);
      },
    })
  );
}

export const useGuestLinkState = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state
  );

// --- Marca de vinculación pendiente ---

export function readPendingGuestLink(): PendingGuestLink | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingGuestLink>;
    if (value?.v !== 1 || typeof value.guestId !== 'string' || !/^\d{12}$/.test(value.guestId)) return null;
    return value as PendingGuestLink;
  } catch {
    return null;
  }
}

export function markGuestLinkPending(
  guest: UserProfile,
  google: { picture?: string; firstNames?: string; lastNames?: string } = {}
): void {
  const pending: PendingGuestLink = {
    v: 1,
    guestId: guest.id,
    username: guest.username ?? '',
    createdAt: guest.createdAt ?? '',
    ...(google.picture ? { picture: google.picture } : {}),
    ...(google.firstNames ? { firstNames: google.firstNames } : {}),
    ...(google.lastNames ? { lastNames: google.lastNames } : {}),
    startedAt: new Date().toISOString(),
  };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function clearGuestLinkPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* sin almacenamiento: la marca caducará con el perfil */
  }
}

/** ¿Este invitado ya se vinculó a una cuenta? */
export function guestLinkedTo(guestId: string): string | null {
  try {
    return localStorage.getItem(linkedKey(guestId));
  } catch {
    return null;
  }
}

// --- La fusión ---

const isRecordList = (value: unknown): value is { id: string }[] =>
  Array.isArray(value) && value.every((row) => row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string');

/**
 * Claves del invitado que el traslado no cubre (p. ej. los vídeos de estudio
 * guardados). Las listas con id se suman sin duplicar; el resto solo se copia
 * si la cuenta no tiene nada en esa clave. Nunca se toca la telemetría, el
 * cursor de sincronización ni las copias de seguridad internas.
 */
function mergeRemainingKeys(guestId: string, accountUid: string): number {
  const suffix = `_${guestId}`;
  const covered = new Set<string>([...SCOPED_KEYS, 'recordings']);
  const skip = /^(telemetry|sync|guestAdoption|profileAvatar)/i;
  let merged = 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith(suffix) && !key.endsWith('__bak')) keys.push(key);
  }
  for (const key of keys) {
    const base = key.slice(0, -suffix.length);
    if (!base || covered.has(base) || skip.test(base)) continue;
    const target = `${base}_${accountUid}`;
    try {
      const incomingRaw = localStorage.getItem(key);
      if (incomingRaw === null) continue;
      const existingRaw = localStorage.getItem(target);
      if (existingRaw === null) {
        localStorage.setItem(target, incomingRaw);
        merged += 1;
        continue;
      }
      const incoming = JSON.parse(incomingRaw) as unknown;
      const existing = JSON.parse(existingRaw) as unknown;
      if (isRecordList(incoming) && isRecordList(existing)) {
        const known = new Set(existing.map((row) => row.id));
        const fresh = incoming.filter((row) => !known.has(row.id));
        if (fresh.length > 0) {
          localStorage.setItem(target, JSON.stringify([...existing, ...fresh]));
          merged += 1;
        }
      }
    } catch {
      /* una clave ilegible no frena el resto */
    }
  }
  return merged;
}

async function applyGooglePicture(uid: string, pictureUrl?: string): Promise<void> {
  if (!pictureUrl) return;
  try {
    if (await getImage(`profileAvatar_${uid}`).catch(() => null)) return;
    const response = await fetch(pictureUrl.replace(/=s\d+(-c)?/, '=s256$1'));
    if (!response.ok) return;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    await saveImage(`profileAvatar_${uid}`, dataUrl);
  } catch {
    /* la foto es un extra */
  }
}

/**
 * Suma los datos del invitado a la cuenta. Idempotente: si ya se hizo, o si se
 * repite tras un corte, no duplica nada. Lanza si no se pudo (sin espacio):
 * quien llama conserva la marca para reintentar.
 */
export async function mergeGuestIntoAccount(
  guest: { id: string; username: string; createdAt?: string },
  accountUid: string,
  picture?: string
): Promise<ImportResult> {
  if (guest.id === accountUid) return { records: 0, images: 0, recordings: 0 };
  const profile: UserProfile = {
    id: guest.id,
    username: guest.username,
    isGuest: true,
    createdAt: guest.createdAt ?? '',
  };
  const file = await buildTransferFile(profile);
  const result = await importTransferFile(file, accountUid, 'merge');
  mergeRemainingKeys(guest.id, accountUid);
  // La música no va en el archivo: es del perfil (1.6.7) y pasa a la cuenta.
  await reassignSongs(guest.id, accountUid);
  // Y lo que escuchó (1.8.0).
  await moveListening(guest.id, accountUid).catch(() => undefined);
  await applyGooglePicture(accountUid, picture);

  try {
    localStorage.setItem(linkedKey(guest.id), accountUid);
    localStorage.setItem(`guestAdoptionAnswered_${accountUid}`, '1');
    // «Entrar como invitado» ya no debe reabrir este perfil: ahora es la cuenta.
    const last = JSON.parse(localStorage.getItem('lastLocalProfile') ?? 'null') as { id?: string } | null;
    if (last?.id === guest.id) localStorage.removeItem('lastLocalProfile');
  } catch {
    /* marcas de cortesía */
  }
  window.dispatchEvent(new StorageEvent('storage', { key: `profileAvatar_${accountUid}` }));
  return result;
}

/** Nombre de usuario (máx. 12) a partir del nombre de pila de Google. */
export function usernameFromGoogle(givenName?: string, fallback?: string): string {
  const first = (givenName ?? '').trim().split(/\s+/)[0] ?? '';
  const candidate = first || (fallback ?? '').trim();
  return candidate.slice(0, 12);
}
