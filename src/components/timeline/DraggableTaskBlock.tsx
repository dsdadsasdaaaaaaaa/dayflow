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
import { MIN_BLOCK_HEIGHT, MINUTE_SCALE } from './layout';

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
  /**
   * Bottom-edge resize: called on release with the new duration (5-min
   * snapped, min 15). Optional — resizing still previews without it, but
   * snaps back unless the owner commits the new duration.
   */
  onResize?: (instance: TaskInstance, newDurationMinutes: number) => void;
}

/**
 * Timed task block with the signature long-press → vertical drag-to-reschedule
 * interaction. Long-press lifts the card; dragging snaps to 5 minutes with a
 * live time tooltip; releasing without moving opens the action menu instead.
 * A bottom-edge strip resizes the block (duration) with the same snapping.
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
  onResize,
}: Props) {
  const theme = useTheme();
  const baseStart = layoutStart;
  const baseDuration = instance.task.durationMinutes;
  /** Anchor for the END-time tooltip (raw start when known). */
  const endAnchor = instance.task.startMinutes ?? layoutStart;
  const maxDuration = Math.max(15, 24 * 60 - endAnchor);

  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const snapped = useSharedValue(baseStart);
  const maxMove = useSharedValue(0);
  const lastQuarter = useSharedValue(Math.floor(baseStart / 15));

  const resizing = useSharedValue(0);
  const snappedDuration = useSharedValue(baseDuration);

  const [tooltipMinutes, setTooltipMinutes] = useState<number | null>(null);
  /** Live duration while resizing (kept until the committed prop arrives). */
  const [liveDuration, setLiveDuration] = useState<number | null>(null);
  const [resizeEndMinutes, setResizeEndMinutes] = useState<number | null>(null);

  // After a commit the `top` prop moves to the new slot — drop the temporary
  // translation in the same frame so the card doesn't double-jump.
  useEffect(() => {
    translateY.value = 0;
    snapped.value = baseStart;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, baseStart]);

  // Same idea for resize: the committed duration re-derives `height`, so the
  // temporary live height is released once the props catch up.
  useEffect(() => {
    setLiveDuration(null);
    setResizeEndMinutes(null);
  }, [height, baseDuration]);

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

  // ── Bottom-edge resize ─────────────────────────────────────────────────────

  const setResizePreview = (dur: number) => {
    setLiveDuration(dur);
    setResizeEndMinutes(endAnchor + dur);
  };

  const commitResize = (dur: number) => {
    if (onResize) onResize(instance, dur);
    // No owner wired yet → snap back to the prop-driven height.
    else setLiveDuration(null);
  };

  const cancelResizePreview = () => setLiveDuration(null);
  const hideResizeTooltip = () => setResizeEndMinutes(null);

  const resizePan = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .failOffsetX([-16, 16])
    // The strip owns its touches: while a resize is possible the long-press
    // drag (and anything outside) must wait, so the gestures never fight.
    .blocksExternalGesture(pan)
    .onStart(() => {
      resizing.value = 1;
      snappedDuration.value = baseDuration;
      lastQuarter.value = Math.floor(baseDuration / 15);
      runOnJS(tapHaptic)();
      runOnJS(setDragActive)(true);
      runOnJS(setResizePreview)(Math.max(15, baseDuration));
    })
    .onUpdate((e) => {
      const raw = baseDuration + e.translationY / MINUTE_SCALE;
      const next = Math.min(maxDuration, Math.max(15, Math.round(raw / 5) * 5));
      if (next !== snappedDuration.value) {
        snappedDuration.value = next;
        runOnJS(setResizePreview)(next);
        const quarter = Math.floor(next / 15);
        if (quarter !== lastQuarter.value) {
          lastQuarter.value = quarter;
          runOnJS(selectionHaptic)();
        }
      }
    })
    .onEnd(() => {
      if (snappedDuration.value !== baseDuration) {
        runOnJS(commitResize)(snappedDuration.value);
      } else {
        runOnJS(cancelResizePreview)();
      }
    })
    .onFinalize(() => {
      resizing.value = 0;
      runOnJS(hideResizeTooltip)();
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
    zIndex: lifted.value === 1 || resizing.value === 1 ? 100 : 10,
    shadowOpacity: withTiming(lifted.value === 1 ? 0.28 : 0, { duration: 140 }),
  }));

  // Grip bar: visible only while resizing or on the lifted (selected) card.
  const gripStyle = useAnimatedStyle(() => ({
    opacity: withTiming(resizing.value === 1 || lifted.value === 1 ? 1 : 0, {
      duration: 120,
    }),
  }));

  const displayHeight =
    liveDuration != null
      ? Math.max(MIN_BLOCK_HEIGHT, liveDuration * MINUTE_SCALE)
      : height;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.block,
          {
            top,
            height: displayHeight,
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
        {resizeEndMinutes != null ? (
          <View style={[styles.tooltipEnd, { backgroundColor: theme.text }]}>
            <Text style={[styles.tooltipText, { color: theme.background }]}>
              {formatMinutes(resizeEndMinutes)}
            </Text>
          </View>
        ) : null}
        <TaskCard
          task={instance.task}
          completed={instance.completed}
          dateKey={instance.dateKey}
          onToggle={() => onToggle(instance)}
          onPress={() => onPress(instance)}
          height={displayHeight}
        />
        <GestureDetector gesture={resizePan}>
          <Animated.View style={styles.resizeZone}>
            <Animated.View
              style={[styles.grip, { backgroundColor: theme.textTertiary }, gripStyle]}
            />
          </Animated.View>
        </GestureDetector>
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
  tooltipEnd: {
    position: 'absolute',
    bottom: -30,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    zIndex: 101,
  },
  tooltipText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  resizeZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  grip: {
    width: 32,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
});
