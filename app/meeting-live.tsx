import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { CheckInRow } from '../src/components/meeting/CheckInRow';
import { DurationSetup } from '../src/components/meeting/DurationSetup';
import { EndMeetingSheet } from '../src/components/meeting/EndMeetingSheet';
import { LiveTimer } from '../src/components/meeting/LiveTimer';
import { MeetingHero } from '../src/components/meeting/MeetingHero';
import { useNow } from '../src/components/meeting/useNow';
import { todayKey } from '../src/lib/dates';
import { successHaptic, tapHaptic, warningHaptic } from '../src/lib/haptics';
import { formatMoney, isPaidOn, occurrenceAmount, occurrenceDeposit } from '../src/lib/meetings';
import { isInstanceCompleted } from '../src/lib/recurrence';
import { useMeetingSession } from '../src/store/meetingSession';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { useTheme } from '../src/theme';
import type { DayKey, MeetingKind } from '../src/types';

export default function MeetingLiveScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; date?: string }>();

  const active = useMeetingSession((s) => s.active);
  const start = useMeetingSession((s) => s.start);
  const extend = useMeetingSession((s) => s.extend);
  const endSession = useMeetingSession((s) => s.end);
  const cancelSession = useMeetingSession((s) => s.cancel);

  const tasks = useTasks((s) => s.tasks);
  const toggleComplete = useTasks((s) => s.toggleComplete);
  const togglePaid = useTasks((s) => s.togglePaid);
  const setOccurrenceAmount = useTasks((s) => s.setOccurrenceAmount);
  const symbol = useSettings((s) => s.settings.currencySymbol);

  // ---- Resolution: params → active session → nothing ----------------------
  const paramId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;
  const paramDate =
    typeof params.date === 'string' && params.date.length > 0 ? (params.date as DayKey) : null;
  const resolvedId = paramId ?? active?.taskId ?? null;
  const resolvedDate: DayKey = paramId
    ? paramDate ?? todayKey()
    : active?.dateKey ?? paramDate ?? todayKey();

  const task = resolvedId ? tasks[resolvedId] ?? null : null;
  const isLive = !!active && active.taskId === resolvedId;
  const otherRunning = !!active && !isLive;

  // ---- Setup state ---------------------------------------------------------
  const [minutes, setMinutes] = useState(() =>
    task && task.durationMinutes > 0 ? task.durationMinutes : 60
  );
  const [checkInOn, setCheckInOn] = useState(() => task?.meeting?.kind === 'outcall');
  const [checkInMin, setCheckInMin] = useState(15);
  const [starting, setStarting] = useState(false);

  // Re-prefill when the target meeting changes.
  useEffect(() => {
    setMinutes(task && task.durationMinutes > 0 ? task.durationMinutes : 60);
    setCheckInOn(task?.meeting?.kind === 'outcall');
    setCheckInMin(15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId]);

  // ---- End flow state ------------------------------------------------------
  const [sheetVisible, setSheetVisible] = useState(false);
  const [ending, setEnding] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);

  const now = useNow(500);

  const onStart = async () => {
    if (!task || starting) return;
    if (otherRunning) {
      // Never clobber a live paid session — its tracked time would vanish.
      warningHaptic();
      Alert.alert(
        'Another meeting is running',
        'End or cancel that session first — starting a new one now would discard its tracked time.',
        [
          { text: 'Open running meeting', onPress: () => router.replace('/meeting-live') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }
    setStarting(true);
    try {
      await start(task, resolvedDate, minutes, checkInOn ? checkInMin : null);
      successHaptic();
    } finally {
      setStarting(false);
    }
  };

  const onExtend = async (extra: number) => {
    tapHaptic();
    await extend(extra);
  };

  const onCancelSession = () => {
    tapHaptic();
    Alert.alert(
      'Cancel this session?',
      'The timer will be discarded and nothing gets logged.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Discard session',
          style: 'destructive',
          onPress: async () => {
            setEnding(true);
            warningHaptic();
            await cancelSession();
            router.back();
          },
        },
      ]
    );
  };

  const onLogMeeting = async (amount: number, paid: boolean) => {
    if (!active || ending) return;
    const day = active.dateKey;
    const client = task?.meeting?.client?.trim() || task?.title || 'Client';
    const kind: MeetingKind = task?.meeting?.kind ?? 'incall';

    setEnding(true);
    if (task?.meeting) {
      // Always record the settled amount — it freezes this day against any
      // later rate edits (extras store absolute per-day amounts).
      setOccurrenceAmount(task.id, day, amount);
      if (paid !== isPaidOn(task, day)) togglePaid(task.id, day);
    }
    if (task && !isInstanceCompleted(task, day)) toggleComplete(task.id, day);

    await endSession({ finalAmount: amount, client, kind });
    successHaptic();
    setSheetVisible(false);
    setCelebration(`${formatMoney(amount, symbol)} logged`);
    setTimeout(() => router.back(), 1200);
  };

  // ---- Render --------------------------------------------------------------
  const closeBtn = (
    <Pressable
      onPress={() => {
        tapHaptic();
        router.back();
      }}
      style={({ pressed }) => [
        styles.closeBtn,
        {
          backgroundColor: theme.surface,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        },
      ]}
      hitSlop={8}
      accessibilityLabel="Close"
    >
      <Ionicons name="chevron-down" size={22} color={theme.text} />
    </Pressable>
  );

  // Celebration / graceful exit while the session tears down.
  if (ending || celebration) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: theme.background }]}>
        {celebration ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.celebrate}>
            <View style={[styles.celebrateCircle, { backgroundColor: theme.success }]}>
              <Ionicons name="checkmark" size={46} color="#fff" />
            </View>
            <Text style={[styles.celebrateLabel, { color: theme.text }]}>{celebration}</Text>
            <Text style={[styles.celebrateSub, { color: theme.textSecondary }]}>
              Nice work.
            </Text>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  // Friendly empty state when nothing is running and no meeting was passed.
  if (!resolvedId || (!task && !isLive)) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top + 8 }]}>
        <View style={styles.topRow}>{closeBtn}</View>
        <View style={[styles.center, styles.flex]}>
          <EmptyState
            icon="timer-outline"
            title="No meeting selected"
            subtitle="Start a session from a meeting on your timeline."
          />
        </View>
      </View>
    );
  }

  if (isLive && active) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.background, paddingTop: insets.top + 8 },
        ]}
      >
        <View style={styles.topRow}>
          {closeBtn}
          <MeetingHero task={task} dateKey={active.dateKey} compact />
        </View>

        <View style={[styles.flex, styles.center]}>
          <Animated.View entering={FadeIn.duration(300)}>
            <LiveTimer
              startedAt={active.startedAt}
              plannedEndAt={active.plannedEndAt}
              now={now}
            />
          </Animated.View>
        </View>

        <View style={[styles.controls, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.extendRow}>
            {[15, 30].map((extra) => (
              <Pressable
                key={extra}
                onPress={() => onExtend(extra)}
                style={({ pressed }) => [
                  styles.extendBtn,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
                accessibilityLabel={`Extend by ${extra} minutes`}
              >
                <Ionicons name="add-circle-outline" size={17} color={theme.accent} />
                <Text style={[styles.extendLabel, { color: theme.text }]}>+{extra} min</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => {
              tapHaptic();
              setSheetVisible(true);
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: theme.accent,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
            accessibilityLabel="End meeting"
          >
            <Ionicons name="stop-circle-outline" size={20} color="#fff" />
            <Text style={styles.primaryLabel}>End meeting</Text>
          </Pressable>

          <Pressable
            onPress={onCancelSession}
            hitSlop={8}
            style={styles.cancelBtn}
            accessibilityLabel="Cancel session without logging"
          >
            <Text style={[styles.cancelLabel, { color: theme.textTertiary }]}>
              Cancel session
            </Text>
          </Pressable>
        </View>

        <EndMeetingSheet
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          startedAt={active.startedAt}
          plannedEndAt={active.plannedEndAt}
          prefillAmount={task ? occurrenceAmount(task, active.dateKey) : 0}
          prefillPaid={task ? isPaidOn(task, active.dateKey) : false}
          deposit={task ? occurrenceDeposit(task, active.dateKey) : 0}
          currencySymbol={symbol}
          onConfirm={onLogMeeting}
          busy={ending}
        />
      </View>
    );
  }

  // ---- SETUP ---------------------------------------------------------------
  return (
    <View
      style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top + 8 }]}
    >
      <View style={styles.topRow}>{closeBtn}</View>

      <ScrollView
        contentContainerStyle={[styles.setupContent, { paddingBottom: 140 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {otherRunning ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              router.replace('/meeting-live');
            }}
            style={({ pressed }) => [
              styles.banner,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
            accessibilityLabel="Open the running meeting"
          >
            <Ionicons name="radio-outline" size={16} color={theme.accent} />
            <Text style={[styles.bannerLabel, { color: theme.accent }]}>
              Another meeting is running — open it
            </Text>
            <Ionicons name="chevron-forward" size={15} color={theme.accent} />
          </Pressable>
        ) : null}

        <MeetingHero task={task} dateKey={resolvedDate} />

        <DurationSetup minutes={minutes} onChange={setMinutes} />

        <CheckInRow
          enabled={checkInOn}
          onToggle={setCheckInOn}
          minutes={checkInMin}
          onChangeMinutes={setCheckInMin}
        />
      </ScrollView>

      <View style={[styles.startBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={onStart}
          disabled={starting}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: theme.accent,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              opacity: starting ? 0.6 : 1,
            },
          ]}
          accessibilityLabel="Start meeting"
        >
          <Ionicons name="play" size={19} color="#fff" />
          <Text style={styles.primaryLabel}>Start meeting</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupContent: { paddingHorizontal: 16, paddingTop: 10, gap: 22 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerLabel: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  startBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  primaryLabel: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  controls: { paddingHorizontal: 16, gap: 12 },
  extendRow: { flexDirection: 'row', gap: 10 },
  extendBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  extendLabel: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cancelBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  cancelLabel: { fontSize: 13, fontWeight: '600' },
  celebrate: { alignItems: 'center', gap: 14, paddingHorizontal: 32 },
  celebrateCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  celebrateLabel: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  celebrateSub: { fontSize: 14, fontWeight: '500' },
});
