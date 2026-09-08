import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';
import { useClientMeta } from '../store/clientMeta';
import { useMessages } from '../store/messages';
import { useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';
import { normalizePhone } from './smsCredentials';
import { todayKey } from './dates';

/**
 * A copy of the app's state, for showing someone what it is doing.
 *
 * Every bug so far has been diagnosed from a description or a screenshot,
 * and half of those diagnoses were wrong on the first go, because "the
 * schedule is fucked up" and the actual store contents are different things.
 * This is the store contents.
 *
 * What is NOT in it: any message body, any phone number, any client name.
 * Those are the user's clients' private lives, and a file meant to be
 * pasted into a chat must not carry them. Threads are counted and their
 * timings kept, since "what time did these arrive" was the last bug; who
 * and what are replaced with stable stand-ins so a thread can still be
 * talked about.
 */

function anonymise(): (value: string) => string {
  const seen = new Map<string, string>();
  return (value) => {
    const key = value.trim().toLowerCase();
    if (!key) return '';
    let label = seen.get(key);
    if (!label) {
      label = `person-${seen.size + 1}`;
      seen.set(key, label);
    }
    return label;
  };
}

export function buildAuditPayload(): Record<string, unknown> {
  const person = anonymise();
  const tasks = Object.values(useTasks.getState().tasks).map((t) => ({
    ...t,
    // A meeting names a client; the rest of the task is about the schedule.
    meeting: t.meeting ? { ...t.meeting, client: person(t.meeting.client) } : null,
  }));
  const messages = useMessages.getState();
  const threads = new Map<string, { messages: number; in: number; out: number; first: number; last: number }>();
  for (const m of Object.values(messages.messages)) {
    const who = person(normalizePhone(m.counterparty));
    const t = threads.get(who) ?? { messages: 0, in: 0, out: 0, first: m.sentAt, last: m.sentAt };
    t.messages++;
    if (m.direction === 'in') t.in++;
    else t.out++;
    t.first = Math.min(t.first, m.sentAt);
    t.last = Math.max(t.last, m.sentAt);
    threads.set(who, t);
  }
  const meta = useClientMeta.getState().meta;
  return {
    exportedAt: new Date().toISOString(),
    today: todayKey(),
    platform: Platform.OS,
    settings: useSettings.getState().settings,
    tasks,
    clients: Object.entries(meta).map(([name, m]) => ({
      label: person(name),
      status: m.status ?? null,
      hasPhone: !!m.phone,
      hasTelegram: !!m.telegram,
      noteChars: m.notes?.length ?? 0,
    })),
    messageThreads: [...threads.entries()].map(([label, t]) => ({ label, ...t })),
    messageStore: {
      total: Object.keys(messages.messages).length,
      highWaterMark: messages.highWaterMark,
      lastSyncAt: messages.lastSyncAt,
      lastError: messages.lastError,
    },
  };
}

/** Write the audit file and open the share sheet on it. */
export async function shareAuditExport(): Promise<void> {
  const json = JSON.stringify(buildAuditPayload(), null, 2);
  const dir = new Directory(Paths.cache, 'audit');
  if (!dir.exists) dir.create();
  const file = new File(dir, `dayflow-audit-${todayKey()}.json`);
  file.write(json);
  await Share.share(
    Platform.OS === 'ios'
      ? { url: file.uri, title: 'DayFlow audit export' }
      : { message: json, title: 'DayFlow audit export' }
  );
}
