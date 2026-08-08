import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  formatDayRelative,
  formatDuration,
  formatMinutes,
  fromDayKey,
  lastNDays,
  toDayKey,
  todayKey,
} from '../../lib/dates';
import { formatMoney, meetingKindMeta, meetingOccurrences } from '../../lib/meetings';
import { normalizePhone } from '../../lib/smsCredentials';
import { buildCallRows, useCalls } from '../../store/calls';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { useMeetingSession } from '../../store/meetingSession';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { SPACING, taskColor, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';
import { formatClockTime } from '../messages/format';

/** How far back the meeting-occurrence walk looks. */
const WINDOW_DAYS = 90;
/** Newest-first feed cap. */
const MAX_EVENTS = 30;

type EventTint = 'success' | 'amber' | 'accent' | 'danger' | 'muted';

interface ActivityEvent {
  key: string;
  /** Epoch ms sort key, newest first. */
  at: number;
  icon: string;
  tint: EventTint;
  title: string;
  /** "Yesterday · 2:45 PM". */
  when: string;
  /** Second caption line (call note), one-line clamped. */
  note?: string;
  /** Right-aligned amount / duration. */
  right?: string;
  /** Money-green right slot (amounts); muted otherwise. */
  rightMoney?: boolean;
}

interface Props {
  client: string;
}

/** "Yesterday · 2:45 PM" for an epoch-ms timestamp. */
function whenFor(at: number): string {
  return `${formatDayRelative(toDayKey(new Date(at)))} · ${formatClockTime(at)}`;
}

/**
 * Chronological merged activity feed for one client: completed / no-show
 * meeting occurrences, live-session log entries, and calls / voicemails on
 * the client's linked phone number. Renders nothing when there is no
 * activity, so the mounting screen's section disappears entirely.
 */
export function ActivityTimeline({ client }: Props) {
  const theme = useTheme();
  const tasks = useTasks((s) => s.tasks);
  const log = useMeetingSession((s) => s.log);
  const calls = useCalls((s) => s.calls);
  const voicemails = useCalls((s) => s.voicemails);
  const callNotes = useCalls((s) => s.callNotes);
  const phone = useClientMeta((s) => s.meta[clientMetaKey(client)]?.phone ?? '');
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const events = useMemo(() => {
    const key = client.trim().toLowerCase();
    if (!key) return [];
    const out: ActivityEvent[] = [];
    const today = todayKey();

    // Meeting occurrences: completed ones earn; no-shows show the tag.
    for (const o of meetingOccurrences(tasks, lastNDays(WINDOW_DAYS))) {
      if (o.client.trim().toLowerCase() !== key) continue;
      if (o.dateKey > today) continue;
      const noShow = o.task.meeting?.noShows?.includes(o.dateKey) ?? false;
      if (!o.completed && !noShow) continue;
      const timed = !o.task.allDay && o.task.startMinutes != null;
      const at =
        fromDayKey(o.dateKey).getTime() +
        (timed ? (o.task.startMinutes as number) : 12 * 60) * 60000;
      out.push({
        key: `mtg-${o.task.id}-${o.dateKey}`,
        at,
        icon: meetingKindMeta(o.kind).icon,
        tint: noShow ? 'amber' : 'success',
        title: noShow ? 'No-show' : `${meetingKindMeta(o.kind).label} meeting`,
        when: timed
          ? `${formatDayRelative(o.dateKey)} · ${formatMinutes(o.task.startMinutes as number)}`
          : formatDayRelative(o.dateKey),
        right: noShow ? undefined : formatMoney(o.rate, symbol),
        rightMoney: !noShow,
      });
    }

    // Live-session log entries (actual time spent).
    for (const e of log) {
      if (e.client.trim().toLowerCase() !== key) continue;
      out.push({
        key: `log-${e.id}`,
        at: e.endedAt,
        icon: 'timer-outline',
        tint: 'accent',
        title: 'Live session',
        when: whenFor(e.endedAt),
        right: formatDuration(e.actualMinutes),
      });
    }

    // Calls + voicemails on the linked number (voicemail implies the miss).
    const target = phone ? normalizePhone(phone) : '';
    if (target) {
      for (const row of buildCallRows({ calls, voicemails })) {
        if (normalizePhone(row.counterparty) !== target) continue;
        const note = callNotes[row.sid];
        if (row.voicemail) {
          out.push({
            key: `call-${row.sid}`,
            at: row.startedAt,
            icon: 'mic-outline',
            tint: 'muted',
            title: 'Voicemail',
            when: whenFor(row.startedAt),
            note,
          });
        } else {
          out.push({
            key: `call-${row.sid}`,
            at: row.startedAt,
            icon: 'call-outline',
            tint: row.missed ? 'danger' : 'muted',
            title: row.missed
              ? 'Missed call'
              : row.direction === 'in'
                ? 'Incoming call'
                : 'Outgoing call',
            when: whenFor(row.startedAt),
            note,
          });
        }
      }
    }

    return out.sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
  }, [tasks, log, calls, voicemails, callNotes, phone, client, symbol]);

  if (events.length === 0) return null;

  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;
  const tintColor = (tint: EventTint): string => {
    switch (tint) {
      case 'success':
        return theme.success;
      case 'amber':
        return amberFg;
      case 'accent':
        return theme.accent;
      case 'danger':
        return theme.danger;
      case 'muted':
        return theme.textSecondary;
    }
  };

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Activity</Text>
      <GlassCard padding={6}>
        {events.map((e, i) => (
          <View
            key={e.key}
            accessible
            accessibilityLabel={`${e.title}, ${e.when}${e.right ? `, ${e.right}` : ''}${
              e.note ? `, note: ${e.note}` : ''
            }`}
            style={[
              styles.row,
              i > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: theme.separator,
              },
            ]}
          >
            <View style={[styles.glyph, { backgroundColor: theme.surface }]}>
              <Ionicons name={e.icon as never} size={15} color={tintColor(e.tint)} />
            </View>
            <View style={styles.body}>
              <Text
                style={[
                  styles.title,
                  { color: e.tint === 'amber' ? amberFg : theme.text },
                ]}
                numberOfLines={1}
              >
                {e.title}
              </Text>
              <Text style={[styles.when, { color: theme.textTertiary }]} numberOfLines={1}>
                {e.when}
              </Text>
              {e.note ? (
                <Text style={[styles.note, { color: theme.textSecondary }]} numberOfLines={1}>
                  {e.note}
                </Text>
              ) : null}
            </View>
            {e.right ? (
              <Text
                style={[
                  styles.right,
                  { color: e.rightMoney ? theme.success : theme.textSecondary },
                ]}
              >
                {e.right}
              </Text>
            ) : null}
          </View>
        ))}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches client-detail's SectionLabel styling.
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm + 2,
  },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 1, minWidth: 0 },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  when: {
    fontSize: 12,
  },
  note: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 1,
  },
  right: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
});
