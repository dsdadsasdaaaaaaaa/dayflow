import { isPhoneBlocked } from '../store/clientMeta';
import { useClientMeta } from '../store/clientMeta';
import { buildThreads, useMessages } from '../store/messages';
import { useTasks } from '../store/tasks';
import { clientNameForPhone } from '../store/clientMeta';
import { knownClients } from './meetings';
import { normalizePhone } from './smsCredentials';
import { upsertTelerivetContact } from './telerivet';
import type { TelerivetCredentials } from './telerivetCredentials';

/**
 * Copy the people we have actually talked to into a Telerivet project, so
 * they can be addressed from its own dashboard.
 *
 * Blocked contacts are never included. That exclusion is the whole reason
 * this is not a raw dump of the address book: someone the user cut off must
 * not resurface inside a tool that can message groups.
 *
 * Each contact costs one API call, which is the same meter that a chatty
 * polling loop was draining, so this is a deliberate action with a count
 * shown up front rather than anything automatic.
 */

export interface ContactExportPlan {
  /** E.164 numbers that would be sent, with a display name where known. */
  entries: { phone: string; name?: string }[];
  /** Conversations left out because the person is blocked. */
  blocked: number;
}

/** What would be exported, without exporting it. */
export function planContactExport(): ContactExportPlan {
  const meta = useClientMeta.getState().meta;
  const displayNames = knownClients(useTasks.getState().tasks);
  const sms = useMessages.getState();

  const entries: { phone: string; name?: string }[] = [];
  const seen = new Set<string>();
  let blocked = 0;

  for (const t of buildThreads(sms.messages, sms.lastReadAt)) {
    const phone = normalizePhone(t.counterparty);
    if (!phone || seen.has(phone)) continue;
    if (isPhoneBlocked(meta, t.counterparty)) {
      blocked++;
      continue;
    }
    seen.add(phone);
    const name = clientNameForPhone(meta, t.counterparty, displayNames);
    entries.push({ phone, ...(name ? { name } : {}) });
  }
  return { entries, blocked };
}

export interface ContactExportResult {
  added: number;
  failed: number;
}

/**
 * Push the planned contacts up, one at a time and in order, reporting
 * progress. Sequential on purpose: firing hundreds of parallel writes at a
 * metered API is how a one-off action turns into a surprise bill, and this
 * is not something the user is waiting on interactively.
 */
export async function exportContacts(
  creds: TelerivetCredentials,
  plan: ContactExportPlan,
  onProgress?: (done: number, total: number) => void
): Promise<ContactExportResult> {
  let added = 0;
  let failed = 0;
  const total = plan.entries.length;
  for (let i = 0; i < total; i++) {
    const e = plan.entries[i];
    const ok = await upsertTelerivetContact(creds, e.phone, e.name);
    if (ok) added++;
    else failed++;
    onProgress?.(i + 1, total);
  }
  return { added, failed };
}
