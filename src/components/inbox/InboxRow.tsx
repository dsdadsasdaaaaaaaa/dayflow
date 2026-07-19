import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { Task } from '../../types';
import { GlassCard } from '../glass/GlassCard';
import { TaskCard } from '../TaskCard';

interface Props {
  task: Task;
  onToggle: () => void;
  onPress: () => void;
  onLongPress: () => void;
  /** Opens the schedule sheet — our answer to Structured's drag gymnastics. */
  onSchedule: () => void;
}

/** An inbox task row: compact TaskCard plus a trailing one-tap schedule button. */
export function InboxRow({ task, onToggle, onPress, onLongPress, onSchedule }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.cardWrap}>
        <TaskCard
          task={task}
          completed={task.completed}
          onToggle={onToggle}
          onPress={onPress}
          onLongPress={onLongPress}
          compact
        />
      </View>
      <Pressable
        onPress={() => {
          tapHaptic();
          onSchedule();
        }}
        hitSlop={6}
        accessibilityLabel={`Schedule ${task.title}`}
        style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.9 : 1 }] }]}
      >
        <GlassCard radius={21} padding={0}>
          <View style={styles.scheduleBtn}>
            <Ionicons name="calendar-outline" size={19} color={theme.accent} />
          </View>
        </GlassCard>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardWrap: { flex: 1 },
  scheduleBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
