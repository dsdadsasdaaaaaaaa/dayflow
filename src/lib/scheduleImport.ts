import type { DayKey } from '../types';
import { todayKey } from './dates';
import { askOnce as askClaudeOnce } from './claude';
import { askOnce as askGeminiOnce } from './gemini';
import { loadBrain, type BrainChoice } from './secretaryBrain';

/**
 * Turning a school's weekly schedule email into a week of DayFlow.
 *
 * Every school writes these differently — a table, a list, a wall of prose —
 * and the format changes whenever someone redesigns the newsletter. A parser
 * written against one shape breaks silently the first time that happens, and
 * a silent break here means missing a class. So the reading is done by the
 * model the user has already connected, and the checking is done here: every
 * field is validated on device, and anything that fails is dropped rather
 * than guessed at.
 *
 * Nothing is created without being shown first. The model is reading an
 * email, which is exactly the kind of input that can be wrong or hostile,
 * so its output is a PROPOSAL — the import screen is the confirmation.
 *
 * Unlike the secretary this does not pseudonymize: a timetable is the user's
 * own school week, with no client, number or message in it. If that ever
 * stops being true, this is the comment that was wrong.
 */

/** One class or event the model found. Dates are already resolved. */
export interface ParsedEvent {
  title: string;
  date: DayKey;
  /** Minutes from midnight, or null for an all-day item. */
  startMinutes: number | null;
  durationMinutes: number;
  location: string;
  notes: string;
}

export type ScheduleParse =
  | { ok: true; events: ParsedEvent[]; dropped: number }
  /**
   * `announcement` means the email was read fine and simply had no timetable
   * in it. The school sends notices from the same address as the schedule,
   * so this is a normal outcome, not a failure, and must not be reported as
   * one — an error where nothing is wrong teaches people to ignore errors.
   */
  | { ok: false; error: string; announcement?: boolean };

/** Longest email accepted. Beyond this the tail is almost always footer. */
const MAX_INPUT = 24_000;

function instruction(today: DayKey, weekday: string, zone: string): string {
  return [
    "You read a school's newsletter email and return the dated schedule it contains as JSON.",
    `Today is ${weekday} ${today} in the ${zone} timezone.`,
    '',
    'WHERE THE SCHEDULE IS. These newsletters carry one or more week GRIDS, under headings',
    "like \"Next Week's Schedule\" or \"Looking Ahead\". A grid has a row of day headings",
    '("Monday, September 7", "Tuesday, September 8", ...) and, under each, that day\'s entries.',
    'Take every such grid in the email, not only the first: the later ones are real weeks too.',
    'A cell may hold several separate entries; each one is its own event.',
    '',
    'HOW THE GRID ARRIVES. The email is flattened to text before you see it, and the flattening',
    'keeps the table: ONE LINE PER TABLE ROW, cells separated by " | ", and entries within one',
    'cell separated by "; ". So a grid reaches you looking like',
    '  Monday, September 7 | Tuesday, September 8 | Wednesday, September 9',
    '  Labour Day: School Closed | First Day of School: Special Schedule; 2:25 PM Dismissal | Welcome Back Carnival',
    'and the third cell of a row belongs to the third day of the heading row. Count the',
    'separators rather than guessing: a miscount puts a test on the wrong day. An EMPTY cell',
    '("A | | C") is a day with nothing on it, not a missing separator — keep counting past it.',
    'If a row has fewer cells than the heading has days, the last days have nothing on them.',
    '',
    'WHAT TO IGNORE. Everything outside those grids. School newsletters are mostly prose —',
    'welcome notes, spotlights, fundraising, athletics, registration links, sign-offs, footers.',
    'None of it belongs in a calendar even when it mentions a date in passing. An event only',
    'counts if it appears inside a week grid, under a day.',
    '',
    'THE SAME ADDRESS ALSO SENDS PURE ANNOUNCEMENTS. If this email has no week grid at all,',
    'return [] and nothing else. That is a correct answer, not a failure.',
    '',
    'Return ONLY a JSON array, no prose and no code fence. Each element:',
    '{"title": string, "date": "YYYY-MM-DD", "startMinutes": number|null, "durationMinutes": number, "location": string, "notes": string}',
    '',
    'Rules:',
    '- date comes from the day heading the entry sits under. The heading gives a weekday and',
    '  a month/day; take the year from the email itself, minding a December-to-January roll.',
    '- title is the entry EXACTLY as the school wrote it, e.g. "Labour Day: School Closed",',
    '  "2:25 PM Dismissal", "Curriculum Night (7:30 PM)". Keep their words and keep any time',
    '  written into them. A person recognises the school\'s own wording, and the written time',
    '  is checked against yours afterwards.',
    '- startMinutes is minutes from midnight when the entry names a time. Add 12 hours for',
    '  every PM time except noon itself: 7:30 PM is 19:30 = 1170, NOT 1050. "2:25 PM',
    '  Dismissal" is 865, "3:08 PM Dismissal" is 908, "10:30 AM Start" is 630, "Noon',
    '  Dismissal" is 720, "12:30 AM" is 30. Use null when the entry names no time at all,',
    '  which is normal for "School Closed" or "No Assessment Day".',
    '- durationMinutes: 30 for a dismissal or a start time, 60 for anything else timed, 60',
    '  when there is no time.',
    '- location is a room or place if the entry names one, otherwise "".',
    '- notes is "" unless the grid says something extra worth keeping.',
    '- Never invent an entry. A missing one is recoverable; an invented one is not.',
  ].join('\n');
}

/**
 * Read JSON out of an answer, however it arrived.
 *
 * Models are told to return a bare array and mostly do. The failures are all
 * packaging rather than content — a code fence, a sentence of preamble, the
 * array wrapped in an object, a trailing comma — and throwing away a correct
 * schedule because of the wrapper it came in is its own bug.
 */
export function extractJson(text: string): unknown {
  const attempts: string[] = [];
  const trimmed = text.trim();
  attempts.push(trimmed);

  // ```json ... ``` and friends.
  const fenced = /```(?:json|javascript)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) attempts.push(fenced[1].trim());

  // The outermost array, wherever it starts.
  const open = trimmed.indexOf('[');
  const close = trimmed.lastIndexOf(']');
  if (open >= 0 && close > open) attempts.push(trimmed.slice(open, close + 1));

  // An object with the array inside it, e.g. {"events": [...]}.
  const objOpen = trimmed.indexOf('{');
  const objClose = trimmed.lastIndexOf('}');
  if (objOpen >= 0 && objClose > objOpen) attempts.push(trimmed.slice(objOpen, objClose + 1));

  for (const candidate of attempts) {
    for (const body of [candidate, candidate.replace(/,\s*([\]}])/g, '$1')]) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      if (Array.isArray(parsed)) return parsed;
      // One array inside an object is the answer; anything else is not.
      if (parsed && typeof parsed === 'object') {
        const arrays = Object.values(parsed as Record<string, unknown>).filter(Array.isArray);
        if (arrays.length === 1) return arrays[0];
      }
    }
  }
  return null;
}

/** The first line or so of an answer, for an error that can be acted on. */
function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
}

/** Is this a real calendar date, not just four digits and two dashes? */
function isRealDate(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d, 12);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/**
 * The clock time written in an entry's own text, in minutes from midnight.
 *
 * The school's words are the ground truth, and reading a 12-hour clock is
 * the one part of this a model reliably gets wrong — a PM time landing
 * twelve hours early looks completely plausible in a list and puts an
 * evening event in the middle of the school day. So where the entry says
 * the time out loud, that is what gets used, and the model's arithmetic is
 * only consulted when the entry does not.
 */
export function timeInText(text: string): number | null {
  if (/\bnoon\b/i.test(text) && !/\d/.test(text)) return 12 * 60;
  const match = /\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(text);
  if (match) {
    const hour12 = Number(match[1]);
    const minutes = Number(match[2] ?? '0');
    const pm = /^p/i.test(match[3]);
    // 12 AM is midnight and 12 PM is noon; every other PM hour gains twelve.
    const hour = hour12 === 12 ? (pm ? 12 : 0) : pm ? hour12 + 12 : hour12;
    return hour * 60 + minutes;
  }
  if (/\bnoon\b/i.test(text)) return 12 * 60;
  return null;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Keep only entries that are entirely well-formed.
 *
 * Exported because it, not the model, is what makes this safe to run on an
 * email: it is the thing worth testing.
 *
 * Deliberately strict, and deliberately silent about what it rejected beyond
 * a count. A half-understood class — right name, invented time — is worse
 * than a missing one, because a missing one is visibly missing.
 */
export function validateEvents(raw: unknown): { events: ParsedEvent[]; dropped: number } {
  if (!Array.isArray(raw)) return { events: [], dropped: 0 };
  const events: ParsedEvent[] = [];
  let dropped = 0;
  for (const row of raw.slice(0, 200)) {
    if (!row || typeof row !== 'object') {
      dropped++;
      continue;
    }
    const r = row as Record<string, unknown>;
    const title = str(r.title, 80);
    const date = str(r.date, 10);
    if (!title || !isRealDate(date)) {
      dropped++;
      continue;
    }
    // A title that is nothing but a clock time is a line break landing in the
    // wrong place, not an event. "(7:00 PM)" on its own names nothing, and
    // putting it on the calendar would be worse than losing it. Counted as
    // letters rather than as a run of them, so "P.E." still passes.
    const named = title
      .replace(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, '')
      .replace(/\bnoon\b/gi, '')
      .replace(/[^a-z]/gi, '');
    if (named.length < 2) {
      dropped++;
      continue;
    }
    const rawStart = r.startMinutes;
    const timed = typeof rawStart === 'number' && Number.isFinite(rawStart);
    if (rawStart != null && !timed) {
      dropped++;
      continue;
    }
    const startMinutes = timed ? Math.round(rawStart as number) : null;
    if (startMinutes != null && (startMinutes < 0 || startMinutes > 1439)) {
      dropped++;
      continue;
    }
    // Where the entry states its own time, believe the entry.
    const written = timeInText(title);
    const settled = written ?? startMinutes;
    const rawDuration = typeof r.durationMinutes === 'number' ? r.durationMinutes : 60;
    const durationMinutes = Math.min(1440, Math.max(5, Math.round(rawDuration) || 60));
    events.push({
      title,
      date,
      startMinutes: settled,
      durationMinutes,
      location: str(r.location, 120),
      notes: str(r.notes, 400),
    });
  }
  // Same class listed twice in one email is the email's problem, not a
  // reason to put it on the day twice.
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.date}|${e.startMinutes ?? 'all'}|${e.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    events: unique.sort((a, b) =>
      a.date === b.date
        ? (a.startMinutes ?? -1) - (b.startMinutes ?? -1)
        : a.date < b.date
          ? -1
          : 1
    ),
    dropped,
  };
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "Monday, September 7" -> { month: 8, day: 7 }, or null if it is not a day heading. */
function dayHeading(cell: string): { month: number; day: number } | null {
  const clean = cell.replace(/[;|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const match = /^([a-z]+)\.?,?\s+([a-z]+)\.?\s+(\d{1,2})\b/.exec(clean);
  if (!match) return null;
  if (!WEEKDAYS.some((d) => d.startsWith(match[1]) && match[1].length >= 3)) return null;
  const month = MONTHS.findIndex((m) => m.startsWith(match[2]) && match[2].length >= 3);
  if (month < 0) return null;
  const day = Number(match[3]);
  return day >= 1 && day <= 31 ? { month, day } : null;
}

/** A dismissal or a start time is a moment; everything else gets an hour. */
function durationFor(title: string): number {
  return /\b(dismissal|start)\b/i.test(title) ? 30 : 60;
}

/**
 * Read the grid without asking anyone.
 *
 * Once the email has been flattened the schedule is not prose any more: it
 * is a heading row of dates and an entry row beneath it, cells separated by
 * "|" and entries within a cell by ";". That is a table, and reading a table
 * is arithmetic rather than judgement — so in the ordinary case this does it
 * outright, with no model, no network and nothing to be plausibly wrong
 * about. The model stays for the case this cannot recognise, which is where
 * judgement was actually needed.
 *
 * Returns [] when it cannot see a grid it trusts, which is the signal to ask.
 */
export function readScheduleGrid(text: string, today: DayKey = todayKey()): ParsedEvent[] {
  const lines = text.split('\n');
  const emailYear = Number(/\b(20\d{2})\b/.exec(text)?.[1]) || Number(today.slice(0, 4));
  const out: ParsedEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('|');
    if (cells.length < 3) continue;
    const days = cells.map(dayHeading);
    // A row of dates, not a layout table that happens to have three columns.
    if (days.filter(Boolean).length < 3) continue;

    // The entries sit on the next line with content. A grid whose entry row
    // is missing is a heading with nothing under it, which is not an error.
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) break;
    const entryCells = lines[j].split('|');
    // Another heading row means this week simply had nothing scheduled.
    if (entryCells.map(dayHeading).filter(Boolean).length >= 3) continue;

    for (let c = 0; c < days.length; c++) {
      const day = days[c];
      const cell = entryCells[c];
      if (!day || !cell) continue;
      // The email names a month and a day but not a year. Take the year from
      // the email, and roll forward when that would put a September notice
      // about January in the past — a newsletter is always about what is
      // coming, never about ten months ago.
      let year = emailYear;
      const asKey = (y: number) =>
        `${y}-${String(day.month + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
      if (asKey(year) < today) {
        const monthsBack = (Number(today.slice(5, 7)) - 1 - day.month + 12) % 12;
        if (monthsBack > 6) year += 1;
      }
      for (const entry of cell.split(';')) {
        const title = entry.replace(/\s+/g, ' ').trim();
        if (!title) continue;
        out.push({
          title,
          date: asKey(year),
          // Left for the validator to fill from the entry's own words, which
          // is the same clock every other path is held to.
          startMinutes: null,
          durationMinutes: durationFor(title),
          location: '',
          notes: '',
        });
      }
    }
    i = j;
  }
  return out;
}

/**
 * One question to whichever model is connected, and its answer as text.
 *
 * Shared with the timetable reader: both are "read this table, give me
 * JSON", and the part worth having in one place is the transport — the
 * key, the timeout, the two vendors' differing shapes — not the prompt.
 */
export async function askModel(
  system: string,
  user: string,
  brain?: BrainChoice | null,
  document?: { mime: string; data: string }
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const chosen = brain ?? (await loadBrain());
  if (!chosen) {
    return {
      ok: false,
      error: 'Connect Claude or Gemini in Settings first — reading this needs one of them.',
    };
  }
  // Note what is NOT here: a model id. Naming one is how this feature would
  // quietly die — the id gets copied from documentation, the vendor retires
  // it, and months later the import stops working with no visible cause.
  // Both clients already walk a list of ids and fall back to asking the API
  // what it actually serves; this borrows that rather than repeating it.
  return chosen.id === 'claude'
    ? askClaudeOnce(chosen.apiKey, system, user, { json: true, document })
    : askGeminiOnce(chosen.apiKey, system, user, { json: true, document });
}

/**
 * Read a schedule email into events. Nothing is created here.
 *
 * `brain` is only passed by tests and the background job; normally it is
 * whichever model the user has already connected for the secretary.
 */
export async function parseScheduleEmail(
  email: string,
  brain?: BrainChoice | null
): Promise<ScheduleParse> {
  const text = email.trim();
  if (!text) return { ok: false, error: 'There was nothing in that email to read.' };

  const today = todayKey();
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const system = instruction(today, weekday, zone);
  const input = text.slice(0, MAX_INPUT);

  const asked = await askModel(system, input, brain);
  if (!asked.ok) return { ok: false, error: asked.error };

  let raw = extractJson(asked.text);
  if (raw == null) {
    // One retry, saying plainly what was wrong with the last answer. Models
    // fix this immediately when told; failing the whole import over a
    // sentence of preamble would be a waste of a correct reading.
    const again = await askModel(
      `${system}\n\nYour previous answer was not valid JSON. Reply with the JSON array ALONE: no explanation, no code fence, nothing before the "[" or after the "]".`,
      input,
      brain
    );
    if (again.ok) raw = extractJson(again.text);
    if (raw == null) {
      return {
        ok: false,
        // Quoting it, because "that was not a schedule" is unactionable —
        // whether the model refused, asked a question or ran out of room is
        // the whole diagnosis, and it was being thrown away.
        error: `The model did not answer with a schedule. It said: "${snippet(
          again.ok ? again.text : asked.text
        )}"`,
      };
    }
  }
  const { events, dropped } = validateEvents(raw);
  if (events.length === 0) {
    // An empty array that lost nothing on the way is the model saying there
    // was no schedule here, which for this sender is an ordinary week.
    if (Array.isArray(raw) && raw.length === 0) {
      return {
        ok: false,
        announcement: true,
        error: 'No schedule in this one — it looks like an announcement rather than a timetable.',
      };
    }
    return {
      ok: false,
      error:
        dropped > 0
          ? 'Nothing in that email survived checking. Paste just the schedule part and try again.'
          : 'No dated schedule found in that email.',
    };
  }
  return { ok: true, events, dropped };
}
