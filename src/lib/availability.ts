import type { CalendarEventLite, DayKey, Settings, Task } from '../types';
import { eventsForDay } from './calendar';
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

/** The day sequence slots are offered for: starts today while at least one
 * bookable hour remains, tomorrow otherwise. */
function upcomingSlotDays(
  settings: Pick<Settings, 'dayEndHour'>,
  days: number
): DayKey[] {
  const dayEnd = settings.dayEndHour * 60;
  const today = todayKey();
  const startsToday = minutesOfDay() < dayEnd - MIN_SLOT_MINUTES;
  const first = startsToday ? today : addDays(today, 1);
  return Array.from({ length: days }, (_, i) => addDays(first, i));
}

/**
 * Free windows inside [dayStartHour, dayEndHour] for each of the next `days`
 * days, found by subtracting every scheduled timed occurrence (meetings and
 * ordinary tasks alike). An all-day MEETING blocks its whole day; ordinary
 * all-day tasks don't block time. Pass `eventsByDay` (see
 * computeFreeSlotsWithCalendar) to subtract timed device-calendar events too.
 * Today's windows never start in the past. Windows shorter than an hour are
 * dropped.
 */
export function computeFreeSlots(
  tasks: Record<string, Task>,
  settings: Pick<Settings, 'dayStartHour' | 'dayEndHour'>,
  days = 6,
  eventsByDay?: Record<DayKey, CalendarEventLite[]>
): DayFreeSlots[] {
  const dayStart = settings.dayStartHour * 60;
  const dayEnd = settings.dayEndHour * 60;
  const today = todayKey();
  const nowMin = minutesOfDay();

  const out: DayFreeSlots[] = [];
  for (const day of upcomingSlotDays(settings, days)) {
    // Today can't offer windows that already passed — floor at the next
    // quarter hour so the first slot starts at a sane time.
    const floor =
      day === today ? Math.max(dayStart, Math.ceil(nowMin / 15) * 15) : dayStart;
    out.push({
      day,
      slots: freeSlotsForDay(tasks, day, floor, dayEnd, eventsByDay?.[day] ?? []),
    });
  }
  return out;
}

/**
 * computeFreeSlots plus the device calendar: when the user shows calendar
 * events on their timeline, timed events subtract from availability too, so
 * the sheet never offers a window the timeline itself shows as taken.
 * Tasks-only when calendar events are hidden (and effectively so when
 * permission is missing — eventsForDay returns [] then).
 */
export async function computeFreeSlotsWithCalendar(
  tasks: Record<string, Task>,
  settings: Pick<
    Settings,
    'dayStartHour' | 'dayEndHour' | 'showCalendarEvents' | 'hiddenCalendarIds'
  >,
  days = 6
): Promise<DayFreeSlots[]> {
  if (!settings.showCalendarEvents) return computeFreeSlots(tasks, settings, days);
  const dayKeys = upcomingSlotDays(settings, days);
  const perDay = await Promise.all(
    dayKeys.map((d) => eventsForDay(d, settings.hiddenCalendarIds))
  );
  const eventsByDay: Record<DayKey, CalendarEventLite[]> = {};
  dayKeys.forEach((d, i) => {
    eventsByDay[d] = perDay[i];
  });
  return computeFreeSlots(tasks, settings, days, eventsByDay);
}

function freeSlotsForDay(
  tasks: Record<string, Task>,
  day: DayKey,
  windowStart: number,
  windowEnd: number,
  events: CalendarEventLite[]
): FreeSlot[] {
  if (windowEnd - windowStart < MIN_SLOT_MINUTES) return [];

  // Busy intervals from every timed occurrence on this day, clamped to the window.
  const busy: [number, number][] = [];
  for (const t of Object.values(tasks)) {
    if (t.allDay || t.startMinutes == null) {
      // An all-day MEETING books the user out for the whole day (travel,
      // overnight) — offer nothing. Ordinary all-day tasks ("renew
      // registration") are reminders, not time commitments, so they don't
      // block availability.
      if (t.meeting && taskOccursOn(t, day)) return [];
      continue;
    }
    if (!taskOccursOn(t, day)) continue;
    const s = Math.max(t.startMinutes, windowStart);
    const e = Math.min(t.startMinutes + Math.max(0, t.durationMinutes), windowEnd);
    if (e <= s) continue; // outside the window or zero-length
    busy.push([s, e]);
  }

  // Timed device-calendar events block exactly like tasks — the timeline
  // renders them side by side, so availability must agree with what the user
  // sees. All-day calendar events are skipped: they're overwhelmingly
  // birthdays/holidays, not time commitments (all-day blocking is opted into
  // via an all-day meeting task instead).
  for (const e of events) {
    if (e.allDay) continue;
    const s = Math.max(e.startMinutes, windowStart);
    const en = Math.min(e.endMinutes, windowEnd);
    if (en <= s) continue;
    busy.push([s, en]);
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
