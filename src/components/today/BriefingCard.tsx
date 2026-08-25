import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildBriefing, type Briefing, type BriefingGap } from '../../lib/briefing';
import { todayKey } from '../../lib/dates';
import { formatQuietShort, type FollowUpThread } from '../../lib/followUps';
import { tapHaptic } from '../../lib/haptics';
import { formatMoney } from '../../lib/meetings';
import { useClientMeta } from '../../store/clientMeta';
import { useMeetingSession } from '../../store/meetingSession';
import { buildThreads, useMessages } from '../../store/messages';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { buildTelegramThreads, useTelegram } from '../../store/telegramAccount';
import { RADIUS, SPACING, taskColor, useTheme } from '../../theme';

/** Day key the user dismissed the briefing for (one day at a time). */
const DISMISS_KEY = 'dayflow-briefing-dismissed';

/** "next at 2 PM" drifts — refresh the summary on a lazy clock. */
const TICK_MS = 5 * 60_000;

/** Never more than this many rows: a briefing, not a backlog. */
const MAX_ROWS = 4;

interface RowSpec {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Right-hand value (money, a duration, a time range). */
  value?: string;
  valueColor?: string;
  route: string;
  a11y: string;
}

function BriefingRow({
  row,
  onPress,
}: {
  row: RowSpec;
  onPress: (row: RowSpec) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={row.a11y}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={row.icon} size={15} color={theme.accent} />
      <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>
        {row.label}
      </Text>
      {row.value ? (
        <Text
          style={[styles.rowValue, { color: row.valueColor ?? theme.textSecondary }]}
          numberOfLines={1}
        >
          {row.value}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={14} color={theme.textTertiary} />
    </Pressable>
  );
}

/** The gap worth offering first: this evening if there is one, else the next. */
function pickGap(briefing: Briefing): BriefingGap | null {
  return briefing.eveningGaps[0] ?? briefing.gaps[0] ?? null;
}

/**
 * Morning briefing at the top of the Today timeline: what the day holds, who
 * is waiting, who is due a rebook, what is still owed, and where the open
 * windows are. Every fact is computed on-device from the stores — no model,
 * no network — so it is instant and works offline.
 *
 * Shown only on today's date, only until the user dismisses it for that day,
 * and never when there is nothing worth saying.
 */
export function BriefingCard() {
  const theme = useTheme();
  const router = useRouter();

  const [day, setDay] = useState<string>(() => todayKey());
  // undefined = still reading the dismissal from storage; render nothing
  // until we know, so the card never flashes in and straight back out.
  const [dismissedDay, setDismissedDay] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const tasks = useTasks((s) => s.tasks);
  const settings = useSettings((s) => s.settings);
  const log = useMeetingSession((s) => s.log);
  const meta = useClientMeta((s) => s.meta);
  const messages = useMessages((s) => s.messages);
  const lastReadAt = useMessages((s) => s.lastReadAt);
  const followUpSnoozedUntil = useMessages((s) => s.followUpSnoozedUntil);
  const followUpDismissed = useMessages((s) => s.followUpDismissed);
  const tgMessages = useTelegram((s) => s.messages);
  const tgLastReadAt = useTelegram((s) => s.lastReadAt);
  const tgImportedChatIds = useTelegram((s) => s.importedChatIds);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(DISMISS_KEY)
      .then((stored) => {
        if (alive) setDismissedDay(stored);
      })
      .catch(() => {
        if (alive) setDismissedDay(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Roll the day over (and re-tick the clock) whenever the tab regains focus,
  // so yesterday's dismissal never hides this morning's briefing.
  useFocusEffect(
    useCallback(() => {
      setDay(todayKey());
      setNow(Date.now());
      const id = setInterval(() => {
        setDay(todayKey());
        setNow(Date.now());
      }, TICK_MS);
      return () => clearInterval(id);
    }, [])
  );

  const hidden = dismissedDay === undefined || dismissedDay === day;

  /** Both channels, in the structural shape the follow-up pass needs. */
  const threads = useMemo<FollowUpThread[]>(() => {
    if (hidden) return [];
    const sms = buildThreads(messages, lastReadAt).map<FollowUpThread>((t) => ({
      counterparty: t.counterparty,
      channel: 'sms',
      lastMessage: { direction: t.lastMessage.direction, sentAt: t.lastMessage.sentAt },
    }));
    const tg = buildTelegramThreads({
      messages: tgMessages,
      lastReadAt: tgLastReadAt,
      importedChatIds: tgImportedChatIds,
    }).map<FollowUpThread>((t) => ({
      counterparty: t.counterparty,
      channel: 'telegram',
      lastMessage: { direction: t.lastMessage.direction, sentAt: t.lastMessage.sentAt },
    }));
    return [...sms, ...tg];
  }, [hidden, messages, lastReadAt, tgMessages, tgLastReadAt, tgImportedChatIds]);

  // Skipped entirely while hidden: the client-book and rebook passes walk a
  // year of occurrences, and a dismissed card should cost nothing.
  const briefing = useMemo<Briefing | null>(() => {
    if (hidden) return null;
    return buildBriefing({
      tasks,
      settings,
      log,
      meta,
      threads,
      followUpSnoozedUntil,
      followUpDismissed,
      now,
      day,
    });
  }, [
    hidden,
    tasks,
    settings,
    log,
    meta,
    threads,
    followUpSnoozedUntil,
    followUpDismissed,
    now,
    day,
  ]);

  const dismiss = useCallback(() => {
    tapHaptic();
    setDismissedDay(day);
    void AsyncStorage.setItem(DISMISS_KEY, day).catch(() => {});
  }, [day]);

  const openRow = useCallback(
    (row: RowSpec) => {
      tapHaptic();
      router.push(row.route);
    },
    [router]
  );

  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;
  const symbol = settings.currencySymbol;

  const rows = useMemo<RowSpec[]>(() => {
    if (!briefing) return [];
    const out: RowSpec[] = [];
    const { waiting, overdue, outstanding } = briefing;

    if (waiting.count > 0) {
      const who =
        waiting.count === 1 && waiting.topName
          ? `${waiting.topName} is waiting on a reply`
          : `${waiting.count} ${waiting.count === 1 ? 'person' : 'people'} waiting on a reply`;
      out.push({
        key: 'waiting',
        icon: 'chatbubble-ellipses-outline',
        label: who,
        value: waiting.longestQuietMs > 0 ? formatQuietShort(waiting.longestQuietMs) : undefined,
        route: '/messages',
        a11y: `${who}. Open messages.`,
      });
    }

    if (overdue.count > 0) {
      const label =
        overdue.count === 1 && overdue.topClient
          ? `${overdue.topClient} is due a rebook`
          : `${overdue.count} regulars due a rebook`;
      out.push({
        key: 'overdue',
        icon: 'repeat-outline',
        label,
        value: overdue.topOverdueDays > 0 ? `${overdue.topOverdueDays}d over` : undefined,
        route: '/clients',
        a11y: `${label}. Open clients.`,
      });
    }

    if (outstanding.amount > 0) {
      const label =
        outstanding.clientCount === 1 && outstanding.topClient
          ? `${outstanding.topClient} still owes`
          : `${outstanding.clientCount} clients still owe`;
      const money = formatMoney(outstanding.amount, symbol);
      out.push({
        key: 'outstanding',
        icon: 'cash-outline',
        label,
        value: money,
        valueColor: amberFg,
        route: '/clients',
        a11y: `${label} ${money}. Open clients.`,
      });
    }

    const gap = pickGap(briefing);
    if (gap && out.length < MAX_ROWS) {
      const label = gap.evening ? 'Open this evening' : 'Open today';
      out.push({
        key: 'gap',
        icon: 'time-outline',
        label,
        value: gap.label,
        route: `/task-editor?date=${briefing.day}&startMinutes=${gap.startMinutes}`,
        a11y: `${label}, ${gap.label}. Add something to this window.`,
      });
    }

    return out.slice(0, MAX_ROWS);
  }, [briefing, symbol, amberFg]);

  if (!briefing || briefing.empty) return null;

  const expected = briefing.meetings.expected;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      accessibilityLabel={`Today's briefing. ${briefing.headline}`}
    >
      <View style={styles.header}>
        <Ionicons name="sunny-outline" size={16} color={theme.accent} />
        <Text style={[styles.headline, { color: theme.text }]} numberOfLines={2}>
          {briefing.headline}
        </Text>
        <Pressable
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss today's briefing"
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.5 }]}
        >
          <Ionicons name="close" size={16} color={theme.textTertiary} />
        </Pressable>
      </View>

      {expected > 0 ? (
        <Text style={[styles.money, { color: theme.success }]}>
          {formatMoney(expected, symbol)} on the books today
        </Text>
      ) : null}

      {rows.length > 0 ? (
        <View style={[styles.rows, { borderTopColor: theme.separator }]}>
          {rows.map((row) => (
            <BriefingRow key={row.key} row={row} onPress={openRow} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm + 2,
    paddingBottom: SPACING.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  headline: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  close: {
    paddingLeft: SPACING.xs,
  },
  money: {
    marginTop: 2,
    marginLeft: 16 + SPACING.sm,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rows: {
    marginTop: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + 1,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
