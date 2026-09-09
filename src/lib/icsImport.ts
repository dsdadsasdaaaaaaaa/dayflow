import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DayKey } from '../types';
import { addScheduleEvents } from './scheduleAuto';
import type { ParsedEvent } from './scheduleImport';
import { timeInText } from './scheduleImport';
import { applySchoolDayRules, deriveDayRules, isRuleMarker, rememberDayRules } from './schoolDay';
import { useSettings } from '../store/settings';

/**
 * The school's own year calendar, as a file rather than a weekly email.
 *
 * Edsby exports one .ics with every closure, early bell, late start,
 * special-schedule day and test through June. The newsletter says the same
 * things one week at a time; this says all of them at once, so the day a
 * timetable is imported it can already know that Labour Day is shut and the
 * Friday before Rosh Hashanah ends at noon.
 *
 * No model reads this. It is a fixed format and a fixed format deserves a
 * parser, not a guess. The words in each entry are still read for what they
 * mean ("3:08 Closing" is an early bell, "PD Day - No classes" is a
 * closure), and the same day rules the newsletter produces are produced
 * here, so the two agree by construction.
 */

export interface IcsEvent {
  uid: string;
  title: string;
  /** Local day the event falls on. Multi-day entries are expanded, one per day. */
  date: DayKey;
  /** Minutes from midnight in the device's zone, null for an all-day item. */
  startMinutes: number | null;
  /** Minutes; all-day items get a full day. */
  durationMinutes: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dayKeyOf(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** P3D, PT3600S, PT1H30M and so on, in minutes. */
export function parseDuration(text: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (!m) return null;
  const [, w, d, h, min, s] = m.map((x) => (x == null ? 0 : Number(x)));
  return w * 7 * 1440 + d * 1440 + h * 60 + min + Math.round(s / 60);
}

/** Unfold continuation lines and unescape the handful of sequences ICS uses. */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function unescape(v: string): string {
  return v
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every VEVENT in the file, one entry per local day it covers.
 *
 * Times come as UTC (`...Z`) and are turned into the device's clock, which
 * is the school's clock too. A floating time with no zone is taken as local.
 * A date with no time is an all-day entry and stays on that date regardless
 * of zone, which is the one case where converting would be a bug.
 */
export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) out.push(...eventsOf(cur));
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(';')[0].toUpperCase();
    cur[key] = line.slice(colon + 1);
  }
  return out;
}

function eventsOf(v: Record<string, string>): IcsEvent[] {
  const title = unescape(v.SUMMARY ?? '');
  const start = v.DTSTART ?? '';
  if (!title || !start) return [];
  const uid = v.UID ?? `${start}|${title}`;

  // All day: YYYYMMDD, spanning DURATION days (or until DTEND).
  if (/^\d{8}$/.test(start)) {
    let days = 1;
    if (v.DURATION) days = Math.max(1, Math.round((parseDuration(v.DURATION) ?? 1440) / 1440));
    else if (/^\d{8}$/.test(v.DTEND ?? '')) {
      days = Math.max(1, Math.round((ymd(v.DTEND) - ymd(start)) / 86_400_000));
    }
    const first = new Date(ymd(start));
    const list: IcsEvent[] = [];
    for (let i = 0; i < Math.min(days, 31); i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, 12);
      list.push({ uid, title, date: dayKeyOf(d), startMinutes: null, durationMinutes: 1440 });
    }
    return list;
  }

  const at = dateTime(start);
  if (!at) return [];
  let minutes: number | null = v.DURATION ? parseDuration(v.DURATION) : null;
  if (minutes == null && v.DTEND) {
    const end = dateTime(v.DTEND);
    if (end) minutes = Math.round((end.getTime() - at.getTime()) / 60_000);
  }
  return [
    {
      uid,
      title,
      date: dayKeyOf(at),
      startMinutes: at.getHours() * 60 + at.getMinutes(),
      durationMinutes: Math.min(1440, Math.max(5, minutes ?? 60)),
    },
  ];
}

/** Local midnight of a YYYYMMDD, as a timestamp. */
function ymd(s: string): number {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), 12).getTime();
}

function dateTime(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, z] = m;
  const n = (x: string | undefined) => Number(x ?? '0');
  return z
    ? new Date(Date.UTC(n(y), n(mo) - 1, n(d), n(h), n(mi), n(se)))
    : new Date(n(y), n(mo) - 1, n(d), n(h), n(mi), n(se));
}

// ---------------------------------------------------------------------------
// What the entries mean
// ---------------------------------------------------------------------------

/**
 * Entries that are about someone else, or about nothing.
 *
 * A school calendar carries the whole school's year: summer school, timetable
 * conflict days for each grade, parent evenings, eight separate "Hanukkah: N
 * candles". None of it is wrong, but on a personal calendar it is noise that
 * hides the closures. This list is short on purpose; anything not on it is
 * kept, because an entry wrongly dropped is invisible and an entry wrongly
 * kept is one tap to delete.
 */
const NOISE =
  /\b(summer school|timetable conflicts|daylight savings?|parent|p\/t|pt conferences|donor|custodian|bar mitzvah|club head|everyone's bday|wine and cheese)\b|candles?\b|(grade|gr\.?)\s*9(?!\s*[-–]\s*1)/i;

/**
 * "3:08 Closing" has no am or pm, and a school does not close at eight past
 * three in the morning. Any hour before seven with no meridiem is afternoon.
 */
export function schoolTimeInText(text: string): number | null {
  const said = timeInText(text);
  if (said != null) return said;
  const m = /\b(1[0-2]|0?[1-9]):([0-5][0-9])\b/.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  return (hour < 7 ? hour + 12 : hour) * 60 + Number(m[2]);
}

const DISMISSAL = /\b(dismissal|closing)\b/i;
const START = /\bstart\b/i;

/**
 * Turn the file's entries into the same shape the newsletter produces, so
 * one set of rules applies to both.
 *
 * For a timed early bell the file already says exactly when the day ends —
 * the entry runs from first bell to dismissal — so the end is used outright.
 * A timed late start likewise gives the real first bell. Everything else
 * keeps its own time, and rule markers become all-day notes on the day.
 */
export function toScheduleEvents(events: readonly IcsEvent[]): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const e of events) {
    // A rule about the day's hours is never noise, whoever it mentions:
    // "P/T 12:40 Closing" ends the school day for students too.
    if (NOISE.test(e.title) && !isRuleMarker(e.title)) continue;
    let startMinutes = e.startMinutes;
    if (DISMISSAL.test(e.title)) {
      startMinutes =
        schoolTimeInText(e.title) ??
        (e.startMinutes != null ? e.startMinutes + e.durationMinutes : null);
    } else if (START.test(e.title)) {
      startMinutes = schoolTimeInText(e.title) ?? e.startMinutes;
    }
    out.push({
      title: e.title,
      date: e.date,
      startMinutes,
      durationMinutes: e.startMinutes == null ? 1440 : e.durationMinutes,
      location: '',
      notes: '',
    });
  }
  return out;
}

export interface CalendarImport {
  read: number;
  added: number;
  closures: number;
  amended: { skipped: number; shortened: number; days: number };
}

/**
 * Put a calendar file on the calendar: the events as school items, and the
 * closures and early bells as day rules that amend the timetable, remembered
 * so a timetable imported later is amended the same way.
 */
export async function importSchoolCalendar(text: string): Promise<CalendarImport> {
  const events = toScheduleEvents(parseIcs(text));
  const added = addScheduleEvents(events);
  const rules = deriveDayRules(events);
  await rememberDayRules(rules);
  const amended = applySchoolDayRules(rules);
  let closures = 0;
  for (const r of rules.values()) if (r.closed) closures++;
  return { read: events.length, added, closures, amended };
}

/** How many of the file's entries are statements about a day's hours. */
export function countRuleMarkers(events: readonly ParsedEvent[]): number {
  return events.filter((e) => isRuleMarker(e.title)).length;
}

// ---------------------------------------------------------------------------
// The subscribed feed
// ---------------------------------------------------------------------------

const FETCHED_KEY = 'dayflow.schoolCalendar.fetchedAt';
/** Once a day is plenty: the year calendar changes a few times a term. */
const REFRESH_MS = 20 * 3_600_000;

/**
 * Fetch the school's calendar link, if one is set and a day has passed.
 *
 * Edsby publishes a subscription link for the same file; keeping it here
 * means a closure the school adds in March lands without anyone exporting
 * anything. Safe on every wake: the file is idempotent to apply.
 */
export async function autoImportSchoolCalendar(): Promise<CalendarImport | null> {
  const url = useSettings.getState().settings.schoolCalendarUrl.trim();
  if (!url) return null;
  try {
    const last = Number((await AsyncStorage.getItem(FETCHED_KEY)) ?? '0') || 0;
    if (Date.now() - last < REFRESH_MS) return null;
  } catch {
    // Unreadable stamp: fetch, which is the safe direction.
  }
  const res = await fetch(url.replace(/^webcal:\/\//i, 'https://'));
  if (!res.ok) throw new Error(`The school calendar link answered ${res.status}.`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('The link did not return a calendar file.');
  const result = await importSchoolCalendar(text);
  try {
    await AsyncStorage.setItem(FETCHED_KEY, String(Date.now()));
  } catch {
    // Costs one extra fetch tomorrow, nothing else.
  }
  return result;
}
