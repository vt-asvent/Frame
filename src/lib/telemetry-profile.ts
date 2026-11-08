import type { DailyPerformance, StreakGoal, StudyGoals, StudySession } from '@/types';
import { loadWeatherPlace, type WeatherPlace } from '@/lib/weather';
import { getLang } from '@/lib/i18n';
import { currentStreak } from '@/lib/streak';
import { getThemePreference } from '@/lib/theme';

// ============================================================
// Perfil de uso de un estudiante para el Panel de uso (1.6.9).
//
// Lo que el responsable de Frame necesita para saber dónde, cuándo y cómo se
// usa la app, sin ver el contenido de nada (Política de Privacidad, 3.2):
//
//   · lugar APROXIMADO: la ciudad, la región y el país del clima de Inicio
//     (lo que el usuario ve y puede cambiar). Nunca coordenadas ni el barrio;
//   · zona horaria, idioma de Frame, idioma del sistema y tipo de equipo;
//   · cuándo estudia: minutos por día de la semana y hora local (7 × 24), en
//     los últimos 140 días, repartidos hora a hora; cuánto duran sus sesiones
//     y el enfoque que declara (por tramos);
//   · su racha actual y la mejor que se le ha visto;
//   · CUÁNTOS elementos tiene de cada función (notas, eventos, vídeos…),
//     nunca cuáles.
// ============================================================

const DAYS = 140;
const HOUR_MS = 60 * 60 * 1000;

export interface UsageProfile {
  city: string | null;
  region: string | null;
  country_code: string | null;
  timezone: string | null;
  lang: string;
  locale: string | null;
  device: 'desktop' | 'tablet' | 'phone';
  /** Minutos por día de la semana (lunes = 0) × hora local: 168 enteros. */
  matrix: number[];
  /** Sesiones de < 15, 15–30, 30–60, 60–120 y ≥ 120 minutos. */
  slen: number[];
  /** Enfoque declarado (1–20) en tramos de 4. */
  focus: number[];
  streak: number;
  best_streak: number;
  features: Record<string, number>;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

const count = (uid: string, name: string): number => {
  const value = read<unknown>(`${name}_${uid}`, []);
  return Array.isArray(value) ? value.length : 0;
};

// ------------------------------------------------------------
// País: el código ISO del lugar; si es un lugar guardado antes de la 1.6.9
// (sin código), se deduce del nombre en español o en inglés.
// ------------------------------------------------------------
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

let namesToCode: Map<string, string> | null = null;
function codeFromName(name: string): string | null {
  if (!namesToCode) {
    namesToCode = new Map();
    try {
      const displays = ['es', 'en'].map((lang) => new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' }));
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (const a of letters) {
        for (const b of letters) {
          const code = a + b;
          for (const display of displays) {
            const label = display.of(code);
            if (label && label !== code) namesToCode.set(fold(label), code);
          }
        }
      }
    } catch {
      /* sin Intl.DisplayNames: el país queda sin código */
    }
  }
  return namesToCode.get(fold(name)) ?? null;
}

export function countryCodeOf(place: Pick<WeatherPlace, 'country' | 'countryCode'> | null): string | null {
  if (!place) return null;
  if (place.countryCode && /^[A-Z]{2}$/.test(place.countryCode)) return place.countryCode;
  return place.country ? codeFromName(place.country) : null;
}

function deviceKind(): UsageProfile['device'] {
  if (!/android/i.test(navigator.userAgent)) return 'desktop';
  // Como Android: desde 600 dp por el lado corto, tableta.
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
  return shortSide >= 600 ? 'tablet' : 'phone';
}

// ------------------------------------------------------------
// Cuándo estudia
// ------------------------------------------------------------
function studyShape(sessions: StudySession[]): Pick<UsageProfile, 'matrix' | 'slen' | 'focus'> {
  const matrix = new Array<number>(168).fill(0);
  const slen = [0, 0, 0, 0, 0];
  const focus = [0, 0, 0, 0, 0];
  const since = Date.now() - DAYS * 24 * HOUR_MS;
  for (const session of sessions) {
    const start = Date.parse(session.startTime ?? '');
    if (Number.isNaN(start) || start < since) continue;
    const minutes = session.durationSec !== undefined ? session.durationSec / 60 : session.duration || 0;
    if (!(minutes > 0)) continue;
    // Repartida hora a hora: una sesión de 14:30 a 16:10 suma 30 min a las 14,
    // 60 a las 15 y 10 a las 16 (como mucho, un día).
    let at = start;
    const end = start + Math.min(minutes, 24 * 60) * 60_000;
    while (at < end) {
      const date = new Date(at);
      const hourEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1).getTime();
      const slice = Math.min(end, hourEnd) - at;
      matrix[((date.getDay() + 6) % 7) * 24 + date.getHours()] += slice / 60_000;
      at += slice;
    }
    slen[minutes < 15 ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 120 ? 3 : 4] += 1;
    if (session.mode !== 'tiempo' && session.perception > 0) focus[Math.min(4, Math.floor((Math.min(20, session.perception) - 1) / 4))] += 1;
  }
  return { matrix: matrix.map(Math.round), slen, focus };
}

/** Todo lo de arriba, a partir de lo guardado en este dispositivo para `uid`. */
export function buildUsageProfile(uid: string, sessions: StudySession[]): UsageProfile {
  const place = loadWeatherPlace();
  const streak = (() => {
    try {
      return currentStreak({
        now: new Date(),
        streakGoal: read<StreakGoal>(`streakGoal_${uid}`, { mode: 'rendimiento', grade: 'A', minutes: 60 }),
        studySessions: sessions,
        dailyPerformances: read<DailyPerformance[]>(`dailyPerformances_${uid}`, []),
        studyGoals: read<StudyGoals | null>(`studyGoals_${uid}`, null),
      });
    } catch {
      return 0;
    }
  })();
  // La mejor racha: la mayor vista desde este dispositivo (el servidor guarda
  // la mayor de todas las que le llegan).
  const bestKey = `telemetryBestStreak_${uid}`;
  const best = Math.max(streak, Number(localStorage.getItem(bestKey)) || 0);
  try {
    localStorage.setItem(bestKey, String(best));
  } catch {
    /* se recalcula en el próximo envío */
  }

  const refs = read<{ kind?: string }[]>(`imageRefs_${uid}`, []);
  const habits = read<{ isArchived?: boolean }[]>(`habits_${uid}`, []);
  const features: Record<string, number> = {
    notes: count(uid, 'notes'),
    loose_notes: count(uid, 'looseNotes'),
    archived_notes: count(uid, 'archivedNotes'),
    pending_tasks: count(uid, 'tasks'),
    incomplete_tasks: count(uid, 'incompleteTasks'),
    events: count(uid, 'localEvents'),
    painted_days: count(uid, 'dayColors'),
    collections: count(uid, 'spaces'),
    videos: count(uid, 'studyVideos'),
    recordings: count(uid, 'recordings'),
    favorites: count(uid, 'songFavorites'),
    day_grades: count(uid, 'dailyPerformances'),
    timetables: count(uid, 'timetables'),
    active_habits: Array.isArray(habits) ? habits.filter((habit) => !habit?.isArchived).length : 0,
    gallery_images: Array.isArray(refs) ? refs.filter((ref) => ref?.kind === 'native').length : 0,
    own_images: Array.isArray(refs) ? refs.filter((ref) => ref?.kind === 'own').length : 0,
    dark_theme: getThemePreference() === 'dark' ? 1 : 0,
  };

  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    /* sin zona horaria: el panel usa la de Perú */
  }

  return {
    city: place?.name && !/^-?\d/.test(place.name) ? place.name : null,
    region: place?.admin ?? null,
    country_code: countryCodeOf(place),
    timezone,
    lang: getLang(),
    locale: typeof navigator.language === 'string' ? navigator.language : null,
    device: deviceKind(),
    ...studyShape(sessions),
    streak,
    best_streak: best,
    features,
  };
}
