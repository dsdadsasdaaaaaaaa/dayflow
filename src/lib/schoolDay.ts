import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DayKey, Task } from '../types';
import { taskOccursOn } from './recurrence';
import type { ParsedEvent } from './scheduleImport';
import { timeInText } from './scheduleImport';
import { isSchoolTask, SCHOOL_TAG, TIMETABLE_TAG } from './timetableImport';
import { useTasks } from '../store/tasks';

/**
 * Making the newsletter and the timetable agree.
 *
 * They describe the same days and contradict each other constantly. The
 * timetable says Monday runs eight periods to 4:30; the newsletter says this
 * particular Monday is Labour Day and the school is shut. Imported
 * separately, the calendar confidently shows eight classes nobody is
 * attending — which is worse than showing nothing, because it is believable.
 *
 * So the newsletter is treated as an amendment to the timetable rather than
 * as a second list beside it. A closure removes that day's classes; an early
 * dismissal removes the ones that start after it and shortens the one that
 * straddles it; a late start removes the ones before it.
 *
 * What it deliberately does NOT do: guess. "Special Schedule" says the day is
 * unusual without saying how, and a plausible invention there would move
 * classes to times nobody published. Those days are left alone, with the
 * newsletter's own note sitting on them to say something is different.
 */

/** What a newsletter says about one particular day. */
export interface DayRule {
  closed: boolean;
  /** School ends here — classes starting at or after it are not happening. */
  dismissalAt: number | null;
  /** School begins here — classes before it are not happening. */
  startsAt: number | null;
}

const CLOSED = /\b(school closed|no school|closed)\b/i;
const DISMISSAL = /\bdismissal\b/i;
const START = /\bstart\b/i;

/**
 * Is this entry a statement about the day's hours rather than an event?
 *
 * "2:25 PM Dismissal" and "10:30 AM Start" are rules: they change when
 * school ends or begins and are applied to the timetable. They are not
 * something to attend at 2:25, so they belong on the all-day shelf as a
 * note about the day, not on the timeline as a half-hour block.
 */
export function isRuleMarker(title: string): boolean {
  return CLOSED.test(title) || DISMISSAL.test(title) || START.test(title);
}

/**
 * Read the newsletter's entries as amendments, keyed by day.
 *
 * Only entries that state a rule outright are used. Anything else — an
 * assembly, a fair, a fast day — is an event on the calendar and no reason
 * to touch the classes around it.
 */
export function deriveDayRules(events: readonly ParsedEvent[]): Map<DayKey, DayRule> {
  const rules = new Map<DayKey, DayRule>();
  const get = (day: DayKey): DayRule => {
    const found = rules.get(day);
    if (found) return found;
    const fresh: DayRule = { closed: false, dismissalAt: null, startsAt: null };
    rules.set(day, fresh);
    return fresh;
  };

  for (const e of events) {
    const title = e.title;
    if (CLOSED.test(title)) {
      get(e.date).closed = true;
      continue;
    }
    // The time comes from the entry's own words where it has them, since
    // that is the school's clock; the parsed start is the fallback.
    const at = timeInText(title) ?? e.startMinutes;
    if (at == null) continue;
    if (DISMISSAL.test(title)) {
      const rule = get(e.date);
      // Earliest wins: two dismissals named for one day means the day ends
      // at the first of them.
      rule.dismissalAt = rule.dismissalAt == null ? at : Math.min(rule.dismissalAt, at);
    } else if (START.test(title)) {
      const rule = get(e.date);
      rule.startsAt = rule.startsAt == null ? at : Math.max(rule.startsAt, at);
    }
  }
  return rules;
}

/** Does this rule change anything at all? */
export function isRuleMeaningful(rule: DayRule): boolean {
  return rule.closed || rule.dismissalAt != null || rule.startsAt != null;
}

/** What a day's rule does to one class. */
export type ClassAction = { kind: 'keep' } | { kind: 'skip' } | { kind: 'shorten'; to: number };

/**
 * Whether a class is still happening, and for how long.
 *
 * Pulled out as a plain function because this is the part that decides
 * whether a real class disappears off someone's calendar, and it should be
 * checkable without a store behind it.
 */
export function classAction(rule: DayRule, start: number, durationMinutes: number): ClassAction {
  if (rule.closed) return { kind: 'skip' };
  const end = start + durationMinutes;
  // Ends before the late start, so it never happens.
  if (rule.startsAt != null && end <= rule.startsAt) return { kind: 'skip' };
  if (rule.dismissalAt != null) {
    if (start >= rule.dismissalAt) return { kind: 'skip' };
    // Straddles the bell: it runs, but only up to it. A minimum of five
    // minutes, since a class cut to nothing should simply go.
    if (end > rule.dismissalAt) {
      const left = rule.dismissalAt - start;
      return left >= 5 ? { kind: 'shorten', to: left } : { kind: 'skip' };
    }
  }
  return { kind: 'keep' };
}

export interface SchoolDayChanges {
  /** Classes removed from a particular day. */
  skipped: number;
  /** Classes cut short because the day ended mid-period. */
  shortened: number;
  /** Days that had a rule and something to change. */
  days: number;
}

/**
 * Apply the newsletter's amendments to the timetable already on the calendar.
 *
 * Only ever touches tasks the school put there. A dentist appointment during
 * a half day is the user's business, and silently deleting it because a
 * newsletter mentioned a dismissal would be indefensible.
 *
 * Idempotent: a class already removed from a day is not there to remove
 * again, and a class already shortened is left alone.
 */
export function applySchoolDayRules(rules: Map<DayKey, DayRule>): SchoolDayChanges {
  const store = useTasks.getState();
  const changes: SchoolDayChanges = { skipped: 0, shortened: 0, days: 0 };

  for (const [day, rule] of rules) {
    if (!isRuleMeaningful(rule)) continue;
    let touched = false;

    // Re-read each time: skipping and detaching both rewrite the store, and
    // a stale snapshot would try to skip an occurrence that has already gone.
    const classesOn = () =>
      Object.values(useTasks.getState().tasks).filter(
        (t: Task) =>
          isSchoolTask(t) &&
          t.recurrence != null &&
          t.startMinutes != null &&
          taskOccursOn(t, day)
      );

    for (const task of classesOn()) {
      const start = task.startMinutes as number;
      const action = classAction(rule, start, task.durationMinutes);
      if (action.kind === 'keep') continue;
      if (action.kind === 'skip') {
        store.skipOccurrence(task.id, day);
        changes.skipped++;
        touched = true;
        continue;
      }
      // Detach this one day from the series so the other weeks keep their
      // real length, then cut it to the bell.
      const detached = useTasks.getState().detachOccurrence(task.id, day);
      if (detached) {
        useTasks.getState().updateTask(detached.id, {
          durationMinutes: action.to,
          // Still a class, still the timetable's, so a replace sweeps it.
          tags: Array.from(new Set([...(detached.tags ?? []), SCHOOL_TAG, TIMETABLE_TAG])),
        });
        changes.shortened++;
        touched = true;
      }
    }
    if (touched) changes.days++;
  }
  return changes;
}


/**
 * Rules are remembered, not just applied.
 *
 * Otherwise the whole thing depends on the order two imports happen in: a
 * newsletter read on Saturday amends the timetable that exists then, and a
 * timetable imported on Sunday arrives after the amendment has been and
 * gone — restoring, in full, the eight classes on the day the school is
 * shut. Keeping the rules means either order gives the same week.
 */
const RULES_KEY = 'dayflow.school.dayRules';

/** How long a rule is worth keeping. Past days cannot be amended usefully. */
const KEEP_DAYS = 120;

type StoredRules = Record<DayKey, DayRule>;

async function loadStored(): Promise<StoredRules> {
  try {
    const raw = await AsyncStorage.getItem(RULES_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredRules) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Merge these rules into what is remembered, dropping ones long past. */
export async function rememberDayRules(rules: Map<DayKey, DayRule>): Promise<void> {
  const floor = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const merged = await loadStored();
  for (const [day, rule] of rules) if (isRuleMeaningful(rule)) merged[day] = rule;
  for (const day of Object.keys(merged)) if (day < floor) delete merged[day];
  try {
    await AsyncStorage.setItem(RULES_KEY, JSON.stringify(merged));
  } catch {
    // Not remembering costs order-independence, never a wrong class.
  }
}

/**
 * Re-apply every remembered rule.
 *
 * Safe to call whenever the timetable changes, which is exactly when it is
 * needed: a freshly imported class knows nothing about the closure the
 * newsletter announced last week.
 */
export async function applyStoredRules(): Promise<SchoolDayChanges> {
  const stored = await loadStored();
  return applySchoolDayRules(new Map(Object.entries(stored)));
}
