import { clientMetaKey, useClientMeta } from '../store/clientMeta';
import { useMeetingSession } from '../store/meetingSession';
import { useTasks } from '../store/tasks';

/**
 * Renaming a client touches three stores (meeting tasks, session log, client
 * meta) because client identity is the name string itself. This orchestrates
 * all of them so notes, phone, status, money history and stats move together.
 */

export type RenameClientResult = { ok: true } | { ok: false; error: string };

/** Is this name already taken by a DIFFERENT client (meta entry or meetings)? */
export function clientNameTaken(oldName: string, candidate: string): boolean {
  const oldKey = clientMetaKey(oldName);
  const newKey = clientMetaKey(candidate);
  if (!newKey || newKey === oldKey) return false;
  if (useClientMeta.getState().meta[newKey]) return true;
  return Object.values(useTasks.getState().tasks).some(
    (t) => t.meeting != null && clientMetaKey(t.meeting.client) === newKey
  );
}

/** Rename everywhere. Validates emptiness + collisions; safe to call from UI. */
export function renameClientEverywhere(oldName: string, newName: string): RenameClientResult {
  const next = newName.trim();
  if (!next) return { ok: false, error: 'The name can’t be empty.' };
  const oldKey = clientMetaKey(oldName);
  const newKey = clientMetaKey(next);
  if (!oldKey) return { ok: false, error: 'Nothing to rename.' };
  if (oldKey === newKey && next === oldName.trim()) return { ok: true };
  if (clientNameTaken(oldName, next)) {
    return { ok: false, error: `You already have a client named “${next}”.` };
  }
  useTasks.getState().renameMeetingClient(oldName, next);
  useMeetingSession.getState().renameLogClient(oldName, next);
  useClientMeta.getState().renameClient(oldName, next);
  return { ok: true };
}
