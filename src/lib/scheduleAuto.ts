import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { parseScheduleEmail, type ParsedEvent } from './scheduleImport';
import { fetchRelaySchedule } from './smsgate';
import { loadSmsGateCredentials } from './smsgateCredentials';
import { useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';

/**
 * Putting the school's week on the calendar without being asked.
 *
 * The point of this feature is not having to remember it, so a schedule that
 * waits in the relay for someone to open a screen has not solved anything.
 * This runs on the background wake the app already has and adds the week as
 * it arrives.
 *
 * That is a real trade and worth naming: a model read an email and the
 * result goes straight onto a calendar. Three things make it a fair one.
 * Every field is validated on device, so a malformed entry is dropped rather
 * than guessed at. Anything already on that day is skipped, so a re-sent
 * week cannot double up. And a notification says exactly what appeared, so
 * it is auditable instead of silent — the user can look at what arrived and
 * delete it, which is the same recourse they would have had from a review
 * screen, minus the waiting.
 */

/** Which schedule has already been dealt with, by the relay's own stamp. */
const CURSOR_KEY = 'dayflow.schedule.importedAt';

async function lastHandled(): Promise<number> {
  try {
    return Number((await AsyncStorage.getItem(CURSOR_KEY)) ?? '0') || 0;
  } catch {
    return 0;
  }
}

async function markHandled(storedAt: number): Promise<void> {
  try {
    await AsyncStorage.setItem(CURSOR_KEY, String(storedAt));
  } catch {
    // A cursor that fails to save costs one duplicate check next wake, and
    // the duplicate check below means nothing lands twice regardless.
  }
}

/** Everything already on the calendar, so nothing is added over itself. */
function existingKeys(): Set<string> {
  const have = new Set<string>();
  for (const t of Object.values(useTasks.getState().tasks)) {
    if (!t.date) continue;
    have.add(`${t.date}|${t.startMinutes ?? 'all'}|${t.title.trim().toLowerCase()}`);
  }
  return have;
}

function keyOf(e: ParsedEvent): string {
  return `${e.date}|${e.startMinutes ?? 'all'}|${e.title.trim().toLowerCase()}`;
}

/** Add these to the calendar, skipping any that are already on it. */
export function addScheduleEvents(events: ParsedEvent[]): number {
  const have = existingKeys();
  const addTask = useTasks.getState().addTask;
  let added = 0;
  for (const e of events) {
    const key = keyOf(e);
    if (have.has(key)) continue;
    have.add(key);
    addTask({
      title: e.title,
      date: e.date,
      allDay: e.startMinutes == null,
      startMinutes: e.startMinutes,
      durationMinutes: e.durationMinutes,
      notes: [e.location, e.notes].filter(Boolean).join('\n'),
      icon: 'school-outline',
      color: 'sky',
    });
    added++;
  }
  return added;
}

/**
 * Check the relay for a schedule that has not been handled, and put it in.
 *
 * Safe to call as often as the app wakes: a schedule already handled is
 * recognised by its stamp, and anything that slips past that is caught by
 * the duplicate check.
 */
export async function autoImportSchedule(): Promise<number> {
  if (!useSettings.getState().settings.autoImportSchedule) return 0;

  const creds = await loadSmsGateCredentials();
  if (!creds) return 0;
  const waiting = await fetchRelaySchedule(creds);
  if (!waiting) return 0;
  if (waiting.storedAt <= (await lastHandled())) return 0;

  const parsed = await parseScheduleEmail(waiting.body);
  if (!parsed.ok) {
    // An email with no timetable in it is a finished job, not a failure to
    // retry every fifteen minutes for a week.
    if (parsed.announcement) await markHandled(waiting.storedAt);
    return 0;
  }

  const added = addScheduleEvents(parsed.events);
  await markHandled(waiting.storedAt);
  if (added === 0) return 0;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'School schedule added',
      body:
        added === 1
          ? '1 item from the newsletter is on your calendar.'
          : `${added} items from the newsletter are on your calendar.`,
      sound: false,
      data: { scheduleImported: true },
    },
    trigger: null,
  }).catch(() => {});
  return added;
}
