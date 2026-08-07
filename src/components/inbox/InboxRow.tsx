import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  SwipeableMethods,
  SwipeDirection,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { RADIUS, useTheme } from '../../theme';
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
  /**
   * Swipe-to-delete (left swipe). The caller owns capture + undo.
   * Omit to disable swiping entirely (e.g. rows without destructive actions).
   */
  onDelete?: () => void;
  /** Bulk-select mode: taps toggle selection instead of opening the editor. */
  selectionMode?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
}

/**
 * An inbox task row: compact TaskCard plus a trailing one-tap schedule button.
 * Swipe right to complete; swipe left for schedule/delete. In selection mode
 * a leading checkbox appears and every tap toggles selection instead.
 */
export function InboxRow({
  task,
  onToggle,
  onPress,
  onLongPress,
  onSchedule,
  onDelete,
  selectionMode = false,
  selected = false,
  onSelectToggle,
}: Props) {
  const theme = useTheme();
  const swipeRef = useRef<SwipeableMethods>(null);

  const closeSwipe = () => swipeRef.current?.close();

  const handleSchedule = () => {
    tapHaptic();
    onSchedule();
  };

  const handleSelect = () => {
    tapHaptic();
    onSelectToggle?.();
  };

  const rowContent = (
    <View style={styles.row}>
      {selectionMode ? (
        <Pressable
          onPress={handleSelect}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={`${selected ? 'Deselect' : 'Select'} ${task.title}`}
        >
          <View
            style={[
              styles.selectCircle,
              selected
                ? { backgroundColor: theme.accent, borderColor: theme.accent }
                : { borderColor: theme.textTertiary },
            ]}
          >
            {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
          </View>
        </Pressable>
      ) : null}
      <View style={styles.cardWrap}>
        <TaskCard
          task={task}
          completed={task.completed}
          onToggle={selectionMode ? (onSelectToggle ?? onToggle) : onToggle}
          onPress={selectionMode ? (onSelectToggle ?? onPress) : onPress}
          onLongPress={selectionMode ? undefined : onLongPress}
          compact
        />
      </View>
      {!selectionMode ? (
        <Pressable
          onPress={handleSchedule}
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
      ) : null}
    </View>
  );

  // Selection mode (or callers without a delete handler) render a plain row.
  if (selectionMode || !onDelete) return rowContent;

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1.4}
      overshootFriction={4}
      leftThreshold={64}
      rightThreshold={48}
      onSwipeableOpen={(direction) => {
        // Right-swipe (left panel) fully opened → complete.
        if (direction === SwipeDirection.RIGHT) {
          closeSwipe();
          successHaptic();
          onToggle();
        }
      }}
      renderLeftActions={() => (
        <View style={[styles.leftAction, { backgroundColor: theme.success }]}>
          <Ionicons name="checkmark-circle" size={24} color="#fff" />
        </View>
      )}
      renderRightActions={() => (
        <View style={styles.rightActions}>
          <Pressable
            onPress={() => {
              closeSwipe();
              handleSchedule();
            }}
            accessibilityLabel={`Schedule ${task.title}`}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="calendar-outline" size={20} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => {
              closeSwipe();
              warningHaptic();
              onDelete();
            }}
            accessibilityLabel={`Delete ${task.title}`}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: theme.danger, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </Pressable>
        </View>
      )}
    >
      {rowContent}
    </ReanimatedSwipeable>
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
  selectCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftAction: {
    flex: 1,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    paddingLeft: 20,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingLeft: 8,
  },
  actionBtn: {
    width: 56,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
