import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DayKey, Task } from '../types';
import { taskOccursOn } from './recurrence';
import { askModel, extractJson, timeInText } from './scheduleImport';
import { isSchoolTask, SCHOOL_TAG, TIMETABLE_TAG } from './timetableImport';
import { useTasks } from '../store/tasks';
import { fromDayKey, todayKey } from './dates';
import { formatClock, parseClockRange, parseSchoolClock } from './clock';
import { storedDayRules } from './schoolDay';
import { isImportedSchool } from './schoolWords';
import {
  isSpecialNotice,
  normalGrid,
  parseBlockOrder,
  planSwappedDay,
  templatesFrom,
  weekdayShape,
  type TimeSource,
} from './specialDays';

/**
 * A day that runs on a different bell.
 *
 * "Special Schedule" in the newsletter is a link, and behind it is a
 * one-page PDF: the periods that run that day, their times, and which BLOCK
 * fills each one. That last column is the part that matters and the part
 * easiest to miss. The school does not run courses in period slots; it runs
 * blocks in period slots, and the timetable is a mapping of block to course.
 * On an ordinary Friday period 4 is block 9, so Physics. On Erev Rosh
 * Hashanah the sheet says period 4 is block 8 — and block 8 is Explore
 * Excellence. Same slot, different class, and a rule that only shortened
 * the day would have put the wrong course on the calendar at the right
 * time.
 *
 * So a special day is rebuilt from the sheet: every normal class that day is
 * set aside, and one entry is created per row of the sheet — the course
 * whose block it names, at the time it gives. What the sheet does not list
 * does not happen.
 */

/** One row of a bell schedule, as read from the sheet. */
export interface BellRow {
  startMinutes: number;
  endMinutes: number;
  /** The block that runs in this slot, when the row names one. */
  block: number | null;
  /** What the row is called when it is not a block: "Lunch", "Break". */
  label: string;
}

export interface BellSchedule {
  date: DayKey;
  title: string;
  rows: BellRow[];
}

export type BellParse =
  | { ok: true; schedule: BellSchedule; notes?: string[] }
  | { ok: false; error: string };

/** Enforced server-side on Claude; see SCHEDULE_SCHEMA for why. */
const BELL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    title: { type: 'string' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startText: { type: 'string' },
          endText: { type: 'string' },
          startMinutes: { type: 'integer' },
          endMinutes: { type: 'integer' },
          block: { type: ['integer', 'null'] },
          label: { type: 'string' },
        },
        required: ['startText', 'endText', 'startMinutes', 'endMinutes', 'block', 'label'],
        additionalProperties: false,
      },
    },
  },
  required: ['date', 'title', 'rows'],
  additionalProperties: false,
};

const SYSTEM = [
  'You read a one-page school bell schedule and return it as JSON.',
  'The page names a date and lists rows of TIME, PERIOD and BLOCK. Some rows are not a',
  'period at all — "Lunch", "10 Minute Break", "Project Support - General" — and carry a',
  'label instead of a block number.',
  '',
  'Return ONLY a JSON object, no prose and no code fence:',
  '{"date": "YYYY-MM-DD", "title": string, "rows": [{"startText": string, "endText": string,',
  ' "startMinutes": number, "endMinutes": number, "block": number|null, "label": string}]}',
  '',
  'Rules:',
  '- date is the date the page names. The year may be omitted on the page; if so take the',
  '  year from the context line you are given.',
  '- startText and endText are the row\'s times COPIED EXACTLY as the page prints them,',
  '  with the am or pm: "8:30 AM", "3:31 PM". Copy the digits; do not round or correct them.',
  '  These are the authority — the app does its own arithmetic from them.',
  '- startMinutes and endMinutes are your reading of those same times in minutes from',
  '  midnight (add 12 hours for PM except noon: 1:25 PM is 805, 12:40 PM is 760, 8:30 AM',
  '  is 510, 2:25 PM is 865). They are checked against the written times.',
  '- block is the number in the BLOCK column, or null for a row that has a label instead.',
  '- label is the row\'s own words when it has no block ("Lunch", "10 Minute Break",',
  '  "Project Support - General"), otherwise "".',
  '- One element per row, in the order printed. Include breaks and lunch; the reader',
  '  decides what to do with them.',
  '- Never invent a row. A missing one is recoverable; an invented one is not.',
].join('\n');

function isRealDate(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const probe = new Date(y, m - 1, d, 12);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/**
 * Keep only rows that describe a real slot. Exported because it, not the
 * model, is what makes this safe to run on a scanned sheet.
 */
/**
 * Most sheets print "Tuesday, September 8" with no year, so the year is the
 * model's to supply, and a wrong one is still a valid date. A sheet filed a
 * year in the past is rebuilt onto a day nobody will look at, then purged
 * from memory as stale — gone without a trace. A sheet describes a day a
 * week or two away, so a date nearly a year off with a far closer reading
 * one year over is that reading.
 */
function nearestPlausibleYear(date: DayKey): DayKey {
  const today = fromDayKey(todayKey()).getTime();
  const away = (d: DayKey) => Math.abs(fromDayKey(d).getTime() - today) / 86_400_000;
  if (away(date) <= 300) return date;
  const year = Number(date.slice(0, 4));
  const closer = [year - 1, year + 1]
    .map((y) => `${y}${date.slice(4)}`)
    .filter(isRealDate)
    .sort((a, b) => away(a) - away(b))[0];
  return closer && away(closer) <= 60 ? closer : date;
}

export function validateBell(raw: unknown, fallbackYear: number): BellSchedule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  let date = typeof r.date === 'string' ? r.date.trim() : '';
  // "September 8" with no year: the sheet often omits it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) === false) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(date) ?? /^(\d{2})-(\d{2})$/.exec(date);
    date = m ? (m.length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${fallbackYear}-${m[1]}-${m[2]}`) : '';
  }
  if (!isRealDate(date)) return null;
  date = nearestPlausibleYear(date);
  const rowsIn = Array.isArray(r.rows) ? r.rows : [];
  const rows: BellRow[] = [];
  for (const row of rowsIn.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue;
    const x = row as Record<string, unknown>;
    // The page's own clock first; the model's minutes are the fallback and
    // the cross-check, never the authority.
    const written = parseClockRange(
      `${typeof x.startText === 'string' ? x.startText : ''} - ${
        typeof x.endText === 'string' ? x.endText : ''
      }`,
      true
    );
    const start = written ? written.start : typeof x.startMinutes === 'number' ? Math.round(x.startMinutes) : NaN;
    const end = written ? written.end : typeof x.endMinutes === 'number' ? Math.round(x.endMinutes) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || start > 1439 || end <= start || end > 1440) continue;
    const block =
      typeof x.block === 'number' && Number.isFinite(x.block) && x.block >= 1 && x.block <= 20
        ? Math.round(x.block)
        : null;
    const label = typeof x.label === 'string' ? x.label.trim().slice(0, 60) : '';
    if (block == null && !label) continue;
    rows.push({ startMinutes: start, endMinutes: end, block, label });
  }
  if (rows.length === 0) return null;
  return {
    date,
    title: typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '',
    rows: rows.sort((a, b) => a.startMinutes - b.startMinutes),
  };
}


/**
 * The second read.
 *
 * These sheets are pictures — the PDFs the newsletter links carry no text
 * layer at all, so every digit on them is OCR, and OCR is where "3:31" became
 * "3:11" on the timetable. One read has no way to know it misread.
 *
 * So the page is read twice by different routes: once as a plain
 * transcription, which asks only for copying and is parsed here in code, and
 * once as structure. Agreement between two independent readings is real
 * evidence; disagreement is a row to distrust, and it is reported rather than
 * averaged away.
 */
const TRANSCRIBE_SYSTEM = [
  'You transcribe a one-page school bell schedule. You do not interpret it.',
  '',
  'Output the table as plain lines, one line per row, top to bottom, with the cells of a',
  'row separated by " | ". Copy the text of each cell EXACTLY as printed, including the',
  'am or pm and the punctuation. Do not convert times, do not reorder, do not fill in a',
  'cell the page leaves empty, do not add a row.',
  '',
  'Make the FIRST line the date the page names, exactly as printed.',
  '',
  'Nothing else: no heading, no explanation, no code fence.',
].join('\n');

/** A transcribed line back into a row, by rule rather than by model. */
export function transcribeRows(text: string): BellRow[] {
  const rows: BellRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;
    const timed = cells.findIndex((c) => parseClockRange(c, true) != null);
    if (timed < 0) continue;
    const span = parseClockRange(cells[timed], true) as { start: number; end: number };
    const rest = cells.filter((_, i) => i !== timed);
    // TIME | PERIOD | BLOCK: the block is the last bare number on the row.
    // A row with words instead — "Lunch", "10 Minute Break" — has no block,
    // and "10 Minute Break" is not the number ten.
    let block: number | null = null;
    const labels: string[] = [];
    for (const cell of rest) {
      const bare = /^\d{1,2}$/.test(cell) ? Number(cell) : null;
      if (bare != null && bare >= 1 && bare <= 20) block = bare;
      else labels.push(cell);
    }
    rows.push({
      startMinutes: span.start,
      endMinutes: span.end,
      block: labels.length > 0 ? null : block,
      label: labels.join(' ').slice(0, 60),
    });
  }
  return rows.sort((a, b) => a.startMinutes - b.startMinutes);
}

/** What a bell schedule cannot be, whoever read it. */
export function bellTrouble(rows: readonly BellRow[]): string[] {
  const out: string[] = [];
  const sorted = [...rows].sort((a, b) => a.startMinutes - b.startMinutes);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const row = sorted[i];
    if (row.startMinutes < prev.endMinutes) {
      out.push(
        `${formatClock(row.startMinutes)} begins before the row above it ends (${formatClock(prev.endMinutes)}).`
      );
    } else if (row.startMinutes - prev.endMinutes > 60) {
      out.push(
        `Nothing between ${formatClock(prev.endMinutes)} and ${formatClock(row.startMinutes)} — a row may be missing.`
      );
    }
  }
  for (const row of sorted) {
    const length = row.endMinutes - row.startMinutes;
    if (row.block != null && (length < 15 || length > 120)) {
      out.push(`A ${length}-minute period at ${formatClock(row.startMinutes)} is not a class.`);
    }
  }
  return out;
}

/**
 * Two readings of one page, reconciled.
 *
 * The transcription is preferred where it stands up structurally: it was
 * copied rather than computed, and this code did the arithmetic. The
 * structured reading is the check on it — and the fallback when the
 * transcription arrives in some shape this cannot parse.
 */
export function reconcileReadings(
  structured: BellRow[],
  transcribed: BellRow[]
): { rows: BellRow[]; notes: string[] } {
  const notes: string[] = [];
  const structuredTrouble = bellTrouble(structured);
  const transcribedTrouble = bellTrouble(transcribed);

  const usable = transcribed.length > 0 && transcribedTrouble.length === 0;
  const rows = usable && transcribed.length >= structured.length ? transcribed : structured;
  const other = rows === transcribed ? structured : transcribed;

  if (other.length > 0) {
    let disagreements = 0;
    for (const row of rows) {
      const twin = other.find((o) => Math.abs(o.startMinutes - row.startMinutes) <= 2);
      if (!twin) {
        disagreements++;
        continue;
      }
      if (Math.abs(twin.endMinutes - row.endMinutes) > 2 || twin.block !== row.block) disagreements++;
    }
    if (disagreements > 0) {
      notes.push(
        `${disagreements} of ${rows.length} rows read differently the second time. ` +
          `Check this day against the sheet.`
      );
    }
  } else {
    notes.push('Only one reading of this sheet came back, so nothing checked it.');
  }
  for (const trouble of rows === transcribed ? transcribedTrouble : structuredTrouble) notes.push(trouble);
  return { rows, notes };
}

/**
 * The blocks a sheet says run, against the blocks the calendar says run.
 *
 * Two independent sources describe the same day: a picture the school links
 * from the newsletter, and a line of text in the year calendar ("Special
 * schedule Blocks 1, 8, 4, 12, 6, 10"). The text was parsed by rule and the
 * picture by OCR, so where they disagree the text is the safer reading — and
 * the sheet still owns the times, which the text does not carry.
 */
export function alignBlocks(
  rows: BellRow[],
  expected: readonly number[] | null
): { rows: BellRow[]; note: string | null } {
  if (!expected || expected.length === 0) return { rows, note: null };
  const classRows = rows.filter((r) => r.block != null);
  const sheetOrder = classRows.map((r) => r.block as number);
  if (sheetOrder.join() === expected.join()) return { rows, note: null };
  if (sheetOrder.length !== expected.length) {
    return {
      rows,
      note:
        `The sheet shows ${sheetOrder.length} classes (blocks ${sheetOrder.join(', ')}) but the ` +
        `calendar says ${expected.length} (blocks ${expected.join(', ')}). The sheet was used.`,
    };
  }
  let i = 0;
  const aligned = rows.map((r) => (r.block != null ? { ...r, block: expected[i++] } : r));
  return {
    rows: aligned,
    note:
      `The sheet read as blocks ${sheetOrder.join(', ')} but the calendar says ` +
      `${expected.join(', ')}. The calendar's order was used with the sheet's times.`,
  };
}


/**
 * The blocks the calendar says run that day, if it says.
 *
 * The year calendar's notice ("Special schedule Blocks 1, 8, 4, 12, 6, 10")
 * is text that was parsed by rule; the sheet is a picture that was read by
 * OCR. Having both is the point — they are independent, so they can check
 * each other.
 */
export function calendarBlockOrder(date: DayKey): number[] | null {
  for (const t of Object.values(useTasks.getState().tasks)) {
    if (t.date !== date || t.recurrence || !isImportedSchool(t)) continue;
    if (t.tags?.includes(TIMETABLE_TAG)) continue;
    if (!isSpecialNotice(t.title)) continue;
    const order = parseBlockOrder(t.title);
    if (order) return order;
  }
  return null;
}

/** Read one bell-schedule document. Nothing is changed here. */
export async function parseBellSchedule(
  doc: { mime: string; data: string },
  /** The blocks the calendar says run that day, when it says. */
  expectedBlocks: readonly number[] | null = null
): Promise<BellParse> {
  const year = new Date().getFullYear();
  const [asked, copied] = await Promise.all([
    askModel(SYSTEM, `The current year is ${year}. Read the attached bell schedule.`, undefined, doc, BELL_SCHEMA),
    askModel(TRANSCRIBE_SYSTEM, 'Transcribe the attached page.', undefined, doc),
  ]);
  if (!asked.ok) return { ok: false, error: asked.error };
  const raw = extractJson(asked.text) ?? extractObject(asked.text);
  const schedule = validateBell(raw, year);
  if (!schedule) {
    return { ok: false, error: 'That document did not read as a bell schedule.' };
  }

  const transcribed = copied.ok ? transcribeRows(copied.text) : [];
  const { rows, notes } = reconcileReadings(schedule.rows, transcribed);
  const checked = alignBlocks(rows, expectedBlocks);
  if (checked.note) notes.push(checked.note);
  return { ok: true, schedule: { ...schedule, rows: checked.rows }, notes };
}

/** The outermost object in an answer, for a reply that is one object rather than an array. */
function extractObject(text: string): unknown {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** The block number a class carries, from its tags. */
export function blockOf(task: Pick<Task, 'tags'>): number | null {
  const tag = task.tags?.find((t) => /^block:\d+$/.test(t));
  return tag ? Number(tag.slice(6)) : null;
}

/** What to create for one row of the sheet. */
export interface PlannedEntry {
  title: string;
  startMinutes: number;
  durationMinutes: number;
  notes: string;
  /** Which block it stands in for, when it is a class. */
  block: number | null;
}

/**
 * Turn a bell schedule into the day's entries, given the timetable.
 *
 * Pure, so the decision that removes a class from someone's day is
 * checkable without a store behind it. `courses` maps a block number to the
 * course that runs in it, from anywhere in the week: a block that never
 * runs on this weekday can still be called on a special day, which is the
 * whole point of the column.
 */
export function planSpecialDay(
  schedule: BellSchedule,
  courses: Map<number, { title: string; notes: string }>
): PlannedEntry[] {
  const out: PlannedEntry[] = [];
  for (const row of schedule.rows) {
    const duration = row.endMinutes - row.startMinutes;
    if (row.block != null) {
      const course = courses.get(row.block);
      out.push({
        // A block with no course in it is a spare, and worth saying so:
        // an empty slot in the band reads as a gap, not as a period.
        title: course?.title ?? 'Spare',
        startMinutes: row.startMinutes,
        durationMinutes: duration,
        notes: course?.notes ?? `Block ${row.block}`,
        block: row.block,
      });
      continue;
    }
    // A ten-minute break is not an entry on anyone's calendar.
    if (/\bbreak\b/i.test(row.label)) continue;
    out.push({
      title: row.label,
      startMinutes: row.startMinutes,
      durationMinutes: duration,
      notes: '',
      block: null,
    });
  }
  return out;
}

const SPECIAL_TAG_PREFIX = 'special:';

/** Block → course, from every timetable class on the calendar. */
export function coursesByBlock(tasks: Record<string, Task>): Map<number, { title: string; notes: string }> {
  const out = new Map<number, { title: string; notes: string }>();
  for (const t of Object.values(tasks)) {
    if (!isSchoolTask(t) || !t.recurrence) continue;
    const block = blockOf(t);
    if (block == null || out.has(block)) continue;
    out.set(block, { title: t.title, notes: t.notes });
  }
  return out;
}

export interface SpecialDayChanges {
  date: DayKey;
  setAside: number;
  created: number;
}

const SOURCE_NOTE: Record<TimeSource, string> = {
  sheet: 'Special schedule · times from the bell sheet',
  template: 'Special schedule · times copied from a day that ran the same way',
  grid: 'Special schedule · the usual bell times',
  estimated: 'Special schedule · times estimated until the bell sheet arrives',
};

/**
 * Rebuild one day from its bell schedule.
 *
 * Idempotent, and quiet when nothing has changed: a day already built from
 * the same plan and the same source is left exactly as it is, so a class
 * ticked off on a special day is not silently unticked by the next wake.
 *
 * Only ever touches the timetable. Returns null when it left the day alone.
 */
export function applySpecialDay(
  schedule: BellSchedule,
  source: TimeSource = 'sheet'
): SpecialDayChanges | null {
  const tag = `${SPECIAL_TAG_PREFIX}${schedule.date}`;
  const sourceTag = `times:${source}`;
  const plan = planSpecialDay(schedule, coursesByBlock(useTasks.getState().tasks));
  const all = Object.values(useTasks.getState().tasks);

  const previous = all.filter((t) => t.tags?.includes(tag));
  const signature = (xs: { title: string; startMinutes: number | null; durationMinutes: number }[]) =>
    xs
      .map((x) => `${x.startMinutes}|${x.durationMinutes}|${x.title}`)
      .sort()
      .join(';');
  if (
    previous.length > 0 &&
    previous.every((t) => t.tags?.includes(sourceTag)) &&
    signature(previous) === signature(plan)
  ) {
    return null;
  }

  // The day is rebuilt from scratch, so two kinds of one-off go: this day's
  // previous build, and any class an ordinary bell rule cut short or split
  // off it. Left in place, the second put Physics at 11:41 beside the
  // Explore Excellence the sheet actually puts there.
  //
  // Removed directly rather than through deleteTask. deleteTask records a
  // deletion as the user's own decision, and the importer honours those by
  // never bringing the entry back.
  const doomed = new Set<string>();
  for (const t of all) {
    if (t.recurrence || t.date !== schedule.date) continue;
    if (t.tags?.includes(tag) || t.tags?.includes(TIMETABLE_TAG)) doomed.add(t.id);
  }
  if (doomed.size > 0) {
    useTasks.setState((s) => {
      const next = { ...s.tasks };
      for (const id of doomed) delete next[id];
      return { tasks: next };
    });
  }

  // The ordinary timetable, set aside for the day. By tag, never by icon:
  // somebody's own "Study for Physics" wears the school icon too.
  let setAside = 0;
  for (const t of Object.values(useTasks.getState().tasks)) {
    if (!t.recurrence || t.startMinutes == null || !t.tags?.includes(TIMETABLE_TAG)) continue;
    if (!taskOccursOn(t, schedule.date)) continue;
    useTasks.getState().skipOccurrence(t.id, schedule.date);
    setAside++;
  }

  for (const entry of plan) {
    useTasks.getState().addTask({
      title: entry.title,
      date: schedule.date,
      allDay: false,
      startMinutes: entry.startMinutes,
      durationMinutes: entry.durationMinutes,
      notes: [entry.notes, SOURCE_NOTE[source]].filter(Boolean).join('\n'),
      icon: 'school-outline',
      color: 'sky',
      tags: [
        SCHOOL_TAG,
        TIMETABLE_TAG,
        tag,
        sourceTag,
        ...(entry.block != null ? [`block:${entry.block}`] : []),
      ],
    });
  }
  return { date: schedule.date, setAside, created: plan.length };
}

/**
 * Every special day from today on, rebuilt from the best evidence there is.
 *
 * Driven by the calendar itself — the "Special schedule Blocks …" notices the
 * year calendar and newsletter put there — rather than by a side cache of
 * sheets alone. That cache is exactly what went missing after the timetable
 * was re-imported, and every special day quietly reverted to an ordinary
 * one. The notices live in the task store with everything else; if the
 * calendar still says a day is special, the day gets rebuilt.
 *
 * Safe to call on every wake: an unchanged day is left alone.
 */
export async function rebuildSpecialDays(): Promise<SpecialDayChanges[]> {
  const today = todayKey();
  const sheets = await loadBells();
  const rules = await storedDayRules();
  const tasks = useTasks.getState().tasks;
  const grid = normalGrid(tasks);
  const templates = templatesFrom(Object.values(sheets));

  const notices = new Map<DayKey, string[]>();
  const support = new Set<DayKey>();
  for (const t of Object.values(tasks)) {
    if (!t.date || t.recurrence || t.date < today || !isImportedSchool(t)) continue;
    if (t.tags?.includes(TIMETABLE_TAG)) continue;
    if (isSpecialNotice(t.title)) notices.set(t.date, [...(notices.get(t.date) ?? []), t.title]);
    if (/\bproject\s+support\b/i.test(t.title)) support.add(t.date);
  }
  for (const day of Object.keys(sheets)) {
    if (day >= today && !notices.has(day)) notices.set(day, []);
  }

  const out: SpecialDayChanges[] = [];
  for (const [date, titles] of [...notices].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sheet = sheets[date];
    if (sheet) {
      const done = applySpecialDay(sheet, 'sheet');
      if (done) out.push(done);
      continue;
    }
    const rule = rules[date] ?? null;
    if (rule?.closed) continue;
    const listedTitle = titles.find((t) => parseBlockOrder(t) != null);
    const listed = listedTitle ? parseBlockOrder(listedTitle) : null;
    const shape = weekdayShape(useTasks.getState().tasks, fromDayKey(date).getDay());
    // A notice with no block list only changes anything when the hours move;
    // otherwise the school has said the day is unusual without saying how,
    // and it is left as it is rather than rebuilt from a guess.
    const hoursMove = rule != null && (rule.startsAt != null || rule.dismissalAt != null);
    const order = listed ?? (hoursMove ? shape.blocks : null);
    if (!order || order.length === 0) continue;
    const planned = planSwappedDay({
      date,
      title: listedTitle ?? titles[0] ?? 'Special schedule',
      order,
      rule,
      grid,
      shape,
      templates,
      projectSupport: support.has(date),
    });
    if (!planned || planned.schedule.rows.length === 0) continue;
    const done = applySpecialDay(planned.schedule, planned.source);
    if (done) out.push(done);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Remembered, so a timetable imported after the newsletter still gets the
// special days, and a re-read of the same newsletter changes nothing.
// ---------------------------------------------------------------------------

const BELLS_KEY = 'dayflow.school.bellSchedules';
const KEEP_DAYS = 120;

async function loadBells(): Promise<Record<DayKey, BellSchedule>> {
  try {
    const raw = await AsyncStorage.getItem(BELLS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<DayKey, BellSchedule>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function rememberBellSchedule(schedule: BellSchedule): Promise<void> {
  const floor = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const all = await loadBells();
  all[schedule.date] = schedule;
  for (const day of Object.keys(all)) if (day < floor) delete all[day];
  try {
    await AsyncStorage.setItem(BELLS_KEY, JSON.stringify(all));
  } catch {
    // Not remembering costs order-independence, never a wrong class.
  }
}

/** Re-apply every special day. Safe whenever the timetable changes. */
export async function applyStoredBellSchedules(): Promise<SpecialDayChanges[]> {
  return rebuildSpecialDays();
}

/** The remembered sheets, by day. */
export async function storedBellSchedules(): Promise<Record<DayKey, BellSchedule>> {
  return loadBells();
}
