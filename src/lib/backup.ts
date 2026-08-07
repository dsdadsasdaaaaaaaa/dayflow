import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { useFocus } from '../store/focus';
import { useHabits } from '../store/habits';
import { useMeetingSession } from '../store/meetingSession';
import { DEFAULT_SETTINGS, useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';
import type {
  DayKey,
  FocusSession,
  Habit,
  MeetingLogEntry,
  Settings,
  Task,
} from '../types';
import { todayKey } from './dates';
import { uid } from './id';
import { syncAllNotifications } from './notifications';

/**
 * Automatic local backups.
 *
 * Once per app-open a JSON snapshot of every store is written to
 * `<documents>/backups/dayflow-YYYY-MM-DD.json`. Documents are covered by the
 * user's iCloud device backup, so this doubles as off-device protection without
 * DayFlow ever talking to a server. Only the newest 7 days are kept.
 *
 * Everything here is a no-op on web (no usable filesystem).
 */

interface BackupPayload {
  version: 1;
  createdAt: string;
  tasks: Task[];
  habits: Habit[];
  focusSessions: FocusSession[];
  meetingLog: MeetingLogEntry[];
  /** Reserved for future per-client metadata; not written today. */
  clientMeta?: unknown;
  settings: Settings;
}

export interface BackupEntry {
  /** File name, e.g. "dayflow-2026-07-19.json". */
  name: string;
  /** DayKey the backup was taken on (parsed from the name). */
  date: DayKey;
  /** File size in bytes. */
  size: number;
}

const BACKUP_NAME_RE = /^dayflow-\d{4}-\d{2}-\d{2}\.json$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_COUNT = 7;

function backupsDir(): Directory {
  return new Directory(Paths.document, 'backups');
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write today's backup if it doesn't exist yet, then prune to the newest
 * {@link KEEP_COUNT} files. Best-effort: never throws.
 */
export async function runAutoBackup(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const dir = backupsDir();
    dir.create({ intermediates: true, idempotent: true });

    const file = new File(dir, `dayflow-${todayKey()}.json`);
    if (!file.exists) {
      const payload: BackupPayload = {
        version: 1,
        createdAt: new Date().toISOString(),
        tasks: Object.values(useTasks.getState().tasks),
        habits: Object.values(useHabits.getState().habits),
        focusSessions: useFocus.getState().sessions,
        meetingLog: useMeetingSession.getState().log,
        settings: useSettings.getState().settings,
      };
      file.create();
      file.write(JSON.stringify(payload));
    }

    // Prune. Names embed the date, so lexicographic order is chronological.
    const files = dir
      .list()
      .filter((e): e is File => e instanceof File && BACKUP_NAME_RE.test(e.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const old of files.slice(KEEP_COUNT)) {
      try {
        old.delete();
      } catch {
        // A stuck file just gets retried on the next run.
      }
    }
  } catch {
    // Backups are best-effort; they must never crash the app.
  }
}

interface PersistApi {
  hasHydrated: () => boolean;
  onFinishHydration: (cb: () => void) => () => void;
}

/** Resolve once a persisted store has rehydrated from AsyncStorage. */
function whenHydrated(store: { persist: PersistApi }): Promise<void> {
  return new Promise((resolve) => {
    if (store.persist.hasHydrated()) {
      resolve();
      return;
    }
    const unsub = store.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

let autoBackupStarted = false;

/**
 * Kick off the once-per-app-open auto backup. Safe to call repeatedly (later
 * calls no-op). Waits for every persisted store to rehydrate first so an early
 * call can never snapshot empty stores over real data.
 */
export function startAutoBackup(): void {
  if (autoBackupStarted || Platform.OS === 'web') return;
  autoBackupStarted = true;
  void (async () => {
    await Promise.all([
      whenHydrated(useTasks),
      whenHydrated(useHabits),
      whenHydrated(useFocus),
      whenHydrated(useMeetingSession),
      whenHydrated(useSettings),
    ]);
    await runAutoBackup();
  })();
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** All stored backups, newest first. Empty on web or on any error. */
export function listBackups(): BackupEntry[] {
  if (Platform.OS === 'web') return [];
  try {
    const dir = backupsDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((e): e is File => e instanceof File && BACKUP_NAME_RE.test(e.name))
      .map((f) => ({
        name: f.name,
        date: f.name.slice('dayflow-'.length, 'dayflow-'.length + 10),
        size: f.size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sanitizeHabit(raw: unknown): Habit | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.id !== 'string' || !h.id || typeof h.title !== 'string' || !h.title.trim()) {
    return null;
  }
  const completions: Record<DayKey, number> = {};
  if (h.completions && typeof h.completions === 'object') {
    for (const [k, v] of Object.entries(h.completions as Record<string, unknown>)) {
      if (DAY_RE.test(k) && typeof v === 'number' && Number.isFinite(v)) completions[k] = v;
    }
  }
  return {
    id: h.id,
    title: h.title.trim(),
    icon: typeof h.icon === 'string' && h.icon ? h.icon : 'sparkles-outline',
    color: typeof h.color === 'string' && h.color ? h.color : 'emerald',
    timesPerDay: Math.max(1, Math.round(num(h.timesPerDay, 1))),
    activeWeekdays: Array.isArray(h.activeWeekdays)
      ? h.activeWeekdays.filter((w): w is number => typeof w === 'number' && w >= 0 && w <= 6)
      : [],
    completions,
    createdAt: num(h.createdAt, Date.now()),
    archived: h.archived === true,
  };
}

function sanitizeFocusSession(raw: unknown): FocusSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.startedAt !== 'number' || typeof s.minutes !== 'number') return null;
  if (typeof s.dateKey !== 'string' || !DAY_RE.test(s.dateKey)) return null;
  return {
    id: typeof s.id === 'string' && s.id ? s.id : uid(),
    taskId: typeof s.taskId === 'string' ? s.taskId : null,
    taskTitle: typeof s.taskTitle === 'string' ? s.taskTitle : null,
    mode: s.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro',
    startedAt: s.startedAt,
    minutes: Math.max(0, Math.round(s.minutes)),
    dateKey: s.dateKey,
  };
}

function sanitizeLogEntry(raw: unknown): MeetingLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.startedAt !== 'number' || typeof e.endedAt !== 'number') return null;
  if (typeof e.dateKey !== 'string' || !DAY_RE.test(e.dateKey)) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id : uid(),
    taskId: typeof e.taskId === 'string' ? e.taskId : '',
    client: typeof e.client === 'string' ? e.client : '',
    kind: e.kind === 'outcall' || e.kind === 'public' ? e.kind : 'incall',
    dateKey: e.dateKey,
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    plannedMinutes: Math.max(1, Math.round(num(e.plannedMinutes, 1))),
    actualMinutes: Math.max(1, Math.round(num(e.actualMinutes, 1))),
    overtimeMinutes: Math.max(0, Math.round(num(e.overtimeMinutes, 0))),
    amount: num(e.amount, 0),
  };
}

/** Coerce untrusted backup settings into a valid Settings object. */
function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, onboardingDone: true };
  if (!raw || typeof raw !== 'object') return out;
  const s = raw as Record<string, unknown>;

  if (s.themeMode === 'system' || s.themeMode === 'light' || s.themeMode === 'dark') {
    out.themeMode = s.themeMode;
  }
  out.dayStartHour = Math.min(12, Math.max(0, Math.round(num(s.dayStartHour, out.dayStartHour))));
  out.dayEndHour = Math.min(
    24,
    Math.max(out.dayStartHour + 1, Math.round(num(s.dayEndHour, out.dayEndHour)))
  );
  if (typeof s.showCalendarEvents === 'boolean') out.showCalendarEvents = s.showCalendarEvents;
  if (Array.isArray(s.hiddenCalendarIds)) {
    out.hiddenCalendarIds = s.hiddenCalendarIds.filter(
      (x): x is string => typeof x === 'string'
    );
  }
  out.defaultDurationMinutes = Math.max(
    5,
    Math.round(num(s.defaultDurationMinutes, out.defaultDurationMinutes))
  );
  if (Array.isArray(s.defaultAlerts)) {
    out.defaultAlerts = s.defaultAlerts.filter(
      (x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0
    );
  }
  out.pomodoroWork = Math.max(1, Math.round(num(s.pomodoroWork, out.pomodoroWork)));
  out.pomodoroBreak = Math.max(1, Math.round(num(s.pomodoroBreak, out.pomodoroBreak)));
  out.pomodoroLongBreak = Math.max(1, Math.round(num(s.pomodoroLongBreak, out.pomodoroLongBreak)));
  out.pomodoroCyclesBeforeLongBreak = Math.max(
    2,
    Math.round(num(s.pomodoroCyclesBeforeLongBreak, out.pomodoroCyclesBeforeLongBreak))
  );
  if (typeof s.haptics === 'boolean') out.haptics = s.haptics;
  if (s.weekStartsOn === 0 || s.weekStartsOn === 1) out.weekStartsOn = s.weekStartsOn;
  if (typeof s.currencySymbol === 'string' && s.currencySymbol.trim()) {
    out.currencySymbol = s.currencySymbol;
  }
  if (s.weeklyEarningsGoal === null) out.weeklyEarningsGoal = null;
  else if (typeof s.weeklyEarningsGoal === 'number' && s.weeklyEarningsGoal > 0) {
    out.weeklyEarningsGoal = s.weeklyEarningsGoal;
  }
  if (typeof s.appLock === 'boolean') out.appLock = s.appLock;
  if (typeof s.onboardingDone === 'boolean') out.onboardingDone = s.onboardingDone;
  return out;
}

/** Accept either an array or a keyed record (both shapes appear in backups). */
function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
}

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

/**
 * Replace all on-device data with the named backup file.
 * Returns false (and changes nothing) if the file is missing or malformed.
 */
export async function restoreBackup(name: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!BACKUP_NAME_RE.test(name)) return false;
  try {
    const file = new File(backupsDir(), name);
    if (!file.exists) return false;

    const parsed: unknown = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const p = parsed as Record<string, unknown>;

    // Validate everything BEFORE touching any store, so a malformed file
    // can never leave the app half-restored.
    const tasks = asList(p.tasks) as Task[]; // importTasks sanitizes each entry
    const habits = asList(p.habits).map(sanitizeHabit).filter(notNull);
    const sessions = asList(p.focusSessions).map(sanitizeFocusSession).filter(notNull);
    const log = asList(p.meetingLog).map(sanitizeLogEntry).filter(notNull);
    const settings = sanitizeSettings(p.settings);

    // A restore replaces current data (the UI double-confirms this).
    useTasks.setState({ tasks: {} });
    useTasks.getState().importTasks(tasks);
    useHabits.setState({ habits: Object.fromEntries(habits.map((h) => [h.id, h])) });
    useFocus.setState({ sessions });
    useMeetingSession.setState({ log });
    useSettings.setState({ settings });

    void syncAllNotifications(useTasks.getState().tasks);
    return true;
  } catch {
    return false;
  }
}
