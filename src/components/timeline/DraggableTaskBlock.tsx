import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { formatMinutes } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { TaskInstance } from '../../types';
import { TaskCard } from '../TaskCard';
import { MINUTE_SCALE } from './layout';

interface Props {
  instance: TaskInstance;
  /**
   * Window-clamped start minute the block is RENDERED at. Drag math is
   * anchored here (not the task's raw startMinutes) so the visual position
   * and the committed time always agree, even for out-of-window tasks.
   */
  layoutStart: number;
  top: number;
  height: number;
  /** Column placement inside the block area, in percent. */
  leftPct: number;
  widthPct: number;
  /** Start-minute clamp range for dragging. */
  minStart: number;
  maxStart: number;
  onPress: (instance: TaskInstance) => void;
  onToggle: (instance: TaskInstance) => void;
  onOpenMenu: (instance: TaskInstance) => void;
  onCommit: (instance: TaskInstance, newStart: number) => void;
  onDragActive: (active: boolean) => void;
}

/**
 * Timed task block with the signature long-press → vertical drag-to-reschedule
 * interaction. Long-press lifts the card; dragging snaps to 5 minutes with a
 * live time tooltip; releasing without moving opens the action menu instead.
 */
export const DraggableTaskBlock = memo(function DraggableTaskBlock({
  instance,
  layoutStart,
  top,
  height,
  leftPct,
  widthPct,
  minStart,
  maxStart,
  onPress,
  onToggle,
  onOpenMenu,
  onCommit,
  onDragActive,
}: Props) {
  const theme = useTheme();
  const baseStart = layoutStart;

  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const snapped = useSharedValue(baseStart);
  const maxMove = useSharedValue(0);
  const lastQuarter = useSharedValue(Math.floor(baseStart / 15));

  const [tooltipMinutes, setTooltipMinutes] = useState<number | null>(null);

  // After a commit the `top` prop moves to the new slot — drop the temporary
  // translation in the same frame so the card doesn't double-jump.
  useEffect(() => {
    translateY.value = 0;
    snapped.value = baseStart;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, baseStart]);

  const setDragActive = (active: boolean) => {
    onDragActive(active);
    if (!active) setTooltipMinutes(null);
  };

  const openMenu = () => onOpenMenu(instance);
  const commit = (newStart: number) => onCommit(instance, newStart);

  const pan = Gesture.Pan()
    .activateAfterLongPress(300)
    .onStart(() => {
      lifted.value = 1;
      maxMove.value = 0;
      snapped.value = baseStart;
      lastQuarter.value = Math.floor(baseStart / 15);
      runOnJS(tapHaptic)();
      runOnJS(setDragActive)(true);
    })
    .onUpdate((e) => {
      maxMove.value = Math.max(maxMove.value, Math.abs(e.translationY));
      const raw = baseStart + e.translationY / MINUTE_SCALE;
      const next = Math.min(maxStart, Math.max(minStart, Math.round(raw / 5) * 5));
      if (next !== snapped.value) {
        snapped.value = next;
        const quarter = Math.floor(next / 15);
        if (quarter !== lastQuarter.value) {
          lastQuarter.value = quarter;
          runOnJS(selectionHaptic)();
        }
      }
      translateY.value = (snapped.value - baseStart) * MINUTE_SCALE;
    })
    .onEnd(() => {
      if (maxMove.value < 8) {
        // Long-press without movement → contextual menu.
        translateY.value = withSpring(0, { damping: 18, stiffness: 260 });
        runOnJS(openMenu)();
      } else if (snapped.value !== baseStart) {
        runOnJS(commit)(snapped.value);
      } else {
        translateY.value = withSpring(0, { damping: 18, stiffness: 260 });
      }
    })
    .onFinalize(() => {
      lifted.value = 0;
      runOnJS(setDragActive)(false);
    });

  // Push the live tooltip time to JS only when the snapped value changes.
  useAnimatedReaction(
    () => (lifted.value === 1 ? snapped.value : -1),
    (cur, prev) => {
      if (cur !== prev && cur >= 0) runOnJS(setTooltipMinutes)(cur);
    }
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: withTiming(lifted.value === 1 ? 1.03 : 1, { duration: 140 }) },
    ],
    zIndex: lifted.value === 1 ? 100 : 10,
    shadowOpacity: withTiming(lifted.value === 1 ? 0.28 : 0, { duration: 140 }),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.block,
          {
            top,
            height,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            shadowColor: theme.dark ? '#000' : '#0F172A',
          },
          animatedStyle,
        ]}
      >
        {tooltipMinutes != null ? (
          <View style={[styles.tooltip, { backgroundColor: theme.text }]}>
            <Text style={[styles.tooltipText, { color: theme.background }]}>
              {formatMinutes(tooltipMinutes)}
            </Text>
          </View>
        ) : null}
        <TaskCard
          task={instance.task}
          completed={instance.completed}
          dateKey={instance.dateKey}
          onToggle={() => onToggle(instance)}
          onPress={() => onPress(instance)}
          height={height}
        />
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  tooltip: {
    position: 'absolute',
    top: -30,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    zIndex: 101,
  },
  tooltipText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
