/**
 * Widget bridge — mirrors app state into the App Group UserDefaults store that
 * the native WidgetKit extension reads (see NATIVE.md for the JSON schemas).
 *
 * Safe everywhere: no-ops on web/Android, and the ExtensionStorage module
 * no-ops in Expo Go where the native side is missing.
 */
import type { ExtensionStorage as ExtensionStorageClass } from '@bacons/apple-targets';
import { Platform } from 'react-native';

import { useMeetingSession } from '../store/meetingSession';
import { useSettings } from '../store/settings';
import { instancesForDay, useTasks } from '../store/tasks';
import { taskColor } from '../theme';
import { formatMinutes, todayKey, weekOf } from './dates';
import { earningsForDays, formatMoney } from './meetings';

const APP_GROUP = 'group.com.levisilverberg.dayflow';
const TODAY_STORAGE_KEY = 'widget.today';
const EARNINGS_STORAGE_KEY = 'widget.earnings';
const MAX_WIDGET_TASKS = 8;
const SYNC_DEBOUNCE_MS = 1500;

interface WidgetTaskEntry {
  id: string;
  title: string;
  /** "8:30 PM" — empty string for all-day / unscheduled-time tasks. */
  timeLabel: string;
  colorHex: string;
  completed: boolean;
  isMeeting: boolean;
}

interface TodayWidgetPayload {
  dateKey: string;
  generatedAt: number;
  done: number;
  total: number;
  /** Empty string when no meeting money earned today. */
  earnedTodayLabel: string;
  tasks: WidgetTaskEntry[];
}

interface EarningsWidgetPayload {
  earnedLabel: string;
  goalLabel: string;
  /** 0..1 (0 when no goal). */
  progress: number;
  /** Empty string when nothing is owed. */
  outstandingLabel: string;
  meetingsDone: number;
  hasGoal: boolean;
}

/**
 * Build both widget payloads from current store state and write them to the
 * shared App Group store, then ask WidgetKit to reload timelines.
 */
export function pushWidgetData(): void {
  if (Platform.OS !== 'ios') return;
  try {
    // Lazy require: the module references the `expo` global at load time, so
    // it must never be evaluated outside a native iOS runtime.
    const { ExtensionStorage } = require('@bacons/apple-targets') as {
      ExtensionStorage: typeof ExtensionStorageClass;
    };

    const tasks = useTasks.getState().tasks;
    const settings = useSettings.getState().settings;
    const symbol = settings.currencySymbol;
    const today = todayKey();

    // --- Today payload -----------------------------------------------------
    const instances = instancesForDay(tasks, today);
    const sorted = [...instances].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return (a.task.startMinutes ?? -1) - (b.task.startMinutes ?? -1);
    });
    const entries: WidgetTaskEntry[] = sorted.slice(0, MAX_WIDGET_TASKS).map((inst) => ({
      id: inst.task.id,
      title: inst.task.title,
      timeLabel:
        inst.task.allDay || inst.task.startMinutes == null
          ? ''
          : formatMinutes(inst.task.startMinutes),
      colorHex: taskColor(inst.task.color).solid,
      completed: inst.completed,
      isMeeting: inst.task.meeting != null,
    }));
    const done = instances.filter((i) => i.completed).length;
    const earnedToday = earningsForDays(tasks, [today]).earned;
    const todayPayload: TodayWidgetPayload = {
      dateKey: today,
      generatedAt: Date.now(),
      done,
      total: instances.length,
      earnedTodayLabel: earnedToday > 0 ? formatMoney(earnedToday, symbol) : '',
      tasks: entries,
    };

    // --- Earnings payload --------------------------------------------------
    const week = weekOf(today, settings.weekStartsOn);
    const summary = earningsForDays(tasks, week);
    const goal = settings.weeklyEarningsGoal;
    const earningsPayload: EarningsWidgetPayload = {
      earnedLabel: formatMoney(summary.earned, symbol),
      goalLabel: goal != null ? formatMoney(goal, symbol) : '',
      progress: goal ? Math.min(1, summary.earned / goal) : 0,
      outstandingLabel: summary.outstanding > 0 ? formatMoney(summary.outstanding, symbol) : '',
      meetingsDone: summary.meetingsDone,
      hasGoal: goal != null,
    };

    const storage = new ExtensionStorage(APP_GROUP);
    storage.set(TODAY_STORAGE_KEY, JSON.stringify(todayPayload));
    storage.set(EARNINGS_STORAGE_KEY, JSON.stringify(earningsPayload));
    ExtensionStorage.reloadWidget();
  } catch {
    // Expo Go / missing native module — widgets simply don't update.
  }
}

/**
 * Keep the widget store in sync: push once now, then debounce pushes whenever
 * tasks, settings, or the live meeting session change.
 * Returns an unsubscribe-all cleanup function.
 */
export function subscribeWidgetSync(): () => void {
  if (Platform.OS !== 'ios') return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pushWidgetData();
    }, SYNC_DEBOUNCE_MS);
  };

  pushWidgetData();

  const unsubscribes = [
    useTasks.subscribe(schedule),
    useSettings.subscribe(schedule),
    useMeetingSession.subscribe(schedule),
  ];

  return () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
