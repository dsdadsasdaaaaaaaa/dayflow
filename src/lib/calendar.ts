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

/** Events for one local day, excluding hidden calendars. */
export async function eventsForDay(
  day: DayKey,
  hiddenCalendarIds: string[]
): Promise<CalendarEventLite[]> {
  if (Platform.OS === 'web') return [];
  try {
    const granted = await ensureCalendarPermission();
    if (!granted) return [];
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const visible = cals.filter((c) => !hiddenCalendarIds.includes(c.id));
    if (visible.length === 0) return [];
    const colorById = new Map(visible.map((c) => [c.id, c.color ?? '#6366F1']));

    const start = fromDayKey(day);
    const end = fromDayKey(day);
    end.setHours(23, 59, 59, 999);
    const events = await Calendar.getEventsAsync(
      visible.map((c) => c.id),
      start,
      end
    );

    return events.map((e) => {
      const s = new Date(e.startDate as string | number | Date);
      const en = new Date(e.endDate as string | number | Date);
      const startsBefore = toDayKey(s) < day;
      const endsAfter = toDayKey(en) > day;
      return {
        id: String(e.id),
        calendarId: e.calendarId,
        title: e.title || 'Untitled event',
        allDay: !!e.allDay,
        startMinutes: e.allDay ? 0 : startsBefore ? 0 : minutesOfDay(s),
        endMinutes: e.allDay ? 24 * 60 : endsAfter ? 24 * 60 : minutesOfDay(en),
        color: colorById.get(e.calendarId) ?? '#6366F1',
        dateKey: day,
      };
    });
  } catch {
    return [];
  }
}
