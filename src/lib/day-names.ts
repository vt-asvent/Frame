import { getLang, type Lang } from '@/lib/i18n';

// ============================================================
// Nombres de los días en el idioma de la interfaz (1.6.7). La semana de
// Frame empieza en lunes: el índice 0 es el lunes y el 6, el domingo.
// `fromSunday` convierte el `getDay()` de JavaScript (0 = domingo).
//
// En inglés (y en otros) las iniciales se repiten (T martes y jueves, S
// sábado y domingo): nunca sirven de `key` en una lista; para eso, el índice.
// ============================================================

const NAMES: Record<Lang, string[]> = {
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  de: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
  it: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'],
  pt: ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'],
  ru: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  ja: ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'],
};
const SHORT: Record<Lang, string[]> = {
  es: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  fr: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  it: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
  pt: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  ja: ['月', '火', '水', '木', '金', '土', '日'],
};
const INITIALS: Record<Lang, string[]> = {
  es: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  de: ['M', 'D', 'M', 'D', 'F', 'S', 'S'],
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
  it: ['L', 'M', 'M', 'G', 'V', 'S', 'D'],
  pt: ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'],
  ru: ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'],
  ja: ['月', '火', '水', '木', '金', '土', '日'],
};

/** `getDay()` (0 = domingo) → índice desde el lunes. */
export const fromSunday = (day: number): number => (day + 6) % 7;

/** «lunes» / «Monday». */
export const dayName = (index: number): string => NAMES[getLang()][index];

/** «Lunes» / «Monday». */
export const dayTitle = (index: number): string => {
  const name = dayName(index);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** «Lun» / «Mon». */
export const dayShort = (index: number): string => SHORT[getLang()][index];

/** «L» / «M». */
export const dayInitial = (index: number): string => INITIALS[getLang()][index];

/** Las siete iniciales, de lunes a domingo. */
export const dayInitials = (): string[] => INITIALS[getLang()];
