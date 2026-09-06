import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMinutes } from '../../lib/dates';
import { taskColor, useTheme } from '../../theme';
import type { TaskInstance } from '../../types';

interface Props {
  top: number;
  height: number;
  widthPct: number;
  /** Every class in the day, in order. */
  classes: TaskInstance[];
  startMinutes: number;
  endMinutes: number;
  /** Minutes into today, or null on any other day. */
  nowMinutes: number | null;
  onPress: () => void;
}

/**
 * The whole school day as one block.
 *
 * A timetable is eight back-to-back periods from half past eight to half
 * past four. Drawn as eight cards that is an eight-hour wall down the
 * timeline every weekday — the planner stops being a plan and becomes a
 * picture of a school day, with the two things actually worth doing lost
 * somewhere inside it.
 *
 * The information a person wants from a fixed timetable at a glance is
 * "school, until half four" and, during it, "what am I in now". Both fit in
 * one block. The eight periods are still there, one tap away, which is
 * roughly how often they are needed.
 */
export function SchoolBand({
  top,
  height,
  widthPct,
  classes,
  startMinutes,
  endMinutes,
  nowMinutes,
  onPress,
}: Props) {
  const theme = useTheme();
  const c = taskColor('sky');
  const fg = theme.dark ? c.fgDark : c.fgLight;

  const current =
    nowMinutes == null
      ? null
      : (classes.find((i) => {
          const s = i.task.startMinutes ?? -1;
          return s <= nowMinutes && nowMinutes < s + i.task.durationMinutes;
        }) ?? null);

  const next =
    nowMinutes == null
      ? null
      : (classes.find((i) => (i.task.startMinutes ?? -1) > nowMinutes) ?? null);

  const subtitle = current
    ? `Now: ${current.task.title}`
    : next
      ? `Next: ${next.task.title}`
      : `${classes.length} classes`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`School day, ${formatMinutes(startMinutes)} to ${formatMinutes(
        endMinutes
      )}, ${classes.length} classes. Tap to see them.`}
      style={({ pressed }) => [
        styles.band,
        {
          top,
          height,
          width: `${widthPct}%`,
          backgroundColor: theme.dark ? `${c.solid}1F` : c.bgLight,
          borderColor: theme.dark ? `${c.solid}44` : `${c.solid}33`,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.stripe, { backgroundColor: c.solid }]} />
      <View style={styles.body}>
        <Text style={[styles.time, { color: theme.textTertiary }]} numberOfLines={1}>
          {`${formatMinutes(startMinutes)} – ${formatMinutes(endMinutes)}`}
        </Text>
        <View style={styles.titleRow}>
          <Ionicons name="school" size={14} color={fg} />
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            School
          </Text>
        </View>
        <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={2}>
          {subtitle}
        </Text>
        {current?.task.notes ? (
          <Text style={[styles.sub, { color: theme.textTertiary }]} numberOfLines={1}>
            {current.task.notes.split('\n')[0]}
          </Text>
        ) : null}
      </View>
      <View style={styles.expandHint}>
        <Ionicons name="chevron-expand-outline" size={13} color={theme.textTertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  stripe: { width: 3, borderRadius: 2, marginLeft: 5, marginVertical: 8 },
  body: { flex: 1, paddingHorizontal: 9, paddingVertical: 8, gap: 1 },
  time: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontSize: 14, fontWeight: '800' },
  sub: { fontSize: 11, fontWeight: '500', lineHeight: 14 },
  expandHint: { paddingRight: 6, paddingTop: 8 },
});
