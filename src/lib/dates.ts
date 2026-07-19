import type { DayKey } from '../types';

/** Local-timezone day key: "YYYY-MM-DD". */
export function toDayKey(d: Date): DayKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): DayKey {
  return toDayKey(new Date());
}

/** Parse a day key into a local Date at midnight. */
export function fromDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: DayKey, days: number): DayKey {
  const d = fromDayKey(key);
  d.setDate(d.getDate() + days);
  return toDayKey(d);
}

/** Whole days from a to b (positive when b is after a). */
export function daysBetween(a: DayKey, b: DayKey): number {
  const ms = fromDayKey(b).getTime() - fromDayKey(a).getTime();
  return Math.round(ms / 86400000);
}

export function isToday(key: DayKey): boolean {
  return key === todayKey();
}

/** 0=Sunday .. 6=Saturday */
export function weekdayOf(key: DayKey): number {
  return fromDayKey(key).getDay();
}

/** Minutes since local midnight for a Date (or now). */
export function minutesOfDay(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** "09:30" / "14:05" style label — respects nothing fancy, 24h optional. */
export function formatMinutes(mins: number, hour12 = true): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(mins)));
  let h = Math.floor(clamped / 60);
  const m = clamped % 60;
  if (!hour12) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "45 min", "1 h", "1 h 30 min" */
export function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Wed, Jul 16" */
export function formatDayShort(key: DayKey): string {
  const d = fromDayKey(key);
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** "Wednesday, July 16" */
export function formatDayLong(key: DayKey): string {
  const d = fromDayKey(key);
  return `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

/** "Today" / "Tomorrow" / "Yesterday" / "Wed, Jul 16" */
export function formatDayRelative(key: DayKey): string {
  const diff = daysBetween(todayKey(), key);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return formatDayShort(key);
}

export function weekdayShort(weekday: number): string {
  return WEEKDAYS_SHORT[weekday] ?? '';
}

export function monthShort(monthIndex: number): string {
  return MONTHS_SHORT[monthIndex] ?? '';
}

/** The 7 day keys of the week containing `key`. */
export function weekOf(key: DayKey, weekStartsOn: 0 | 1 = 1): DayKey[] {
  const wd = weekdayOf(key);
  const offset = (wd - weekStartsOn + 7) % 7;
  const start = addDays(key, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Last `n` day keys ending with `end` (inclusive), oldest first. */
export function lastNDays(n: number, end: DayKey = todayKey()): DayKey[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}
