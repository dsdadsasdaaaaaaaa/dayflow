import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task } from '../types';
import { isImportedSchool, normTitle } from './schoolWords';

/**
 * Remembering the school entries the user threw away.
 *
 * The year calendar is re-fetched about once a day, and the import skips
 * anything already on the calendar. A deleted entry is not on the calendar,
 * so it came straight back — and because the refetch is silent and hours
 * later, it looked less like a bug than like the app quietly overruling you.
 * Delete a class you dropped on Monday and it is back by Tuesday.
 *
 * So a deletion is recorded, and the import treats it as an instruction
 * rather than an absence. It is deliberately keyed the same way the
 * duplicate check is: the school renaming or moving an entry makes it a
 * different entry, which is the right outcome — a genuinely new announcement
 * should arrive even on a day something was deleted from.
 */

const KEY = 'dayflow.school.deleted';
/** Plenty for a school year of second thoughts, and bounded. */
const MAX_REMEMBERED = 500;

/** The key an imported school entry is known by, as it sits on the calendar. */
export function schoolEventKey(
  date: string,
  startMinutes: number | null,
  allDay: boolean,
  title: string
): string {
  return `${date}|${allDay || startMinutes == null ? 'all' : startMinutes}|${normTitle(title)}`;
}

function keyForTask(task: Task): string | null {
  if (!task.date) return null;
  return schoolEventKey(task.date, task.startMinutes ?? null, task.allDay === true, task.title);
}

async function read(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Everything the user has deleted and does not want back.
 *
 * Entries for days already past are dropped on the way out — they cannot be
 * re-added to a day that has gone, and the list should not grow forever.
 */
export async function forgottenSchoolKeys(today: string): Promise<Set<string>> {
  const kept = (await read()).filter((k) => k.slice(0, 10) >= today);
  return new Set(kept.slice(-MAX_REMEMBERED));
}

/** Record that this school entry was deleted on purpose. */
export async function forgetSchoolTask(task: Task): Promise<void> {
  if (!isImportedSchool(task) || task.recurrence) return;
  const key = keyForTask(task);
  if (!key) return;
  try {
    const existing = await read();
    if (existing.includes(key)) return;
    const next = [...existing, key].slice(-MAX_REMEMBERED);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Failing to remember costs one unwanted entry coming back, which is
    // where this started; it must never cost the deletion itself.
  }
}

/** Let a deleted entry back in — used when the user asks for a fresh import. */
export async function clearForgottenSchool(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to do; the next import simply keeps skipping them.
  }
}
