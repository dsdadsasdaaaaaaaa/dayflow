import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { Composer } from '../src/components/messages/Composer';
import { ErrorBanner } from '../src/components/messages/ErrorBanner';
import { LinkClientRow } from '../src/components/messages/LinkClientRow';
import { MessageBubble } from '../src/components/messages/MessageBubble';
import { formatPhoneDisplay } from '../src/components/messages/format';
import {
  addDays,
  formatDayRelative,
  formatMinutes,
  toDayKey,
  todayKey,
} from '../src/lib/dates';
import { tapHaptic } from '../src/lib/haptics';
import { knownClients, meetingOccurrences } from '../src/lib/meetings';
import type { SmsMessage } from '../src/lib/smsApi';
import { normalizePhone } from '../src/lib/smsCredentials';
import { clientNameForPhone, useClientMeta } from '../src/store/clientMeta';
import { threadMessages, useMessages } from '../src/store/messages';
import { useTasks } from '../src/store/tasks';
import { SPACING, useTheme } from '../src/theme';
import type { DayKey } from '../src/types';

type Row =
  | { type: 'day'; key: string; day: DayKey }
  | { type: 'message'; key: string; msg: SmsMessage; showStatus: boolean };

/** One conversation: bubbles, day separators, client link, pinned composer. */
export default function ThreadScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ number?: string }>();
  const number = normalizePhone(typeof params.number === 'string' ? params.number : '');

  const messages = useMessages((s) => s.messages);
  const sendingTo = useMessages((s) => s.sendingTo);
  const lastError = useMessages((s) => s.lastError);
  const lastSyncAt = useMessages((s) => s.lastSyncAt);
  const send = useMessages((s) => s.send);
  const sync = useMessages((s) => s.sync);
  const markRead = useMessages((s) => s.markRead);
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);

  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // Read state: clear the unread count on focus and again after each sync.
  useFocusEffect(
    useCallback(() => {
      if (number) markRead(number);
    }, [number, markRead])
  );
  useEffect(() => {
    if (number && lastSyncAt != null) markRead(number);
  }, [number, lastSyncAt, markRead]);

  const clientName = useMemo(
    () => clientNameForPhone(meta, number, knownClients(tasks)),
    [meta, number, tasks]
  );

  /** Earliest uncompleted booking for the linked client in the next 30 days. */
  const nextBooking = useMemo(() => {
    if (!clientName) return null;
    const key = clientName.trim().toLowerCase();
    const today = todayKey();
    const days = Array.from({ length: 31 }, (_, i) => addDays(today, i));
    const upcoming = meetingOccurrences(tasks, days)
      .filter((o) => !o.completed && o.client.trim().toLowerCase() === key)
      .sort((a, b) =>
        a.dateKey !== b.dateKey
          ? a.dateKey < b.dateKey
            ? -1
            : 1
          : (a.task.startMinutes ?? 0) - (b.task.startMinutes ?? 0)
      );
    return upcoming[0] ?? null;
  }, [clientName, tasks]);

  const msgs = useMemo(() => threadMessages(messages, number), [messages, number]);

  /** Chronological rows with day separators, reversed for the inverted list. */
  const rows = useMemo<Row[]>(() => {
    let lastOutSid: string | null = null;
    for (const m of msgs) if (m.direction === 'out') lastOutSid = m.sid;
    const out: Row[] = [];
    let prevDay: DayKey | null = null;
    for (const m of msgs) {
      const day = toDayKey(new Date(m.sentAt));
      if (day !== prevDay) {
        out.push({ type: 'day', key: `day-${day}`, day });
        prevDay = day;
      }
      out.push({
        type: 'message',
        key: m.sid,
        msg: m,
        // Only surface real problems — queued/sending settle on their own
        // (the store re-checks the status after a send).
        showStatus:
          m.sid === lastOutSid && (m.status === 'failed' || m.status === 'undelivered'),
      });
    }
    return out.reverse();
  }, [msgs]);

  const handleSend = useCallback(
    async (body: string) => {
      // The store merges the sent message optimistically and settles its
      // status itself — no full history re-sync needed here (it was the
      // cause of multi-second sends).
      return send(number, body);
    },
    [send, number]
  );

  const subtitle = clientName
    ? nextBooking
      ? `Next: ${formatDayRelative(nextBooking.dateKey)}${
          !nextBooking.task.allDay && nextBooking.task.startMinutes != null
            ? ` · ${formatMinutes(nextBooking.task.startMinutes)}`
            : ''
        }`
      : formatPhoneDisplay(number)
    : null;

  const showError = lastError != null && lastError !== dismissedError;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: theme.background }]}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: theme.separator },
        ]}
      >
        <BackButton />
        <Pressable
          onPress={() => {
            if (!clientName) return;
            tapHaptic();
            router.push(`/client-detail?name=${encodeURIComponent(clientName)}`);
          }}
          disabled={!clientName}
          accessibilityRole={clientName ? 'button' : undefined}
          accessibilityLabel={clientName ? `Open ${clientName}` : undefined}
          style={styles.titleCol}
        >
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {clientName ?? formatPhoneDisplay(number)}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
        {clientName ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              router.push(`/task-editor?client=${encodeURIComponent(clientName)}`);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Book a meeting with ${clientName}`}
            style={[styles.calendarBtn, { backgroundColor: theme.surface }]}
          >
            <Ionicons name="calendar-outline" size={18} color={theme.accent} />
          </Pressable>
        ) : null}
      </View>

      {/* Conversation */}
      {rows.length > 0 ? (
        <FlatList
          data={rows}
          inverted
          keyExtractor={(r) => r.key}
          renderItem={({ item }) =>
            item.type === 'day' ? (
              <Text style={[styles.daySep, { color: theme.textTertiary }]}>
                {formatDayRelative(item.day)}
              </Text>
            ) : (
              <MessageBubble msg={item.msg} showStatus={item.showStatus} />
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
            No messages yet — say hello.
          </Text>
        </View>
      )}

      {/* Footer: link row, inline error, composer */}
      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.separator,
            paddingBottom: Math.max(insets.bottom, SPACING.sm) + 4,
          },
        ]}
      >
        {!clientName ? <LinkClientRow number={number} /> : null}
        {showError ? (
          <ErrorBanner message={lastError} onDismiss={() => setDismissedError(lastError)} />
        ) : null}
        <Composer onSend={handleSend} sending={sendingTo === number} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleCol: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  calendarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  daySep: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.sm,
  },
});
