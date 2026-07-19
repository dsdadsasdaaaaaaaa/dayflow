import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addDays,
  formatDayRelative,
  formatMinutes,
  minutesOfDay,
  todayKey,
  weekdayOf,
  weekdayShort,
} from '../../lib/dates';
import { selectionHaptic, successHaptic, tapHaptic } from '../../lib/haptics';
import { syncTaskNotifications } from '../../lib/notifications';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { DayKey, Task } from '../../types';

interface Props {
  /** Task being scheduled, or null when the sheet is closed. */
  task: Task | null;
  onClose: () => void;
}

interface QuickOption {
  key: string;
  icon: string;
  label: string;
  date: DayKey;
  minutes: number;
}

const TIME_ITEM_HEIGHT = 44;
/** Every 5 minutes across the day. */
const TIME_SLOTS = Array.from({ length: (24 * 60) / 5 }, (_, i) => i * 5);

function roundUpTo5(minutes: number): number {
  return Math.min(23 * 60 + 55, Math.ceil(minutes / 5) * 5);
}

/**
 * Bottom sheet for scheduling an inbox task in one or two taps —
 * DayFlow's faster answer to Structured's drag-to-tab gymnastics.
 * Design v3: plain overlay backdrop, solid card sheet, solid accent CTAs.
 */
export function ScheduleSheet({ task, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const scheduleTask = useTasks((s) => s.scheduleTask);
  const updateTask = useTasks((s) => s.updateTask);
  const defaultAlerts = useSettings((s) => s.settings.defaultAlerts);

  const [mode, setMode] = useState<'quick' | 'custom'>('quick');
  const [day, setDay] = useState<DayKey>(todayKey());
  const [minutes, setMinutes] = useState<number>(roundUpTo5(minutesOfDay()));
  const closing = useRef(false);

  const progress = useSharedValue(0);

  // Reset + animate in whenever a new task opens the sheet.
  useEffect(() => {
    if (task) {
      closing.current = false;
      setMode('quick');
      setDay(todayKey());
      setMinutes(roundUpTo5(minutesOfDay()));
      progress.value = 0;
      progress.value = withTiming(1, { duration: 220 });
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 480 }],
  }));

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    progress.value = withTiming(0, { duration: 170 }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  const commit = (date: DayKey, startMinutes: number) => {
    if (!task) return;
    scheduleTask(task.id, date, startMinutes, false);
    // Scheduling from the inbox: give the task the default alerts so the
    // notification it now deserves actually fires.
    const current = useTasks.getState().tasks[task.id];
    if (current && current.alerts.length === 0 && defaultAlerts.length > 0) {
      updateTask(task.id, { alerts: defaultAlerts });
    }
    const updated = useTasks.getState().tasks[task.id];
    if (updated) void syncTaskNotifications(updated);
    successHaptic();
    close();
  };

  const quickOptions = useMemo<QuickOption[]>(() => {
    const today = todayKey();
    // "This weekend" means the CURRENT weekend when it's already Sat/Sun.
    const wd = weekdayOf(today);
    const satDiff = wd === 0 || wd === 6 ? 0 : 6 - wd;
    return [
      { key: 'today-am', icon: 'sunny-outline', label: 'Today morning', date: today, minutes: 9 * 60 },
      { key: 'today-pm', icon: 'moon-outline', label: 'Today evening', date: today, minutes: 18 * 60 },
      { key: 'tmrw-am', icon: 'arrow-redo-outline', label: 'Tomorrow morning', date: addDays(today, 1), minutes: 9 * 60 },
      { key: 'weekend', icon: 'cafe-outline', label: 'This weekend', date: addDays(today, satDiff), minutes: 10 * 60 },
    ];
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayChips = useMemo(() => {
    const today = todayKey();
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeIndex = TIME_SLOTS.indexOf(roundUpTo5(minutes));
  const initialTimeIndex = Math.max(0, (timeIndex === -1 ? 108 : timeIndex) - 2);

  return (
    <Modal
      visible={task != null}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
          />
          <Pressable style={styles.backdropPress} onPress={close} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.card, borderColor: theme.border },
            sheetStyle,
          ]}
        >
          <View
            style={[
              styles.sheetContent,
              { paddingBottom: insets.bottom + SPACING.lg },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.border }]} />

            <View style={styles.header}>
              {mode === 'custom' ? (
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setMode('quick');
                  }}
                  hitSlop={8}
                  style={[styles.headerBtn, { backgroundColor: theme.surface }]}
                  accessibilityLabel="Back to quick options"
                >
                  <Ionicons name="chevron-back" size={18} color={theme.textSecondary} />
                </Pressable>
              ) : (
                <View style={styles.headerBtn} />
              )}
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: theme.text }]}>
                  {mode === 'quick' ? 'Schedule' : 'Pick date & time'}
                </Text>
                <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSecondary }]}>
                  {task?.title ?? ''}
                </Text>
              </View>
              <Pressable
                onPress={close}
                hitSlop={8}
                style={[styles.headerBtn, { backgroundColor: theme.surface }]}
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color={theme.textSecondary} />
              </Pressable>
            </View>

            {mode === 'quick' ? (
              <View style={styles.options}>
                {quickOptions.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => commit(opt.date, opt.minutes)}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                      },
                      pressed && { opacity: 0.7, transform: [{ scale: 0.985 }] },
                    ]}
                    accessibilityLabel={opt.label}
                  >
                    <View
                      style={[styles.optionIcon, { backgroundColor: theme.accentSoft }]}
                    >
                      <Ionicons name={opt.icon as never} size={19} color={theme.accent} />
                    </View>
                    <View style={styles.optionText}>
                      <Text style={[styles.optionLabel, { color: theme.text }]}>{opt.label}</Text>
                      <Text style={[styles.optionMeta, { color: theme.textSecondary }]}>
                        {formatDayRelative(opt.date)} · {formatMinutes(opt.minutes)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                  </Pressable>
                ))}

                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setMode('custom');
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: theme.accentSoft,
                      borderColor: `${theme.accent}40`,
                    },
                    pressed && { opacity: 0.7, transform: [{ scale: 0.985 }] },
                  ]}
                  accessibilityLabel="Pick a custom date and time"
                >
                  <View style={[styles.optionIcon, { backgroundColor: theme.accent }]}>
                    <Ionicons name="options-outline" size={19} color="#fff" />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, { color: theme.accent }]}>
                      Pick date & time
                    </Text>
                    <Text style={[styles.optionMeta, { color: theme.textSecondary }]}>
                      Any day, down to the 5 minutes
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.accent} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.custom}>
                <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.dayRow}
                  >
                    {dayChips.map((d, i) => {
                      const selected = d === day;
                      const top =
                        i === 0 ? 'Today' : i === 1 ? 'Tmrw' : weekdayShort(weekdayOf(d));
                      return (
                        <Pressable
                          key={d}
                          onPress={() => {
                            selectionHaptic();
                            setDay(d);
                          }}
                          accessibilityLabel={formatDayRelative(d)}
                          accessibilityState={{ selected }}
                          style={({ pressed }) => [
                            pressed && { transform: [{ scale: 0.96 }] },
                          ]}
                        >
                          <View
                            style={[
                              styles.dayChip,
                              selected
                                ? {
                                    backgroundColor: theme.accent,
                                    borderColor: theme.accent,
                                  }
                                : {
                                    backgroundColor: theme.surface,
                                    borderColor: theme.border,
                                  },
                            ]}
                          >
                            <Text
                              style={[
                                styles.dayChipTop,
                                { color: selected ? '#fff' : theme.textSecondary },
                              ]}
                            >
                              {top}
                            </Text>
                            <Text
                              style={[
                                styles.dayChipNum,
                                { color: selected ? '#fff' : theme.text },
                              ]}
                            >
                              {Number(d.slice(-2))}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View>
                  <View
                    style={[
                      styles.timeList,
                      {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <FlatList
                      data={TIME_SLOTS}
                      keyExtractor={(m) => String(m)}
                      initialScrollIndex={initialTimeIndex}
                      getItemLayout={(_, index) => ({
                        length: TIME_ITEM_HEIGHT,
                        offset: TIME_ITEM_HEIGHT * index,
                        index,
                      })}
                      showsVerticalScrollIndicator={false}
                      renderItem={({ item }) => {
                        const selected = item === minutes;
                        return (
                          <Pressable
                            onPress={() => {
                              selectionHaptic();
                              setMinutes(item);
                            }}
                            accessibilityLabel={formatMinutes(item)}
                            accessibilityState={{ selected }}
                            style={[
                              styles.timeRow,
                              selected && { backgroundColor: theme.accentSoft },
                            ]}
                          >
                            <Text
                              style={[
                                styles.timeText,
                                {
                                  color: selected ? theme.accent : theme.textSecondary,
                                  fontWeight: selected ? '700' : '500',
                                },
                              ]}
                            >
                              {formatMinutes(item)}
                            </Text>
                            {selected ? (
                              <Ionicons name="checkmark" size={16} color={theme.accent} />
                            ) : null}
                          </Pressable>
                        );
                      }}
                    />
                  </View>
                </View>

                <Pressable
                  onPress={() => commit(day, minutes)}
                  accessibilityLabel="Confirm schedule"
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: theme.accent },
                    pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <Ionicons name="calendar" size={17} color="#fff" />
                  <Text style={styles.confirmText}>
                    Schedule · {formatDayRelative(day)} {formatMinutes(minutes)}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdropPress: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  sheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginBottom: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontWeight: '500', marginTop: 1 },
  options: { gap: SPACING.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontSize: 15, fontWeight: '600' },
  optionMeta: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  custom: { gap: SPACING.md },
  dayRow: { gap: SPACING.sm, paddingVertical: 4 },
  dayChip: {
    width: 60,
    paddingVertical: 9,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  dayChipTop: {
    fontSize: 10,
    fontWeight: '600',
  },
  dayChipNum: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timeList: {
    height: 4.5 * TIME_ITEM_HEIGHT,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  timeRow: {
    height: TIME_ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    marginHorizontal: 6,
    marginVertical: 0,
    borderRadius: RADIUS.sm,
  },
  timeText: { fontSize: 15, fontVariant: ['tabular-nums'] },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 14,
  },
  confirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
