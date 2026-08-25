import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/EmptyState';
import { Fab } from '../../src/components/Fab';
import { RAIL_CENTER_X } from '../../src/components/TaskCard';
import { BriefingCard } from '../../src/components/today/BriefingCard';
import { AllDayShelf } from '../../src/components/timeline/AllDayShelf';
import { DraggableTaskBlock } from '../../src/components/timeline/DraggableTaskBlock';
import { EventBlock } from '../../src/components/timeline/EventBlock';
import { GapButton } from '../../src/components/timeline/GapButton';
import { HourGrid, GUTTER_WIDTH } from '../../src/components/timeline/HourGrid';
import { LiveMeetingBanner } from '../../src/components/timeline/LiveMeetingBanner';
import { NowLine } from '../../src/components/timeline/NowLine';
import {
  ReplanChip,
  ReplanSheet,
  type ReplanAction,
} from '../../src/components/timeline/ReplanSheet';
import { SummaryRow } from '../../src/components/timeline/SummaryRow';
import { TaskActionSheet, type ShiftDelta } from '../../src/components/timeline/TaskActionSheet';
import { TodayHeader } from '../../src/components/timeline/TodayHeader';
import { WeekStrip } from '../../src/components/timeline/WeekStrip';
import { consumePendingDay } from '../../src/components/week/dayHandoff';
import { JumpDateSheet } from '../../src/components/week/JumpDateSheet';
import { WeekEarningsChip } from '../../src/components/week/WeekEarningsChip';
import {
  computeColumns,
  findGaps,
  mergeIntervals,
  MINUTE_SCALE,
  MIN_BLOCK_HEIGHT,
  type Interval,
} from '../../src/components/timeline/layout';
import { eventsForDay } from '../../src/lib/calendar';
import { addDays, isToday, minutesOfDay, todayKey } from '../../src/lib/dates';
import { successHaptic, tapHaptic } from '../../src/lib/haptics';
import { syncTaskNotifications } from '../../src/lib/notifications';
import { useSettings } from '../../src/store/settings';
import { useMeetingSession } from '../../src/store/meetingSession';
import { instancesForDay, useTasks } from '../../src/store/tasks';
import { showUndo } from '../../src/store/undo';
import { useTheme } from '../../src/theme';
import type { CalendarEventLite, DayKey, Task, TaskInstance } from '../../src/types';

/** Minutes a block must span to render at MIN_BLOCK_HEIGHT. */
const MIN_LAYOUT_MINUTES = MIN_BLOCK_HEIGHT / MINUTE_SCALE;

/** Re-sync a task's notifications after a store mutation. */
function resync(taskId: string): void {
  const t = useTasks.getState().tasks[taskId];
  void syncTaskNotifications(t ?? null, taskId);
}

interface PositionedBlock {
  instance: TaskInstance;
  /** Window-clamped start minute the block is rendered at (drag base). */
  layoutStart: number;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
}

export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const tasks = useTasks((s) => s.tasks);
  const toggleComplete = useTasks((s) => s.toggleComplete);
  const scheduleTask = useTasks((s) => s.scheduleTask);
  const updateTask = useTasks((s) => s.updateTask);
  const deleteTask = useTasks((s) => s.deleteTask);
  const skipOccurrence = useTasks((s) => s.skipOccurrence);
  const duplicateTask = useTasks((s) => s.duplicateTask);
  const rawDetachOccurrence = useTasks((s) => s.detachOccurrence);
  const settings = useSettings((s) => s.settings);

  /**
   * Detach one occurrence AND keep a running live session pointing at the
   * right task. Detaching adds the day to the series' skips; if the live
   * meeting still referenced the series id, ending it would write money onto
   * a skipped (invisible-everywhere) day.
   */
  const detachOccurrence = useCallback(
    (id: string, day: DayKey) => {
      const copy = rawDetachOccurrence(id, day);
      if (copy) {
        const active = useMeetingSession.getState().active;
        if (active && active.taskId === id && active.dateKey === day) {
          useMeetingSession.setState({ active: { ...active, taskId: copy.id } });
        }
      }
      return copy;
    },
    [rawDetachOccurrence]
  );

  const [selectedDay, setSelectedDay] = useState<DayKey>(() => todayKey());
  const [hideCompleted, setHideCompleted] = useState(false);
  const [menuInstance, setMenuInstance] = useState<TaskInstance | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [events, setEvents] = useState<CalendarEventLite[]>([]);
  const [nowMin, setNowMin] = useState(() => minutesOfDay());
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const scrollRef = useRef<ScrollView>(null);
  const autoScrolled = useRef(false);

  const winStart = settings.dayStartHour * 60;
  const winEnd = Math.max(settings.dayEndHour * 60, winStart + 60);
  const gridHeight = (winEnd - winStart) * MINUTE_SCALE;
  const todaySelected = isToday(selectedDay);

  // ── Now tick (~30s) ───────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesOfDay()), 30_000);
    return () => clearInterval(id);
  }, []);

  // A day tapped in the week view lands here when this tab regains focus.
  useFocusEffect(
    useCallback(() => {
      const pending = consumePendingDay();
      if (pending) setSelectedDay(pending);
    }, [])
  );

  // ── Device-calendar events for the selected day ───────────────────────────
  // Re-fetched on every foreground too: events added in the Calendar app
  // while DayFlow was backgrounded must not be invisible until a day switch.
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setCalendarRefresh((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let alive = true;
    if (!settings.showCalendarEvents) {
      setEvents([]);
      return;
    }
    eventsForDay(selectedDay, settings.hiddenCalendarIds).then((evs) => {
      if (alive) setEvents(evs);
    });
    return () => {
      alive = false;
    };
  }, [selectedDay, settings.showCalendarEvents, settings.hiddenCalendarIds, calendarRefresh]);

  // ── Day computations (memoized) ───────────────────────────────────────────
  const dayData = useMemo(() => {
    const all = instancesForDay(tasks, selectedDay);
    const allDay = all.filter((i) => i.task.allDay || i.task.startMinutes == null);
    const timed = all.filter((i) => !i.task.allDay && i.task.startMinutes != null);
    return {
      all,
      allDay,
      timed,
      doneCount: all.filter((i) => i.completed).length,
      plannedMinutes: timed.reduce((sum, i) => sum + i.task.durationMinutes, 0),
    };
  }, [tasks, selectedDay]);

  const visibleAllDay = useMemo(
    () => (hideCompleted ? dayData.allDay.filter((i) => !i.completed) : dayData.allDay),
    [dayData.allDay, hideCompleted]
  );
  const visibleTimed = useMemo(
    () => (hideCompleted ? dayData.timed.filter((i) => !i.completed) : dayData.timed),
    [dayData.timed, hideCompleted]
  );

  const allDayEvents = useMemo(() => events.filter((e) => e.allDay), [events]);
  const timedEvents = useMemo(
    () =>
      events.filter(
        (e) => !e.allDay && e.endMinutes > e.startMinutes && e.endMinutes > winStart && e.startMinutes < winEnd
      ),
    [events, winStart, winEnd]
  );

  // Overlap clusters → side-by-side columns; plus gap detection + free time.
  const { blocks, gaps, freeMinutes } = useMemo(() => {
    const maxStart = Math.max(winStart, winEnd - MIN_LAYOUT_MINUTES);
    const items = visibleTimed
      .map((instance) => {
        const raw = instance.task.startMinutes ?? winStart;
        const start = Math.min(Math.max(raw, winStart), maxStart);
        const end = start + Math.max(instance.task.durationMinutes, MIN_LAYOUT_MINUTES);
        return { instance, start, end };
      })
      .sort(
        (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start)
      );

    const placements = computeColumns(items.map(({ start, end }) => ({ start, end })));
    const positioned: PositionedBlock[] = items.map((it, idx) => {
      const { col, cols } = placements[idx];
      const gapPct = cols > 1 ? 1 : 0;
      return {
        instance: it.instance,
        layoutStart: it.start,
        top: (it.start - winStart) * MINUTE_SCALE,
        height: Math.max(MIN_BLOCK_HEIGHT, (it.end - it.start) * MINUTE_SCALE),
        leftPct: (col / cols) * 100,
        widthPct: 100 / cols - gapPct,
      };
    });

    // Occupied = tasks + timed calendar events, merged. Uses TRUE durations
    // (not the min layout height) so free-time and gap math stay honest.
    const occupied: Interval[] = [
      ...visibleTimed
        .map((instance) => {
          const raw = instance.task.startMinutes ?? winStart;
          return {
            start: Math.max(raw, winStart),
            end: Math.min(raw + instance.task.durationMinutes, winEnd),
          };
        })
        .filter((iv) => iv.end > iv.start),
      ...timedEvents.map((e) => ({
        start: Math.max(e.startMinutes, winStart),
        end: Math.min(e.endMinutes, winEnd),
      })),
    ].sort((a, b) => a.start - b.start);
    const merged = mergeIntervals(occupied);

    const gapList = findGaps(merged, winStart, winEnd, 30);

    let free: number | null = null;
    if (todaySelected) {
      const from = Math.min(Math.max(nowMin, winStart), winEnd);
      let f = winEnd - from;
      for (const iv of merged) {
        f -= Math.max(0, Math.min(iv.end, winEnd) - Math.max(iv.start, from));
      }
      free = Math.max(0, Math.round(f));
    }

    return { blocks: positioned, gaps: gapList, freeMinutes: free };
  }, [visibleTimed, timedEvents, winStart, winEnd, todaySelected, nowMin]);

  // ── Replan: unfinished non-recurring tasks scheduled before today ─────────
  // todayK is read on every render (the 30s now-tick re-renders us), so the
  // memo rolls over correctly if the app stays open past midnight.
  const todayK = todayKey();
  const replanTasks = useMemo(() => {
    return Object.values(tasks)
      .filter((t) => t.date != null && t.date < todayK && !t.recurrence && !t.completed)
      .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  }, [tasks, todayK]);

  useEffect(() => {
    if (replanOpen && replanTasks.length === 0) setReplanOpen(false);
  }, [replanOpen, replanTasks.length]);

  // ── Auto-scroll near "now" on first load ──────────────────────────────────
  const scrollToNow = useCallback(
    (animated: boolean) => {
      const m = minutesOfDay();
      if (m < winStart || m > winEnd) return;
      const y = Math.max(0, (m - winStart) * MINUTE_SCALE - 170);
      scrollRef.current?.scrollTo({ y, animated });
    },
    [winStart, winEnd]
  );

  useEffect(() => {
    if (autoScrolled.current || !todaySelected) return;
    autoScrolled.current = true;
    const t = setTimeout(() => scrollToNow(false), 80);
    return () => clearTimeout(t);
  }, [todaySelected, scrollToNow]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const openEditor = useCallback(
    (instance: TaskInstance) => {
      router.push(`/task-editor?id=${instance.task.id}&date=${selectedDay}`);
    },
    [router, selectedDay]
  );

  const handleToggle = useCallback(
    (instance: TaskInstance) => {
      if (instance.completed) tapHaptic();
      else successHaptic();
      toggleComplete(instance.task.id, selectedDay);
      resync(instance.task.id);
    },
    [toggleComplete, selectedDay]
  );

  const handleDragCommit = useCallback(
    (instance: TaskInstance, newStart: number) => {
      let id = instance.task.id;
      if (instance.task.recurrence) {
        // Rescheduling ONE day of a series: detach it so the series anchor
        // and its per-day completion/earnings history stay intact.
        const copy = detachOccurrence(id, selectedDay);
        if (!copy) return;
        resync(instance.task.id);
        id = copy.id;
      }
      scheduleTask(id, selectedDay, newStart, false);
      successHaptic();
      resync(id);
    },
    [scheduleTask, detachOccurrence, selectedDay]
  );

  const handleShiftRestOfDay = useCallback(
    (instance: TaskInstance, delta: ShiftDelta) => {
      const fromStart = instance.task.startMinutes ?? 0;
      const affected = dayData.timed.filter(
        (i) => !i.completed && (i.task.startMinutes ?? 0) >= fromStart
      );
      const touched: string[] = [];
      for (const i of affected) {
        const cur = i.task.startMinutes ?? 0;
        const dur = Math.max(i.task.durationMinutes, 5);
        // Push later, clamped to fit before midnight — but never pull earlier.
        const next = Math.max(cur, Math.min(cur + delta, 24 * 60 - dur));
        if (next === cur) continue;
        if (i.task.recurrence) {
          const copy = detachOccurrence(i.task.id, selectedDay);
          if (!copy) continue;
          updateTask(copy.id, { startMinutes: next });
          touched.push(i.task.id, copy.id);
        } else {
          updateTask(i.task.id, { startMinutes: next });
          touched.push(i.task.id);
        }
      }
      successHaptic();
      for (const id of touched) resync(id);
    },
    [dayData.timed, updateTask, detachOccurrence, selectedDay]
  );

  const handleResize = useCallback(
    (instance: TaskInstance, newDurationMinutes: number) => {
      let id = instance.task.id;
      if (instance.task.recurrence) {
        // Resizing ONE occurrence detaches it, same as drag-move.
        const copy = detachOccurrence(id, selectedDay);
        if (!copy) return;
        resync(instance.task.id);
        id = copy.id;
      }
      updateTask(id, { durationMinutes: newDurationMinutes });
      successHaptic();
      resync(id);
    },
    [updateTask, detachOccurrence, selectedDay]
  );

  const handleDelete = useCallback(
    (instance: TaskInstance, mode: 'occurrence' | 'series') => {
      if (mode === 'occurrence') {
        const day = selectedDay;
        skipOccurrence(instance.task.id, day);
        resync(instance.task.id);
        showUndo('Occurrence removed', () => {
          const t = useTasks.getState().tasks[instance.task.id];
          if (!t) return;
          useTasks.getState().updateTask(instance.task.id, {
            skips: t.skips.filter((s) => s !== day),
          });
          resync(instance.task.id);
        });
      } else {
        const captured = instance.task;
        deleteTask(captured.id);
        void syncTaskNotifications(null, captured.id);
        showUndo('Task deleted', () => {
          useTasks.getState().importTasks([captured]);
          resync(captured.id);
        });
      }
    },
    [skipOccurrence, deleteTask, selectedDay]
  );

  const handleReplanAction = useCallback(
    (task: Task, action: ReplanAction) => {
      switch (action) {
        case 'today':
        case 'tomorrow': {
          const target = action === 'today' ? todayKey() : addDays(todayKey(), 1);
          scheduleTask(task.id, target, task.allDay ? null : task.startMinutes, task.allDay);
          resync(task.id);
          break;
        }
        case 'inbox':
          scheduleTask(task.id, null, null, false);
          resync(task.id);
          break;
        case 'done':
          successHaptic();
          if (task.date) toggleComplete(task.id, task.date);
          resync(task.id);
          break;
        case 'delete': {
          const captured = task;
          deleteTask(captured.id);
          void syncTaskNotifications(null, captured.id);
          showUndo('Task deleted', () => {
            useTasks.getState().importTasks([captured]);
            resync(captured.id);
          });
          break;
        }
      }
    },
    [scheduleTask, toggleComplete, deleteTask]
  );

  const handleGapPress = useCallback(
    (startMinutes: number) => {
      const start = Math.ceil(startMinutes / 5) * 5;
      router.push(`/task-editor?date=${selectedDay}&startMinutes=${start}`);
    },
    [router, selectedDay]
  );

  const jumpToToday = useCallback(() => {
    setSelectedDay(todayKey());
    setTimeout(() => scrollToNow(true), 350);
  }, [scrollToNow]);

  // ── Render ────────────────────────────────────────────────────────────────
  const dayEmpty = dayData.all.length === 0 && events.length === 0;
  const showNowLine = todaySelected && !dayEmpty && nowMin >= winStart && nowMin <= winEnd;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <TodayHeader
        selectedDay={selectedDay}
        hideCompleted={hideCompleted}
        onToggleHideCompleted={() => setHideCompleted((v) => !v)}
        onPressToday={jumpToToday}
        onPressTitle={() => setJumpOpen(true)}
      />
      <LiveMeetingBanner />
      <WeekStrip
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        tasks={tasks}
        weekStartsOn={settings.weekStartsOn}
      />
      <SummaryRow
        doneCount={dayData.doneCount}
        totalCount={dayData.all.length}
        plannedMinutes={dayData.plannedMinutes}
        freeMinutes={freeMinutes}
        right={<WeekEarningsChip onPress={() => router.push('/stats')} />}
      />
      {replanTasks.length > 0 ? (
        <ReplanChip count={replanTasks.length} onPress={() => setReplanOpen(true)} />
      ) : null}
      {/* Deterministic, on-device morning briefing — today only, dismissible,
          and self-hiding when there is nothing worth saying. */}
      {todaySelected ? <BriefingCard /> : null}

      <View style={[styles.scrollEdge, { borderBottomColor: theme.separator }]} />
      <ScrollView
        ref={scrollRef}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 84 + insets.bottom }}
      >
        <AllDayShelf
          instances={visibleAllDay}
          events={allDayEvents}
          onToggle={handleToggle}
          onPress={openEditor}
          onLongPress={setMenuInstance}
        />
        {dayEmpty ? (
          <EmptyState
            icon={todaySelected ? 'sunny-outline' : 'calendar-outline'}
            title={todaySelected ? 'A blank canvas' : 'Nothing planned'}
            subtitle={
              todaySelected
                ? 'Your day is wide open. Tap + to plan something.'
                : 'Tap + to add a task for this day.'
            }
          />
        ) : (
          <View style={[styles.grid, { height: gridHeight + 28 }]}>
            <HourGrid
              startHour={settings.dayStartHour}
              endHour={settings.dayEndHour}
              nowMinutes={showNowLine ? nowMin : null}
            />
            {/* Connector rail: task icon circles sit on this line. */}
            <View
              pointerEvents="none"
              style={[
                styles.rail,
                { backgroundColor: theme.separator, height: gridHeight },
              ]}
            />
            <View style={styles.blockArea}>
              {gaps.map((g) => (
                <GapButton
                  key={g.start}
                  top={(g.start - winStart) * MINUTE_SCALE}
                  height={(g.end - g.start) * MINUTE_SCALE}
                  startMinutes={g.start}
                  onPress={handleGapPress}
                />
              ))}
              {timedEvents.map((e) => {
                const start = Math.max(e.startMinutes, winStart);
                const end = Math.min(e.endMinutes, winEnd);
                return (
                  <EventBlock
                    key={`${e.id}-${e.startMinutes}`}
                    event={e}
                    top={(start - winStart) * MINUTE_SCALE}
                    height={Math.max(24, (end - start) * MINUTE_SCALE)}
                  />
                );
              })}
              {blocks.map((b) => (
                <DraggableTaskBlock
                  key={b.instance.task.id}
                  instance={b.instance}
                  layoutStart={b.layoutStart}
                  top={b.top}
                  height={b.height}
                  leftPct={b.leftPct}
                  widthPct={b.widthPct}
                  minStart={winStart}
                  maxStart={Math.max(
                    winStart,
                    winEnd - Math.max(b.instance.task.durationMinutes, 5)
                  )}
                  onPress={openEditor}
                  onToggle={handleToggle}
                  onOpenMenu={setMenuInstance}
                  onCommit={handleDragCommit}
                  onDragActive={(active) => setScrollEnabled(!active)}
                  onResize={handleResize}
                />
              ))}
            </View>
            {showNowLine ? (
              <NowLine top={(nowMin - winStart) * MINUTE_SCALE} nowMinutes={nowMin} />
            ) : null}
          </View>
        )}
      </ScrollView>

      <Fab
        onPress={() => router.push(`/task-editor?date=${selectedDay}`)}
        bottom={96 + insets.bottom}
      />

      <TaskActionSheet
        instance={menuInstance}
        onClose={() => setMenuInstance(null)}
        onEdit={openEditor}
        onDuplicate={(i) => {
          duplicateTask(i.task.id);
          successHaptic();
        }}
        onMoveToInbox={(i) => {
          if (i.task.recurrence) {
            // Only this day's occurrence goes to the inbox — the series stays.
            const copy = detachOccurrence(i.task.id, selectedDay);
            resync(i.task.id);
            if (copy) scheduleTask(copy.id, null, null, false);
          } else {
            scheduleTask(i.task.id, null, null, false);
            void syncTaskNotifications(null, i.task.id);
          }
        }}
        onShiftRestOfDay={handleShiftRestOfDay}
        onSkipOccurrence={(i) => {
          skipOccurrence(i.task.id, selectedDay);
          resync(i.task.id);
        }}
        onDelete={handleDelete}
        onStartMeeting={(i) =>
          router.push(`/meeting-live?id=${i.task.id}&date=${selectedDay}`)
        }
      />

      <ReplanSheet
        visible={replanOpen}
        tasks={replanTasks}
        onClose={() => setReplanOpen(false)}
        onAction={handleReplanAction}
      />

      <JumpDateSheet
        visible={jumpOpen}
        onClose={() => setJumpOpen(false)}
        selected={selectedDay}
        onSelect={(day) => {
          setSelectedDay(day);
          setJumpOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grid: { marginTop: 6 },
  scrollEdge: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  rail: {
    position: 'absolute',
    top: 0,
    left: GUTTER_WIDTH + 2 + RAIL_CENTER_X - 1,
    width: 2,
    borderRadius: 1,
  },
  blockArea: {
    position: 'absolute',
    left: GUTTER_WIDTH + 2,
    right: 12,
    top: 0,
    bottom: 0,
  },
});
