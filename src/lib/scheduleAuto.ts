import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { parseScheduleEmail, type ParsedEvent } from './scheduleImport';
import { fetchRelaySchedule } from './smsgate';
import { loadSmsGateCredentials } from './smsgateCredentials';
import { useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';
import { applySpecialDay, parseBellSchedule, rememberBellSchedule } from './bellSchedule';
import { applySchoolDayRules, deriveDayRules, rememberDayRules } from './schoolDay';
import { isRuleMarker } from './schoolDay';
import { normTitle } from './schoolWords';
import { collapseSchoolDuplicates } from './schoolDuplicates';
import { SCHOOL_TAG } from './timetableImport';

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

/**
 * What happened last time, in a sentence.
 *
 * A background job that fails silently is indistinguishable from one that
 * was never asked to run, and "nothing appeared on my calendar" is not a
 * diagnosis. Every outcome — including the boring ones — gets written down
 * so the import screen can say which of them it was.
 */
const STATUS_KEY = 'dayflow.schedule.lastStatus';

export interface ScheduleStatus {
  at: number;
  text: string;
  ok: boolean;
}

async function note(text: string, ok: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify({ at: Date.now(), text, ok }));
  } catch {
    // Losing the note costs a diagnosis, never a message.
  }
}

/** What the last automatic run did, for the import screen to show. */
export async function lastScheduleStatus(): Promise<ScheduleStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScheduleStatus;
    return typeof parsed?.text === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function lastHandled(): Promise<number> {
  try {
    return Number((await AsyncStorage.getItem(CURSOR_KEY)) ?? '0') || 0;
  } catch {
    return 0;
  }
}

/** Has this relay schedule already been put on the calendar? */
export async function alreadyHandled(storedAt: number): Promise<boolean> {
  return storedAt <= (await lastHandled());
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
    have.add(`${t.date}|${t.startMinutes ?? 'all'}|${normTitle(t.title)}`);
  }
  return have;
}

/**
 * The key an event will have ONCE STORED, not as it arrived.
 *
 * A rule marker is shelved as all-day whatever time it names, so keying the
 * incoming event on its raw time never matched the task already sitting on
 * the calendar: "Noon Dismissal" was re-added every time the year calendar
 * refreshed, roughly once a day, forever.
 */
function keyOf(e: ParsedEvent): string {
  const allDay = e.startMinutes == null || isRuleMarker(e.title);
  return `${e.date}|${allDay ? 'all' : e.startMinutes}|${normTitle(e.title)}`;
}

/**
 * Every bell-schedule sheet that came with the newsletter, read and applied.
 *
 * Returns how many days were rebuilt. A sheet that will not read is skipped
 * rather than failing the import: the grid's own rules have already run,
 * so the day is at worst shortened correctly and not rebuilt precisely.
 */
export async function applyBellSheets(
  attachments: { name: string; mime: string; data: string }[] | undefined
): Promise<{ days: number; failed: number }> {
  let days = 0;
  let failed = 0;
  for (const doc of attachments ?? []) {
    const parsed = await parseBellSchedule({ mime: doc.mime, data: doc.data });
    if (!parsed.ok) {
      failed++;
      continue;
    }
    await rememberBellSchedule(parsed.schedule);
    applySpecialDay(parsed.schedule);
    days++;
  }
  return { days, failed };
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
      allDay: e.startMinutes == null || isRuleMarker(e.title),
      startMinutes: isRuleMarker(e.title) ? null : e.startMinutes,
      durationMinutes: e.durationMinutes,
      notes: [e.location, e.notes].filter(Boolean).join('\n'),
      icon: 'school-outline',
      color: 'sky',
      tags: [SCHOOL_TAG],
    });
    added++;
  }
  // Both sources land here, so this is where a day described twice is
  // noticed. The word-matching above stops the ordinary case; this catches
  // the ones only comparing facts can pair — "2:25 Closing" against
  // "2:25 PM Dismissal".
  if (added > 0) {
    const before = Object.keys(useTasks.getState().tasks).length;
    const collapsed = collapseSchoolDuplicates(useTasks.getState().tasks);
    if (collapsed) {
      useTasks.setState({ tasks: collapsed });
      // Say what is on the calendar, not how many rows were attempted: a
      // notification claiming fifteen when eleven survived is a small lie
      // that makes the import look broken next time somebody counts.
      added = Math.max(0, added - (before - Object.keys(collapsed).length));
    }
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
  if (!creds) {
    await note('The relay is not set up, so there is nowhere to collect a schedule from.', false);
    return 0;
  }
  const waiting = await fetchRelaySchedule(creds);
  if (!waiting) {
    await note('No schedule email has reached the relay yet.', false);
    return 0;
  }
  if (waiting.storedAt <= (await lastHandled())) {
    await note(`Already read "${waiting.subject || 'the last schedule'}".`, true);
    return 0;
  }

  const parsed = await parseScheduleEmail(waiting.body);
  if (!parsed.ok) {
    // An email with no timetable in it is a finished job, not a failure to
    // retry every fifteen minutes for a week.
    if (parsed.announcement) await markHandled(waiting.storedAt);
    await note(parsed.error, parsed.announcement === true);
    return 0;
  }

  const added = addScheduleEvents(parsed.events);

  // The newsletter is an amendment to the timetable, not a second list
  // beside it: a closure or an early bell has to remove the classes that are
  // not happening, or the calendar shows a full day of school on Labour Day.
  const rules = deriveDayRules(parsed.events);
  await rememberDayRules(rules);
  const amended = applySchoolDayRules(rules);
  // Then the sheets, which are more precise than the rules: a rule shortens
  // the day, a sheet says exactly which block runs when.
  const sheets = await applyBellSheets(waiting.attachments);

  await markHandled(waiting.storedAt);
  const amendment =
    (amended.skipped + amended.shortened > 0
      ? ` Cleared ${amended.skipped} class${amended.skipped === 1 ? '' : 'es'} that are not happening` +
        (amended.shortened > 0 ? ` and cut ${amended.shortened} short` : '') +
        `, across ${amended.days} day${amended.days === 1 ? '' : 's'}.`
      : '') +
    (sheets.days > 0
      ? ` Rebuilt ${sheets.days} special-schedule day${sheets.days === 1 ? '' : 's'} from the school's own bell sheets.`
      : '') +
    (sheets.failed > 0 ? ` ${sheets.failed} bell sheet${sheets.failed === 1 ? '' : 's'} could not be read.` : '');
  if (added === 0) {
    await note(
      `Read ${parsed.events.length} item${parsed.events.length === 1 ? '' : 's'}; all were already on your calendar.${amendment}`,
      true
    );
    return 0;
  }
  await note(`Added ${added} item${added === 1 ? '' : 's'} from "${waiting.subject}".${amendment}`, true);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'School schedule added',
      body:
        (added === 1
          ? '1 item from the newsletter is on your calendar.'
          : `${added} items from the newsletter are on your calendar.`) +
        (amended.skipped > 0
          ? ` ${amended.skipped} class${amended.skipped === 1 ? '' : 'es'} removed for closures and early finishes.`
          : ''),
      sound: false,
      data: { scheduleImported: true },
    },
    trigger: null,
  }).catch(() => {});
  return added;
}
