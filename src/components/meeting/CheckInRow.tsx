import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { RADIUS, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

const MIN_MINUTES = 5;
const MAX_MINUTES = 120;

interface Props {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  minutes: number;
  onChangeMinutes: (minutes: number) => void;
}

/**
 * Optional check-in reminder after the meeting ends — a caring nudge to
 * let someone know you're okay. Especially handy for out-calls.
 */
export function CheckInRow({ enabled, onToggle, minutes, onChangeMinutes }: Props) {
  const theme = useTheme();

  const nudge = (delta: number) => {
    tapHaptic();
    onChangeMinutes(Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, minutes + delta)));
  };

  return (
    <GlassCard radius={RADIUS.lg} padding={14}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="shield-checkmark-outline" size={17} color={theme.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.text }]}>Check-in reminder</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {enabled
                ? `We'll remind you to check in with someone ${minutes} min after the meeting ends.`
                : 'A gentle nudge to let someone know you’re okay afterwards.'}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => {
              selectionHaptic();
              onToggle(v);
            }}
            trackColor={{ true: theme.accent, false: theme.surface }}
            accessibilityLabel="Toggle check-in reminder"
          />
        </View>

        {enabled ? (
          <View style={[styles.stepperRow, { borderTopColor: theme.separator }]}>
            <Text style={[styles.stepperLabel, { color: theme.textSecondary }]}>
              Remind me after
            </Text>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => nudge(-5)}
                disabled={minutes <= MIN_MINUTES}
                style={({ pressed }) => [
                  styles.stepBtn,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    opacity: minutes <= MIN_MINUTES ? 0.4 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  },
                ]}
                accessibilityLabel="Fewer minutes"
              >
                <Ionicons name="remove" size={16} color={theme.text} />
              </Pressable>
              <Text style={[styles.minutesLabel, { color: theme.text }]}>{minutes} min</Text>
              <Pressable
                onPress={() => nudge(5)}
                disabled={minutes >= MAX_MINUTES}
                style={({ pressed }) => [
                  styles.stepBtn,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    opacity: minutes >= MAX_MINUTES ? 0.4 : 1,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  },
                ]}
                accessibilityLabel="More minutes"
              >
                <Ionicons name="add" size={16} color={theme.text} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  inner: { gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  subtitle: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  stepperLabel: { fontSize: 13, fontWeight: '500' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minutesLabel: {
    fontSize: 15,
    fontWeight: '700',
    minWidth: 56,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
