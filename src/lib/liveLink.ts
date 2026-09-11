import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildDataExport, collectExportCalendar, type ExportScope } from './dataExport';
import { importSchoolCalendar } from './icsImport';
import { rebuildSpecialDays, rememberBellSchedule, validateBell } from './bellSchedule';
import { todayKey } from './dates';
import { normalizePhone } from './smsCredentials';
import { loadSmsGateCredentials } from './smsgateCredentials';
import { useClientMeta } from '../store/clientMeta';
import { useMessages } from '../store/messages';
import { useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';

/**
 * The live link: the app's state kept where an assistant can read it, and a
 * queue of changes coming back the other way.
 *
 * The user asked to stop describing their data and just let an assistant see
 * it. That is a real convenience and a real exposure, so the shape of it
 * matters more than the size of it:
 *
 * - It is off unless switched on, and switching it off DELETES the snapshot
 *   rather than merely stopping the pushes. "Off" has to mean gone.
 * - It has its own secret, never the one guarding messages.
 * - Changes coming back are applied for the user's own calendar, because
 *   that is the point. Anything a CLIENT would see is queued as a draft and
 *   still waits for a person — the same rule the assistant has always had,
 *   and the one the user has stated twice.
 */

/** Where the last push got to, so a failure is visible rather than silent. */
const STATUS_KEY = 'dayflow.liveLink.status';

export interface LiveLinkStatus {
  at: number;
  ok: boolean;
  text: string;
}

async function note(text: string, ok: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify({ at: Date.now(), ok, text }));
  } catch {
    // Losing the note costs a diagnosis, never data.
  }
}

export async function lastLiveLinkStatus(): Promise<LiveLinkStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveLinkStatus;
    return typeof parsed?.text === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function base(url: string): string {
  return url.replace(/\/+$/, '');
}

/** The relay and the data secret, or null when the link is not set up. */
async function link(): Promise<{ url: string; secret: string; scope: ExportScope } | null> {
  const { liveLinkEnabled, liveLinkScope } = useSettings.getState().settings;
  if (!liveLinkEnabled) return null;
  const creds = await loadSmsGateCredentials();
  if (!creds?.inboxUrl) return null;
  const secret = await AsyncStorage.getItem('dayflow.liveLink.secret');
  if (!secret) return null;
  return { url: base(creds.inboxUrl), secret, scope: liveLinkScope };
}

/** Set (or clear) the secret the live link is guarded by. */
export async function setLiveLinkSecret(secret: string | null): Promise<void> {
  if (secret) await AsyncStorage.setItem('dayflow.liveLink.secret', secret.trim());
  else await AsyncStorage.removeItem('dayflow.liveLink.secret');
}

export async function hasLiveLinkSecret(): Promise<boolean> {
  return (await AsyncStorage.getItem('dayflow.liveLink.secret')) != null;
}

/** Push the current state. Safe to call often; it replaces what is there. */
export async function pushSnapshot(): Promise<boolean> {
  const l = await link();
  if (!l) return false;
  try {
    const body = JSON.stringify(buildDataExport(l.scope, await collectExportCalendar(l.scope)));
    const res = await fetch(`${l.url}/data/${encodeURIComponent(l.secret)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) {
      await note(`The relay refused the snapshot (${res.status}).`, false);
      return false;
    }
    await note(`Shared ${Math.round(body.length / 1000)}k of data at the "${l.scope}" level.`, true);
    return true;
  } catch (e) {
    await note(e instanceof Error ? e.message : 'Could not reach the relay.', false);
    return false;
  }
}

/** Stop sharing, and remove what has already been shared. */
export async function clearSnapshot(): Promise<void> {
  const creds = await loadSmsGateCredentials();
  const secret = await AsyncStorage.getItem('dayflow.liveLink.secret');
  if (!creds?.inboxUrl || !secret) return;
  try {
    await fetch(`${base(creds.inboxUrl)}/data/${encodeURIComponent(secret)}`, { method: 'DELETE' });
    await note('Sharing is off and the shared copy has been deleted.', true);
  } catch {
    await note('Sharing is off, but the shared copy could not be deleted. Try again on wifi.', false);
  }
}

// ---------------------------------------------------------------------------
// Changes coming back
// ---------------------------------------------------------------------------

interface QueuedChange {
  id: string;
  action: string;
  [key: string]: unknown;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function isRealDate(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const probe = new Date(y, m - 1, d, 12);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

export interface AppliedChanges {
  applied: number;
  drafted: number;
  rejected: number;
}

/**
 * Apply what an assistant queued.
 *
 * Every field is validated here, for the same reason the schedule readers
 * validate theirs: what arrives was written by a model, and a malformed task
 * silently landing on a calendar is worse than one that never arrives. An
 * action this does not recognise is counted and dropped rather than guessed
 * at.
 */
export async function applyQueuedChanges(): Promise<AppliedChanges> {
  const l = await link();
  const out: AppliedChanges = { applied: 0, drafted: 0, rejected: 0 };
  if (!l) return out;

  let changes: QueuedChange[] = [];
  try {
    const res = await fetch(`${l.url}/queue/${encodeURIComponent(l.secret)}`);
    if (!res.ok) return out;
    changes = ((await res.json()) as { changes?: QueuedChange[] }).changes ?? [];
  } catch {
    return out;
  }
  if (changes.length === 0) return out;

  const tasks = useTasks.getState();
  for (const c of changes) {
    switch (c.action) {
      case 'add_task': {
        const title = str(c.title, 120);
        const date = str(c.date, 10);
        if (!title || (date && !isRealDate(date))) {
          out.rejected++;
          break;
        }
        const start = num(c.startMinutes);
        tasks.addTask({
          title,
          date: date || todayKey(),
          allDay: start == null,
          startMinutes: start != null && start >= 0 && start <= 1439 ? start : null,
          durationMinutes: Math.min(1440, Math.max(5, num(c.durationMinutes) ?? 60)),
          notes: str(c.notes, 2000),
          icon: 'sparkles-outline',
          color: 'violet',
          tags: ['assistant'],
        });
        out.applied++;
        break;
      }
      case 'update_task': {
        const id = str(c.taskId ?? c.id_task ?? c.id, 60);
        const existing = id ? useTasks.getState().tasks[id] : null;
        if (!existing) {
          out.rejected++;
          break;
        }
        const patch: Record<string, unknown> = {};
        if (typeof c.title === 'string') patch.title = str(c.title, 120);
        if (typeof c.notes === 'string') patch.notes = str(c.notes, 2000);
        const date = str(c.date, 10);
        if (date && isRealDate(date)) patch.date = date;
        const start = num(c.startMinutes);
        if (start != null && start >= 0 && start <= 1439) patch.startMinutes = start;
        const dur = num(c.durationMinutes);
        if (dur != null) patch.durationMinutes = Math.min(1440, Math.max(5, dur));
        if (Object.keys(patch).length === 0) {
          out.rejected++;
          break;
        }
        tasks.updateTask(id, patch);
        out.applied++;
        break;
      }
      case 'delete_task': {
        const id = str(c.taskId ?? c.id_task ?? c.id, 60);
        const existing = id ? useTasks.getState().tasks[id] : null;
        if (!existing) {
          out.rejected++;
          break;
        }
        const day = str(c.date, 10);
        // A class every Tuesday is one task. Deleting it because one Tuesday
        // is cancelled would take the whole term with it, so a date means
        // that day only, and taking the series needs saying outright.
        if (existing.recurrence) {
          if (day && isRealDate(day)) {
            tasks.skipOccurrence(id, day);
            out.applied++;
            break;
          }
          if (c.applyToSeries !== true) {
            out.rejected++;
            await note(
              `"${existing.title}" repeats — give a date to cancel one day, or say applyToSeries to delete every occurrence.`,
              false
            );
            break;
          }
        }
        tasks.deleteTask(id);
        out.applied++;
        break;
      }
      case 'move_task': {
        const id = str(c.taskId ?? c.id_task ?? c.id, 60);
        const existing = id ? useTasks.getState().tasks[id] : null;
        const date = str(c.date, 10);
        if (!existing || (date && !isRealDate(date))) {
          out.rejected++;
          break;
        }
        const start = num(c.startMinutes);
        const patch: Record<string, unknown> = {};
        if (date) patch.date = date;
        if (start != null && start >= 0 && start <= 1439) {
          patch.startMinutes = start;
          patch.allDay = false;
        }
        const dur = num(c.durationMinutes);
        if (dur != null) patch.durationMinutes = Math.min(1440, Math.max(5, dur));
        if (Object.keys(patch).length === 0) {
          out.rejected++;
          break;
        }
        // Moving one day of a series detaches that day rather than dragging
        // every other week along with it.
        const from = str(c.fromDate, 10);
        if (existing.recurrence && from && isRealDate(from)) {
          const detached = useTasks.getState().detachOccurrence(id, from);
          if (!detached) {
            out.rejected++;
            break;
          }
          useTasks.getState().updateTask(detached.id, patch);
          out.applied++;
          break;
        }
        if (existing.recurrence && c.applyToSeries !== true) {
          out.rejected++;
          await note(
            `"${existing.title}" repeats — give fromDate to move one day, or say applyToSeries to move every occurrence.`,
            false
          );
          break;
        }
        tasks.updateTask(id, patch);
        out.applied++;
        break;
      }
      case 'complete_task': {
        const id = str(c.taskId ?? c.id_task ?? c.id, 60);
        const existing = id ? useTasks.getState().tasks[id] : null;
        if (!existing) {
          out.rejected++;
          break;
        }
        const day = str(c.date, 10);
        const on = isRealDate(day) ? day : (existing.date ?? todayKey());
        const wanted = c.done === false ? false : true;
        // toggleComplete flips; read first so saying "done" twice is not
        // an accidental undo.
        const now = existing.recurrence
          ? existing.completions[on] === true
          : existing.completed === true;
        if (now !== wanted) tasks.toggleComplete(id, on);
        out.applied++;
        break;
      }
      case 'add_client_note': {
        const client = str(c.client, 80);
        const notes = str(c.notes, 2000);
        if (!client || !notes) {
          out.rejected++;
          break;
        }
        const meta = useClientMeta.getState();
        const existing = meta.meta[client.trim().toLowerCase()]?.notes ?? '';
        meta.setNotes(client, existing ? `${existing}\n${notes}` : notes);
        out.applied++;
        break;
      }
      case 'draft_message': {
        // Never sent, only written into the composer for that thread. The
        // user has said twice that nothing goes to a client without them,
        // and a live link is exactly the wrong place to start.
        const to = normalizePhone(str(c.to, 30));
        const text = str(c.text, 1000);
        if (!to || !text) {
          out.rejected++;
          break;
        }
        useMessages.getState().setThreadDraft(to, text);
        out.drafted++;
        break;
      }
      case 'bell_schedule': {
        // A bell sheet, already read: {date, title, rows:[{startMinutes,
        // endMinutes, block, label}]}. Held to the same validation as one the
        // app read itself, then remembered, so it survives a timetable
        // re-import and teaches days that run the same way.
        const schedule = validateBell(c, new Date().getFullYear());
        if (!schedule) {
          out.rejected++;
          break;
        }
        await rememberBellSchedule(schedule);
        out.applied++;
        break;
      }
      case 'rebuild_special_days': {
        // Nothing to do here: the rebuild runs once, after the whole batch.
        out.applied++;
        break;
      }
      case 'import_calendar': {
        // A whole .ics, usually the school's year. Parsed on device by a
        // fixed-format parser and applied through the same validation and
        // duplicate checks as the newsletter; nothing in it can send.
        const ics = typeof c.ics === 'string' ? c.ics : '';
        if (!/BEGIN:VCALENDAR/.test(ics) || ics.length > 2_000_000) {
          out.rejected++;
          break;
        }
        try {
          const r = await importSchoolCalendar(ics);
          out.applied += r.added;
          await note(
            `Calendar from the assistant: ${r.read} entries read, ${r.added} added, ${r.closures} closure day${r.closures === 1 ? '' : 's'}, ${r.amended.skipped} class${r.amended.skipped === 1 ? '' : 'es'} cleared.`,
            true
          );
        } catch {
          out.rejected++;
        }
        break;
      }
      default:
        out.rejected++;
    }
  }

  const parts = [
    out.applied > 0 ? `applied ${out.applied}` : '',
    out.drafted > 0 ? `${out.drafted} draft${out.drafted === 1 ? '' : 's'} waiting` : '',
    out.rejected > 0 ? `${out.rejected} rejected` : '',
  ].filter(Boolean);
  if (parts.length > 0) await note(`Changes from the assistant: ${parts.join(', ')}.`, true);
  return out;
}

/** One pass: send what is here, take what is waiting. */
export async function syncLiveLink(): Promise<void> {
  if (!(await link())) return;
  const changes = await applyQueuedChanges();
  // A corrected class time or a delivered bell sheet moves the special days
  // with it, before the snapshot goes out describing them.
  if (changes.applied > 0) {
    try {
      await rebuildSpecialDays();
    } catch {
      // A failed rebuild leaves yesterday's version, never a broken day.
    }
  }
  await pushSnapshot();
}
