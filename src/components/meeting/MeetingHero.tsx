import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { formatDayRelative, formatMinutes } from '../../lib/dates';
import { formatMoney, meetingKindMeta, occurrenceAmount } from '../../lib/meetings';
import { useSettings } from '../../store/settings';
import { useTheme } from '../../theme';
import type { DayKey, Task } from '../../types';

interface Props {
  task: Task | null;
  dateKey: DayKey;
  /** Compact single-row variant for the live-timer header. */
  compact?: boolean;
}

/**
 * Meeting identity block: client (or task title), kind chip, rate,
 * location and scheduled time. Compact mode collapses to one row.
 */
export function MeetingHero({ task, dateKey, compact = false }: Props) {
  const theme = useTheme();
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const meeting = task?.meeting ?? null;
  const name = meeting?.client?.trim() || task?.title || 'Meeting';
  const kind = meeting ? meetingKindMeta(meeting.kind) : null;
  const amount = task && meeting ? occurrenceAmount(task, dateKey) : null;

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={[styles.compactIcon, { backgroundColor: theme.accent }]}>
          <Ionicons name={(task?.icon ?? 'briefcase-outline') as never} size={16} color="#fff" />
        </View>
        <View style={styles.compactText}>
          <Text numberOfLines={1} style={[styles.compactName, { color: theme.text }]}>
            {name}
          </Text>
          <Text numberOfLines={1} style={[styles.compactMeta, { color: theme.textSecondary }]}>
            {[kind?.label, amount != null ? formatMoney(amount, symbol) : null]
              .filter(Boolean)
              .join(' · ') || 'Live session'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.hero}>
      <View style={[styles.iconCircle, { backgroundColor: theme.accent }]}>
        <Ionicons name={(task?.icon ?? 'briefcase-outline') as never} size={30} color="#fff" />
      </View>
      <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>
        {name}
      </Text>

      <View style={styles.chipRow}>
        {kind ? (
          <View
            style={[
              styles.chip,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons name={kind.icon as never} size={13} color={theme.accent} />
            <Text style={[styles.chipLabel, { color: theme.accent }]}>{kind.label}</Text>
          </View>
        ) : null}
        {amount != null ? (
          <View style={[styles.moneyChip, { backgroundColor: theme.success }]}>
            <Ionicons name="cash-outline" size={13} color="#fff" />
            <Text style={[styles.chipLabel, styles.moneyLabel]}>
              {formatMoney(amount, symbol)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.detailBlock}>
        {task ? (
          <View style={styles.detailRow}>
            <Ionicons name="time-outline" size={14} color={theme.textTertiary} />
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>
              {formatDayRelative(dateKey)}
              {!task.allDay && task.startMinutes != null
                ? ` · ${formatMinutes(task.startMinutes)}`
                : task.allDay
                  ? ' · All day'
                  : ''}
            </Text>
          </View>
        ) : null}
        {meeting?.location?.trim() ? (
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={14} color={theme.textTertiary} />
            <Text
              style={[styles.detailLabel, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {meeting.location.trim()}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 12 },
  iconCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.8,
    paddingHorizontal: 24,
  },
  chipRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: { fontSize: 13, fontWeight: '700' },
  moneyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  moneyLabel: { color: '#fff', fontVariant: ['tabular-nums'] },
  detailBlock: { gap: 6, alignItems: 'center', marginTop: 2 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 32,
  },
  detailLabel: { fontSize: 13, fontWeight: '500', textAlign: 'center' },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  compactIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactText: { flex: 1, gap: 1 },
  compactName: { fontSize: 15, fontWeight: '700' },
  compactMeta: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
