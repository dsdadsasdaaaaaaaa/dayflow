import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { useCalls } from '../store/calls';
import { clientMetaKey, useClientMeta, type ClientMeta } from '../store/clientMeta';
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
import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  loadBackupPassphrase,
} from './cryptoBackup';
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
 * When a backup passphrase is set (src/lib/cryptoBackup.ts), snapshots and
 * exports are written as encrypted envelopes instead of plain JSON; restoring
 * decrypts with the stored passphrase (or one supplied by the caller). Plain
 * files from before a passphrase existed still restore fine.
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
  /**
   * Client book: notes/phones/statuses/display names keyed by lowercased
   * client name. Optional so v1 files written before it existed still restore.
   */
  clientMeta?: Record<string, ClientMeta>;
  /**
   * When each voicemail was first listened to (recording SID → ms). Calls and
   * voicemails themselves re-sync from the provider; only this local-only
   * read state needs backing up.
   */
  callsHeardAt?: Record<string, number>;
  settings: Settings;
}
// Message bodies are deliberately NOT backed up: threads re-sync from Twilio,
// and keeping client texts out of plaintext backup files is a privacy choice.

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

/** Snapshot every store into the backup payload shape. */
function currentPayload(): BackupPayload {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    tasks: Object.values(useTasks.getState().tasks),
    habits: Object.values(useHabits.getState().habits),
    focusSessions: useFocus.getState().sessions,
    meetingLog: useMeetingSession.getState().log,
    clientMeta: useClientMeta.getState().meta,
    callsHeardAt: useCalls.getState().heardAt,
    settings: useSettings.getState().settings,
  };
}

/**
 * The share-sheet export payload: current data as JSON, encrypted into an
 * envelope when a backup passphrase is set. `encrypted` lets the UI say so.
 */
export async function exportBackupPayload(): Promise<{ data: string; encrypted: boolean }> {
  const json = JSON.stringify({ ...currentPayload(), exportedAt: new Date().toISOString() });
  try {
    const passphrase = await loadBackupPassphrase();
    if (passphrase) return { data: encryptBackup(json, passphrase), encrypted: true };
  } catch {
    // Keychain hiccup — fall through to a plain export rather than failing.
  }
  return { data: json, encrypted: false };
}

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
      const json = JSON.stringify(currentPayload());
      // With a passphrase set, on-device snapshots are encrypted envelopes
      // too — an unlocked phone backup (or iCloud copy) exposes nothing.
      // FAIL CLOSED: a keychain read ERROR must skip the snapshot rather
      // than quietly writing the client book as plaintext; only a definite
      // "no passphrase set" (null) may write plain.
      let passphrase: string | null;
      try {
        passphrase = await loadBackupPassphrase();
      } catch {
        return;
      }
      file.create();
      file.write(passphrase ? encryptBackup(json, passphrase) : json);
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

/**
 * Delete today's snapshot and write it again (used right after the backup
 * passphrase is set, changed, or turned off, so the freshest snapshot on disk
 * always matches the current encryption choice). Best-effort: never throws.
 */
export async function rewriteTodayBackup(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const file = new File(backupsDir(), `dayflow-${todayKey()}.json`);
    if (file.exists) file.delete();
  } catch {
    // Couldn't remove the old snapshot — runAutoBackup will then keep it.
  }
  await runAutoBackup();
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
      whenHydrated(useClientMeta),
      whenHydrated(useCalls),
      whenHydrated(useSettings),
    ]);
    await runAutoBackup();
  })();
}

/**
 * Delete every on-device backup file and the backups directory itself
 * (used by "Erase all data"). Best-effort: never throws.
 */
export function deleteAllBackups(): void {
  if (Platform.OS === 'web') return;
  try {
    const dir = backupsDir();
    if (!dir.exists) return;
    // Directory.delete() removes contents recursively, but sweep files first
    // so one stuck entry doesn't leave every other snapshot behind.
    for (const entry of dir.list()) {
      try {
        entry.delete();
      } catch {
        // Leave it; the directory delete below gets another chance.
      }
    }
    try {
      dir.delete();
    } catch {
      // Directory itself is empty (or stuck) — nothing sensitive remains.
    }
  } catch {
    // Erase must never throw over a backup file.
  }
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

/** Coerce an untrusted client-book map into valid ClientMeta entries. */
export function sanitizeClientMeta(raw: unknown): Record<string, ClientMeta> {
  const out: Record<string, ClientMeta> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = clientMetaKey(name);
    if (!key || !v || typeof v !== 'object') continue;
    const m = v as Record<string, unknown>;
    const entry: ClientMeta = { notes: typeof m.notes === 'string' ? m.notes : '' };
    if (typeof m.phone === 'string' && m.phone.trim()) entry.phone = m.phone;
    // Telegram link must survive the round-trip — dropping it would silently
    // un-block a blocked Telegram contact after a restore.
    if (typeof m.telegram === 'string' && m.telegram.trim()) {
      entry.telegram = m.telegram.trim();
    }
    if (m.status === 'lead' || m.status === 'client' || m.status === 'blocked') {
      entry.status = m.status;
    }
    if (typeof m.displayName === 'string' && m.displayName.trim()) {
      entry.displayName = m.displayName.trim();
    }
    out[key] = entry;
  }
  return out;
}

/** Coerce an untrusted voicemail-heard map (recording SID → ms timestamp). */
export function sanitizeHeardAt(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [sid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (sid && typeof v === 'number' && Number.isFinite(v) && v > 0) out[sid] = v;
  }
  return out;
}

/** Coerce untrusted backup settings into a valid Settings object. */
function sanitizeSettings(raw: unknown): Settings {
  // Backups may predate the messaging/calling settings — seed those from the
  // device so a restore never silently disables calling or drops templates.
  const current = useSettings.getState().settings;
  const out: Settings = {
    ...DEFAULT_SETTINGS,
    messageTemplates: current.messageTemplates,
    photoQuickReplies: current.photoQuickReplies,
    callingEnabled: current.callingEnabled,
    callForwardTo: current.callForwardTo,
    callShowWorkNumber: current.callShowWorkNumber,
    voicemailGreeting: current.voicemailGreeting,
    // Safety + lock config must never regress to defaults on restore — a
    // restore that silently disarms the trusted-contact alert is dangerous.
    safetyAlertEnabled: current.safetyAlertEnabled,
    trustedContactName: current.trustedContactName,
    trustedContactPhone: current.trustedContactPhone,
    safetyGraceMinutes: current.safetyGraceMinutes,
    safetyMessage: current.safetyMessage,
    appLockGraceSeconds: current.appLockGraceSeconds,
    appLock: current.appLock,
    onboardingDone: true,
  };
  if (!raw || typeof raw !== 'object') return out;
  const s = raw as Record<string, unknown>;

  // Prefer the backup's own safety block when it carries one (newer files do).
  if (typeof s.safetyAlertEnabled === 'boolean') out.safetyAlertEnabled = s.safetyAlertEnabled;
  if (typeof s.trustedContactName === 'string') out.trustedContactName = s.trustedContactName;
  if (typeof s.trustedContactPhone === 'string') out.trustedContactPhone = s.trustedContactPhone;
  if (typeof s.safetyGraceMinutes === 'number' && Number.isFinite(s.safetyGraceMinutes)) {
    out.safetyGraceMinutes = Math.min(60, Math.max(5, Math.round(s.safetyGraceMinutes)));
  }
  if (typeof s.safetyMessage === 'string' && s.safetyMessage.trim()) {
    out.safetyMessage = s.safetyMessage;
  }
  if (typeof s.appLockGraceSeconds === 'number' && Number.isFinite(s.appLockGraceSeconds)) {
    out.appLockGraceSeconds = Math.max(0, Math.round(s.appLockGraceSeconds));
  }

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
  if (Array.isArray(s.messageTemplates)) {
    out.messageTemplates = s.messageTemplates.filter(
      (x): x is string => typeof x === 'string'
    );
  }
  if (Array.isArray(s.photoQuickReplies)) {
    out.photoQuickReplies = s.photoQuickReplies.filter(
      (x): x is { label: string; url: string } =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as { label?: unknown }).label === 'string' &&
        typeof (x as { url?: unknown }).url === 'string'
    );
  }
  if (typeof s.callingEnabled === 'boolean') out.callingEnabled = s.callingEnabled;
  if (typeof s.callForwardTo === 'string') out.callForwardTo = s.callForwardTo;
  if (typeof s.callShowWorkNumber === 'boolean') out.callShowWorkNumber = s.callShowWorkNumber;
  if (typeof s.voicemailGreeting === 'string' && s.voicemailGreeting.trim()) {
    out.voicemailGreeting = s.voicemailGreeting;
  }
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
 *
 * Encrypted snapshots decrypt with the keychain passphrase, or with
 * `passphrase` when supplied (e.g. a file written under an older passphrase).
 * Returns false when neither opens the file.
 */
export async function restoreBackup(name: string, passphrase?: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!BACKUP_NAME_RE.test(name)) return false;
  try {
    const file = new File(backupsDir(), name);
    if (!file.exists) return false;

    let raw = await file.text();
    if (isEncryptedBackup(raw)) {
      const pass = passphrase ?? (await loadBackupPassphrase());
      if (!pass) return false;
      const dec = decryptBackup(raw, pass);
      if (!dec.ok) return false;
      raw = dec.plaintext;
    }

    const parsed: unknown = JSON.parse(raw);
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
    // Only replace the client book / voicemail read state when the file
    // carries them — a v1 backup without them must not wipe what's on device.
    if (p.clientMeta !== undefined) {
      useClientMeta.setState({ meta: sanitizeClientMeta(p.clientMeta) });
    }
    if (p.callsHeardAt !== undefined) {
      useCalls.setState({ heardAt: sanitizeHeardAt(p.callsHeardAt) });
    }

    void syncAllNotifications(useTasks.getState().tasks);
    return true;
  } catch {
    return false;
  }
}
