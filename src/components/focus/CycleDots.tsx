import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import type { PomodoroPhase } from './useFocusTimer';

interface Props {
  cycles: number;
  /** 0-based index of the current work slot. */
  cycle: number;
  phase: PomodoroPhase;
  /** Kept for call-site compatibility (design v3 renders static dots). */
  running?: boolean;
}

/** Position indicator for the pomodoro super-cycle: one dot per work slot. */
export function CycleDots({ cycles, cycle, phase }: Props) {
  const theme = useTheme();
  const idle = theme.dark ? theme.surface : theme.border;
  return (
    <View style={styles.row} accessibilityLabel={`Cycle ${cycle + 1} of ${cycles}`}>
      {Array.from({ length: cycles }, (_, i) => {
        const done = i < cycle || (i === cycle && phase !== 'work');
        const active = i === cycle && phase === 'work';
        return (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: done || active ? theme.accent : idle },
              active && styles.dotActive,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotActive: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
