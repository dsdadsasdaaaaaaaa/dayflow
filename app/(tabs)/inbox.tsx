import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fab } from '../../src/components/Fab';
import { GlassCard } from '../../src/components/glass/GlassCard';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { EmptyGlow } from '../../src/components/inbox/EmptyGlow';
import {
  FilterChips,
  InboxFilter,
  taskMatchesFilter,
} from '../../src/components/inbox/FilterChips';
import { InboxRow } from '../../src/components/inbox/InboxRow';
import { QuickAddBar } from '../../src/components/inbox/QuickAddBar';
import { ScheduleSheet } from '../../src/components/inbox/ScheduleSheet';
import { SearchResults } from '../../src/components/inbox/SearchResults';
import { todayKey } from '../../src/lib/dates';
import { successHaptic, tapHaptic, warningHaptic } from '../../src/lib/haptics';
import { nextOccurrence } from '../../src/lib/recurrence';
import { syncTaskNotifications } from '../../src/lib/notifications';
import { inboxTasks, useTasks } from '../../src/store/tasks';
import { SPACING, useTheme } from '../../src/theme';
import type { Task } from '../../src/types';

export default function InboxScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const tasks = useTasks((s) => s.tasks);
  const toggleComplete = useTasks((s) => s.toggleComplete);
  const deleteTask = useTasks((s) => s.deleteTask);
  const duplicateTask = useTasks((s) => s.duplicateTask);
  const clearCompletedInbox = useTasks((s) => s.clearCompletedInbox);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  const inbox = useMemo(() => inboxTasks(tasks), [tasks]);
  const pending = useMemo(() => inbox.filter((t) => !t.completed), [inbox]);
  const completedList = useMemo(() => inbox.filter((t) => t.completed), [inbox]);

  /** Tags in use across the inbox, alphabetical. */
  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const t of inbox) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [inbox]);

  // If the active tag filter falls out of use (task deleted/edited), reset it.
  useEffect(() => {
    if (filter.startsWith('tag:') && !tags.includes(filter.slice('tag:'.length))) {
      setFilter('all');
    }
  }, [tags, filter]);

  const filteredPending = useMemo(
    () => pending.filter((t) => taskMatchesFilter(t, filter)),
    [pending, filter]
  );
  const filteredCompleted = useMemo(
    () => completedList.filter((t) => taskMatchesFilter(t, filter)),
    [completedList, filter]
  );

  const schedulingTask = schedulingId ? (tasks[schedulingId] ?? null) : null;

  const subtitle = searching
    ? 'Search everything'
    : pending.length === 0
      ? 'Nothing waiting'
      : `${pending.length} ${pending.length === 1 ? 'task' : 'tasks'} waiting`;

  const toggleSearch = () => {
    tapHaptic();
    setSearching((on) => {
      if (on) setQuery('');
      return !on;
    });
  };

  const openEditor = (task: Task) => {
    // Pass the occurrence the user means (next upcoming for recurring tasks)
    // so per-occurrence actions like the paid toggle target the right day.
    const occ = nextOccurrence(task, todayKey());
    router.push(occ ? `/task-editor?id=${task.id}&date=${occ}` : `/task-editor?id=${task.id}`);
  };

  const confirmDelete = (task: Task) => {
    Alert.alert('Delete task?', `“${task.title}” will be removed from your inbox.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          warningHaptic();
          deleteTask(task.id);
          void syncTaskNotifications(null, task.id);
        },
      },
    ]);
  };

  const duplicate = (task: Task) => {
    successHaptic();
    duplicateTask(task.id);
  };

  const showActions = (task: Task) => {
    tapHaptic();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: task.title,
          options: ['Edit', 'Duplicate', 'Delete', 'Cancel'],
          destructiveButtonIndex: 2,
          cancelButtonIndex: 3,
          userInterfaceStyle: theme.dark ? 'dark' : 'light',
        },
        (index) => {
          if (index === 0) openEditor(task);
          else if (index === 1) duplicate(task);
          else if (index === 2) confirmDelete(task);
        }
      );
    } else {
      Alert.alert(task.title, undefined, [
        { text: 'Edit', onPress: () => openEditor(task) },
        { text: 'Duplicate', onPress: () => duplicate(task) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(task) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const confirmClearCompleted = () => {
    tapHaptic();
    Alert.alert(
      'Clear completed?',
      `${completedList.length} completed ${completedList.length === 1 ? 'task' : 'tasks'} will be removed from your inbox.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            successHaptic();
            clearCompletedInbox();
          },
        },
      ]
    );
  };

  const searchButton = (
    <Pressable
      onPress={toggleSearch}
      hitSlop={8}
      accessibilityLabel={searching ? 'Close search' : 'Search tasks'}
      style={({ pressed }) => [
        styles.headerBtn,
        {
          backgroundColor: searching ? theme.accentSoft : theme.card,
          borderColor: searching ? `${theme.accent}40` : theme.border,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Ionicons
        name={searching ? 'close' : 'search'}
        size={19}
        color={searching ? theme.accent : theme.textSecondary}
      />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Inbox" subtitle={subtitle} right={searchButton} />

      {searching ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.searchWrap}>
          <GlassCard radius={25} padding={0}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={17} color={theme.textTertiary} />
              <TextInput
                ref={searchInputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search tasks, notes, tags, clients…"
                placeholderTextColor={theme.textTertiary}
                style={[styles.searchInput, { color: theme.text }]}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                accessibilityLabel="Search all tasks"
              />
              {query.length > 0 ? (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  accessibilityLabel="Clear search"
                >
                  <Ionicons name="close-circle" size={18} color={theme.textTertiary} />
                </Pressable>
              ) : null}
            </View>
          </GlassCard>
        </Animated.View>
      ) : (
        <QuickAddBar />
      )}

      {searching ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 120 + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <SearchResults tasks={tasks} query={query} onOpen={openEditor} />
        </ScrollView>
      ) : (
        <>
          {inbox.length > 0 ? (
            <View style={styles.chipsWrap}>
              <FilterChips tags={tags} active={filter} onChange={setFilter} />
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: 120 + insets.bottom },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {inbox.length === 0 ? (
              <EmptyGlow
                icon="file-tray-outline"
                title="Inbox zero"
                subtitle="Capture anything above, then schedule it when the time is right."
              />
            ) : filteredPending.length === 0 && filteredCompleted.length === 0 ? (
              <EmptyGlow
                icon="funnel-outline"
                title="No matching tasks"
                subtitle="Nothing in your inbox matches this filter."
              />
            ) : (
              <>
                {filteredPending.map((task) => (
                  <Animated.View
                    key={task.id}
                    layout={LinearTransition}
                  >
                    <InboxRow
                      task={task}
                      onToggle={() => toggleComplete(task.id, todayKey())}
                      onPress={() => openEditor(task)}
                      onLongPress={() => showActions(task)}
                      onSchedule={() => setSchedulingId(task.id)}
                    />
                  </Animated.View>
                ))}

                {filteredCompleted.length > 0 ? (
                  <Animated.View
                    layout={LinearTransition}
                    style={styles.completedSection}
                  >
                    <View style={styles.completedHeader}>
                      <Text
                        style={[styles.completedTitle, { color: theme.textSecondary }]}
                      >
                        Completed · {filteredCompleted.length}
                      </Text>
                      <Pressable
                        onPress={confirmClearCompleted}
                        hitSlop={8}
                        accessibilityLabel="Clear completed tasks"
                        style={({ pressed }) => [
                          styles.clearBtn,
                          {
                            backgroundColor: theme.card,
                            borderColor: theme.border,
                            opacity: pressed ? 0.7 : 1,
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                          },
                        ]}
                      >
                        <Ionicons name="trash-outline" size={13} color={theme.textSecondary} />
                        <Text style={[styles.clearLabel, { color: theme.textSecondary }]}>
                          Clear
                        </Text>
                      </Pressable>
                    </View>
                    {filteredCompleted.map((task) => (
                      <Animated.View
                        key={task.id}
                        entering={FadeIn.duration(180)}
                        layout={LinearTransition}
                      >
                        <InboxRow
                          task={task}
                          onToggle={() => toggleComplete(task.id, todayKey())}
                          onPress={() => openEditor(task)}
                          onLongPress={() => showActions(task)}
                          onSchedule={() => setSchedulingId(task.id)}
                        />
                      </Animated.View>
                    ))}
                  </Animated.View>
                ) : null}
              </>
            )}
          </ScrollView>
        </>
      )}

      {!searching ? (
        <Fab
          onPress={() => router.push('/task-editor?inbox=1')}
          bottom={96 + insets.bottom}
        />
      ) : null}

      <ScheduleSheet task={schedulingTask} onClose={() => setSchedulingId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    height: 50,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 0,
  },
  chipsWrap: { paddingBottom: SPACING.sm },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 4,
    gap: SPACING.sm,
  },
  completedSection: {
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  completedTitle: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  clearLabel: { fontSize: 12, fontWeight: '600' },
});
