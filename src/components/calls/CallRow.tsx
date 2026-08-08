import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDayRelative, toDayKey } from '../../lib/dates';
import type { CallRow as CallRowData } from '../../store/calls';
import { SPACING, useTheme } from '../../theme';
import { formatClockTime, formatPhoneDisplay } from '../messages/format';

/** Play control state for a voicemail row. */
export type PlayState = 'idle' | 'loading' | 'playing';

interface Props {
  row: CallRowData;
  /** Linked client display name, when the number matched one. */
  name: string | null;
  /** Voicemail not yet listened to — shows the accent dot. */
  unheard: boolean;
  playState: PlayState;
  onPress: () => void;
  onTogglePlay: () => void;
}

/** "2m 10s" / "45s". */
function formatCallDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * One call-log row: direction glyph (missed calls in danger red), name or
 * number, relative day + time + duration, and a play/pause control when the
 * caller left a voicemail.
 */
export function CallRow({ row, name, unheard, playState, onPress, onTogglePlay }: Props) {
  const theme = useTheme();
  const { voicemail } = row;

  const glyphColor = row.missed ? theme.danger : theme.textSecondary;
  const title = name ?? formatPhoneDisplay(row.counterparty);

  const parts = [
    formatDayRelative(toDayKey(new Date(row.startedAt))),
    formatClockTime(row.startedAt),
  ];
  if (voicemail) {
    parts.push(`Voicemail · ${formatCallDuration(voicemail.durationSec)}`);
  } else if (row.durationSec > 0) {
    parts.push(formatCallDuration(row.durationSec));
  } else if (row.missed) {
    parts.push('Missed');
  }

  // The play control sits BESIDE the main press target, not inside it —
  // nested Pressables render nested <button>s on web (invalid DOM).
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${row.missed ? 'Missed call' : row.direction === 'in' ? 'Call from' : 'Call to'} ${title}`}
        style={({ pressed }) => [styles.main, pressed && { backgroundColor: theme.surface }]}
      >
        <View style={[styles.glyph, { backgroundColor: theme.surface }]}>
          <Ionicons
            name={row.direction === 'in' ? 'arrow-down' : 'arrow-up'}
            size={18}
            color={glyphColor}
          />
        </View>
        <View style={styles.textCol}>
          <View style={styles.titleRow}>
            {unheard ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
            <Text
              style={[styles.title, { color: theme.text, fontWeight: unheard ? '700' : '600' }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
          <Text style={[styles.subtitle, { color: theme.textTertiary }]} numberOfLines={1}>
            {parts.join(' · ')}
          </Text>
        </View>
      </Pressable>
      {voicemail ? (
        <Pressable
          onPress={onTogglePlay}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={playState === 'playing' ? 'Pause voicemail' : 'Play voicemail'}
          style={({ pressed }) => [
            styles.playBtn,
            { backgroundColor: theme.surface },
            pressed && { transform: [{ scale: 0.94 }] },
          ]}
        >
          {playState === 'loading' ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <Ionicons
              name={playState === 'playing' ? 'pause' : 'play'}
              size={16}
              color={theme.accent}
            />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: SPACING.lg,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.md,
    paddingVertical: SPACING.md,
  },
  glyph: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 16, letterSpacing: -0.2, flexShrink: 1 },
  subtitle: { fontSize: 13, fontWeight: '500' },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
