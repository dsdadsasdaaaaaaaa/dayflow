# DayFlow — Product Specification v1.0

**Working title:** DayFlow
**Platform:** iOS (React Native / Expo, SDK 52+, New Architecture)
**Positioning:** A visual daily planner that puts your tasks, routines, and habits on one proportional timeline — everything free, forever. All of Structured Pro, plus the top 20 features its users have begged for over years, at $0.

---

## 1. Feature Parity List (everything Structured does that DayFlow must do)

### 1.1 Core timeline
- Vertical single-day timeline as the home screen, morning → night, hour timestamps in a slim left gutter.
- Every task is a rounded colored card whose **height is proportional to duration** (30-min task = half a 1-hour task). Short tasks render as circles on the timeline connector; longer tasks stretch into vertical capsules.
- Thin vertical connector line down the left; past/completed segments fill with color, upcoming segments stay grey.
- Card anatomy: colored icon circle/capsule, grey caption `7:00 – 7:15 AM (15 min)`, bold title, subtask count + expand chevron, ring-outline checkbox tinted the task color at right.
- **Now-line** current-time indicator; the ongoing task shows a live countdown and its capsule fills as time passes.
- Free gaps render inline ghost "Add task" affordances (tap → pre-filled creation at that time).
- All-day tasks in a pinned horizontal row above the timeline (icon circles with labels; horizontally reorderable by drag).
- Overlapping tasks handled (see §2 for our superior side-by-side lanes).
- Day anchors: onboarding creates editable recurring "Rise & Shine" / "Wind Down" bookend tasks so the first timeline is never empty. Fully editable/deletable and (unlike Structured) **recreatable for free**, with weekday/weekend variants offered in settings.

### 1.2 Navigation & views
- Bottom tab bar: **Inbox · Timeline · Stats · Settings** + floating draggable **+** FAB.
- Day header: large bold date ("13. May"), year + chevron in accent color → opens Month view.
- 7-day date strip: weekday over date number, today = filled accent pill, tiny mini-icon previews of each day's tasks beneath dates. Swipe strip = page weeks; swipe timeline body = change days; long-press date = context menu (Copy Day, Paste from…, Clear Day, Replan with unfinished count).
- **Ever-present "Today" button** (fixes Structured's top navigation complaint — always visible whenever the visible date ≠ today).
- Week view: side-by-side day columns of icon capsules on grey tracks, all-day row on top, tap icon → opens day sheet; reachable via drag-handle above the timeline or long-press on the Timeline tab.
- Month view: calendar grid with mini-icons per day (option: titles), tap to jump, fast month/year scrubber, Today button.
- 3-day view on iPad-class widths (Structured gap, fixed).

### 1.3 Task model & editor
- Fields: title, icon (auto-suggested from title as you type, tappable to change), color, date, start time, duration (default 15 min; slider + editable presets, 1 min–24 h), all-day flag, per-task timezone, multiple alerts, subtasks, notes, recurrence rule, energy level (6 levels incl. Relaxing/recharge), tags (ours), priority (ours), deadline (ours).
- Two time-picker modes: scroll wheel AND **typeable start/end fields** (Structured refused this; we ship it).
- Icon picker: search bar + category bar (Suggested, Recent, then themed categories); ~600 glyph icons + **any emoji as an icon** (free).
- Color picker: horizontal preset palette + custom color (HSB sliders + HEX field) + **12 savable custom presets — free**.
- Subtasks: rapid chained entry via keyboard "next", drag-reorder, individually checkable, expandable and checkable **inline on the timeline card**, convert subtask ↔ task (Structured gap).
- Notes: text field, **with basic Markdown rendering** (bold/italic/links/check-glyphs) and optional inline preview line on the card when space allows (Structured gap). Notes autosave (no lost-notes bug).
- Create/Update confirm buttons; Duplicate; Delete (in-editor + drag-to-trash); Undo/Redo (shake + toolbar buttons).

### 1.4 Creation paths
1. Tap + → bottom-sheet editor (essentials first: title/date/time/duration; icon/color/repeat/energy/subtasks/notes secondary).
2. Tap inline "Add task" gap slot (pre-fills time).
3. **Drag the + FAB** onto the timeline (creates at drop time), onto the all-day row, or onto the Inbox tab.
4. Natural-language quick add (ours, §2).
5. Siri Shortcuts / share-sheet intake.

### 1.5 Inbox
- Tab for undated tasks ("brain dump"). Rows: icon + title + "+" schedule button.
- Reduced creation sheet (title, icon, optional duration estimate — plus our optional **deadline**).
- Drag inbox item over Timeline tab (hover auto-opens day) → drop at exact slot or all-day row; reverse drag to unschedule; "Move to Inbox" in editor.
- Manual priority reordering; drag-to-bottom completes; "Finished" section; duplicate-as-template.

### 1.6 Drag & drop (signature interactions — full parity)
- Long-press-lift any card with spring animation; floating preview shows live destination time; 5-min snap (configurable to 1/5/15).
- Drop on a date-strip day = keep time, change day; hover a date/edge ≈ 0.7 s = auto-flip to that day.
- Drag to top = all-day; all-day → timeline = timed; drag over Inbox tab = unschedule; + FAB morphs into red trash as a delete drop target while dragging.

### 1.7 Recurrence, notifications, replan, focus, misc
- Recurring tasks: Daily / Weekly (weekday picker) / Monthly + intervals, series start/end dates, edit scopes (this only / future / all), delete single vs all, 31st→month-end clamping. **Free.** (Extensions in §2.)
- Alerts: global defaults (at start, at end) + per-task overrides; presets 1/5/15/60 min before + fully custom lead time; all-day default 8:00 AM; per-task notification sound from a previewable sound set; planning-reminder nudges (morning/evening/custom). **All free.**
- Replan triage flow for unfinished past tasks: one-at-a-time bottom sheet — swipe up = reschedule (today/tomorrow/pick), left = to Inbox, right = complete, down = delete; skip + undo; "rescheduled 3×" badge; include/exclude recurring & all-day. **Free.**
- Focus timer: "Focus Now" on the ongoing (or any) task → full-screen countdown with color drain fill, subtasks/notes checkable in-session, hide-seconds tap, Live Activity + Dynamic Island, ends at task end/completion. Pomodoro + Deep Focus interval schemes **free** (and pausable — Structured gap).
- Whole-day ops: Copy Day (with filters: regular/recurring/imported), Paste to one or many days, Clear Day.
- Calendar import via EventKit (all Apple-synced accounts: Google/Outlook/Exchange/…), per-calendar toggles, events render as normal cards. **Free** — and see §2 for two-way sync.
- Apple Reminders import with write-back of edits/completions; undated → Inbox; Siri capture. **Free.**
- Widgets: home-screen timeline (3 sizes), inbox, current/next task — interactive check-off; lock-screen widgets; Live Activities; StandBy. (Expo: widgets/Live Activities via native extension targets — `@bacons/apple-targets` or config-plugin; this is a committed native module, not a stretch goal.)
- Energy Monitor: 6 energy levels per task, non-linear points (per 30 min: Low 1 / Medium 2 / High 3; Relaxing subtracts — actually subtracts, fixing Structured's complaint), gauge chip in the all-day row with green/orange/red vs a personal daily limit (default 20).
- Sync: cloud account sync (passwordless email code) across devices + local-first offline; export/backup to a file (JSON), not locked to iCloud.
- Settings parity: layout density (Full/Simplified/Minimal), app accent color, System/Light/Dark (true-black OLED), OpenDyslexic toggle, alternate app icons, sounds/haptics toggles, 12/24 h, first day of week, day start/end times, localization-ready, accessibility (VoiceOver, Reduce Motion, high contrast, Dynamic Type).
- Face ID app lock; full reset; account deletion; no ads; no data selling.

---

## 2. What DayFlow Does BETTER or ADDS — all free

### 2.1 Kill the paywall (instant win)
Everything in §1 that Structured gates behind Pro is free in DayFlow: **recurring tasks, calendar import, Reminders sync, custom notifications & sounds, Replan, focus intervals, custom color presets, all icons, unlimited tasks.** No trial, no upsell nags, no AI button squatting in the tab bar.

### 2.2 Fixes for Structured's top complaints
1. **Search** (1,644 votes, never shipped): global search over title/notes/subtasks/tags, past + future + inbox, with filters (color, tag, date range, completed) and jump-to-task-in-timeline. Pull down on the timeline or tap 🔍 in the header.
2. **Two-way calendar sync** (3,075 votes): DayFlow tasks can write to a chosen "DayFlow" calendar (per-task or per-tag opt-in); imported events are **editable** (time/day changes write back via EventKit); no duplicate-alert double-notification (auto-suppress when both would fire); imported recurring events keep custom colors.
3. **Routines** (#1 request, 3,554 votes): named reusable task groups ("Morning routine" = shower 20m + breakfast 30m + review 10m) that stamp onto any day at an anchor time, auto-populate on matching days, and shift as a unit. Also **Day Templates** (save an entire day layout: "Office day", "WFH day") applied via long-press-date menu.
4. **Habits & streaks** (2,518 votes): mark any recurring task as a *habit* → streak counter, completion calendar heatmap, weekly target ("3× / week" habits that don't break streaks on off-days), **vacation mode** freeze, partial completion (½ check), celebration animation on milestones. No red/shame states — a missed habit shows a gentle grey gap, never a broken-glass streak reset by default (configurable strict mode).
5. **"My day changed" tooling**:
   - **Shift rest of day** +5/10/15/30 min with cascade (one tap from the now-line or ongoing task).
   - **Finish early reclaims time** (2,219 votes): completing a task early offers "End now & pull next task up?"
   - **Task overtime auto-push**: optional setting — an unfinished running task pushes subsequent flexible tasks.
   - **Start Now** button resets a task's start to the current minute.
   - Drop-on-overlap offers "push tasks down" instead of silently stacking.
6. **Drag-to-resize duration** (329 votes): grab the bottom edge of any card and stretch/shrink it directly on the timeline, live duration tooltip, snap to increment.
7. **Overlap lanes** (1,022 votes): overlapping tasks render side-by-side in narrow lanes (calendar-style) instead of a mess; plus **container blocks** — a big block (e.g. "Work 9–5") can hold an unordered checklist of child tasks inside it.
8. **Richer recurrence**: hourly; "every 2nd Friday"; "last Thursday of month"; nth-weekday; **repeat-after-completion** (laundry every 3 days *after* last done); recurring inbox tasks; yearly.
9. **Organization**: **tags** (multi, colored, filterable) + **priority** (P1–P3 + none) + **deadlines on inbox tasks** (1,444 votes) with a "Due soon" smart section; inbox sort/filter (by deadline, priority, tag, manual).
10. **Multi-select / bulk edit on device** (771 votes): long-press → select mode → reschedule, recolor, retag, complete, delete, move to inbox, make all-day.
11. **Cross-midnight tasks** render correctly on both days; multi-timezone entry for flights.
12. **Alert improvements**: nagging repeat alerts until checked (opt-in per task), no 3-hour lead cap (we schedule local notifications ourselves — any lead time), notification body can include notes/subtasks, complete-from-notification action, stale notifications auto-clear on completion.
13. **Timeline-to-scale toggle**: optional true-scale mode showing real free time; "day fullness" bar and total free-time readout in the header.
14. **Hide completed** toggle for timeline and inbox; completed all-day tasks sink to the end.
15. **Suggestions are controllable**: free-slot suggestions editable/deletable/disable-able; never resurrect deleted people/pets.

### 2.3 Best ideas stolen from competitors
- **Guided rituals (Sunsama):** optional Morning Plan (review yesterday's unfinished → pull from inbox → estimate durations → overload warning "6.5 h planned, 4 h available") and Evening Shutdown (what got done, roll or release the rest, one-line highlight of the day). Weekly review screen with planned-vs-actual.
- **Gentle rollover (Tweek/Tiimo):** optional silent auto-rollover of unfinished tasks to today — nothing ever turns red or reads "overdue." "Fresh start" one-tap day reset.
- **Visual countdown (Tiimo):** radial draining timer for the current task in Focus mode, Live Activity, lock screen, and a "current task" widget; optional transition warnings ("Wrapping up in 5 min").
- **Fit My Day (deterministic Motion):** one tap packs selected inbox tasks into today's free gaps by priority + deadline + duration, with chunking of long tasks (min chunk 30 m) and an explicit "Couldn't fit" list — no AI, no server, instant, reversible.
- **Natural-language quick add (Fantastical/Todoist):** see §6.
- **Streaks + goals + vacation mode (Todoist Karma):** daily/weekly completion goals, streaks, gentle points — never punitive.
- **Analytics (Sunsama/TimeBloc/Todoist):** the Stats tab, §3.7.
- **Planned vs actual (Sunsama/Toggl gap):** optional lightweight actual-time capture — Focus sessions log actual time automatically; "took longer/shorter" quick adjust on completion; per-tag estimation-accuracy insight ("You underestimate 'Deep work' by ~40%").
- **Delight layer (Amie):** confetti burst on day-complete, personalized greeting on the morning ritual, spring physics everywhere, playful empty states, optional weather chip on the day header (WeatherKit).
- **Buffer protection (Rise/Sunsama):** optional auto-insert of 10-min buffers between back-to-back blocks; overload warning when planned energy or time exceeds limits.

### 2.4 Explicit non-goals for v1
No AI chatbot tab (the backlash is a feature: "It's a calendar app!"). No collaboration in v1 (roadmapped v2: shared read-only day link, shared routines). No Android/Web in v1 — but the data layer is portable (see §5). Monetization: none in v1; future optional tip jar / cosmetic icon packs only — no feature paywalls, ever.

---

## 3. Screen-by-Screen Breakdown

### 3.0 Navigation shell
Bottom floating pill tab bar (4 tabs: **Inbox · Timeline · Stats · Settings**) + separate circular accent **+** FAB docked bottom-right. FAB is tappable (opens Add sheet) and draggable (create-in-place, morphs to trash during card drags). Active tab tinted accent with label; inactive grey.

### 3.1 Timeline (home)
- **Header:** bold `16. Jul` + `2026 ›` in accent (→ Month view); 🔍 search; ⛅ 74° weather chip (optional); "Today" pill (visible when off today).
- **Date strip:** 7 days, today = filled accent circle, mini-icon previews under dates (Full layout only). Long-press date → Copy Day / Paste from… / Clear / Apply Template / Replan (n unfinished).
- **All-day row:** icon circles + labels, Energy gauge chip, drag targets.
- **Body:** proportional timeline per §1.1; now-line with time bubble; ghost add-slots in gaps; free-time totals per gap in to-scale mode; drag handle above → Week view.
- **Card interactions:** tap = editor sheet; checkbox tap = complete; chevron = expand subtasks inline; long-press = lift/drag; bottom-edge drag = resize; long-press → "Select" enters multi-select mode with a bottom action bar.
- **Ongoing task card:** countdown, "Focus Now" chip, "Shift rest of day" chip when running late.

### 3.2 Week view
Pull down / long-press Timeline tab. 7 columns of icon capsules on pale tracks, hour rulings, all-day row, Zz sleep gaps. Tap task → bottom day sheet. Swipe between weeks. Toggle: icon mode ↔ **grid mode** (Google-Calendar-style titled blocks — the view Structured users begged for). Month view per §1.2 with optional energy/habit heat overlay. 3-day mode on wide screens.

### 3.3 Inbox
Header with count badge, sort/filter menu (manual · deadline · priority · tag), search. Sections: **Due soon** (deadline-carrying), **Anytime**, **Finished** (collapsible). Row: icon, title, tag dots, deadline chip ("Fri"), + schedule button. Swipe right = complete, swipe left = schedule sheet. Drag out over Timeline tab to place. Empty state: friendly illustration, "Get it out of your head."

### 3.4 Add / Edit Task sheet
Bottom sheet, two zones:
- **Essentials (always visible):** title field with live-swapping suggested icon (tap icon → icon+color picker); NL parse chips appear under the title as you type ("tomorrow 10am · 15 min · every Mon" — tap to accept/x to dismiss); date chips (Today/Tomorrow/Pick/Inbox); time (wheel ↔ typeable start–end toggle); duration slider + preset chips (editable presets, "until next task" option).
- **More (collapsed rows):** Repeat (Once/Daily/Weekly/Monthly/Custom → interval stepper, weekday chips, nth-weekday, after-completion), Alerts (default at-start/at-end shown struck-through-removable; add presets/custom; nag toggle), Tags, Priority, Deadline, Energy (6 icons), All-day toggle, Timezone, Calendar write-back toggle, Subtasks (chained entry, ✨ suggest-from-title on-device optional), Notes (Markdown), Attach photo.
- Footer: **Create Task / Update Task**; edit mode adds Duplicate · Focus Now · Move to Inbox · Delete (⋯ menu). Previous/next task context shown above the sheet.

### 3.5 Focus Timer
Full screen, task color drains from the top as time elapses; huge remaining time (tap to hide seconds); radial ring variant (Tiimo mode) in settings. Subtasks + notes checkable/jot-able in-session. Modes: Simple countdown · Pomodoro (25/5) · Deep Focus (50/10) — durations customizable, **pausable**, skip phase, upcoming-interval strip (🎯/☕). Live Activity + Dynamic Island. On end: gentle chime, "Done / +5 min / Take a break," actual time logged. Auto-suggest rolling to the next task.

### 3.6 Habits (lives inside Timeline + a Habits section in Stats)
Any recurring task flagged "habit" gets: streak flame + count on its card, per-habit detail page (calendar heatmap, current/best streak, completion %, weekly target progress ring), vacation-mode toggle, partial-check. "Habit strip" optional row under all-day tasks showing today's habits as tappable rings.

### 3.7 Stats tab
- **Today/Week header cards:** completion % ring, tasks done, focused minutes, current streak.
- **Charts:** daily completion bar trend (2/4/12 weeks), time-by-tag donut (planned and actual), planned-vs-actual scatter/accuracy per tag, energy planned-vs-limit line, busiest-hours heatmap (weekday × hour), habit heatmaps.
- **Weekly Review** (guided, Sunday evening nudge): auto summary — completed, rolled, top tag, best day — plus a one-line reflection saved to history.
- Everything computed locally.

### 3.8 Settings
Groups: **Customization** (accent color presets + custom + saved swatches; app icon variants; System/Light/Dark/true-black; layout Full/Simplified/Minimal; density/font size; OpenDyslexic; sounds + haptics toggles; celebration effects toggle) · **Behavior** (day start/end + anchor tasks manager; snap increment; auto-rollover on/off; auto-push overtime; buffers; suggestions on/off; hide completed; time format; first weekday; to-scale mode) · **Notifications** (defaults, planning reminders, nag mode, sound picker) · **Integrations** (Calendars: per-calendar toggles, two-way calendar selection; Reminders: lists, write-back) · **Rituals** (morning plan / evening shutdown / weekly review scheduling) · **Energy Monitor** (enable, daily limit) · **Data** (cloud account, export JSON/ICS, import, Face ID lock, erase) · **About** (no upsell banner — there is nothing to upsell).

### 3.9 Onboarding
4 screens max: value prop → wake/sleep times (creates anchors, offers weekday/weekend split) → notification permission (with honest copy) → optional calendar/Reminders connect. Lands on a live timeline already framed by anchors with a 3-step interactive coach-mark tour (tap a gap, drag the +, check something off — confetti). No account required; cloud sign-in optional, later.

### 3.10 Search (modal)
Big input, recent searches, filter chips (date range, tag, color, status, inbox/timeline). Results grouped by day; tap → jump to that day with the card pulsing.

### 3.11 Replan (bottom sheet flow)
Per §1.7, card-at-a-time with four color-coded swipe actions + "Reschedule all to today" bulk shortcut and Fit-My-Day handoff.

---

## 4. Visual Design Language

### 4.1 Personality
Soft, friendly, calm — "a paper planner that came alive." Rounded everything, generous whitespace, spacing instead of divider lines, one saturated accent against neutral surfaces. Playful but never loud; every serious state (missed, overloaded) rendered gently.

### 4.2 Color
- **Accent (default):** DayFlow Coral `#FF8A80` with deep slate `#33526E` as the secondary brand tone. Accent is fully user-themeable (8 presets + custom); accent drives FAB, active tab, today pill, buttons, links.
- **Task palette (10 presets + custom + 12 saved swatches):** coral `#F98F8F`, steel blue `#578BB2`, navy `#24475D`, leaf `#93BA77`, wine `#A34168`, marigold `#F5BB11`, lavender `#9B8CDB`, teal `#4FB0A5`, slate `#7A8B99`, cocoa `#A9836B`. Each color ships light/dark-tuned variants (WCAG AA on both backgrounds).
- **Light surfaces:** background `#FAFAFC`, cards `#FFFFFF`, secondary fill `#F2F2F5`, text `#1A1A1A`, secondary text `#8A8A8E`.
- **Dark surfaces:** background `#000000` (true black, toggleable to `#1C1C1E` "soft dark"), cards `#1C1C1E`, secondary `#2C2C2E`, text `#F5F5F7`; task colors brightened ~8% for dark; widgets use iOS-style dark grey, not pure black (explicit Structured complaint).
- **Semantics:** success = task color fill (color is the reward — completed cards fill, upcoming are outlined/tinted at 15% — we keep Structured's mechanic but boost upcoming-task contrast per the UX-case-study critique). Warning amber `#F5A623` (overload), never a "failure red" on tasks; destructive red reserved for delete affordances only.

### 4.3 Timeline layout metrics
- Left gutter 44 pt (hour labels, SF Pro 11 pt, secondary). Connector line 3 pt.
- Icon circle 44 pt; capsule stretches vertically with duration; scale ≈ 1 h = 88 pt (Full), 64 pt (Simplified), user-zoomable via pinch (56–120 pt/h).
- Cards: corner radius 16 pt (sheets 24 pt), shadow `rgba(0,0,0,0.08)` y=2 blur=12; 12 pt vertical rhythm; checkbox ring 24 pt at trailing edge.
- Now-line: accent, 2 pt, leading time bubble; overlap lanes split available width with 4 pt gutters.

### 4.4 Type & iconography
- SF Pro (system): header 28 pt bold, task title 16 pt semibold, meta 12 pt regular secondary, tab labels 10 pt. Full Dynamic Type support; OpenDyslexic alternative.
- Icons: single-weight filled white glyphs inside colored circles (SF Symbols base + custom set + emoji). Friendly, slightly playful.
- Motion: Reanimated springs (damping 18, stiffness 220) for sheet presents, card lifts, checkbox pops; check-off = stroke-draw checkmark → strikethrough wipe → color flood → light confetti on day-complete. All gated by Reduce Motion.

---

## 5. Data Model

Local-first SQLite (expo-sqlite / WatermelonDB-style), sync via changelog + server (CRDT-lite: last-write-wins per field, tombstones). All IDs UUIDv7. Times stored as UTC + IANA timezone.

```
Task
  id, title, notes(md), iconId, colorHex,
  date (nullable → inbox), startTime, durationMin, isAllDay,
  timezone, priority (0–3), deadline (nullable date/time),
  energyLevel (relax|neutral|low|med|high|xhigh),
  status (pending|done|partial), completedAt, actualDurationMin,
  seriesId (nullable → RecurrenceSeries), occurrenceDate, isDetached,
  routineInstanceId?, parentBlockId? (container blocks),
  calendarEventId? + calendarId? (two-way link), reminderId? (write-back link),
  source (user|calendar|reminders|routine),
  inboxSortOrder, allDaySortOrder, rescheduleCount,
  createdAt, updatedAt, deletedAt?

Subtask
  id, taskId, title, isDone, sortOrder, timestamps

Tag              id, name, colorHex, sortOrder
TaskTag          taskId, tagId

RecurrenceSeries
  id, templateTask (embedded field-set: title/icon/color/duration/alerts/energy/tags/subtask templates),
  rule { freq: hourly|daily|weekly|monthly|yearly,
         interval, byWeekday[], byMonthDay, bySetPos (e.g. -1 Thu = last Thursday),
         anchor: schedule|completion },      // completion-anchored chores
  startDate, endDate?, time, isHabit,
  exceptions[] (skipped/detached dates)

Habit (extends a series)
  seriesId, targetPerWeek?, allowPartial, strictStreaks,
  vacationRanges[], streakCurrent, streakBest (derived, cached)

HabitLog         id, seriesId, date, value (0|0.5|1)

Alert
  id, taskId|seriesId, offsetMin (± from start/end), anchor(start|end),
  soundId, isNagging, isEnabled

Routine
  id, name, iconId, colorHex,
  items[] { title, iconId, colorHex, durationMin, offsetMin, energy, subtaskTemplates[] },
  autoApply { weekdays[], anchorTime } | manual

DayTemplate      id, name, snapshot of task field-sets w/ times

FocusSession
  id, taskId, mode (simple|pomodoro|deep), startedAt, endedAt,
  plannedMin, focusedMin, pauses[], intervalsCompleted

CalendarLink     calendarId, isVisible, isWriteTarget, colorOverride?
ReminderListLink listId, isVisible

Settings (key-value)
  accentColor, theme, layoutDensity, dayStart/dayEnd, snapMin, timeFormat,
  firstWeekday, autoRollover, autoPushOvertime, bufferMin, suggestionsEnabled,
  hideCompleted, toScaleMode, energyEnabled, energyDailyLimit,
  ritual schedules, sounds/haptics, faceIdLock, savedSwatches[12], durationPresets[]

StatsCache (derived, rebuildable)
  daily rollups: date, planned/completed counts, plannedMin, actualMin,
  byTag{}, energyPlanned, focusMin
```

Sync log: `Change {id, entity, entityId, field?, value, deviceId, lamport, ts}`. Export = full JSON dump + ICS of scheduled tasks.

---

## 6. Notable Interactions

1. **Natural-language quick add.** Type in the title field (or the dedicated quick-add from the FAB long-press): `"Answer emails 15min tomorrow 10am every weekday #work p2 !gym-icon"` → chips render live beneath the field for each parsed token (date, time, duration, recurrence, tag, priority); tap a chip to edit, ✕ to reject; parsed text is stripped from the title. Fully offline deterministic parser (chrono-node + custom grammar). Voice dictation feeds the same parser.
2. **Drag-to-reschedule.** Long-press lifts the card (scale 1.05, shadow deepens, haptic `impactMedium`); a floating time tooltip live-updates with 5-min snapping; hovering a date-strip day 0.7 s flips the view (haptic tick); drop = spring-settle + `impactLight`. Edge cases: drop-on-occupied offers Push / Overlap / Cancel.
3. **Drag-to-resize.** Bottom-edge grabber appears on lift; stretching plays detent haptics at each snap increment; duration tooltip follows the finger.
4. **Check-off ceremony.** Tap the ring → checkmark draws in (180 ms), title strikethrough wipes left→right, card floods with its color, soft "pop" sound (respects mute) + `notificationSuccess` haptic. Last task of the day → confetti burst + "Day complete 🎉" toast with the day's stats. Un-check reverses gracefully.
5. **Draggable + FAB.** Tap = add sheet; drag onto timeline/all-day/inbox = create in place (ghost card preview at snap position); during any card drag, FAB morphs into a red trash can (drop = shrink-and-poof + `impactHeavy`, undo toast).
6. **Shift rest of day.** Running-late banner on the ongoing task: "+15 min to everything after?" — one tap cascades all later flexible tasks with a ripple animation; calendar-locked events stay put and conflicts get flagged.
7. **Replan swipes.** Four-direction swipe triage with color-coded glows (up amber reschedule / right green done / left blue inbox / down red delete), rubber-band physics, per-card haptic, undo pill.
8. **Fit My Day.** Tap ✨-free "Fit" button in the Inbox: selected tasks animate flying into timeline gaps one by one; unfittable ones shake and stay with a "couldn't fit" badge; one tap undoes the whole placement.
9. **Inline subtask check.** Chevron expands subtasks on the card with a spring; checking one ticks the card's `2/5` counter; completing the last offers to complete the parent.
10. **Pinch-to-zoom timeline** between compact and to-scale; double-tap the gutter to reset.
11. **Pull-down gestures.** Pull down on timeline = search; drag the grey handle = week view; shake = undo.
12. **Haptics map (expo-haptics):** selection ticks for snaps/pickers, `impactLight` for drops/toggles, `impactMedium` for lifts, `notificationSuccess` for completes, `notificationWarning` for overload alerts — every one toggleable, all suppressed under Reduce Motion + system settings.

---

## 7. Build Notes (React Native / Expo)

- **Stack:** Expo (dev-client builds — native modules required), TypeScript, Reanimated 3 + Gesture Handler (timeline drag/resize/swipes), expo-sqlite + Drizzle, Zustand/Jotai for UI state, expo-notifications (local scheduling engine that pre-schedules a rolling 64-notification window and refreshes on app foreground/BGTask), expo-haptics, expo-calendar (EventKit two-way), react-native-permissions.
- **Native extension targets (config plugins):** WidgetKit widgets, Live Activities/Dynamic Island, App Intents for Siri/Shortcuts/interactive widgets, Spotlight indexing of upcoming tasks. Budget these as first-class workstreams — they are the retention surface.
- **Performance guardrails:** timeline virtualized by day, 60 fps drag on device baseline iPhone 12; cold start < 1.5 s; all stats computed from local rollups; zero network required for 100% of features except optional sync.
- **Sequencing:** M1 timeline+inbox+editor+drag+notifications → M2 recurrence+habits+routines+replan+search → M3 calendar/Reminders two-way+widgets+Live Activities+focus → M4 stats+rituals+Fit My Day+NL quick add+delight polish.

**North-star acceptance test:** a churned Structured user opens DayFlow and, within 10 minutes, has recreated their day for free, searched for a task, dragged one to resize it, set up a "last Thursday" recurring task, and seen a streak — five things their $99 lifetime license never gave them.