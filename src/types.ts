// Core data model for DayFlow.
// Dates are stored as "day keys" — local-timezone YYYY-MM-DD strings.
// Times are minutes from local midnight (0..1439).

export type DayKey = string; // "2026-07-16"

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export type RecurrenceFreq =
  | 'daily'
  | 'weekly' // uses weekdays[]
  | 'monthly' // same day-of-month as anchor date
  | 'yearly';

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Every N days/weeks/months/years. Default 1. */
  interval: number;
  /** For weekly: 0=Sunday .. 6=Saturday. Required when freq === 'weekly'. */
  weekdays?: number[];
  /** Inclusive last day the task occurs, or null for forever. */
  until?: DayKey | null;
}

export type Priority = 0 | 1 | 2 | 3; // 0=none, 1=low, 2=medium, 3=high

/** Where a paid client meeting happens. */
export type MeetingKind = 'incall' | 'outcall' | 'public';

/**
 * Paid client-meeting details attached to a task. A meeting is an ordinary
 * timeline task (time, alerts, recurrence all work) plus who it's with,
 * where, and what it pays. Earnings count when the occurrence is completed.
 */
export interface MeetingInfo {
  kind: MeetingKind;
  /** Client name (free text; suggestions come from past meetings). */
  client: string;
  /** Agreed amount for one occurrence of this meeting. */
  rate: number;
  /** Occurrence dates whose payment has been collected. */
  paidDates: DayKey[];
  /** Optional address / spot note. */
  location: string;
  /**
   * Settled per-occurrence amounts (tips, overtime, discounts), keyed by
   * DayKey. Values are ABSOLUTE final amounts for that day; days without an
   * entry fall back to `rate`. Absolute so editing the rate later never
   * rewrites already-settled history.
   */
  extras?: Record<DayKey, number>;
  /**
   * Money received up-front per occurrence (booking deposits), keyed by
   * DayKey. A deposit reduces what's still owed for that day; it does NOT
   * change the occurrence's total amount.
   */
  deposits?: Record<DayKey, number>;
}

/** A meeting currently in progress (live timer). */
export interface ActiveMeeting {
  taskId: string;
  dateKey: DayKey;
  startedAt: number; // epoch ms
  plannedEndAt: number; // epoch ms — countdown target, extendable
  /** Minutes after planned end to fire a "check in" reminder, or null. */
  checkInAfterMin: number | null;
  /** Scheduled notification ids to cancel on end/extend. */
  notificationIds: string[];
}

/** A finished meeting session (history log). */
export interface MeetingLogEntry {
  id: string;
  taskId: string;
  client: string;
  kind: MeetingKind;
  dateKey: DayKey;
  startedAt: number;
  endedAt: number;
  plannedMinutes: number;
  actualMinutes: number;
  /** Minutes past the planned end (0 if ended early/on time). */
  overtimeMinutes: number;
  /** Final amount for the session (rate + adjustments at end time). */
  amount: number;
}

export interface Task {
  id: string;
  title: string;
  /** Ionicons glyph name, e.g. "barbell-outline". */
  icon: string;
  /** Key into TASK_COLORS palette, e.g. "coral". */
  color: string;
  notes: string;
  /**
   * Anchor date. null = inbox (unscheduled).
   * For recurring tasks this is the first occurrence date.
   */
  date: DayKey | null;
  /** true = all-day task (shown in the all-day shelf, no specific time). */
  allDay: boolean;
  /** Minutes from midnight, null when allDay or inbox. */
  startMinutes: number | null;
  /** Duration in minutes. 0 is allowed (point-in-time task). */
  durationMinutes: number;
  subtasks: Subtask[];
  /** Notification offsets in minutes before start (0 = at start). */
  alerts: number[];
  recurrence: Recurrence | null;
  priority: Priority;
  tags: string[];
  /** Present when this task is a paid client meeting. */
  meeting: MeetingInfo | null;
  /** Completion for one-off tasks. Recurring tasks use `completions`. */
  completed: boolean;
  completedAt: number | null;
  /** Per-occurrence completion for recurring tasks, keyed by DayKey. */
  completions: Record<DayKey, boolean>;
  /** Occurrence dates that were deleted ("skip just this one"). */
  skips: DayKey[];
  createdAt: number;
  updatedAt: number;
}

/** A task occurrence resolved for one specific day (recurring or one-off). */
export interface TaskInstance {
  task: Task;
  dateKey: DayKey;
  completed: boolean;
}

export interface CalendarEventLite {
  id: string;
  calendarId: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  allDay: boolean;
  color: string; // hex from the source calendar
  dateKey: DayKey;
}

export interface Habit {
  id: string;
  title: string;
  icon: string;
  color: string;
  /** How many times per day to count as done. Default 1. */
  timesPerDay: number;
  /** Which weekdays this habit is active (0=Sun..6=Sat). Empty = every day. */
  activeWeekdays: number[];
  /** Count completed per day. */
  completions: Record<DayKey, number>;
  createdAt: number;
  archived: boolean;
}

export type FocusMode = 'pomodoro' | 'stopwatch';

export interface FocusSession {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  mode: FocusMode;
  startedAt: number; // epoch ms
  /** Completed focused time in minutes (breaks excluded). */
  minutes: number;
  dateKey: DayKey;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  themeMode: ThemeMode;
  /** Hour the timeline starts at (default 0) and ends at (default 24). */
  dayStartHour: number;
  dayEndHour: number;
  /** Show imported device calendar events on the timeline. */
  showCalendarEvents: boolean;
  /** Device calendar IDs to hide. */
  hiddenCalendarIds: string[];
  /** Default task duration in minutes for new tasks. */
  defaultDurationMinutes: number;
  /** Default alert offsets for new scheduled tasks. */
  defaultAlerts: number[];
  /** Pomodoro lengths in minutes. */
  pomodoroWork: number;
  pomodoroBreak: number;
  pomodoroLongBreak: number;
  pomodoroCyclesBeforeLongBreak: number;
  /** Haptic feedback on interactions. */
  haptics: boolean;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  /** Symbol used for meeting earnings, e.g. "$". */
  currencySymbol: string;
  /** Weekly earnings target for the Stats goal bar, or null = no goal. */
  weeklyEarningsGoal: number | null;
  /** Require Face ID / passcode to open the app. */
  appLock: boolean;
  onboardingDone: boolean;
}
