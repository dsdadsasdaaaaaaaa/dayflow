import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/EmptyState';
import { Fab } from '../../src/components/Fab';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { GlassCard } from '../../src/components/glass/GlassCard';
import { HabitCard } from '../../src/components/habits/HabitCard';
import {
  HabitSuggestion,
  SuggestedHabits,
} from '../../src/components/habits/SuggestedHabits';
import { WeekOverview } from '../../src/components/habits/WeekOverview';
import { todayKey } from '../../src/lib/dates';
import { successHaptic, tapHaptic, warningHaptic } from '../../src/lib/haptics';
import { habitActiveOn, habitDoneOn, useHabits } from '../../src/store/habits';
import { useSettings } from '../../src/store/settings';
import { RADIUS, taskColor, useTheme } from '../../src/theme';
import type { Habit } from '../../src/types';

export default function HabitsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const habitsMap = useHabits((s) => s.habits);
  const tick = useHabits((s) => s.tick);
  const addHabit = useHabits((s) => s.addHabit);
  const updateHabit = useHabits((s) => s.updateHabit);
  const deleteHabit = useHabits((s) => s.deleteHabit);
  const weekStartsOn = useSettings((s) => s.settings.weekStartsOn);
  const [showArchived, setShowArchived] = useState(false);

  const today = todayKey();
  const all = useMemo(() => Object.values(habitsMap), [habitsMap]);
  const active = useMemo(() => all.filter((h) => !h.archived), [all]);
  const archived = useMemo(() => all.filter((h) => h.archived), [all]);

  const activeToday = active.filter((h) => habitActiveOn(h, today));
  const doneToday = activeToday.filter((h) => habitDoneOn(h, today)).length;

  const sorted = useMemo(() => {
    const needsAction = (h: Habit) =>
      habitActiveOn(h, today) && !habitDoneOn(h, today) ? 0 : 1;
    return [...active].sort(
      (a, b) => needsAction(a) - needsAction(b) || a.title.localeCompare(b.title)
    );
  }, [active, today]);

  const subtitle =
    active.length === 0
      ? 'Small daily wins compound'
      : activeToday.length === 0
        ? 'Rest day — nothing scheduled today'
        : `${doneToday} of ${activeToday.length} done today`;

  const openEditor = (id?: string) => {
    router.push(id ? `/habit-editor?id=${id}` : '/habit-editor');
  };

  const confirmDelete = (habit: Habit) => {
    Alert.alert(
      'Delete habit?',
      `“${habit.title}” and its whole history will be gone for good.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            warningHaptic();
            deleteHabit(habit.id);
          },
        },
      ]
    );
  };

  const archive = (habit: Habit) => {
    tapHaptic();
    updateHabit(habit.id, { archived: true });
  };

  const showActions = (habit: Habit) => {
    tapHaptic();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: habit.title,
          options: ['Edit', 'Archive', 'Delete', 'Cancel'],
          destructiveButtonIndex: 2,
          cancelButtonIndex: 3,
          userInterfaceStyle: theme.dark ? 'dark' : 'light',
        },
        (index) => {
          if (index === 0) openEditor(habit.id);
          else if (index === 1) archive(habit);
          else if (index === 2) confirmDelete(habit);
        }
      );
    } else {
      Alert.alert(habit.title, undefined, [
        { text: 'Edit', onPress: () => openEditor(habit.id) },
        { text: 'Archive', onPress: () => archive(habit) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(habit) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const pickSuggestion = (s: HabitSuggestion) => {
    successHaptic();
    addHabit({ title: s.title, icon: s.icon, color: s.color });
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Habits" subtitle={subtitle} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 176 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {active.length > 0 ? (
          <WeekOverview habits={active} weekStartsOn={weekStartsOn} />
        ) : null}

        {active.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="leaf-outline"
              title="Build your first habit"
              subtitle="Small daily wins compound."
            />
            <Pressable
              onPress={() => {
                tapHaptic();
                openEditor();
              }}
              style={({ pressed }) => [
                styles.cta,
                {
                  backgroundColor: theme.accent,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
              accessibilityLabel="Create a habit"
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.ctaLabel}>New Habit</Text>
            </Pressable>
            <Text style={[styles.orLabel, { color: theme.textSecondary }]}>
              or start with one of these
            </Text>
            <SuggestedHabits onPick={pickSuggestion} />
          </View>
        ) : (
          sorted.map((habit) => (
            <Animated.View
              key={habit.id}
              layout={LinearTransition}
            >
              <HabitCard
                habit={habit}
                onTickDay={(day) => tick(habit.id, day)}
                onToggleToday={() => tick(habit.id)}
                onPress={() => openEditor(habit.id)}
                onLongPress={() => showActions(habit)}
              />
            </Animated.View>
          ))
        )}

        {archived.length > 0 ? (
          <Animated.View layout={LinearTransition} style={styles.archivedWrap}>
            <Pressable
              onPress={() => {
                tapHaptic();
                setShowArchived((v) => !v);
              }}
              style={styles.archivedHint}
              accessibilityLabel={`${archived.length} archived habits`}
            >
              <Ionicons name="archive-outline" size={13} color={theme.textTertiary} />
              <Text style={[styles.archivedHintLabel, { color: theme.textTertiary }]}>
                {archived.length} archived {archived.length === 1 ? 'habit' : 'habits'}
              </Text>
              <Ionicons
                name={showArchived ? 'chevron-up' : 'chevron-down'}
                size={13}
                color={theme.textTertiary}
              />
            </Pressable>

            {showArchived
              ? archived.map((habit) => (
                  <ArchivedRow
                    key={habit.id}
                    habit={habit}
                    onUnarchive={() => {
                      successHaptic();
                      updateHabit(habit.id, { archived: false });
                    }}
                    onDelete={() => confirmDelete(habit)}
                  />
                ))
              : null}
          </Animated.View>
        ) : null}
      </ScrollView>

      <Fab onPress={() => openEditor()} bottom={96 + insets.bottom} />
    </View>
  );
}

function ArchivedRow({
  habit,
  onUnarchive,
  onDelete,
}: {
  habit: Habit;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const c = taskColor(habit.color);
  return (
    <Animated.View entering={FadeIn.duration(180)}>
      <GlassCard radius={RADIUS.lg} padding={0}>
        <View style={styles.archivedRow}>
          <View style={[styles.archivedIcon, { backgroundColor: c.solid }]}>
            <Ionicons name={habit.icon as never} size={14} color="#fff" />
          </View>
          <Text
            numberOfLines={1}
            style={[styles.archivedTitle, { color: theme.textSecondary }]}
          >
            {habit.title}
          </Text>
          <Pressable
            onPress={onUnarchive}
            hitSlop={6}
            style={[styles.unarchiveBtn, { backgroundColor: theme.accentSoft }]}
            accessibilityLabel={`Unarchive ${habit.title}`}
          >
            <Ionicons name="arrow-up-circle-outline" size={14} color={theme.accent} />
            <Text style={[styles.unarchiveLabel, { color: theme.accent }]}>Unarchive</Text>
          </Pressable>
          <Pressable
            onPress={onDelete}
            hitSlop={8}
            style={styles.trashBtn}
            accessibilityLabel={`Delete ${habit.title}`}
          >
            <Ionicons name="trash-outline" size={17} color={theme.danger} />
          </Pressable>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  emptyWrap: { alignItems: 'center', paddingTop: 24 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 26,
    borderRadius: 14,
  },
  ctaLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  orLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 14,
  },
  archivedWrap: { gap: 8, marginTop: 6 },
  archivedHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  archivedHintLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  archivedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  archivedTitle: { flex: 1, fontSize: 14, fontWeight: '500' },
  unarchiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  unarchiveLabel: { fontSize: 12, fontWeight: '700' },
  trashBtn: { padding: 4 },
});
