import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DayKey, Task } from '../types';
import { taskOccursOn } from './recurrence';
import { askModel, extractJson, timeInText } from './scheduleImport';
import { isSchoolTask, SCHOOL_TAG, TIMETABLE_TAG } from './timetableImport';
import { useTasks } from '../store/tasks';

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

export type BellParse = { ok: true; schedule: BellSchedule } | { ok: false; error: string };

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
          startMinutes: { type: 'integer' },
          endMinutes: { type: 'integer' },
          block: { type: ['integer', 'null'] },
          label: { type: 'string' },
        },
        required: ['startMinutes', 'endMinutes', 'block', 'label'],
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
  '{"date": "YYYY-MM-DD", "title": string, "rows": [{"startMinutes": number, "endMinutes": number, "block": number|null, "label": string}]}',
  '',
  'Rules:',
  '- date is the date the page names. The year may be omitted on the page; if so take the',
  '  year from the context line you are given.',
  '- Times are minutes from midnight. Add 12 hours for PM except noon: 1:25 PM is 805,',
  '  12:40 PM is 760, 8:30 AM is 510, 2:25 PM is 865.',
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
  const rowsIn = Array.isArray(r.rows) ? r.rows : [];
  const rows: BellRow[] = [];
  for (const row of rowsIn.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue;
    const x = row as Record<string, unknown>;
    const start = typeof x.startMinutes === 'number' ? Math.round(x.startMinutes) : NaN;
    const end = typeof x.endMinutes === 'number' ? Math.round(x.endMinutes) : NaN;
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

/** Read one bell-schedule document. Nothing is changed here. */
export async function parseBellSchedule(doc: { mime: string; data: string }): Promise<BellParse> {
  const year = new Date().getFullYear();
  const asked = await askModel(
    SYSTEM,
    `The current year is ${year}. Read the attached bell schedule.`,
    undefined,
    doc,
    BELL_SCHEMA
  );
  if (!asked.ok) return { ok: false, error: asked.error };
  const raw = extractJson(asked.text) ?? extractObject(asked.text);
  const schedule = validateBell(raw, year);
  if (!schedule) {
    return { ok: false, error: 'That document did not read as a bell schedule.' };
  }
  return { ok: true, schedule };
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

/**
 * Rebuild one day from its bell schedule.
 *
 * Idempotent: entries from an earlier run of the same day are removed first,
 * and a class already set aside is not there to set aside again. Only ever
 * touches what the school put there.
 */
export function applySpecialDay(schedule: BellSchedule): SpecialDayChanges {
  const store = useTasks.getState();
  const tag = `${SPECIAL_TAG_PREFIX}${schedule.date}`;
  let setAside = 0;

  // Yesterday's version of this day, if this sheet has been read before.
  for (const t of Object.values(useTasks.getState().tasks)) {
    if (t.tags?.includes(tag)) store.deleteTask(t.id);
  }
  // The ordinary timetable, set aside for the day.
  for (const t of Object.values(useTasks.getState().tasks)) {
    if (!isSchoolTask(t) || !t.recurrence || t.startMinutes == null) continue;
    if (!taskOccursOn(t, schedule.date)) continue;
    store.skipOccurrence(t.id, schedule.date);
    setAside++;
  }
  const plan = planSpecialDay(schedule, coursesByBlock(useTasks.getState().tasks));
  for (const entry of plan) {
    useTasks.getState().addTask({
      title: entry.title,
      date: schedule.date,
      allDay: false,
      startMinutes: entry.startMinutes,
      durationMinutes: entry.durationMinutes,
      notes: entry.notes,
      icon: 'school-outline',
      color: 'sky',
      tags: [
        SCHOOL_TAG,
        TIMETABLE_TAG,
        tag,
        ...(entry.block != null ? [`block:${entry.block}`] : []),
      ],
    });
  }
  return { date: schedule.date, setAside, created: plan.length };
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

/** Re-apply every remembered special day. Safe whenever the timetable changes. */
export async function applyStoredBellSchedules(): Promise<SpecialDayChanges[]> {
  const all = await loadBells();
  return Object.values(all).map(applySpecialDay);
}
