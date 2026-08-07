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
import { BulkActionBar } from '../../src/components/inbox/BulkActionBar';
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
import { showUndo } from '../../src/store/undo';
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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkScheduling, setBulkScheduling] = useState(false);
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

  // Keep the selection honest: drop ids that are no longer pending, and leave
  // selection mode entirely when nothing is left to select.
  useEffect(() => {
    if (!selecting) return;
    if (pending.length === 0) {
      setSelecting(false);
      setSelectedIds([]);
      return;
    }
    setSelectedIds((ids) => {
      const valid = ids.filter((id) => pending.some((t) => t.id === id));
      return valid.length === ids.length ? ids : valid;
    });
  }, [pending, selecting]);

  const filteredPending = useMemo(
    () => pending.filter((t) => taskMatchesFilter(t, filter)),
    [pending, filter]
  );
  const filteredCompleted = useMemo(
    () => completedList.filter((t) => taskMatchesFilter(t, filter)),
    [completedList, filter]
  );

  const selectedTasks = useMemo(
    () => selectedIds.map((id) => tasks[id]).filter((t): t is Task => t != null),
    [selectedIds, tasks]
  );

  const schedulingTask = schedulingId ? (tasks[schedulingId] ?? null) : null;

  const subtitle = searching
    ? 'Search everything'
    : selecting
      ? `${selectedIds.length} selected`
      : pending.length === 0
        ? 'Nothing waiting'
        : `${pending.length} ${pending.length === 1 ? 'task' : 'tasks'} waiting`;

  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds([]);
  };

  const toggleSearch = () => {
    tapHaptic();
    exitSelection();
    setSearching((on) => {
      if (on) setQuery('');
      return !on;
    });
  };

  const toggleSelecting = () => {
    tapHaptic();
    if (selecting) exitSelection();
    else setSelecting(true);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  };

  const openEditor = (task: Task) => {
    // Pass the occurrence the user means (next upcoming for recurring tasks)
    // so per-occurrence actions like the paid toggle target the right day.
    const occ = nextOccurrence(task, todayKey());
    router.push(occ ? `/task-editor?id=${task.id}&date=${occ}` : `/task-editor?id=${task.id}`);
  };

  /** Delete with undo: capture the task, remove it, offer to bring it back. */
  const performDelete = (task: Task) => {
    warningHaptic();
    deleteTask(task.id);
    void syncTaskNotifications(null, task.id);
    showUndo('Task deleted', () => {
      useTasks.getState().importTasks([task]);
      void syncTaskNotifications(task);
    });
  };

  const confirmDelete = (task: Task) => {
    Alert.alert('Delete task?', `“${task.title}” will be removed from your inbox.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => performDelete(task),
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
            const captured = [...completedList];
            clearCompletedInbox();
            showUndo(
              captured.length === 1 ? 'Task cleared' : `${captured.length} tasks cleared`,
              () => useTasks.getState().importTasks(captured)
            );
          },
        },
      ]
    );
  };

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const bulkComplete = () => {
    if (selectedTasks.length === 0) return;
    successHaptic();
    const day = todayKey();
    for (const t of selectedTasks) toggleComplete(t.id, day);
    exitSelection();
  };

  const bulkSchedule = () => {
    if (selectedTasks.length === 0) return;
    tapHaptic();
    setBulkScheduling(true);
  };

  const bulkDelete = () => {
    const n = selectedTasks.length;
    if (n === 0) return;
    tapHaptic();
    Alert.alert(
      n === 1 ? 'Delete task?' : `Delete ${n} tasks?`,
      `${n === 1 ? 'It' : 'They'} will be removed from your inbox.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const captured = [...selectedTasks];
            warningHaptic();
            for (const t of captured) {
              deleteTask(t.id);
              void syncTaskNotifications(null, t.id);
            }
            showUndo(
              captured.length === 1 ? 'Task deleted' : `${captured.length} tasks deleted`,
              () => {
                useTasks.getState().importTasks(captured);
                for (const t of captured) void syncTaskNotifications(t);
              }
            );
            exitSelection();
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

  const selectButton = (
    <Pressable
      onPress={toggleSelecting}
      hitSlop={8}
      accessibilityLabel={selecting ? 'Cancel selection' : 'Select tasks'}
      style={({ pressed }) => [
        styles.selectBtn,
        {
          backgroundColor: selecting ? theme.accentSoft : theme.card,
          borderColor: selecting ? `${theme.accent}40` : theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.selectLabel,
          { color: selecting ? theme.accent : theme.textSecondary },
        ]}
      >
        {selecting ? 'Cancel' : 'Select'}
      </Text>
    </Pressable>
  );

  const headerRight = (
    <View style={styles.headerRow}>
      {!searching && (selecting || pending.length >= 2) ? selectButton : null}
      {selecting ? null : searchButton}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Inbox" subtitle={subtitle} right={headerRight} />

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
              { paddingBottom: (selecting ? 190 : 120) + insets.bottom },
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
                      onDelete={() => performDelete(task)}
                      selectionMode={selecting}
                      selected={selectedIds.includes(task.id)}
                      onSelectToggle={() => toggleSelect(task.id)}
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
                          onDelete={() => performDelete(task)}
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

      {!searching && !selecting ? (
        <Fab
          onPress={() => router.push('/task-editor?inbox=1')}
          bottom={96 + insets.bottom}
        />
      ) : null}

      {selecting ? (
        <BulkActionBar
          count={selectedIds.length}
          onCompleteAll={bulkComplete}
          onScheduleAll={bulkSchedule}
          onDeleteAll={bulkDelete}
        />
      ) : null}

      <ScheduleSheet
        task={schedulingTask}
        tasks={bulkScheduling ? selectedTasks : null}
        onScheduled={bulkScheduling ? exitSelection : undefined}
        onClose={() => {
          setSchedulingId(null);
          setBulkScheduling(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectLabel: { fontSize: 13, fontWeight: '600' },
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
