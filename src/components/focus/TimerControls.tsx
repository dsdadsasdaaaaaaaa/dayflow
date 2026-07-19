import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { useTheme, type Theme } from '../../theme';
import type { FocusMode } from '../../types';
import type { TimerStatus } from './useFocusTimer';

interface Props {
  status: TimerStatus;
  mode: FocusMode;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSkip: () => void;
}

/** Reset · big solid accent Start/Pause/Resume · Skip (pomodoro). */
export function TimerControls({
  status,
  mode,
  onStart,
  onPause,
  onResume,
  onReset,
  onSkip,
}: Props) {
  const theme = useTheme();
  const active = status !== 'idle';

  const primaryLabel = status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start';
  const primaryIcon = status === 'running' ? 'pause' : 'play';
  const onPrimary = status === 'running' ? onPause : status === 'paused' ? onResume : onStart;

  return (
    <View style={styles.row}>
      <SecondaryButton
        icon="refresh"
        label="Reset"
        enabled={active}
        onPress={onReset}
        theme={theme}
      />
      <PrimaryButton
        label={primaryLabel}
        icon={primaryIcon}
        theme={theme}
        onPress={() => {
          tapHaptic();
          onPrimary();
        }}
      />
      {mode === 'pomodoro' ? (
        <SecondaryButton
          icon="play-skip-forward"
          label="Skip phase"
          enabled={active}
          onPress={() => {
            selectionHaptic();
            onSkip();
          }}
          theme={theme}
        />
      ) : (
        <View style={styles.ghost} />
      )}
    </View>
  );
}

/** Solid accent pill. */
function PrimaryButton({
  label,
  icon,
  theme,
  onPress,
}: {
  label: string;
  icon: 'play' | 'pause';
  theme: Theme;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.primary,
        {
          backgroundColor: theme.accent,
          transform: [{ scale: pressed ? 0.96 : 1 }],
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color="#fff" />
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

/** Flat circle. */
function SecondaryButton({
  icon,
  label,
  enabled,
  onPress,
  theme,
}: {
  icon: 'refresh' | 'play-skip-forward';
  label: string;
  enabled: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.secondary,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          opacity: enabled ? (pressed ? 0.7 : 1) : 0.35,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 58,
    minWidth: 168,
    paddingHorizontal: 32,
    borderRadius: 29,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondary: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    width: 52,
    height: 52,
  },
});
