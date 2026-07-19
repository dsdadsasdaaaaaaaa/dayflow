# DayFlow native iOS layer — implementation contract

App Group: `group.com.levisilverberg.dayflow` (declared in app.json ios.entitlements and
targets/widgets/expo-target.config.js). NSSupportsLiveActivities is set in app.json.
Plugin `@bacons/apple-targets` is installed and registered. Local Expo module scaffold
exists at modules/dayflow-live-activity/ (podspec + expo-module.config.json + the shared
MeetingActivityAttributes.swift). Deployment target for the widget extension: iOS 17.

Reference docs: .claude/skills/apple-targets/widget.md (production patterns for this
exact plugin — READ IT before writing Swift).

## Shared storage schema (App Group UserDefaults, written from JS as JSON strings)

Key `widget.today` — JSON string:
```json
{
  "dateKey": "2026-07-19",
  "generatedAt": 1789000000000,
  "done": 2, "total": 5,
  "earnedTodayLabel": "$300",
  "tasks": [
    { "id": "abc", "title": "Session with Alex", "timeLabel": "8:30 PM",
      "colorHex": "#F97362", "completed": false, "isMeeting": true }
  ]
}
```
`tasks` = today's instances sorted by start time, incomplete first, max 8 entries.
`earnedTodayLabel` empty string when no meeting money today.

Key `widget.earnings` — JSON string:
```json
{
  "earnedLabel": "$450", "goalLabel": "$1,500", "progress": 0.3,
  "outstandingLabel": "$150", "meetingsDone": 3, "hasGoal": true
}
```
`progress` 0..1 (0 when no goal). `outstandingLabel` empty string when nothing owed.

Widgets read these with `UserDefaults(suiteName: "group.com.levisilverberg.dayflow")`,
decode defensively (any missing/malformed field → sensible placeholder), and NEVER crash.

## Live Activity

`MeetingActivityAttributes` (already written, identical copies at
targets/widgets/MeetingActivityAttributes.swift and
modules/dayflow-live-activity/ios/MeetingActivityAttributes.swift — do NOT edit either
without mirroring the other): attributes {clientName, kindLabel, rateLabel, symbolName};
ContentState {endDate, startDate, overtime}. Countdown renders via
`Text(timerInterval: context.state.startDate...context.state.endDate, countsDown: true)`
so no periodic updates are needed — the module only updates on extend and overtime flip.

## JS module API (modules/dayflow-live-activity/index.ts)

```ts
isLiveActivitySupported(): boolean  // false on web/Expo Go/Android or iOS < 16.2
startMeetingActivity(input: { clientName: string; kindLabel: string; rateLabel: string;
  symbolName: string; startedAtMs: number; endAtMs: number }): Promise<void>
updateMeetingActivity(input: { endAtMs: number; overtime: boolean }): Promise<void>
endMeetingActivity(): Promise<void>
```
All functions resolve without throwing when unsupported (no-op). The native side keeps a
single current Activity<MeetingActivityAttributes> reference; start ends any prior one.
Use `requireOptionalNativeModule('DayflowLiveActivity')` from 'expo-modules-core' in the
TS wrapper — it returns null in Expo Go/web and the wrapper must no-op.

## Design language for widget SwiftUI

Match the app's liquid-glass brand: indigo #6366F1 → violet #8B5CF6 → cyan #22D3EE
hero gradient (LinearGradient, topLeading→bottomTrailing) as accents (progress fills,
icons, live timer), emerald #10B981→teal #2DD4BF for money, dark-elevated surfaces via
`.containerBackground(for: .widget)` with a subtle gradient tint, SF rounded-weight
typography (.system(size:weight:design:)), generous corner radii. Money text in emerald.
Every widget family view MUST set `.containerBackground(for: .widget)` (iOS 17 rule).
`widgetURL` deep links: dayflow:// (today), dayflow://inbox, dayflow://stats,
dayflow://meeting-live (live activity tap). The app's scheme is `dayflow` (app.json).

## Verification

Swift cannot be run here without a full build. Compile-check EVERYTHING with:
```
export PATH="/Users/levisilverberg/.nvm/versions/node/v20.20.2/bin:$PATH"
cd "/Users/levisilverberg/structured remake"
npx expo prebuild -p ios --no-install   # regenerates project (skip pod install)
```
(The final xcodebuild compile pass is run by the orchestrator — keep Swift simple,
standard, and iOS-17-API-safe. No third-party Swift deps.)
