import { normalizePhone } from './smsCredentials';
import { knownClients } from './meetings';
import { clientMetaKey, useClientMeta, type ClientMeta } from '../store/clientMeta';
import { useTasks } from '../store/tasks';
import type { Task } from '../types';

/**
 * Attach a conversation (SMS number or Telegram chat) to an EXISTING client,
 * moving the identifier off whichever contact currently holds it. Solves
 * "this thread saved itself as its own contact, but it's really Michael".
 */

function titleCase(key: string): string {
  return key
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Every client the user could link a thread to: meeting clients plus
 * message-book contacts, display-cased, deduped, alphabetical.
 */
export function allClientNames(
  tasks: Record<string, Task>,
  meta: Record<string, ClientMeta>
): string[] {
  const byKey = new Map<string, string>();
  for (const name of knownClients(tasks)) byKey.set(clientMetaKey(name), name);
  for (const [key, m] of Object.entries(meta)) {
    if (!byKey.has(key)) byKey.set(key, m.displayName ?? titleCase(key));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export type LinkResult = { ok: true } | { ok: false; error: string };

/** 'tgc:<chatId>' → chatId, else normalized phone. Empty string = invalid. */
function identifierOf(counterparty: string): { tg: string | null; phone: string | null } {
  if (counterparty.startsWith('tgc:')) {
    const id = counterparty.slice(4).trim();
    return { tg: id || null, phone: null };
  }
  const phone = normalizePhone(counterparty);
  return { tg: null, phone: phone || null };
}

/**
 * Link the thread to `targetClient`. The identifier is removed from any other
 * contact that held it; if that contact ends up empty (no numbers, no chats,
 * no notes, no meetings), it is deleted. Its notes and explicit status carry
 * over when the target has none of its own.
 */
export function linkThreadToClient(counterparty: string, targetClient: string): LinkResult {
  const target = targetClient.trim();
  const targetKey = clientMetaKey(target);
  if (!targetKey) return { ok: false, error: 'Pick a client first.' };
  const { tg, phone } = identifierOf(counterparty);
  if (!tg && !phone) return { ok: false, error: 'This conversation has no linkable id.' };

  const { meta } = useClientMeta.getState();

  // Whoever currently holds this identifier (e.g. the auto-saved contact).
  const ownerKey = Object.entries(meta).find(([, m]) =>
    tg ? m.telegram === tg : m.phone != null && normalizePhone(m.phone) === phone
  )?.[0];

  if (ownerKey === targetKey) return { ok: true }; // already linked

  const meetingKeys = new Set(knownClients(useTasks.getState().tasks).map(clientMetaKey));

  useClientMeta.setState((s) => {
    const next = { ...s.meta };
    const owner = ownerKey ? next[ownerKey] : undefined;
    const existing = next[targetKey];

    // Merge what the old contact knew into the target (never overwrite).
    const mergedNotes =
      existing?.notes?.trim()
        ? owner?.notes?.trim() && !existing.notes.includes(owner.notes.trim())
          ? `${existing.notes}\n${owner.notes.trim()}`
          : existing.notes
        : owner?.notes ?? '';

    next[targetKey] = {
      ...existing,
      notes: mergedNotes,
      // A meeting client never inherits the auto-saved contact's stage —
      // their history already says 'client'.
      status:
        existing?.status ?? (meetingKeys.has(targetKey) ? undefined : owner?.status),
      displayName: existing?.displayName ?? target,
      ...(tg ? { telegram: tg } : {}),
      ...(phone ? { phone } : {}),
    };

    if (ownerKey && owner) {
      const stripped: ClientMeta = {
        ...owner,
        notes: '',
        ...(tg ? { telegram: undefined } : {}),
        ...(phone ? { phone: undefined } : {}),
      };
      const empty =
        !stripped.phone && !stripped.telegram && !meetingKeys.has(ownerKey);
      if (empty) delete next[ownerKey];
      else next[ownerKey] = { ...stripped, notes: owner.notes };
    }
    return { meta: next };
  });

  return { ok: true };
}
