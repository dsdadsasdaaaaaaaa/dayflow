import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { fromDayKey, minutesOfDay, toDayKey } from './dates';
import type { CalendarEventLite, DayKey } from '../types';

export interface DeviceCalendar {
  id: string;
  title: string;
  color: string;
}

export async function ensureCalendarPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Calendar.getCalendarPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Calendar.requestCalendarPermissionsAsync();
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
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
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
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const visible = cals.filter((c) => !hiddenCalendarIds.includes(c.id));
    if (visible.length === 0) return empty;
    const colorById = new Map(visible.map((c) => [c.id, c.color ?? '#6366F1']));

    const sorted = [...days].sort();
    const start = fromDayKey(sorted[0]);
    const end = fromDayKey(sorted[sorted.length - 1]);
    end.setHours(23, 59, 59, 999);

    const events = await Calendar.getEventsAsync(
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
      const last = toDayKey(en);
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
