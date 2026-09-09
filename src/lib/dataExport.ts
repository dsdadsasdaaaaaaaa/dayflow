import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';
import { useCalls } from '../store/calls';
import { useClientMeta } from '../store/clientMeta';
import { useFocus } from '../store/focus';
import { useHabits } from '../store/habits';
import { useMeetingSession } from '../store/meetingSession';
import { useMessages } from '../store/messages';
import { useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';
import { useTelegram } from '../store/telegramAccount';
import { todayKey } from './dates';
import { normalizePhone } from './smsCredentials';

/**
 * The whole app, as one document, at a level of exposure the user picks.
 *
 * Distinct from the two exports that already existed and from both of their
 * purposes. The audit export strips every name and message so it can be
 * pasted into a chat safely; the backup keeps the client book but drops
 * message bodies, because a backup is for restoring a phone, not for reading.
 * This one is for handing an assistant the real thing on purpose.
 *
 * Which is why the scope is explicit rather than a flag buried in settings.
 * "Everything" means everything: names, numbers, addresses, rates, and the
 * full text of every conversation. That is the point of it, and it is also
 * the reason it should never be the default or the easy path.
 */

export type ExportScope = 'schedule' | 'clients' | 'everything';

export const SCOPE_LABELS: Record<ExportScope, { title: string; detail: string }> = {
  schedule: {
    title: 'Schedule only',
    detail:
      'Classes, tasks, habits and settings. Clients appear as "person-1", with no names, numbers or messages.',
  },
  clients: {
    title: 'Schedule and clients',
    detail:
      'The above plus real names, phone numbers, notes, rates and addresses. Still no message text.',
  },
  everything: {
    title: 'Everything',
    detail:
      'The above plus the full text of every message, both directions. Nothing is held back.',
  },
};

/** Stable stand-ins, used only at the narrowest scope. */
function anonymiser(): (value: string) => string {
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

export function buildDataExport(scope: ExportScope): Record<string, unknown> {
  const named = scope !== 'schedule';
  const person = anonymiser();
  const who = (value: string) => (named ? value : person(value));

  const tasks = Object.values(useTasks.getState().tasks).map((t) => ({
    ...t,
    meeting: t.meeting ? { ...t.meeting, client: who(t.meeting.client) } : null,
  }));

  const meta = useClientMeta.getState().meta;
  const clients = Object.entries(meta).map(([name, m]) => ({
    name: who(name),
    displayName: named ? m.displayName : undefined,
    status: m.status ?? null,
    phone: named ? m.phone : undefined,
    telegram: named ? m.telegram : undefined,
    notes: named ? m.notes : undefined,
    noteChars: named ? undefined : (m.notes?.length ?? 0),
  }));

  const store = useMessages.getState();
  // Grouped by conversation rather than listed flat: a thread is the unit
  // anyone reasons about, and a flat list of five thousand rows is not
  // something a reader can hold.
  const byThread = new Map<string, Record<string, unknown>[]>();
  for (const m of Object.values(store.messages)) {
    const key = normalizePhone(m.counterparty);
    const row = byThread.get(key) ?? [];
    row.push(
      scope === 'everything'
        ? { direction: m.direction, sentAt: m.sentAt, body: m.body, status: m.status }
        : { direction: m.direction, sentAt: m.sentAt }
    );
    byThread.set(key, row);
  }
  const threads = [...byThread.entries()].map(([key, rows]) => ({
    counterparty: who(key),
    messages: rows.length,
    // Oldest first: a conversation reads forwards.
    thread: rows.sort(
      (a, b) => (a.sentAt as number) - (b.sentAt as number)
    ),
  }));

  return {
    exportedAt: new Date().toISOString(),
    today: todayKey(),
    platform: Platform.OS,
    scope,
    // Said in the document itself, so a reader who was handed the file
    // without the conversation around it still knows what it is.
    contains: SCOPE_LABELS[scope].detail,
    settings: useSettings.getState().settings,
    tasks,
    habits: Object.values(useHabits.getState().habits),
    focusSessions: useFocus.getState().sessions,
    meetingLog: useMeetingSession.getState().log.map((e) => ({ ...e, client: who(e.client) })),
    clients,
    threads,
    telegramLinked: Object.keys(useTelegram.getState().messages).length > 0,
    callsHeardAt: useCalls.getState().heardAt,
  };
}

/** Write the export and open the share sheet on it. */
export async function shareDataExport(scope: ExportScope): Promise<void> {
  const json = JSON.stringify(buildDataExport(scope), null, 2);
  const dir = new Directory(Paths.cache, 'export');
  if (!dir.exists) dir.create();
  const file = new File(dir, `dayflow-${scope}-${todayKey()}.json`);
  file.write(json);
  await Share.share(
    Platform.OS === 'ios'
      ? { url: file.uri, title: `DayFlow export (${SCOPE_LABELS[scope].title})` }
      : { message: json, title: `DayFlow export (${SCOPE_LABELS[scope].title})` }
  );
}
