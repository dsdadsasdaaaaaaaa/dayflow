import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { CycleDots } from '../../src/components/focus/CycleDots';
import { GlassSegmented } from '../../src/components/focus/GlassSegmented';
import { GradientRing } from '../../src/components/focus/GradientRing';
import { SessionList } from '../../src/components/focus/SessionList';
import { TaskPickerSheet } from '../../src/components/focus/TaskPickerSheet';
import { TimerControls } from '../../src/components/focus/TimerControls';
import { WeekSparkline } from '../../src/components/focus/WeekSparkline';
import {
  formatClock,
  useFocusTimer,
  type PomodoroPhase,
} from '../../src/components/focus/useFocusTimer';
import { GlassCard } from '../../src/components/glass/GlassCard';
import { formatDuration, todayKey } from '../../src/lib/dates';
import { successHaptic, tapHaptic } from '../../src/lib/haptics';
import { isInstanceCompleted } from '../../src/lib/recurrence';
import { minutesFocusedOn, useFocus } from '../../src/store/focus';
import { useTasks } from '../../src/store/tasks';
import { useSettings } from '../../src/store/settings';
import { RADIUS, taskColor, useTheme } from '../../src/theme';
import type { FocusMode } from '../../src/types';

const RING_SIZE = 288;

const PHASE_LABELS: Record<PomodoroPhase, string> = {
  work: 'Focus',
  break: 'Break',
  longBreak: 'Long break',
};

const MODE_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: 'pomodoro', label: 'Pomodoro' },
  { value: 'stopwatch', label: 'Stopwatch' },
];

export default function FocusScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sessions = useFocus((s) => s.sessions);
  const tasksMap = useTasks((s) => s.tasks);
  const toggleComplete = useTasks((s) => s.toggleComplete);
  const settings = useSettings((s) => s.settings);

  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [promptId, setPromptId] = useState<string | null>(null);

  const today = todayKey();
  const linkedTask = linkedId ? tasksMap[linkedId] ?? null : null;

  // The engine reads the link at flush time, so a mid-session relink attributes correctly.
  const linkRef = useRef<{ taskId: string | null; taskTitle: string | null }>({
    taskId: null,
    taskTitle: null,
  });
  linkRef.current = {
    taskId: linkedTask?.id ?? null,
    taskTitle: linkedTask?.title ?? null,
  };

  const timer = useFocusTimer({
    getLink: () => linkRef.current,
    onSessionLogged: (end) => {
      if (end.taskId) setPromptId(end.taskId);
    },
  });

  // Drop a dangling link if the task gets deleted elsewhere.
  useEffect(() => {
    if (linkedId && !tasksMap[linkedId]) setLinkedId(null);
  }, [linkedId, tasksMap]);

  const running = timer.status === 'running';
  const focusedToday = minutesFocusedOn(sessions, today);
  const subtitle =
    focusedToday > 0 ? `${formatDuration(focusedToday)} focused today` : 'Find your flow';

  const todaySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.dateKey === today)
        .slice()
        .reverse(),
    [sessions, today]
  );

  const promptTask = promptId ? tasksMap[promptId] ?? null : null;
  const showPrompt = !!promptTask && !isInstanceCompleted(promptTask, today);

  const isPomodoro = timer.mode === 'pomodoro';
  const onBreak = isPomodoro && timer.phase !== 'work';
  // Break phases switch the ring to the calmer money tone.
  const ringColor = onBreak ? theme.success : theme.accent;
  const phaseLabel = isPomodoro
    ? PHASE_LABELS[timer.phase]
    : timer.status === 'idle'
      ? 'Stopwatch'
      : 'Elapsed';

  const caption =
    timer.status !== 'idle'
      ? null
      : isPomodoro
        ? `${settings.pomodoroWork} min focus · ${settings.pomodoroBreak} min break · long break after ${settings.pomodoroCyclesBeforeLongBreak}`
        : 'Sessions of a minute or more are saved automatically.';

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Focus" subtitle={subtitle} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 112 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <Dimmable dim={running}>
          <GlassSegmented
            options={MODE_OPTIONS}
            value={timer.mode}
            onChange={timer.setMode}
          />
        </Dimmable>

        <Dimmable dim={running} style={styles.linkRowWrap}>
          <Pressable
            onPress={() => {
              tapHaptic();
              setPickerVisible(true);
            }}
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}
            accessibilityRole="button"
            accessibilityLabel={linkedTask ? `Linked to ${linkedTask.title}` : 'Link a task'}
          >
            <GlassCard radius={RADIUS.lg} padding={12}>
              <View style={styles.linkRow}>
                {linkedTask ? (
                  <View
                    style={[
                      styles.linkIcon,
                      { backgroundColor: taskColor(linkedTask.color).solid },
                    ]}
                  >
                    <Ionicons name={linkedTask.icon as never} size={15} color="#fff" />
                  </View>
                ) : (
                  <View style={[styles.linkIcon, { backgroundColor: theme.accentSoft }]}>
                    <Ionicons name="link-outline" size={15} color={theme.accent} />
                  </View>
                )}
                <View style={styles.linkText}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.linkTitle,
                      { color: linkedTask ? theme.text : theme.textSecondary },
                    ]}
                  >
                    {linkedTask ? linkedTask.title : 'Link a task'}
                  </Text>
                  <Text style={[styles.linkMeta, { color: theme.textTertiary }]}>
                    {linkedTask ? 'Focus counts toward it' : 'Optional — attribute your focus'}
                  </Text>
                </View>
                {linkedTask ? (
                  <Pressable
                    onPress={() => {
                      tapHaptic();
                      setLinkedId(null);
                    }}
                    hitSlop={10}
                    style={styles.linkClear}
                    accessibilityLabel="Remove linked task"
                  >
                    <Ionicons name="close-circle" size={20} color={theme.textTertiary} />
                  </Pressable>
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                )}
              </View>
            </GlassCard>
          </Pressable>
        </Dimmable>

        <View style={styles.ringWrap}>
          <GradientRing
            size={RING_SIZE}
            strokeWidth={14}
            progress={timer.progress}
            color={ringColor}
            trackColor={theme.surface}
          >
            <Text
              style={[
                styles.phaseLabel,
                { color: onBreak ? theme.success : theme.textSecondary },
              ]}
            >
              {phaseLabel}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.clock, { color: theme.text }]}
            >
              {formatClock(timer.displayMs, timer.mode === 'stopwatch')}
            </Text>
            {isPomodoro ? (
              <CycleDots cycles={timer.cycles} cycle={timer.cycle} phase={timer.phase} />
            ) : null}
          </GradientRing>
        </View>

        <View>
          <TimerControls
            status={timer.status}
            mode={timer.mode}
            onStart={timer.start}
            onPause={timer.pause}
            onResume={timer.resume}
            onReset={timer.reset}
            onSkip={timer.skip}
          />

          {caption ? (
            <Text style={[styles.caption, { color: theme.textTertiary }]}>{caption}</Text>
          ) : null}
        </View>

        {showPrompt && promptTask ? (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(160)}
            style={styles.promptWrap}
          >
            <GlassCard radius={RADIUS.lg} padding={12}>
              <View style={styles.promptRow}>
                <View style={[styles.promptIcon, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name="checkmark-done-outline" size={17} color={theme.accent} />
                </View>
                <View style={styles.promptText}>
                  <Text numberOfLines={2} style={[styles.promptTitle, { color: theme.text }]}>
                    You focused on “{promptTask.title}”
                  </Text>
                  <Text style={[styles.promptSub, { color: theme.textSecondary }]}>
                    Mark it done?
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setPromptId(null);
                  }}
                  style={({ pressed }) => [
                    styles.promptGhostBtn,
                    { backgroundColor: theme.surface, opacity: pressed ? 0.7 : 1 },
                  ]}
                  accessibilityLabel="Not yet"
                >
                  <Text style={[styles.promptGhostLabel, { color: theme.textSecondary }]}>
                    Not yet
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    successHaptic();
                    toggleComplete(promptTask.id, today);
                    setPromptId(null);
                  }}
                  style={({ pressed }) => [
                    styles.promptDoneBtn,
                    { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityLabel={`Mark ${promptTask.title} done`}
                >
                  <Text style={styles.promptDoneLabel}>Mark done</Text>
                </Pressable>
              </View>
            </GlassCard>
          </Animated.View>
        ) : null}

        <Dimmable dim={running} style={styles.history}>
          <SessionList sessions={todaySessions} />
          <WeekSparkline sessions={sessions} />
        </Dimmable>
      </ScrollView>

      <TaskPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        tasks={tasksMap}
        selectedId={linkedId}
        onSelect={(task) => setLinkedId(task?.id ?? null)}
      />
    </View>
  );
}

/** Softly fades non-essential UI while the timer runs (stays interactive). */
function Dimmable({
  dim,
  children,
  style,
}: {
  dim: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(dim ? 0.35 : 1, { duration: 400 });
  }, [dim, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  linkRowWrap: { marginTop: 14 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  linkIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1 },
  linkTitle: { fontSize: 15, fontWeight: '600' },
  linkMeta: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  linkClear: { padding: 2 },
  ringWrap: {
    alignItems: 'center',
    marginTop: 26,
    marginBottom: 26,
  },
  phaseLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  clock: {
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
    maxWidth: RING_SIZE - 76,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 24,
  },
  promptWrap: {
    marginTop: 20,
  },
  promptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  promptIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptText: { flex: 1 },
  promptTitle: { fontSize: 14, fontWeight: '700' },
  promptSub: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  promptGhostBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  promptGhostLabel: { fontSize: 13, fontWeight: '700' },
  promptDoneBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  promptDoneLabel: { color: '#fff', fontSize: 13, fontWeight: '700' },
  history: {
    marginTop: 24,
    gap: 12,
  },
});
