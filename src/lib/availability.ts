import type { DayKey, Settings, Task } from '../types';
import {
  addDays,
  daysBetween,
  formatMinutes,
  minutesOfDay,
  todayKey,
  weekdayOf,
  weekdayShort,
} from './dates';
import { taskOccursOn } from './recurrence';

/** Ignore free windows shorter than this — nobody books a 45-minute gap. */
const MIN_SLOT_MINUTES = 60;

/** One shareable free window on one day. Times are minutes from midnight. */
export interface FreeSlot {
  day: DayKey;
  startMinutes: number;
  endMinutes: number;
  /** Runs to the end of the bookable day — reads "after X" in messages. */
  openEnded: boolean;
  /** Spans the entire bookable day — reads "anytime" instead of a range. */
  wholeDay: boolean;
}

/** A day's free windows (possibly none when fully booked). */
export interface DayFreeSlots {
  day: DayKey;
  slots: FreeSlot[];
}

/**
 * Free windows inside [dayStartHour, dayEndHour] for each of the next `days`
 * days, found by subtracting every scheduled timed occurrence (meetings and
 * ordinary tasks alike; all-day tasks don't block time). Starts today while
 * at least one bookable hour remains, tomorrow otherwise; today's windows
 * never start in the past. Windows shorter than an hour are dropped.
 */
export function computeFreeSlots(
  tasks: Record<string, Task>,
  settings: Pick<Settings, 'dayStartHour' | 'dayEndHour'>,
  days = 6
): DayFreeSlots[] {
  const dayStart = settings.dayStartHour * 60;
  const dayEnd = settings.dayEndHour * 60;
  const today = todayKey();
  const nowMin = minutesOfDay();
  const startsToday = nowMin < dayEnd - MIN_SLOT_MINUTES;
  const first = startsToday ? today : addDays(today, 1);

  const out: DayFreeSlots[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(first, i);
    // Today can't offer windows that already passed — floor at the next
    // quarter hour so the first slot starts at a sane time.
    const floor =
      day === today ? Math.max(dayStart, Math.ceil(nowMin / 15) * 15) : dayStart;
    out.push({ day, slots: freeSlotsForDay(tasks, day, floor, dayEnd) });
  }
  return out;
}

function freeSlotsForDay(
  tasks: Record<string, Task>,
  day: DayKey,
  windowStart: number,
  windowEnd: number
): FreeSlot[] {
  if (windowEnd - windowStart < MIN_SLOT_MINUTES) return [];

  // Busy intervals from every timed occurrence on this day, clamped to the window.
  const busy: [number, number][] = [];
  for (const t of Object.values(tasks)) {
    if (t.allDay || t.startMinutes == null) continue;
    if (!taskOccursOn(t, day)) continue;
    const s = Math.max(t.startMinutes, windowStart);
    const e = Math.min(t.startMinutes + Math.max(0, t.durationMinutes), windowEnd);
    if (e <= s) continue; // outside the window or zero-length
    busy.push([s, e]);
  }
  busy.sort((a, b) => a[0] - b[0]);

  // Merge overlapping/adjacent busy intervals.
  const merged: [number, number][] = [];
  for (const iv of busy) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }

  // The gaps are the free windows; keep the ones worth offering.
  const slots: FreeSlot[] = [];
  let cursor = windowStart;
  const push = (start: number, end: number) => {
    if (end - start < MIN_SLOT_MINUTES) return;
    slots.push({
      day,
      startMinutes: start,
      endMinutes: end,
      openEnded: end === windowEnd,
      wholeDay: start === windowStart && end === windowEnd,
    });
  };
  for (const [s, e] of merged) {
    push(cursor, s);
    cursor = Math.max(cursor, e);
  }
  push(cursor, windowEnd);
  return slots;
}

/** "3 PM" → {time: "3", suffix: "PM"} (formatMinutes always emits a suffix). */
function splitTime(mins: number): { time: string; suffix: string } {
  const label = formatMinutes(mins);
  const i = label.lastIndexOf(' ');
  return { time: label.slice(0, i), suffix: label.slice(i + 1) };
}

/**
 * Compact label for one window: "3–6 PM", "11 AM–2 PM", or "after 7 PM" when
 * the window runs to the end of the bookable day.
 */
export function formatSlotRange(slot: FreeSlot): string {
  if (slot.wholeDay) return 'anytime';
  if (slot.openEnded) return `after ${formatMinutes(slot.startMinutes)}`;
  const s = splitTime(slot.startMinutes);
  const e = splitTime(slot.endMinutes);
  return s.suffix === e.suffix
    ? `${s.time}–${e.time} ${e.suffix}`
    : `${s.time} ${s.suffix}–${e.time} ${e.suffix}`;
}

/** "today" / "tomorrow" / "Tue" — mid-sentence day label. */
function messageDayLabel(day: DayKey): string {
  const diff = daysBetween(todayKey(), day);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return weekdayShort(weekdayOf(day));
}

/**
 * Human text for the selected windows, ready to drop into a message:
 * "I'm free: Tue 3–6 PM, Wed after 7 PM, Fri 1–4 PM". Multiple windows on
 * one day join with "or". Empty selection → "".
 */
export function formatSlotsMessage(selection: FreeSlot[]): string {
  if (selection.length === 0) return '';
  const sorted = [...selection].sort((a, b) =>
    a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.startMinutes - b.startMinutes
  );
  const byDay = new Map<DayKey, FreeSlot[]>();
  for (const s of sorted) {
    const list = byDay.get(s.day);
    if (list) list.push(s);
    else byDay.set(s.day, [s]);
  }
  const parts = [...byDay.entries()].map(
    ([day, slots]) => `${messageDayLabel(day)} ${slots.map(formatSlotRange).join(' or ')}`
  );
  return `I'm free: ${parts.join(', ')}`;
}
