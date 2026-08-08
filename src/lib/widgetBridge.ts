/**
 * Widget bridge — mirrors app state into the App Group UserDefaults store that
 * the native WidgetKit extension reads (see NATIVE.md for the JSON schemas).
 *
 * Safe everywhere: no-ops on web/Android, and the ExtensionStorage module
 * no-ops in Expo Go where the native side is missing.
 */
import type { ExtensionStorage as ExtensionStorageClass } from '@bacons/apple-targets';
import { AppState, Platform } from 'react-native';

import { unheardCount, useCalls } from '../store/calls';
import { isPhoneBlocked, isTelegramBlocked, useClientMeta } from '../store/clientMeta';
import { useMeetingSession } from '../store/meetingSession';
import { buildThreads, useMessages } from '../store/messages';
import { useSettings } from '../store/settings';
import { instancesForDay, useTasks } from '../store/tasks';
import { buildTelegramThreads, useTelegram } from '../store/telegramAccount';
import { taskColor } from '../theme';
import type { DayKey, Task } from '../types';
import { addDays, formatDayRelative, formatMinutes, minutesOfDay, todayKey, weekOf } from './dates';
import { earningsForDays, formatMoney, meetingOccurrences } from './meetings';

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
  /** Unread SMS + unread imported-Telegram + unheard voicemails (blocked excluded). */
  unreadCount: number;
  /** Client of the next upcoming meeting — empty when none in the next week.
   *  Home-screen families only; lock-screen families must never render it. */
  nextMeetingClient: string;
  /** "2:00 PM" today, "Tomorrow 2:00 PM" / "Sat 26 2:00 PM" for later days. */
  nextMeetingTimeLabel: string;
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
  /** Empty string when no meeting money earned today. */
  earnedTodayLabel: string;
  /** Same unread total as the messages tab badge. */
  unreadCount: number;
}

/**
 * Total unread for the widget badge — mirrors the GlassTabBar math exactly:
 * unread SMS threads + unread imported-Telegram threads + unheard voicemails,
 * with blocked contacts excluded everywhere.
 */
function computeUnreadCount(): number {
  const meta = useClientMeta.getState().meta;
  const { messages, lastReadAt } = useMessages.getState();
  const smsUnread = buildThreads(messages, lastReadAt)
    .filter((t) => !isPhoneBlocked(meta, t.counterparty))
    .reduce((sum, t) => sum + t.unread, 0);
  const tg = useTelegram.getState();
  const tgUnread = buildTelegramThreads(tg)
    .filter((t) => !isTelegramBlocked(meta, t.counterparty))
    .reduce((sum, t) => sum + t.unread, 0);
  const { voicemails, heardAt } = useCalls.getState();
  return smsUnread + tgUnread + unheardCount({ voicemails, heardAt }, meta);
}

/**
 * Next upcoming meeting within the coming week: today's not-yet-over
 * incomplete occurrences first, then day by day ahead. Untimed meetings are
 * skipped (nothing sensible to show). Empty strings when there is none.
 */
function nextMeetingInfo(
  tasks: Record<string, Task>,
  today: DayKey
): { client: string; timeLabel: string } {
  const nowMinutes = minutesOfDay();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = offset === 0 ? today : addDays(today, offset);
    const upcoming = meetingOccurrences(tasks, [day])
      .filter((occ) => {
        const start = occ.task.startMinutes;
        if (occ.completed || start == null) return false;
        // Today: only meetings that haven't already ended.
        return offset > 0 || start + occ.task.durationMinutes >= nowMinutes;
      })
      .sort((a, b) => (a.task.startMinutes ?? 0) - (b.task.startMinutes ?? 0));
    const first = upcoming[0];
    if (first) {
      const time = formatMinutes(first.task.startMinutes ?? 0);
      return {
        client: first.client,
        timeLabel: offset === 0 ? time : `${formatDayRelative(day)} ${time}`,
      };
    }
  }
  return { client: '', timeLabel: '' };
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
    const earnedTodayLabel = earnedToday > 0 ? formatMoney(earnedToday, symbol) : '';
    const unreadCount = computeUnreadCount();
    const nextMeeting = nextMeetingInfo(tasks, today);
    const todayPayload: TodayWidgetPayload = {
      dateKey: today,
      generatedAt: Date.now(),
      done,
      total: instances.length,
      earnedTodayLabel,
      tasks: entries,
      unreadCount,
      nextMeetingClient: nextMeeting.client,
      nextMeetingTimeLabel: nextMeeting.timeLabel,
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
      earnedTodayLabel,
      unreadCount,
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
 * tasks, settings, the live meeting session, or the unread inputs (SMS,
 * Telegram, voicemails, blocked status) change, plus a fresh push on every
 * app foreground. No polling — the message stores' existing sync hooks drive
 * the state changes we subscribe to. Returns an unsubscribe-all cleanup.
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
    // The messaging stores flip transient flags (syncing, sendingTo…) on every
    // sync pass — only reschedule when an unread-relevant slice actually changes.
    useMessages.subscribe((s, prev) => {
      if (s.messages !== prev.messages || s.lastReadAt !== prev.lastReadAt) schedule();
    }),
    useTelegram.subscribe((s, prev) => {
      if (
        s.messages !== prev.messages ||
        s.lastReadAt !== prev.lastReadAt ||
        s.importedChatIds !== prev.importedChatIds
      ) {
        schedule();
      }
    }),
    useCalls.subscribe((s, prev) => {
      if (s.voicemails !== prev.voicemails || s.heardAt !== prev.heardAt) schedule();
    }),
    useClientMeta.subscribe((s, prev) => {
      if (s.meta !== prev.meta) schedule();
    }),
  ];

  // Foreground = the moment stale widgets are most visible; push immediately.
  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') pushWidgetData();
  });

  return () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    for (const unsubscribe of unsubscribes) unsubscribe();
    appStateSub.remove();
  };
}
