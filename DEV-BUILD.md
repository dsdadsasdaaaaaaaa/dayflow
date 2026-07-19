# Installing DayFlow on your iPhone (real build)

Expo Go is fine for testing, but a **development build** gives you: the custom app icon,
Face ID app lock, reliable notifications, and (later) widgets + Live Activities. You have
an Apple Developer account, so this takes about 15 minutes, mostly waiting.

## One-time setup

```bash
cd "/Users/levisilverberg/structured remake"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"   # Node 20

npx eas-cli login          # your Expo account (create one free at expo.dev if needed)
```

## Build and install

```bash
npx eas-cli build --profile development --platform ios
```

- It will ask to log into your **Apple Developer account** and register your iPhone —
  say yes to everything (it creates certificates/profiles automatically).
- When it asks to register a device, follow the link on your phone and install the profile.
- The build runs in Expo's cloud (~10–15 min). When done it prints a QR/link —
  **open it on your iPhone** and install the app.

## Day-to-day

The dev build works like Expo Go but it's YOUR app:

```bash
npx expo start --dev-client     # connect the installed app to your local code
```

When you just want the app on your phone without a computer running, make a
standalone internal build instead:

```bash
npx eas-cli build --profile preview --platform ios
```

Install it the same way — it runs fully on-device, no computer needed. Rebuild
whenever you want to ship yourself new features.

## What this unlocks next (ask Claude when ready)

- **Live Activity / Dynamic Island** for the meeting countdown (native widget target)
- **Home-screen widgets** (today's timeline, earnings this week)
- **Apple Watch** companion
- **TestFlight** distribution (`npx eas-cli build --profile production` + `eas submit`)

## Widgets & Live Activities

The dev build now includes the full native layer:

- **Today widget** — today's schedule (up to 8 tasks with times and colors), done/total
  progress, and today's meeting earnings. Supports Home Screen sizes plus Lock Screen
  (accessory) families.
- **Earnings widget** — this week's earned amount vs. your weekly goal with a progress
  ring, meetings done, and any outstanding (unpaid) amount. Home Screen + Lock Screen
  families as well.
- **Meeting Live Activity** — when you start a live meeting session, a countdown appears
  on the Lock Screen and in the Dynamic Island, with an overtime state when you run past
  the planned end. It updates when you extend and disappears when you end the session.
- **Quick actions** — long-press the DayFlow icon on the Home Screen for shortcuts:
  New Task, Inbox, and Clients.

**Adding widgets:** long-press an empty spot on the Home Screen → tap **Edit** → **Add
Widget** → search "DayFlow" → pick Today or Earnings and a size. For Lock Screen widgets:
long-press the Lock Screen → **Customize** → tap the widget area under the clock → add
DayFlow.

**Widget data:** widgets mirror the app automatically — any change to tasks, settings, or
a live session syncs to them within a couple of seconds of using the app. Tapping a
widget deep-links straight into the relevant screen.

**Live Activity toggle:** if you don't want the Lock Screen countdown, turn it off in
**iOS Settings → DayFlow → Live Activities**.

All of this is native code, so it only exists in a real build — rebuild with
`npx eas-cli build --profile development --platform ios` after pulling these changes
(Expo Go will keep working, just without widgets/Live Activities/quick actions).
