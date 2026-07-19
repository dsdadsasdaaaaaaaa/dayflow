import * as Notifications from 'expo-notifications';
import { useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import { successHaptic, warningHaptic } from '../../lib/haptics';
import { ensureNotificationPermission } from '../../lib/notifications';
import { useFocus } from '../../store/focus';
import { useSettings } from '../../store/settings';
import type { FocusMode } from '../../types';

export type TimerStatus = 'idle' | 'running' | 'paused';
export type PomodoroPhase = 'work' | 'break' | 'longBreak';

export interface SessionEnd {
  taskId: string | null;
  taskTitle: string | null;
  minutes: number;
}

export interface FocusTimer {
  mode: FocusMode;
  status: TimerStatus;
  phase: PomodoroPhase;
  /** 0-based index of the current work slot within the super-cycle. */
  cycle: number;
  cycles: number;
  /** Pomodoro: remaining ms in phase. Stopwatch: elapsed ms. */
  displayMs: number;
  /** Ring fill 0..1. Pomodoro drains; stopwatch sweeps once per hour. */
  progress: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  skip: () => void;
  setMode: (mode: FocusMode) => void;
}

interface PomodoroConfig {
  workMs: number;
  breakMs: number;
  longBreakMs: number;
  cycles: number;
}

interface TimerData {
  mode: FocusMode;
  status: TimerStatus;
  phase: PomodoroPhase;
  cycle: number;
  /** Pomodoro: wall-clock end of the current phase (valid while running). */
  endAt: number;
  /** Pomodoro: frozen remaining ms (valid while paused). */
  remainingMs: number;
  /** Duration of the current pomodoro phase, captured at phase start. */
  phaseMs: number;
  /** Wall-clock start of the current phase / stopwatch chunk (for logging). */
  chunkStartedAt: number;
  /** Stopwatch: elapsed ms accumulated across pauses. */
  accumMs: number;
  /** Stopwatch: wall-clock start of the current running leg. */
  runStartedAt: number;
  /** Stopwatch: elapsed ms already flushed to the session log. */
  loggedMs: number;
  notifIds: string[];
  notifGen: number;
}

function readConfig(): PomodoroConfig {
  const s = useSettings.getState().settings;
  return {
    workMs: Math.max(1, s.pomodoroWork) * 60_000,
    breakMs: Math.max(1, s.pomodoroBreak) * 60_000,
    longBreakMs: Math.max(1, s.pomodoroLongBreak) * 60_000,
    cycles: Math.max(1, s.pomodoroCyclesBeforeLongBreak),
  };
}

function phaseDuration(phase: PomodoroPhase, c: PomodoroConfig): number {
  if (phase === 'work') return c.workMs;
  if (phase === 'break') return c.breakMs;
  return c.longBreakMs;
}

/** Next phase in the work → break → … → work → long-break sequence, or null when the run ends. */
function nextPhase(
  phase: PomodoroPhase,
  cycle: number,
  cycles: number
): { phase: PomodoroPhase; cycle: number } | null {
  if (phase === 'work') {
    return cycle >= cycles - 1
      ? { phase: 'longBreak', cycle }
      : { phase: 'break', cycle };
  }
  if (phase === 'break') return { phase: 'work', cycle: cycle + 1 };
  return null; // long break finished → run complete
}

function notificationCopy(
  endingPhase: PomodoroPhase,
  next: { phase: PomodoroPhase } | null,
  c: PomodoroConfig
): { title: string; body: string } {
  if (endingPhase === 'work') {
    if (next?.phase === 'longBreak') {
      return {
        title: 'Focus complete',
        body: `Great work — take a ${Math.round(c.longBreakMs / 60_000)} min long break.`,
      };
    }
    return {
      title: 'Focus complete',
      body: `Time for a ${Math.round(c.breakMs / 60_000)} min break.`,
    };
  }
  if (endingPhase === 'break') {
    return {
      title: 'Break over',
      body: `Back to it — ${Math.round(c.workMs / 60_000)} min of focus.`,
    };
  }
  return { title: 'Pomodoro complete', body: 'All cycles finished. Nice work!' };
}

/** "25:00" / "1:05:09". Countdown ceils so the clock starts full and hits 0:00 exactly at the end. */
export function formatClock(ms: number, countUp: boolean): string {
  const total = Math.max(0, countUp ? Math.floor(ms / 1000) : Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Drift-free focus timer engine.
 *
 * All timing derives from wall-clock timestamps (`endAt` / `runStartedAt`);
 * the 250 ms interval only *recomputes* — it never decrements — so the timer
 * survives backgrounding, JS stalls, and clock ticks without drifting.
 * Phase-end alerts are scheduled as local notifications (best effort) so a
 * backgrounded pomodoro still chimes.
 */
export function useFocusTimer(options: {
  /** Called at flush time so a mid-session relink attributes correctly. */
  getLink: () => { taskId: string | null; taskTitle: string | null };
  /** Fired whenever ≥1 focused minute is written to the log. */
  onSessionLogged: (end: SessionEnd) => void;
}): FocusTimer {
  const [, force] = useReducer((x: number) => x + 1, 0);

  const getLinkRef = useRef(options.getLink);
  const onLoggedRef = useRef(options.onSessionLogged);
  getLinkRef.current = options.getLink;
  onLoggedRef.current = options.onSessionLogged;

  const T = useRef<TimerData>({
    mode: 'pomodoro',
    status: 'idle',
    phase: 'work',
    cycle: 0,
    endAt: 0,
    remainingMs: 0,
    phaseMs: 0,
    chunkStartedAt: 0,
    accumMs: 0,
    runStartedAt: 0,
    loggedMs: 0,
    notifIds: [],
    notifGen: 0,
  }).current;

  // ── Session logging ────────────────────────────────────────────────────

  /** Write `ms` of focused time to the log (no-op under a minute). */
  const flushLog = (startedAt: number, ms: number): boolean => {
    if (ms < 60_000) return false;
    const link = getLinkRef.current();
    const minutes = Math.max(1, Math.round(ms / 60_000));
    useFocus.getState().logSession({
      taskId: link.taskId,
      taskTitle: link.taskTitle,
      mode: T.mode,
      startedAt,
      minutes,
    });
    onLoggedRef.current({ taskId: link.taskId, taskTitle: link.taskTitle, minutes });
    return true;
  };

  // ── Notifications (best effort, never throw) ──────────────────────────

  const cancelNotifications = () => {
    T.notifGen += 1;
    const ids = T.notifIds;
    T.notifIds = [];
    try {
      for (const id of ids) {
        Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      }
    } catch {
      // best effort
    }
  };

  /**
   * Schedule an alert for every remaining phase boundary of the current run
   * so a fully backgrounded pomodoro still walks the user through the cycle.
   */
  const scheduleChain = async () => {
    try {
      cancelNotifications();
      if (T.status !== 'running' || T.mode !== 'pomodoro') return;
      const gen = T.notifGen;
      const granted = await ensureNotificationPermission();
      if (!granted || gen !== T.notifGen) return;

      const c = readConfig();
      let phase = T.phase;
      let cycle = T.cycle;
      let at = T.endAt;
      const ids: string[] = [];
      const maxBoundaries = c.cycles * 2 + 2;

      for (let i = 0; i < maxBoundaries; i++) {
        const next = nextPhase(phase, cycle, c.cycles);
        if (at > Date.now() + 500) {
          const { title, body } = notificationCopy(phase, next, c);
          const id = await Notifications.scheduleNotificationAsync({
            content: { title, body, sound: true, data: { dayflowFocus: true } },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(at),
            },
          });
          if (gen !== T.notifGen) {
            // A pause/reset raced us — undo and bail.
            Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
            return;
          }
          ids.push(id);
          T.notifIds = ids;
        }
        if (!next) break;
        phase = next.phase;
        cycle = next.cycle;
        at += phaseDuration(phase, c);
      }
    } catch {
      // Notifications are a bonus; the in-app timer is the source of truth.
    }
  };

  // ── Core transitions ───────────────────────────────────────────────────

  const resetPomodoroCore = (c: PomodoroConfig) => {
    T.status = 'idle';
    T.phase = 'work';
    T.cycle = 0;
    T.phaseMs = c.workMs;
    T.remainingMs = c.workMs;
    T.endAt = 0;
  };

  /**
   * Advance through any phase boundaries that have passed. Runs on every
   * tick and on app foreground, so hours of backgrounded time resolve to
   * the correct phase (work phases get logged along the way).
   */
  const catchUp = () => {
    if (T.status !== 'running' || T.mode !== 'pomodoro') return;
    const c = readConfig();
    let transitioned = false;
    let guard = 0;
    while (T.status === 'running' && T.endAt <= Date.now() && guard++ < 64) {
      const finishedAt = T.endAt;
      if (T.phase === 'work') flushLog(T.chunkStartedAt, T.phaseMs);
      transitioned = true;
      const next = nextPhase(T.phase, T.cycle, c.cycles);
      if (!next) {
        // Long break done — the full pomodoro run is complete.
        cancelNotifications();
        resetPomodoroCore(c);
        break;
      }
      T.phase = next.phase;
      T.cycle = next.cycle;
      T.phaseMs = phaseDuration(next.phase, c);
      T.chunkStartedAt = finishedAt;
      T.endAt = finishedAt + T.phaseMs;
    }
    if (transitioned) successHaptic();
  };

  /** Stop the current session, flushing any unlogged focused time. */
  const stopInternal = () => {
    const now = Date.now();
    if (T.mode === 'pomodoro') {
      const c = readConfig();
      if (T.status !== 'idle' && T.phase === 'work') {
        const remaining =
          T.status === 'running' ? Math.max(0, T.endAt - now) : T.remainingMs;
        flushLog(T.chunkStartedAt, T.phaseMs - remaining);
      }
      cancelNotifications();
      resetPomodoroCore(c);
    } else {
      const elapsed =
        T.status === 'running' ? T.accumMs + (now - T.runStartedAt) : T.accumMs;
      flushLog(T.chunkStartedAt, elapsed - T.loggedMs);
      T.status = 'idle';
      T.accumMs = 0;
      T.loggedMs = 0;
    }
  };

  // ── Public actions ─────────────────────────────────────────────────────

  const start = () => {
    if (T.status !== 'idle') return;
    const now = Date.now();
    if (T.mode === 'pomodoro') {
      const c = readConfig();
      T.status = 'running';
      T.phase = 'work';
      T.cycle = 0;
      T.phaseMs = c.workMs;
      T.chunkStartedAt = now;
      T.endAt = now + c.workMs;
      void scheduleChain();
    } else {
      T.status = 'running';
      T.accumMs = 0;
      T.loggedMs = 0;
      T.runStartedAt = now;
      T.chunkStartedAt = now;
    }
    force();
  };

  const pause = () => {
    if (T.status !== 'running') return;
    const now = Date.now();
    if (T.mode === 'pomodoro') {
      catchUp();
      if (T.status === 'running') {
        T.remainingMs = Math.max(0, T.endAt - now);
        T.status = 'paused';
        cancelNotifications();
      }
    } else {
      const elapsed = T.accumMs + (now - T.runStartedAt);
      T.accumMs = elapsed;
      T.status = 'paused';
      // A pause is a natural session end for the stopwatch — flush it.
      if (flushLog(T.chunkStartedAt, elapsed - T.loggedMs)) T.loggedMs = elapsed;
    }
    force();
  };

  const resume = () => {
    if (T.status !== 'paused') return;
    const now = Date.now();
    if (T.mode === 'pomodoro') {
      T.endAt = now + T.remainingMs;
      T.status = 'running';
      void scheduleChain();
    } else {
      T.runStartedAt = now;
      // If the previous chunk was flushed, the next one starts now.
      if (T.loggedMs >= T.accumMs) T.chunkStartedAt = now;
      T.status = 'running';
    }
    force();
  };

  const reset = () => {
    if (T.status === 'idle') return;
    warningHaptic();
    stopInternal();
    force();
  };

  const skip = () => {
    if (T.mode !== 'pomodoro' || T.status === 'idle') return;
    const c = readConfig();
    const now = Date.now();
    const remaining =
      T.status === 'running' ? Math.max(0, T.endAt - now) : T.remainingMs;
    if (T.phase === 'work') flushLog(T.chunkStartedAt, T.phaseMs - remaining);

    const next = nextPhase(T.phase, T.cycle, c.cycles);
    if (!next) {
      cancelNotifications();
      resetPomodoroCore(c);
    } else {
      T.phase = next.phase;
      T.cycle = next.cycle;
      T.phaseMs = phaseDuration(next.phase, c);
      T.chunkStartedAt = now;
      if (T.status === 'running') {
        T.endAt = now + T.phaseMs;
        void scheduleChain();
      } else {
        T.remainingMs = T.phaseMs;
      }
    }
    force();
  };

  const setMode = (mode: FocusMode) => {
    if (mode === T.mode) return;
    if (T.status !== 'idle') stopInternal();
    T.mode = mode;
    T.status = 'idle';
    resetIdleDisplay();
    force();
  };

  const resetIdleDisplay = () => {
    const c = readConfig();
    T.phase = 'work';
    T.cycle = 0;
    T.phaseMs = c.workMs;
    T.remainingMs = c.workMs;
    T.accumMs = 0;
    T.loggedMs = 0;
  };

  // ── Ticking & lifecycle ────────────────────────────────────────────────

  const status = T.status;

  useEffect(() => {
    if (status !== 'running') return;
    const interval = setInterval(() => {
      catchUp();
      force();
    }, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Recompute immediately — hours may have passed while backgrounded.
        catchUp();
        force();
        // The root layout wipes ALL scheduled notifications on foreground
        // (task-alert resync); re-schedule our chain after it settles.
        if (T.status === 'running' && T.mode === 'pomodoro') {
          setTimeout(() => {
            if (T.status === 'running' && T.mode === 'pomodoro') {
              void scheduleChain();
            }
          }, 1500);
        }
      } else if (state === 'background') {
        if (T.status === 'running' && T.mode === 'pomodoro') void scheduleChain();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived display values (recomputed every render) ───────────────────

  // Reactive so an idle timer reflects settings changes instantly.
  const settings = useSettings((s) => s.settings);
  const cycles = Math.max(1, settings.pomodoroCyclesBeforeLongBreak);
  const idleWorkMs = Math.max(1, settings.pomodoroWork) * 60_000;

  const now = Date.now();
  let displayMs: number;
  let progress: number;
  if (T.mode === 'pomodoro') {
    const total = T.status === 'idle' ? idleWorkMs : T.phaseMs;
    const remaining =
      T.status === 'running'
        ? Math.max(0, T.endAt - now)
        : T.status === 'paused'
          ? T.remainingMs
          : idleWorkMs;
    displayMs = remaining;
    progress = total > 0 ? remaining / total : 0;
  } else {
    const elapsed =
      T.status === 'running' ? T.accumMs + (now - T.runStartedAt) : T.accumMs;
    displayMs = elapsed;
    progress = (elapsed % 3_600_000) / 3_600_000;
  }

  return {
    mode: T.mode,
    status: T.status,
    phase: T.phase,
    cycle: T.cycle,
    cycles,
    displayMs,
    progress,
    start,
    pause,
    resume,
    reset,
    skip,
    setMode,
  };
}
