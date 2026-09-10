import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { fromDayKey, minutesOfDay, toDayKey } from './dates';
import type { CalendarEventLite, DayKey } from '../types';

export interface DeviceCalendar {
  id: string;
  title: string;
  color: string;
}

/**
 * Is access already granted? Asks nobody.
 *
 * For the paths that run without a screen in front of them — the widget
 * refresh, the background snapshot push. A permission dialog raised from a
 * background job, with nothing on screen to explain it, is the surest way to
 * earn a permanent refusal, and after that canAskAgain is false and the
 * feature is dead everywhere.
 */
export async function hasCalendarPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await Calendar.getCalendarPermissions()).granted;
  } catch {
    return false;
  }
}

export async function ensureCalendarPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Calendar.getCalendarPermissions();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Calendar.requestCalendarPermissions();
    return req.granted;
  } catch {
    return false;
  }
}

export async function listCalendars(): Promise<DeviceCalendar[]> {
  if (Platform.OS === 'web') return [];
  try {
    const granted = await ensureCalendarPermission();
    if (!granted) return [];
    const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    return cals.map((c) => ({ id: c.id, title: c.title, color: c.color ?? '#6366F1' }));
  } catch {
    return [];
  }
}

/**
 * Events across a span of days, in ONE query, bucketed per day.
 *
 * A day at a time meant a fresh permission check, calendar list and event
 * query for each — seven round trips to draw one week, and the week redrew
 * as each landed. The device is perfectly happy to answer for a range.
 *
 * An event crossing midnight appears in every day it touches, clipped to
 * that day, which is what a day column wants: a flight landing at 1 AM is
 * part of both days and belongs at the top of the second one.
 */
export async function eventsForDays(
  days: readonly DayKey[],
  hiddenCalendarIds: string[]
): Promise<Record<DayKey, CalendarEventLite[]>> {
  const empty: Record<DayKey, CalendarEventLite[]> = {};
  for (const d of days) empty[d] = [];
  if (Platform.OS === 'web' || days.length === 0) return empty;

  try {
    const granted = await ensureCalendarPermission();
    if (!granted) return empty;
    const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    const visible = cals.filter((c) => !hiddenCalendarIds.includes(c.id));
    if (visible.length === 0) return empty;
    const colorById = new Map(visible.map((c) => [c.id, c.color ?? '#6366F1']));

    const sorted = [...days].sort();
    const start = fromDayKey(sorted[0]);
    const end = fromDayKey(sorted[sorted.length - 1]);
    end.setHours(23, 59, 59, 999);

    const events = await Calendar.listEvents(
      visible.map((c) => c.id),
      start,
      end
    );

    const wanted = new Set(days);
    const out = empty;
    for (const e of events) {
      // Hidden means hidden, decided here rather than trusted to the query.
      // The switches in settings are a promise about what leaves the device,
      // and an event from a calendar the user turned off would otherwise
      // have been drawn in a fallback colour rather than dropped.
      if (!colorById.has(e.calendarId)) continue;
      const s = new Date(e.startDate as string | number | Date);
      const en = new Date(e.endDate as string | number | Date);
      const first = toDayKey(s);
      // An event ending exactly at midnight belongs to the day it ran in,
      // not to the one that starts as it finishes. iOS states an all-day
      // event as midnight-to-midnight, so without this every all-day event
      // also claimed the following day, and a 10 PM to midnight event showed
      // up as a zero-length sliver at the top of tomorrow.
      const endsAtMidnight =
        en.getHours() === 0 &&
        en.getMinutes() === 0 &&
        en.getSeconds() === 0 &&
        en.getTime() > s.getTime();
      const last = toDayKey(endsAtMidnight ? new Date(en.getTime() - 1) : en);
      for (const day of wanted) {
        if (day < first || day > last) continue;
        out[day].push({
          id: String(e.id),
          calendarId: e.calendarId,
          title: e.title || 'Untitled event',
          allDay: !!e.allDay,
          startMinutes: e.allDay ? 0 : first < day ? 0 : minutesOfDay(s),
          endMinutes: e.allDay ? 24 * 60 : last > day ? 24 * 60 : minutesOfDay(en),
          color: colorById.get(e.calendarId) as string,
          dateKey: day,
        });
      }
    }
    for (const day of days) {
      out[day].sort((a, b) => a.startMinutes - b.startMinutes);
    }
    return out;
  } catch {
    return empty;
  }
}

/** Events for one local day, excluding hidden calendars. */
export async function eventsForDay(
  day: DayKey,
  hiddenCalendarIds: string[]
): Promise<CalendarEventLite[]> {
  return (await eventsForDays([day], hiddenCalendarIds))[day] ?? [];
}
