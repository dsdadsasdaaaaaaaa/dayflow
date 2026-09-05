import type { DayKey, Task } from '../types';
import { addDays, fromDayKey, todayKey } from './dates';
import { askModel, extractJson, timeInText } from './scheduleImport';
import type { BrainChoice } from './secretaryBrain';

/**
 * Reading a school timetable into a repeating week.
 *
 * Different problem from the newsletter, despite looking like the same one.
 * A newsletter describes particular days and produces one-off entries; a
 * timetable describes EVERY week and produces a recurring one. Getting that
 * wrong in either direction is expensive — a term of classes entered as
 * one-offs, or a single assembly repeating forever — so the two readers stay
 * separate rather than sharing a prompt that has to hedge.
 *
 * Checking is again done here rather than asked for: a period grid has hard
 * structure (a weekday, a start, an end) and anything that fails it is
 * dropped rather than guessed at.
 */

/**
 * Marks a task as coming from a timetable or a school newsletter.
 *
 * Two things need to recognise these later: the timeline, which gives them a
 * lane of their own, and re-importing, which has to be able to replace the
 * old week rather than lay a second one on top of it. Recognising them by
 * their icon would break the moment someone picked a different icon.
 */
export const SCHOOL_TAG = 'school';

/** Is this one of ours? Icon is the fallback for anything imported before the tag existed. */
export function isSchoolTask(task: Pick<Task, 'tags' | 'icon'>): boolean {
  return task.tags?.includes(SCHOOL_TAG) === true || task.icon === 'school-outline';
}

/** One class, on one weekday, every week. */
export interface ParsedClass {
  /** Course as a person says it, e.g. "Chemistry". */
  title: string;
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  /** Room, teacher and course code, each optional. */
  room: string;
  teacher: string;
  code: string;
  /** The school's own period label, when it numbers them. */
  period: string;
}

export type TimetableParse =
  | { ok: true; classes: ParsedClass[]; dropped: number }
  | { ok: false; error: string };

const MAX_INPUT = 24_000;

const SYSTEM = [
  'You read a school timetable and return it as JSON.',
  '',
  'A timetable is a grid: rows are periods with their start and end times, columns are the',
  'days of the week. Each filled cell is one class, and it happens EVERY week on that day.',
  '',
  'Return ONLY a JSON array, no prose and no code fence. Each element is one class on one day:',
  '{"title": string, "weekday": 0-6, "startMinutes": number, "durationMinutes": number,',
  ' "room": string, "teacher": string, "code": string, "period": string}',
  '',
  'Rules:',
  '- One element per cell. A class taught on Monday, Wednesday and Friday is THREE elements,',
  '  one per day, not one element with three days.',
  '- weekday: 0 is Sunday, 1 Monday, 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday.',
  '- title is the subject as a person would say it — "Chemistry", "Jewish History", "Lunch".',
  '  Not the course code. If a cell has only a code, use the code.',
  '- startMinutes and durationMinutes come from the period\'s own times. Minutes from midnight;',
  '  add 12 hours for PM except noon itself: 1:25 PM is 805, 12:40 PM is 760, 8:30 AM is 510.',
  '  A period listed as 8:30 AM to 9:29 AM is startMinutes 510 and durationMinutes 59.',
  '- room, teacher, code and period are "" when the grid does not give them.',
  '- Include lunch and any free or support period that occupies a slot: they are part of the',
  '  day and leaving them out makes the day look emptier than it is.',
  '- An empty cell is a free slot. Skip it — do not invent a class to fill it.',
  '- Never invent a class. A missing one is recoverable; an invented one is not.',
].join('\n');

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Keep only rows that describe a real slot in a real week.
 *
 * Exported because it, not the model, is what makes this safe to point at a
 * scanned timetable: it is the thing worth testing.
 */
export function validateClasses(raw: unknown): { classes: ParsedClass[]; dropped: number } {
  if (!Array.isArray(raw)) return { classes: [], dropped: 0 };
  const classes: ParsedClass[] = [];
  let dropped = 0;
  for (const row of raw.slice(0, 300)) {
    if (!row || typeof row !== 'object') {
      dropped++;
      continue;
    }
    const r = row as Record<string, unknown>;
    const title = str(r.title, 60);
    const weekday = typeof r.weekday === 'number' ? Math.round(r.weekday) : -1;
    const rawStart = typeof r.startMinutes === 'number' ? Math.round(r.startMinutes) : -1;
    if (!title || weekday < 0 || weekday > 6 || rawStart < 0 || rawStart > 1439) {
      dropped++;
      continue;
    }
    // A title with no letters left once times are stripped is grid debris.
    if (title.replace(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, '').replace(/[^a-z]/gi, '').length < 2) {
      dropped++;
      continue;
    }
    const rawDuration = typeof r.durationMinutes === 'number' ? Math.round(r.durationMinutes) : 60;
    // A school period is not eight hours. Clamping rather than dropping,
    // because the class is real even when the arithmetic around it is not.
    const durationMinutes = Math.min(300, Math.max(5, rawDuration || 60));
    const period = str(r.period, 20);
    // The period label often states the times outright; where it does, that
    // is the school's own clock and it beats the model's arithmetic — the
    // same rule the newsletter reader is held to.
    const written = timeInText(period);
    classes.push({
      title,
      weekday,
      startMinutes: written ?? rawStart,
      durationMinutes,
      room: str(r.room, 40),
      teacher: str(r.teacher, 60),
      code: str(r.code, 20),
      period,
    });
  }
  const seen = new Set<string>();
  const unique = classes.filter((c) => {
    const key = `${c.weekday}|${c.startMinutes}|${c.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    classes: unique.sort((a, b) =>
      a.weekday === b.weekday ? a.startMinutes - b.startMinutes : a.weekday - b.weekday
    ),
    dropped,
  };
}

/** Read a timetable into repeating classes. Nothing is created here. */
export async function parseTimetable(
  text: string,
  brain?: BrainChoice | null
): Promise<TimetableParse> {
  const input = text.trim();
  if (!input) return { ok: false, error: 'There was nothing there to read.' };
  const asked = await askModel(SYSTEM, input.slice(0, MAX_INPUT), brain);
  if (!asked.ok) return { ok: false, error: asked.error };

  let raw = extractJson(asked.text);
  if (raw == null) {
    // Same one retry as the newsletter reader, for the same reason: a
    // sentence of preamble is not worth losing a correct reading over.
    const again = await askModel(
      `${SYSTEM}\n\nYour previous answer was not valid JSON. Reply with the JSON array ALONE: no explanation, no code fence, nothing before the "[" or after the "]".`,
      input.slice(0, MAX_INPUT),
      brain
    );
    if (again.ok) raw = extractJson(again.text);
  }
  if (raw == null) {
    return { ok: false, error: 'That did not come back as a timetable. Try pasting just the grid.' };
  }
  const { classes, dropped } = validateClasses(raw);
  if (classes.length === 0) {
    return {
      ok: false,
      error:
        dropped > 0
          ? 'Nothing in that survived checking. Paste just the timetable grid and try again.'
          : 'No classes found in that.',
    };
  }
  return { ok: true, classes, dropped };
}

/** The next date on or after `from` that falls on this weekday. */
export function nextWeekday(weekday: number, from: DayKey = todayKey()): DayKey {
  const start = fromDayKey(from);
  const shift = (weekday - start.getDay() + 7) % 7;
  return addDays(from, shift);
}

/** A weekly repeat on one weekday, forever. */
export function weeklyOn(weekday: number): Task['recurrence'] {
  return { freq: 'weekly', interval: 1, weekdays: [weekday], until: null };
}

/** Room, teacher and code, as a note a person would actually read. */
export function classNote(c: ParsedClass): string {
  return [c.room, c.teacher, c.code].filter(Boolean).join(' · ');
}
