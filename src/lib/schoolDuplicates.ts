import type { Task } from '../types';
import { isSchoolTask, normTitle, ruleKind } from './schoolWords';

/**
 * Clearing up school entries the calendar was told about twice.
 *
 * Two sources describe the same term. The weekly newsletter covers the week
 * ahead; the year calendar file covers all of it. Both are worth having —
 * the newsletter arrives with the bell sheets, the file knows about March in
 * September — but on the days where they overlap they say the same thing in
 * slightly different words, and the calendar ended up carrying both.
 *
 * Two kinds of duplicate, and they need different tests:
 *
 * - Same words, different punctuation. "Project Support: Combined" and
 *   "Project Support - Combined". Comparing the words settles these.
 * - Same fact, different words. "2:25 Closing" and "2:25 PM Dismissal" are
 *   one early finish; no text comparison will ever pair them. What they have
 *   in common is what they DO to the day, so those are compared instead.
 *
 * Only ever touches one-off school entries. A class series is left alone, and
 * so is anything the user made: deleting somebody's own plans because a
 * school newsletter used similar words would be indefensible.
 */

/** A school entry that is safe to consider — imported, one-off, dated. */
function isCandidate(t: Task): boolean {
  return isSchoolTask(t) && !t.recurrence && t.date != null;
}

/**
 * Which of two entries to keep.
 *
 * Whichever carries more — a longer note, a real time rather than an all-day
 * shelf — since the two sources describe the same day at different levels of
 * detail and the fuller one is the one worth reading. Ties break on the
 * older record, so running this twice keeps the same survivor.
 */
function richer(a: Task, b: Task): Task {
  const score = (t: Task) =>
    // Naming the blocks is the whole value of a special-schedule notice:
    // "Special Schedule blocks 1, 3, 5, 8" tells you which classes run,
    // "Erev Rosh Hashanah: Special Schedule" only tells you something is
    // different, and the day it belongs to is on the calendar anyway.
    (/\bblocks?\b/i.test(t.title) ? 500 : 0) +
    (t.notes?.trim().length ?? 0) +
    (t.startMinutes != null ? 50 : 0) +
    (t.subtasks?.length ?? 0) * 10 +
    (t.alerts?.length ?? 0) * 5;
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? a : b;
  // Equal otherwise: the longer title is the one that says more —
  // "Special schedule Blocks 1, 3, 5, 8" over a bare "Special Schedule".
  const la = a.title.trim().length;
  const lb = b.title.trim().length;
  if (la !== lb) return la > lb ? a : b;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? a : b;
  return a.id < b.id ? a : b;
}

/**
 * The ids of duplicate school entries, keeping one of each.
 *
 * Pure and exported so the thing that decides which of the user's calendar
 * entries disappear can be tested without a store behind it.
 */
export function duplicateSchoolTaskIds(tasks: Record<string, Task>): string[] {
  const survivors = new Map<string, Task>();
  const doomed: string[] = [];

  const consider = (key: string, task: Task): boolean => {
    const held = survivors.get(key);
    if (!held) {
      survivors.set(key, task);
      return false;
    }
    const keep = richer(held, task);
    survivors.set(key, keep);
    doomed.push(keep === held ? task.id : held.id);
    return true;
  };

  // Sorted so the result does not depend on object key order.
  const candidates = Object.values(tasks)
    .filter(isCandidate)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const t of candidates) {
    const day = t.date as string;
    const when = t.allDay || t.startMinutes == null ? 'all' : String(t.startMinutes);

    // Same words on the same day, at the same time or both all-day.
    if (consider(`words|${day}|${when}|${normTitle(t.title)}`, t)) continue;

    // Same statement about the day's hours, however it was worded. An entry
    // that says nothing about the hours has no second key and is kept.
    const kind = ruleKind(t.title, t.allDay ? null : (t.startMinutes ?? null));
    if (kind) consider(`rule|${day}|${kind}`, t);
  }

  // One more pass, for the same event told at two levels of precision. The
  // year calendar shelves "Curriculum Night 7:30 PM" as an all-day note; the
  // newsletter puts "Curriculum Night (7:30 PM)" on the timeline at 7:30.
  // Same words, same day, so the vaguer of the two adds nothing.
  //
  // Only an all-day entry is ever dropped this way. Two entries that both
  // carry a time are left alone however alike they look, because a day can
  // genuinely hold the same class twice — a double period is one course, two
  // real blocks, and deleting the second would take a class off the
  // timetable.
  const gone = new Set(doomed);
  const timedWords = new Set<string>();
  for (const t of candidates) {
    if (gone.has(t.id) || t.allDay || t.startMinutes == null) continue;
    timedWords.add(`${t.date}|${normTitle(t.title)}`);
  }
  for (const t of candidates) {
    if (gone.has(t.id)) continue;
    if (!t.allDay && t.startMinutes != null) continue;
    if (timedWords.has(`${t.date}|${normTitle(t.title)}`)) {
      doomed.push(t.id);
      gone.add(t.id);
    }
  }

  return doomed;
}

/**
 * The task map with duplicate school entries removed, or null when there is
 * nothing to remove — so a caller can skip writing unchanged state.
 */
export function collapseSchoolDuplicates(
  tasks: Record<string, Task>
): Record<string, Task> | null {
  const doomed = duplicateSchoolTaskIds(tasks);
  if (doomed.length === 0) return null;
  const out = { ...tasks };
  for (const id of doomed) delete out[id];
  return out;
}
