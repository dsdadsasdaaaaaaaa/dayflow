# DayFlow

A free, open day planner for iOS — everything [Structured](https://structured.app) does, plus everything its users have been asking for. Built with Expo + React Native + TypeScript.

## Why

Structured paywalls the essentials: recurring tasks, calendar import, Pomodoro intervals, and custom alerts all require Pro ($6.99/mo or $99.99 lifetime). It also has **no search, no priorities, no tags, no habit streaks, and no statistics** — all top user requests for years.

DayFlow ships all of it, free:

| Feature | Structured | DayFlow |
|---|---|---|
| Visual proportional day timeline with now-line | ✅ free | ✅ |
| Inbox for unscheduled tasks | ✅ free | ✅ |
| Subtasks, notes, icons, colors | ✅ free | ✅ |
| **Recurring tasks** | 💰 Pro | ✅ free |
| **Calendar import** | 💰 Pro | ✅ free |
| **Pomodoro / focus intervals** | 💰 Pro | ✅ free |
| **Replan unfinished tasks** | 💰 Pro (iOS only) | ✅ free |
| **Custom alerts** | 💰 Pro | ✅ free |
| Search across all tasks | ❌ none | ✅ |
| Task priorities | ❌ none | ✅ |
| Tags | ❌ none | ✅ |
| Habit tracking with streaks | ❌ none | ✅ |
| Statistics & insights | ❌ none | ✅ |
| "Shift rest of day" cascade | ❌ none | ✅ |
| Natural-language quick add | 💰 Pro (AI) | ✅ free, on-device |
| Hide completed tasks | ❌ none | ✅ |
| JSON backup/export | ❌ iCloud only | ✅ |
| **Paid client meetings & earnings** | ❌ none | ✅ |

## Client meetings

Any task can be a paid client meeting: set the type (in-call, out-call, or public spot), the client, and the amount for that meeting. When the meeting starts, tap **Start meeting** — you get a live countdown to the agreed end time, a 10-minute warning, a time's-up notification, one-tap extensions, and an optional check-in reminder after out-calls. Ending the session logs planned vs. actual time and overtime, lets you adjust the final amount (tips), and marks the payment collected. The Stats tab tracks earned / collected / outstanding money, top clients, hours, and per-type splits. Client names remember their usual rate and location.

## Running it

Requires Node 20+ (`nvm use 20`).

```bash
npm install
npx expo start          # scan the QR code with Expo Go on your iPhone
./scripts/web.sh        # or run the web preview
```

Everything is stored locally on-device (AsyncStorage). No account, no server, no tracking.

## Structure

- `app/` — expo-router screens: 5 tabs (Today, Inbox, Focus, Habits, Stats) + modals (task editor, habit editor, settings)
- `src/types.ts` — data model
- `src/store/` — zustand stores (tasks, habits, focus sessions, settings)
- `src/lib/` — recurrence engine, date utils, NLP quick-add parser, notifications, calendar import
- `src/theme/` — design system (light/dark, 12 task colors, signature indigo→cyan gradient)
- `src/components/` — shared UI
- `docs/SPEC.md` — full product spec derived from competitive research
- `CONTRACT.md` — internal implementation contract
