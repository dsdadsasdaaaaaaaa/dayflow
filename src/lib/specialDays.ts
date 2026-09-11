import type { DayKey, Task } from '../types';
import type { BellRow, BellSchedule } from './bellSchedule';
import type { DayRule } from './schoolDay';
import { isSchoolTask, TIMETABLE_TAG } from './schoolWords';

/**
 * Recognising a day whose blocks have been swapped, and working out when it
 * runs.
 *
 * The school runs blocks in period slots, and on a special day it reorders
 * them: "Special schedule Blocks 1, 8, 4, 12, 6, 10" is a Wednesday whose
 * second period is block 8 rather than block 3. The calendar showed the
 * ordinary Wednesday regardless — a spare, Project Support and Physics on a
 * day none of them ran, and no sign of the two blocks that did.
 *
 * Which blocks run, and in what order, is stated outright in the title. That
 * part is certain and is always applied. WHEN they run is only certain from
 * the bell sheet, which arrives with the newsletter the week before; until
 * then the times come from the best evidence available, in this order:
 *
 * 1. template — a remembered sheet of the same shape (same number of blocks,
 *    same first bell, same dismissal). Erev Rosh Hashanah and Erev Sukkot ran
 *    identical bells, so one teaches the other.
 * 2. grid — the ordinary bell, clipped to the day, when it has exactly one
 *    slot per listed block. This is how most swapped days actually run: the
 *    first day of school was the ordinary bell cut at 2:25 with the blocks
 *    reassigned, and the second was the ordinary bell with blocks swapped.
 * 3. estimated — anything else: the ordinary slots filled in order when there
 *    are more slots than blocks, or equal periods squeezed into the day when
 *    there are fewer, which is what the school does for a noon dismissal.
 *
 * Every entry says which of these it came from, and a sheet arriving later
 * replaces the lot. What is never invented is WHICH classes run.
 */

/** Does this title announce a special schedule? */
export function isSpecialNotice(title: string): boolean {
  return /\bspecial\s+schedule\b/i.test(title);
}

/**
 * The blocks a title says will run, in the order it says them.
 *
 * Reads "Blocks  2, 3, 5, 9, 11", "blocks 1, 3, 5, 8", "Blocks 3,5,9,11" and
 * "(Special Schedule Blocks 1, 3, 4, 8)" alike. Null when the title names no
 * blocks, which is a different fact from naming none of them: "Special
 * Schedule" alone says the day is unusual without saying how.
 */
export function parseBlockOrder(title: string): number[] | null {
  const m = /\bblocks?\b\s*[:\-–]?\s*((?:\d{1,2}\s*(?:,|&|\band\b)?\s*)+)/i.exec(title);
  if (!m) return null;
  const blocks = (m[1].match(/\d{1,2}/g) ?? [])
    .map(Number)
    .filter((n) => n >= 1 && n <= 20);
  return blocks.length > 0 ? blocks : null;
}

/** One period of the ordinary bell. */
export interface Slot {
  start: number;
  end: number;
  lunch: boolean;
}

function blockTag(task: Pick<Task, 'tags'>): number | null {
  const tag = task.tags?.find((t) => /^block:\d+$/.test(t));
  return tag ? Number(tag.slice(6)) : null;
}

function isLunch(task: Pick<Task, 'title'>): boolean {
  return /\blunch\b/i.test(task.title);
}

/** The recurring timetable: the ordinary week, and nothing else. */
function ordinaryWeek(tasks: Record<string, Task>): Task[] {
  return Object.values(tasks).filter(
    (t) =>
      isSchoolTask(t) &&
      t.recurrence != null &&
      t.startMinutes != null &&
      t.tags?.includes(TIMETABLE_TAG) === true
  );
}

/**
 * The school's ordinary bell, read off the timetable itself.
 *
 * Every distinct period start across the week, with the end most classes in
 * it share. Learned rather than written down so it follows the timetable: a
 * corrected period time moves the grid with it.
 */
export function normalGrid(tasks: Record<string, Task>): Slot[] {
  const ends = new Map<number, Map<number, number>>();
  const lunches = new Set<number>();
  for (const t of ordinaryWeek(tasks)) {
    const start = t.startMinutes as number;
    const end = start + t.durationMinutes;
    const seen = ends.get(start) ?? new Map<number, number>();
    seen.set(end, (seen.get(end) ?? 0) + 1);
    ends.set(start, seen);
    if (isLunch(t)) lunches.add(start);
  }
  return [...ends]
    .map(([start, seen]) => ({
      start,
      end: [...seen].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0],
      lunch: lunches.has(start),
    }))
    .sort((a, b) => a.start - b.start);
}

/** How an ordinary one of these weekdays runs. */
export interface WeekdayShape {
  /** Its blocks, in the order they run. */
  blocks: number[];
  /** How many of them come before lunch. */
  blocksBeforeLunch: number;
}

/** @param weekday 0 = Sunday … 6 = Saturday, as recurrences store it. */
export function weekdayShape(tasks: Record<string, Task>, weekday: number): WeekdayShape {
  const day = ordinaryWeek(tasks)
    .filter((t) => t.recurrence?.weekdays?.includes(weekday) === true)
    .sort((a, b) => (a.startMinutes as number) - (b.startMinutes as number));
  const lunch = day.find(isLunch);
  const blocks: number[] = [];
  let before = 0;
  for (const t of day) {
    const b = blockTag(t);
    if (b == null) continue;
    blocks.push(b);
    if (!lunch || (t.startMinutes as number) < (lunch.startMinutes as number)) before++;
  }
  return { blocks, blocksBeforeLunch: before };
}

/** A real sheet, remembered as a shape a later day might share. */
export interface Template {
  blockCount: number;
  start: number;
  end: number;
  rows: BellRow[];
  from: DayKey;
}

export function templatesFrom(sheets: readonly BellSchedule[]): Template[] {
  const out: Template[] = [];
  for (const s of sheets) {
    if (s.rows.length === 0) continue;
    const blockCount = s.rows.filter((r) => r.block != null).length;
    if (blockCount === 0) continue;
    out.push({
      blockCount,
      start: s.rows[0].startMinutes,
      end: s.rows[s.rows.length - 1].endMinutes,
      rows: s.rows,
      from: s.date,
    });
  }
  return out;
}

/** Where a day's times came from. A sheet is exact; the rest are not. */
export type TimeSource = 'sheet' | 'template' | 'grid' | 'estimated';

export interface SwapInput {
  date: DayKey;
  title: string;
  /** The blocks that run, in order. */
  order: number[];
  /** A late start or early dismissal on this day, if one is known. */
  rule: Pick<DayRule, 'startsAt' | 'dismissalAt'> | null;
  grid: readonly Slot[];
  shape: WeekdayShape;
  templates: readonly Template[];
  /** The school announced Project Support for this day. */
  projectSupport: boolean;
}

export interface PlannedSwap {
  schedule: BellSchedule;
  source: Exclude<TimeSource, 'sheet'>;
}

const PASSING_GAP = 2;
const MORNING_BREAK = 10;
const LUNCH_MINUTES = 45;

/**
 * Lay a swapped day out in time.
 *
 * Pure, and exported, because this is what decides which class a person is
 * told to be in and when — worth checking against real sheets without a
 * phone in the loop.
 */
export function planSwappedDay(input: SwapInput): PlannedSwap | null {
  const { date, title, order, grid } = input;
  const classSlots = grid.filter((s) => !s.lunch);
  if (order.length === 0 || classSlots.length === 0) return null;
  const lunch = grid.find((s) => s.lunch) ?? null;
  const start = input.rule?.startsAt ?? classSlots[0].start;
  const end = input.rule?.dismissalAt ?? grid[grid.length - 1].end;
  if (end - start < 30) return null;

  // 1. A day that ran the same way before.
  const template = input.templates.find(
    (t) =>
      t.blockCount === order.length &&
      Math.abs(t.start - start) <= 2 &&
      Math.abs(t.end - end) <= 2
  );
  if (template) {
    let i = 0;
    const rows = template.rows.map((r) =>
      r.block != null ? { ...r, block: order[i++] } : { ...r }
    );
    return { source: 'template', schedule: { date, title, rows } };
  }

  // 2 and 3. The ordinary bell, clipped to the day. Project Support takes
  // the period before lunch, as it does every ordinary Wednesday.
  const inDay = grid.filter((s) => s.start >= start && s.end <= end + 1);
  let support: Slot | null = null;
  if (input.projectSupport && lunch) {
    const beforeLunch = inDay.filter((s) => !s.lunch && s.end <= lunch.start + 1);
    support = beforeLunch[beforeLunch.length - 1] ?? null;
  }
  const open = inDay.filter((s) => !s.lunch && s !== support);
  if (open.length >= order.length) {
    const used = new Set(open.slice(0, order.length));
    const rows: BellRow[] = [];
    let i = 0;
    for (const s of inDay) {
      if (s.lunch) {
        rows.push({ startMinutes: s.start, endMinutes: s.end, block: null, label: 'Lunch' });
      } else if (s === support) {
        rows.push({ startMinutes: s.start, endMinutes: s.end, block: null, label: 'Project Support' });
      } else if (used.has(s)) {
        rows.push({
          startMinutes: s.start,
          endMinutes: Math.min(s.end, end),
          block: order[i++],
          label: '',
        });
      }
    }
    // Lunch after the last class is not part of a day that has ended.
    while (rows.length > 0 && rows[rows.length - 1].block == null) rows.pop();
    return {
      // One slot per block is the ordinary bell doing what it always does.
      // Spare slots mean the school has something else in the day that the
      // title does not mention, so the placement is a best guess.
      source: open.length === order.length ? 'grid' : 'estimated',
      schedule: { date, title, rows },
    };
  }

  // 4. Fewer slots than blocks: the school has squeezed the day.
  const rows = compressDay(input, start, end, classSlots[0].start);
  if (rows.length === 0) return null;
  return { source: 'estimated', schedule: { date, title, rows } };
}

type Separator = { kind: 'gap' | 'break' | 'lunch'; minutes: number };

/**
 * Equal periods filling the day, the way the school shortens one.
 *
 * Reproduces the noon dismissals exactly — four 49-minute periods, two
 * minutes between them and the ten-minute break after the second — because
 * that is the pattern they follow. A late start is an honest approximation:
 * the school moved lunch and trimmed Project Support on the one it
 * published, and neither is predictable from anything else.
 */
function compressDay(input: SwapInput, start: number, end: number, normalStart: number): BellRow[] {
  const { order, shape, projectSupport } = input;
  type Period = { block: number | null; label: string };
  const beforeCount = Math.min(order.length, shape.blocksBeforeLunch);
  const before: Period[] = order.slice(0, beforeCount).map((b) => ({ block: b, label: '' }));
  const after: Period[] = order.slice(beforeCount).map((b) => ({ block: b, label: '' }));
  if (projectSupport) before.push({ block: null, label: 'Project Support' });
  const periods = [...before, ...after];
  if (periods.length === 0) return [];

  const hasLunch = after.length > 0;
  // The morning break sits after the second period on a day that starts on
  // time. A late start has already swallowed it.
  const morningBreak = Math.abs(start - normalStart) <= 10 && before.length >= 3;

  const seps: Separator[] = [];
  for (let i = 0; i < periods.length - 1; i++) {
    if (hasLunch && i === before.length - 1) seps.push({ kind: 'lunch', minutes: LUNCH_MINUTES });
    else if (morningBreak && i === 1) seps.push({ kind: 'break', minutes: MORNING_BREAK });
    else seps.push({ kind: 'gap', minutes: PASSING_GAP });
  }
  const fixed = seps.reduce((sum, s) => sum + s.minutes, 0);
  const available = end - start - fixed;
  // Periods under twenty minutes are not a school day, they are a mistake.
  if (available < periods.length * 20) return [];

  const base = Math.floor(available / periods.length);
  let extra = available - base * periods.length;
  const rows: BellRow[] = [];
  let at = start;
  periods.forEach((p, i) => {
    const length = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    rows.push({ startMinutes: at, endMinutes: at + length, block: p.block, label: p.label });
    at += length;
    const sep = seps[i];
    if (!sep) return;
    if (sep.kind === 'lunch') {
      rows.push({ startMinutes: at, endMinutes: at + sep.minutes, block: null, label: 'Lunch' });
    }
    at += sep.minutes;
  });
  return rows;
}
