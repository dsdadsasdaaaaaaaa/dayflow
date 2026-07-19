# DayFlow — Implementation Contract

DayFlow is a free iOS day-planner built with Expo (SDK 57, React Native 0.86, TypeScript,
expo-router v6). It is a superior clone of "Structured — Daily Planner": visual vertical
timeline + inbox + recurring tasks + habits + focus timer + stats, with everything free.

## Non-negotiable rules for every implementation agent

1. **Only create/edit files inside your assigned paths.** Never touch another agent's
   folders, the stores, libs, types, theme, or root layouts (read them, don't edit).
2. TypeScript strict. Verify with:
   `export PATH="/Users/levisilverberg/.nvm/versions/node/v20.20.2/bin:$PATH" && cd "/Users/levisilverberg/structured remake" && npx tsc --noEmit`
   Fix every error in YOUR files before finishing (errors in other agents' files may
   appear mid-build — ignore those, they're being fixed in parallel).
3. Do NOT run `npm start` / `expo start` / install packages. Available deps:
   expo-router, reanimated 4.5 (+react-native-worklets), gesture-handler, async-storage,
   expo-haptics, expo-notifications, expo-calendar, expo-linear-gradient, expo-device,
   react-native-svg, @expo/vector-icons (Ionicons), zustand 5, dayjs, safe-area-context.
4. RN 0.86 notes: `StyleSheet.absoluteFillObject` no longer exists — use
   `StyleSheet.absoluteFill` inside a style array. Keyboard handling: use
   `KeyboardAvoidingView` behavior="padding" on iOS.
5. The iOS tab bar is `position: absolute` — every tab screen needs bottom padding
   (~`96 + insets.bottom`) on scroll content so it clears the bar and the FAB.
6. All colors/typography come from `src/theme` — never hardcode hex except pure white
   text on solid task colors. Support light AND dark mode everywhere via `useTheme()`.
7. Interactions get haptics via `src/lib/haptics` helpers (they respect the setting).
8. Never mark tasks/data "overdue" in red. Gentle design: unfinished past tasks are
   dimmed, never shamed.

## Data model (src/types.ts — read it)

- `Task`: title, icon (Ionicons name), color (key of TASK_COLORS), notes, date
  (DayKey "YYYY-MM-DD" or null = inbox), allDay, startMinutes (min from midnight),
  durationMinutes, subtasks, alerts (minutes-before array), recurrence, priority 0-3,
  tags, completed/completedAt (one-off), completions map + skips (recurring),
  `meeting: MeetingInfo | null`.
- `MeetingInfo` — PAID CLIENT MEETINGS, a flagship feature. The user gets paid per
  meeting. Fields: kind ('incall' | 'outcall' | 'public'), client (name), rate
  (amount for one occurrence), paidDates (DayKey[] of collected payments),
  location (free text). A meeting is an ordinary task with these extras: it lives
  on the timeline, gets alerts/recurrence/drag like any task. Completing the
  occurrence = the meeting happened = money earned; marking paid = money collected.
  Treat this professionally and neutrally everywhere (labels: "Meeting", "Client",
  "Rate", "Paid"). `src/lib/meetings.ts` has: MEETING_KINDS + meetingKindMeta
  (label + Ionicon per kind), formatMoney(amount, symbol), isPaidOn(task, day),
  meetingOccurrences(tasks, days), earningsForDays(tasks, days) →
  {earned, expected, outstanding, collected, meetingsDone, meetingsPlanned},
  knownClients(tasks), lastMeetingFor(tasks, client) → prefill {rate, kind, location}.
  `useSettings` has `currencySymbol` (default "$"). `useTasks` has
  `togglePaid(id, day)` and `setOccurrenceAmount(id, day, absoluteFinalAmount)`
  (stores the delta from rate into `meeting.extras[day]`; occurrenceAmount(task, day)
  in lib/meetings resolves it). TaskCard already renders the money badge (pass `dateKey`).

## Client book & business layer

- `clientProfiles(tasks, log)` (src/lib/meetings.ts) → ClientProfile[]: per-client
  name/kind/rate/location, meetingsDone, earned/collected/outstanding, loggedMinutes,
  lastSeen, nextMeeting, and `unpaid` occurrence list (for settle-up UI).
- `meetingsCsv(tasks, log, symbol)` → CSV string of completed occurrences.
- Routes `/clients` (list) and `/client-detail?name=<client>` are registered.
- Settings has `weeklyEarningsGoal: number | null` and `appLock: boolean`.
- `LockGate` (src/components/LockGate.tsx) wraps the root layout — Face ID gate
  driven by settings.appLock (expo-local-authentication; no-op on web).

## Live meeting sessions (src/store/meetingSession.ts — read it)

The user starts a timer when a meeting begins and gets notified when time is up.
- `useMeetingSession`: `active: ActiveMeeting | null` (persists across restarts),
  `log: MeetingLogEntry[]`;
  `start(task, dateKey, plannedMinutes, checkInAfterMin | null)` — schedules a
  10-min warning + time's-up notification (+ optional check-in reminder N min
  after end, useful for out-calls);
  `extend(minutes)` — pushes planned end later, re-schedules alerts;
  `end({finalAmount, client, kind})` → MeetingLogEntry (logs planned vs actual
  vs overtime minutes); `cancel()`; `clearLog()`.
  Helper `meetingMinutesOn(log, days)`.
- Timer math: ALWAYS derive remaining/elapsed from `active.startedAt` /
  `active.plannedEndAt` vs Date.now() on an interval — never decrement counters.
- Route `/meeting-live` (fullScreenModal, registered) is the live session screen.
- `Habit`: title, icon, color, timesPerDay, activeWeekdays, completions {day: count}.
- `FocusSession`: taskId?, mode 'pomodoro'|'stopwatch', startedAt, minutes, dateKey.
- `Settings`: themeMode, dayStartHour/dayEndHour, showCalendarEvents,
  hiddenCalendarIds, defaultDurationMinutes, defaultAlerts, pomodoro*, haptics,
  weekStartsOn, onboardingDone.

## Store APIs (read the files)

- `useTasks` (src/store/tasks.ts): `tasks` record; `addTask(input)`, `updateTask(id,patch)`,
  `deleteTask(id)`, `skipOccurrence(id,day)`, `detachOccurrence(id,day)` (split one
  day of a recurring series into a standalone one-off carrying that day's
  completion/paid state — ALWAYS use this instead of scheduleTask/updateTask when
  moving or re-timing a single occurrence of a recurring task; scheduleTask on a
  recurring task rewrites its anchor and corrupts history), `toggleComplete(id,day)`,
  `scheduleTask(id,date,startMinutes,allDay?)`, `duplicateTask(id)`,
  `clearCompletedInbox()`, `importTasks(list)`.
  Helpers: `instancesForDay(tasks, day)` → sorted `TaskInstance[]`; `inboxTasks(tasks)`.
- `useHabits` (src/store/habits.ts): `habits`; `addHabit`, `updateHabit`, `deleteHabit`,
  `tick(id, day?)`. Helpers: `habitActiveOn`, `habitDoneOn`, `habitStreak`, `habitBestStreak`.
- `useFocus` (src/store/focus.ts): `sessions`; `logSession({taskId?,taskTitle?,mode,startedAt,minutes})`,
  `clearHistory()`. Helper `minutesFocusedOn(sessions, day)`.
- `useSettings` (src/store/settings.ts): `settings`, `update(patch)`, `reset()`.

## Libs

- `src/lib/dates.ts`: toDayKey/todayKey/fromDayKey/addDays/daysBetween/isToday/
  weekdayOf/minutesOfDay/formatMinutes/formatDuration/formatDayShort/formatDayLong/
  formatDayRelative/weekdayShort/monthShort/weekOf/lastNDays.
- `src/lib/recurrence.ts`: taskOccursOn, isInstanceCompleted, describeRecurrence, ruleOccursOn.
- `src/lib/nlp.ts`: `parseQuickAdd(text)` → {title,date,startMinutes,durationMinutes,priority,recurrence}.
- `src/lib/notifications.ts`: `syncTaskNotifications(task)` after save, `syncTaskNotifications(null, id)`
  after delete, `syncAllNotifications(tasks)`; `ensureNotificationPermission()`.
- `src/lib/calendar.ts`: `ensureCalendarPermission()`, `listCalendars()`, `eventsForDay(day, hiddenIds)`.
- `src/lib/icons.ts`: ICON_GROUPS / ALL_ICONS for icon pickers.
- `src/lib/haptics.ts`: tapHaptic/successHaptic/warningHaptic/selectionHaptic.
- `src/lib/id.ts`: `uid()`.

## Theme (src/theme/index.ts)

`useTheme()` → {dark, background, card, surface, text, textSecondary, textTertiary,
border, separator, accent, accentSoft, danger, success, gradient, nowLine, tabBar, overlay}.
`TASK_COLORS` (12 entries: key/label/bgLight/bgDark/solid/fgLight/fgDark), `taskColor(key)`,
`PRIORITY_META[0..3]` {label,color,icon}, `RADIUS`, `SPACING`, `GRADIENT`.

Design language v3 — CLEAN (the user explicitly rejected the earlier liquid-glass look;
NEVER reintroduce blur, aurora blobs, glow shadows, or decorative gradients):
- Flat solid surfaces: theme.background screens, theme.card cards with hairline
  theme.border, RADIUS.lg corners. `GlassCard` now renders exactly that (name kept for
  compatibility) and `AuroraBackground` renders null — stop mounting it in new code.
- One restrained accent (theme.accent indigo) + theme.success for money. Selected
  chips/CTAs = SOLID accent fill with white text. Primary buttons = solid accent,
  radius 14, no shadows beyond a soft elevation on floating elements.
- The legacy gradient/glow tokens still exist but resolve flat (heroGradient = solid
  accent ×3, glow = transparent). Prefer plain backgroundColor over LinearGradient in
  new/edited code; delete white "sheen" overlays on sight.
- Tab bar: standard solid bar with hairline top border, accent-tinted active tab
  (GlassTabBar renders this). Screens need ~80px + insets.bottom of bottom padding.
- Typography: headers 28-32 weight 700; section labels 12/weight 600 sentence case in
  textSecondary (no uppercase tracking); timers keep fontVariant tabular-nums.
- Motion: subtle only — simple FadeIn on mount is fine; no springy staggers, no pulses.
- INPUT PRINCIPLE (user feedback): direct entry over increment steppers. Times use
  native wheel pickers (@react-native-community/datetimepicker, installed; iOS
  display "spinner"; guard Platform.OS web with a simple fallback list). Tasks are
  defined by START TIME + END TIME with the duration computed and displayed.

## Shared components (src/components) — use, don't reinvent

- `TaskCard` {task, completed, onToggle, onPress, onLongPress?, compact?, height?}
- `AnimatedCheck` {checked, color, size?, onToggle, borderColor?}
- `EmptyState` {icon, title, subtitle?}
- `ProgressRing` {size, strokeWidth, progress 0..1, color, trackColor, children}
- `SegmentedControl` {options: {value,label}[], value, onChange}
- `ScreenHeader` {title, subtitle?, right?, showSettings?}
- `Fab` {onPress, icon?, bottom?}

## Routes

- Tabs: `/` Today timeline · `/inbox` · `/focus` · `/habits` · `/stats`
- Modals (registered in app/_layout.tsx): `/task-editor`, `/settings`, `/habit-editor`
- `/task-editor` params (all strings): `id` (edit existing), `date` (DayKey prefill),
  `startMinutes` (prefill), `inbox` ("1" → create unscheduled), `title` (prefill).
  Everyone else pushes these routes; the editor agent owns the screen.
