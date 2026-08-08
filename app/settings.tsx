import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertChips } from '../src/components/settings/AlertChips';
import { BackupsModal } from '../src/components/settings/BackupsModal';
import { CallingSection } from '../src/components/settings/CallingSection';
import { GlassSegmented } from '../src/components/settings/GlassSegmented';
import { CalendarToggles } from '../src/components/settings/CalendarToggles';
import { CurrencyPicker } from '../src/components/settings/CurrencyPicker';
import { GoalStepper } from '../src/components/settings/GoalStepper';
import { ImportBackupModal } from '../src/components/settings/ImportBackupModal';
import { MessagingSection } from '../src/components/settings/MessagingSection';
import { SettingsRow } from '../src/components/settings/SettingsRow';
import { SettingsSection } from '../src/components/settings/SettingsSection';
import { Stepper } from '../src/components/settings/Stepper';
import { deleteAllBackups, startAutoBackup } from '../src/lib/backup';
import { ensureCalendarPermission } from '../src/lib/calendar';
import { formatDuration } from '../src/lib/dates';
import { selectionHaptic, successHaptic, tapHaptic, warningHaptic } from '../src/lib/haptics';
import { clearMediaMemoryCache } from '../src/lib/mediaCache';
import { meetingsCsv } from '../src/lib/meetings';
import {
  ensureNotificationPermission,
  syncAllNotifications,
} from '../src/lib/notifications';
import { clearSmsCredentials } from '../src/lib/smsCredentials';
import { useCalls } from '../src/store/calls';
import { useClientMeta } from '../src/store/clientMeta';
import { useDrafts } from '../src/store/drafts';
import { useFocus } from '../src/store/focus';
import { useHabits } from '../src/store/habits';
import { useMeetingSession } from '../src/store/meetingSession';
import { useMessages } from '../src/store/messages';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { taskColor, useTheme } from '../src/theme';
import type { ThemeMode } from '../src/types';

type NotifStatus = 'unknown' | 'granted' | 'undetermined' | 'denied';

/** "6 AM" / "Noon" / "Midnight" labels for the day-range steppers. */
function formatHour(h: number): string {
  if (h === 0 || h === 24) return 'Midnight';
  if (h === 12) return 'Noon';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/**
 * Cached client media on disk: decoded MMS photos (dayflow-mms-*.b64, written
 * by lib/mediaCache) and downloaded voicemail audio (voicemail-*.mp3, written
 * by lib/voiceApi).
 */
const CACHED_MEDIA_RE = /^(dayflow-mms-.+\.b64|voicemail-.+\.mp3)$/;

/** Sweep cached photos/voicemails out of the cache dir. Best-effort. */
function deleteCachedMediaFiles(): void {
  if (Platform.OS === 'web') return;
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && CACHED_MEDIA_RE.test(entry.name)) {
        try {
          entry.delete();
        } catch {
          // A stuck file must never block the erase.
        }
      }
    }
  } catch {
    // Cache dir unavailable — nothing to remove.
  }
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const meetingLog = useMeetingSession((s) => s.log);
  const clearMeetingLog = useMeetingSession((s) => s.clearLog);

  const [importVisible, setImportVisible] = useState(false);
  const [backupsVisible, setBackupsVisible] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotifStatus>('unknown');

  // Lazy trigger for the once-per-app-open automatic backup (no-op if it
  // already ran — e.g. when the root layout wires startAutoBackup directly).
  useEffect(() => {
    startAutoBackup();
  }, []);

  // ---- Notifications permission status -------------------------------------

  const refreshNotifStatus = useCallback(async () => {
    if (Platform.OS === 'web') {
      setNotifStatus('denied');
      return;
    }
    try {
      const p = await Notifications.getPermissionsAsync();
      setNotifStatus(p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied');
    } catch {
      setNotifStatus('unknown');
    }
  }, []);

  useEffect(() => {
    refreshNotifStatus();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshNotifStatus();
    });
    return () => sub.remove();
  }, [refreshNotifStatus]);

  const enableNotifications = async () => {
    tapHaptic();
    if (notifStatus === 'denied') {
      // Can't re-prompt — send the user to iOS Settings.
      Linking.openSettings().catch(() => {});
      return;
    }
    const granted = await ensureNotificationPermission();
    if (!granted) {
      Alert.alert(
        'Notifications are off',
        'Allow notifications for DayFlow in iOS Settings to get task alerts.'
      );
    }
    refreshNotifStatus();
  };

  // ---- Calendar ------------------------------------------------------------

  const toggleCalendarEvents = async (next: boolean) => {
    selectionHaptic();
    if (!next) {
      update({ showCalendarEvents: false });
      return;
    }
    update({ showCalendarEvents: true });
    const granted = await ensureCalendarPermission();
    if (!granted) {
      update({ showCalendarEvents: false });
      Alert.alert(
        'Calendar access needed',
        'Allow calendar access for DayFlow in iOS Settings to see your events on the timeline.'
      );
    }
  };

  // ---- Privacy -------------------------------------------------------------

  const toggleAppLock = async (next: boolean) => {
    selectionHaptic();
    if (!next) {
      update({ appLock: false });
      return;
    }
    if (Platform.OS === 'web') return;
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.getEnrolledLevelAsync();
      if (!hasHardware || enrolled === LocalAuthentication.SecurityLevel.NONE) {
        Alert.alert(
          'Face ID is not set up',
          'Set up Face ID or a device passcode in iOS Settings first — DayFlow uses it to lock the app.'
        );
        return; // Switch is bound to settings.appLock, so it snaps back off.
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable App Lock',
      });
      if (res.success) {
        update({ appLock: true });
        successHaptic();
      }
    } catch {
      // Authentication unavailable — leave the lock off.
    }
  };

  // ---- Meetings ------------------------------------------------------------

  const confirmClearMeetings = () => {
    const n = meetingLog.length;
    Alert.alert(
      'Clear meeting history?',
      n === 0
        ? 'There are no logged sessions yet.'
        : `${n} logged session${n === 1 ? '' : 's'} will be removed. Tasks and their earnings are not affected.`,
      n === 0
        ? [{ text: 'OK', style: 'cancel' }]
        : [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear',
              style: 'destructive',
              onPress: () => {
                warningHaptic();
                clearMeetingLog();
              },
            },
          ]
    );
  };

  // ---- Data ----------------------------------------------------------------

  const exportBackup = async () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: Object.values(useTasks.getState().tasks),
      habits: Object.values(useHabits.getState().habits),
      focusSessions: useFocus.getState().sessions,
      meetingLog: useMeetingSession.getState().log,
      // Client book + voicemail read state. Message bodies are deliberately
      // excluded: threads re-sync from Twilio, and keeping client texts out
      // of plaintext export files is a privacy choice.
      clientMeta: useClientMeta.getState().meta,
      callsHeardAt: useCalls.getState().heardAt,
      settings: useSettings.getState().settings,
    };
    try {
      await Share.share(
        { message: JSON.stringify(payload) },
        { subject: 'DayFlow backup' }
      );
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const exportEarningsCsv = async () => {
    const csv = meetingsCsv(
      useTasks.getState().tasks,
      useMeetingSession.getState().log,
      settings.currencySymbol
    );
    // meetingsCsv always emits a header line; no newline means zero data rows.
    if (!csv.includes('\n')) {
      Alert.alert(
        'No completed meetings yet',
        'Finished meetings show up here, ready to export for bookkeeping.'
      );
      return;
    }
    try {
      await Share.share({ message: csv }, { subject: 'DayFlow earnings' });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const eraseAll = async () => {
    warningHaptic();
    // Every step below is best-effort: one failure must never keep the rest
    // of the wipe from running.
    try {
      await useMeetingSession.getState().cancel();
    } catch {
      // best-effort: clearing a stale live session must not block the erase
    }
    useMeetingSession.getState().clearLog();
    useTasks.setState({ tasks: {} });
    useHabits.setState({ habits: {} });
    useFocus.getState().clearHistory();
    useDrafts.setState({ drafts: {} });
    // The sensitive layer: messages, client book, call log, credentials.
    useMessages.getState().clearAll();
    useCalls.getState().clearAll();
    useClientMeta.setState({ meta: {} });
    try {
      await clearSmsCredentials();
    } catch {
      // Keychain entry already gone (or unavailable) — nothing left to clear.
    }
    clearMediaMemoryCache();
    deleteCachedMediaFiles();
    deleteAllBackups();
    useSettings.getState().reset();
    syncAllNotifications({});
    Alert.alert('All data erased', 'DayFlow is back to a fresh start.');
  };

  const confirmErase = () => {
    Alert.alert(
      'Erase all data?',
      'Tasks, habits, focus and meeting history, the client book, message and call history, cached photos and voicemails, saved backups, messaging credentials and settings will all be deleted from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Are you absolutely sure?',
              'There is no undo. Consider exporting a backup first.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Erase Everything', style: 'destructive', onPress: eraseAll },
              ]
            ),
        },
      ]
    );
  };

  // ---- Render --------------------------------------------------------------

  const notifSublabel =
    notifStatus === 'granted'
      ? 'Enabled'
      : notifStatus === 'denied'
        ? 'Off — allow in iOS Settings'
        : notifStatus === 'undetermined'
          ? 'Not enabled yet'
          : ' ';

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 10 },
        ]}
      >
        <Pressable
          onPress={() => {
            tapHaptic();
            router.back();
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.closeBtn,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            },
          ]}
          accessibilityLabel="Close settings"
        >
          <Ionicons name="close" size={19} color={theme.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 40 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title="Appearance" delay={0}>
          <SettingsRow
            icon="contrast"
            tint={taskColor('violet').solid}
            label="Theme"
            right={
              <View style={styles.segmentWide}>
                <GlassSegmented<ThemeMode>
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                  value={settings.themeMode}
                  onChange={(mode) => update({ themeMode: mode })}
                />
              </View>
            }
          />
          <SettingsRow
            icon="calendar-clear"
            tint={taskColor('sky').solid}
            label="Week starts"
            right={
              <View style={styles.segmentNarrow}>
                <GlassSegmented<'0' | '1'>
                  options={[
                    { value: '1', label: 'Mon' },
                    { value: '0', label: 'Sun' },
                  ]}
                  value={String(settings.weekStartsOn) as '0' | '1'}
                  onChange={(v) => update({ weekStartsOn: v === '1' ? 1 : 0 })}
                />
              </View>
            }
          />
          <SettingsRow
            icon="pulse"
            tint={taskColor('teal').solid}
            label="Haptics"
            right={
              <Switch
                value={settings.haptics}
                onValueChange={(on) => {
                  update({ haptics: on });
                  if (on) tapHaptic();
                }}
                trackColor={{ false: theme.surface, true: theme.accent }}
                ios_backgroundColor={theme.surface}
                accessibilityLabel="Haptic feedback"
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          delay={45}
          title="Your day"
          caption="The timeline shows these hours. New tasks pick up the default duration and alerts."
        >
          <SettingsRow
            icon="sunny"
            tint={taskColor('amber').solid}
            label="Day starts"
            right={
              <Stepper
                value={settings.dayStartHour}
                onChange={(v) => update({ dayStartHour: v })}
                min={0}
                max={Math.min(12, settings.dayEndHour - 1)}
                format={formatHour}
              />
            }
          />
          <SettingsRow
            icon="moon"
            tint={taskColor('indigo').solid}
            label="Day ends"
            right={
              <Stepper
                value={settings.dayEndHour}
                onChange={(v) => update({ dayEndHour: v })}
                min={Math.max(12, settings.dayStartHour + 1)}
                max={24}
                format={formatHour}
              />
            }
          />
          <SettingsRow
            icon="time"
            tint={taskColor('cyan').solid}
            label="Default duration"
            right={
              <Stepper
                value={settings.defaultDurationMinutes}
                onChange={(v) => update({ defaultDurationMinutes: v })}
                min={15}
                max={240}
                step={15}
                format={formatDuration}
              />
            }
          />
          <View style={styles.block}>
            <Text style={[styles.blockLabel, { color: theme.textTertiary }]}>
              Default alerts
            </Text>
            <AlertChips
              value={settings.defaultAlerts}
              onChange={(alerts) => update({ defaultAlerts: alerts })}
            />
          </View>
        </SettingsSection>

        <SettingsSection
          delay={90}
          title="Meetings"
          caption="The symbol used for rates and earnings across the app. The weekly goal is shown as a progress bar in Stats."
        >
          <View style={styles.block}>
            <Text style={[styles.blockLabel, { color: theme.textTertiary }]}>
              Currency symbol
            </Text>
            <CurrencyPicker
              value={settings.currencySymbol}
              onChange={(currencySymbol) => update({ currencySymbol })}
            />
          </View>
          <SettingsRow
            icon="flag"
            tint={taskColor('emerald').solid}
            label="Weekly goal"
            right={
              <GoalStepper
                value={settings.weeklyEarningsGoal}
                onChange={(weeklyEarningsGoal) => update({ weeklyEarningsGoal })}
                symbol={settings.currencySymbol}
              />
            }
          />
          <SettingsRow
            icon="file-tray-full"
            tint={taskColor('slate').solid}
            label="Clear meeting history"
            sublabel={
              meetingLog.length === 0
                ? 'No sessions logged'
                : `${meetingLog.length} session${meetingLog.length === 1 ? '' : 's'} logged`
            }
            onPress={confirmClearMeetings}
          />
        </SettingsSection>

        <MessagingSection />

        <CallingSection />

        <SettingsSection title="Focus" delay={135}>
          <SettingsRow
            icon="timer"
            tint={taskColor('orange').solid}
            label="Focus length"
            right={
              <Stepper
                value={settings.pomodoroWork}
                onChange={(v) => update({ pomodoroWork: v })}
                min={10}
                max={90}
                step={5}
                format={formatDuration}
              />
            }
          />
          <SettingsRow
            icon="cafe"
            tint={taskColor('lime').solid}
            label="Short break"
            right={
              <Stepper
                value={settings.pomodoroBreak}
                onChange={(v) => update({ pomodoroBreak: v })}
                min={1}
                max={30}
                format={formatDuration}
              />
            }
          />
          <SettingsRow
            icon="leaf"
            tint={taskColor('emerald').solid}
            label="Long break"
            right={
              <Stepper
                value={settings.pomodoroLongBreak}
                onChange={(v) => update({ pomodoroLongBreak: v })}
                min={5}
                max={60}
                step={5}
                format={formatDuration}
              />
            }
          />
          <SettingsRow
            icon="sync"
            tint={taskColor('violet').solid}
            label="Rounds before long break"
            right={
              <Stepper
                value={settings.pomodoroCyclesBeforeLongBreak}
                onChange={(v) => update({ pomodoroCyclesBeforeLongBreak: v })}
                min={2}
                max={8}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          delay={180}
          title="Calendar"
          caption={
            settings.showCalendarEvents
              ? 'Choose which calendars appear on your timeline. Events are read-only.'
              : 'Show read-only events from your device calendars on the timeline.'
          }
        >
          <SettingsRow
            icon="calendar"
            tint={taskColor('rose').solid}
            label="Show calendar events"
            right={
              <Switch
                value={settings.showCalendarEvents}
                onValueChange={toggleCalendarEvents}
                trackColor={{ false: theme.surface, true: theme.accent }}
                ios_backgroundColor={theme.surface}
                accessibilityLabel="Show calendar events"
              />
            }
          />
          {settings.showCalendarEvents ? <CalendarToggles /> : null}
        </SettingsSection>

        <SettingsSection
          delay={225}
          title="Notifications"
          caption="Alerts are scheduled right on your iPhone — they stay local and private, and nothing ever leaves your device."
        >
          <SettingsRow
            icon="notifications"
            tint={taskColor('coral').solid}
            label="Task alerts"
            sublabel={notifSublabel}
            right={
              notifStatus === 'granted' ? (
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={theme.success}
                />
              ) : (
                <Pressable
                  onPress={enableNotifications}
                  style={({ pressed }) => [
                    styles.pillBtn,
                    {
                      backgroundColor: theme.accent,
                      opacity: pressed ? 0.85 : 1,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                  ]}
                  accessibilityLabel="Enable notifications"
                >
                  <Text style={styles.pillLabel}>
                    {notifStatus === 'denied' ? 'Open Settings' : 'Enable'}
                  </Text>
                </Pressable>
              )
            }
          />
        </SettingsSection>

        <SettingsSection
          delay={270}
          title="Privacy"
          caption="Require Face ID to open DayFlow."
        >
          <SettingsRow
            icon="lock-closed"
            tint={taskColor('violet').solid}
            label="App lock"
            sublabel={Platform.OS === 'web' ? 'Device only' : undefined}
            right={
              <Switch
                value={Platform.OS === 'web' ? false : settings.appLock}
                onValueChange={toggleAppLock}
                disabled={Platform.OS === 'web'}
                trackColor={{ false: theme.surface, true: theme.accent }}
                ios_backgroundColor={theme.surface}
                accessibilityLabel="App lock"
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          delay={315}
          title="Data"
          caption="Backups are plain JSON you keep wherever you like. Nothing is stored in any cloud."
        >
          <SettingsRow
            icon="share-outline"
            tint={taskColor('sky').solid}
            label="Export backup"
            sublabel="Tasks, habits, meetings and the client book"
            onPress={exportBackup}
          />
          <SettingsRow
            icon="document-text"
            tint={taskColor('emerald').solid}
            label="Export earnings CSV"
            sublabel="Completed meetings, for bookkeeping"
            onPress={exportEarningsCsv}
          />
          <SettingsRow
            icon="download-outline"
            tint={taskColor('emerald').solid}
            label="Import backup"
            sublabel="Paste a previously exported backup"
            onPress={() => setImportVisible(true)}
          />
          <SettingsRow
            icon="archive-outline"
            tint={taskColor('indigo').solid}
            label="Backups"
            sublabel="Saved daily on your phone"
            onPress={() => setBackupsVisible(true)}
          />
          <SettingsRow
            icon="trash-outline"
            tint={theme.danger}
            label="Erase all data"
            destructive
            onPress={confirmErase}
          />
        </SettingsSection>

        <SettingsSection
          delay={360}
          title="About"
          caption="Everything Structured charges for. Free."
        >
          <View style={styles.aboutRow}>
            <View style={[styles.aboutIcon, { backgroundColor: theme.accent }]}>
              <Ionicons name="sparkles" size={20} color="#fff" />
            </View>
            <View style={styles.aboutLabels}>
              <View style={styles.aboutTitleRow}>
                <Text style={[styles.aboutName, { color: theme.accent }]}>
                  DayFlow
                </Text>
                <Text
                  style={[styles.aboutVersion, { color: theme.textTertiary }]}
                >
                  1.0
                </Text>
              </View>
              <Text style={[styles.aboutTag, { color: theme.textTertiary }]}>
                Free forever
              </Text>
            </View>
          </View>
        </SettingsSection>
      </ScrollView>

      <ImportBackupModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
      />
      <BackupsModal
        visible={backupsVisible}
        onClose={() => setBackupsVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  headerSpacer: { width: 34 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  segmentWide: { width: 200 },
  segmentNarrow: { width: 124 },
  block: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  pillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pillLabel: { fontSize: 13, fontWeight: '700', color: '#fff' },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  aboutIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutLabels: { flex: 1, gap: 1 },
  aboutTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  aboutName: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  aboutVersion: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  aboutTag: { fontSize: 12.5, fontWeight: '600' },
});
