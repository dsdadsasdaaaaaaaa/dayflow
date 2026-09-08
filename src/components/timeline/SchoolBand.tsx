import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMinutes } from '../../lib/dates';
import { taskColor, useTheme } from '../../theme';
import type { TaskInstance } from '../../types';
import { MINUTE_SCALE } from './layout';

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
  onPressClass: (instance: TaskInstance) => void;
}

/**
 * The school day as one quiet container, with every period inside it at its
 * real time.
 *
 * Eight periods drawn as eight task cards was an eight-hour wall — each with
 * an icon, a checkbox, a caption and a title, all saying the same thing:
 * you are at school. But collapsing them to a single block threw away the
 * one thing a timetable is for, which is knowing what you are in and where.
 *
 * So: one soft band the length of the day, and inside it a line per period
 * — time, subject, room — sitting exactly where it falls. No cards, no
 * checkboxes, nothing to complete. The current period is the only one that
 * draws attention to itself. It reads as a timetable pinned to the wall,
 * which is what it is, and leaves the rest of the timeline for the day's
 * own business.
 */
export function SchoolBand({
  top,
  height,
  widthPct,
  classes,
  startMinutes,
  endMinutes,
  nowMinutes,
  onPressClass,
}: Props) {
  const theme = useTheme();
  const c = taskColor('sky');
  const fg = theme.dark ? c.fgDark : c.fgLight;

  const inSchool = nowMinutes != null && nowMinutes >= startMinutes && nowMinutes < endMinutes;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.band,
        {
          top,
          height,
          width: `${widthPct}%`,
          backgroundColor: theme.dark ? `${c.solid}14` : `${c.solid}0F`,
          borderColor: theme.dark ? `${c.solid}33` : `${c.solid}2A`,
        },
      ]}
    >
      <View style={styles.head} pointerEvents="none">
        <Ionicons name="school" size={11} color={fg} />
        <Text style={[styles.headLabel, { color: fg }]} numberOfLines={1}>
          {`School · ${formatMinutes(startMinutes)} – ${formatMinutes(endMinutes)}`}
        </Text>
      </View>

      {classes.map((i) => {
        const start = i.task.startMinutes ?? startMinutes;
        const rowTop = (start - startMinutes) * MINUTE_SCALE;
        const rowHeight = Math.max(18, i.task.durationMinutes * MINUTE_SCALE);
        const current = inSchool && nowMinutes! >= start && nowMinutes! < start + i.task.durationMinutes;
        const past = nowMinutes != null && nowMinutes >= start + i.task.durationMinutes;
        const room = i.task.notes.split(' · ')[0]?.trim();
        return (
          <Pressable
            key={i.task.id}
            onPress={() => onPressClass(i)}
            accessibilityRole="button"
            accessibilityLabel={`${i.task.title}, ${formatMinutes(start)}${room ? `, ${room}` : ''}${
              current ? ', now' : ''
            }`}
            style={({ pressed }) => [
              styles.row,
              { top: rowTop, height: rowHeight },
              current && {
                backgroundColor: theme.dark ? `${c.solid}2E` : `${c.solid}22`,
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            <View
              style={[
                styles.stripe,
                { backgroundColor: current ? c.solid : theme.dark ? `${c.solid}66` : `${c.solid}55` },
              ]}
            />
            <Text
              style={[
                styles.time,
                { color: current ? fg : theme.textTertiary },
                past && !current && styles.past,
              ]}
            >
              {formatMinutes(start)}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.title,
                { color: current ? theme.text : theme.textSecondary },
                current && styles.titleNow,
                past && !current && styles.past,
              ]}
            >
              {i.task.title}
            </Text>
            {room ? (
              <Text
                numberOfLines={1}
                style={[styles.room, { color: theme.textTertiary }, past && !current && styles.past]}
              >
                {room}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    position: 'absolute',
    top: 6,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 2,
  },
  headLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 10,
  },
  stripe: { width: 3, alignSelf: 'stretch', marginVertical: 3, borderRadius: 2 },
  time: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], width: 58 },
  title: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  titleNow: { fontWeight: '800' },
  room: { fontSize: 11, fontWeight: '500', marginLeft: 'auto', flexShrink: 0 },
  past: { opacity: 0.55 },
});
