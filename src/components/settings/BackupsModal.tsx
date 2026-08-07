import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listBackups, restoreBackup, type BackupEntry } from '../../lib/backup';
import { formatDayRelative } from '../../lib/dates';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { syncAllNotifications } from '../../lib/notifications';
import { useFocus } from '../../store/focus';
import { useHabits } from '../../store/habits';
import { useMeetingSession } from '../../store/meetingSession';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { showUndo } from '../../store/undo';
import { RADIUS, useTheme } from '../../theme';
import { EmptyState } from '../EmptyState';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Mid-sentence day label: "today" / "yesterday" / "Sat, Jul 18". */
function dayLabel(date: string): string {
  const rel = formatDayRelative(date);
  return rel === 'Today' || rel === 'Yesterday' ? rel.toLowerCase() : rel;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Everything a restore overwrites, captured so it can be undone. */
function snapshotStores() {
  return {
    tasks: useTasks.getState().tasks,
    habits: useHabits.getState().habits,
    sessions: useFocus.getState().sessions,
    log: useMeetingSession.getState().log,
    settings: useSettings.getState().settings,
  };
}

function applySnapshot(snap: ReturnType<typeof snapshotStores>) {
  useTasks.setState({ tasks: snap.tasks });
  useHabits.setState({ habits: snap.habits });
  useFocus.setState({ sessions: snap.sessions });
  useMeetingSession.setState({ log: snap.log });
  useSettings.setState({ settings: snap.settings });
  void syncAllNotifications(snap.tasks);
}

/**
 * Lists the automatic daily backups (date + size) with a per-row Restore.
 * Restoring double-confirms, overwrites current data, and offers Undo.
 */
export function BackupsModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setEntries(listBackups());
  }, [visible]);

  const runRestore = async (entry: BackupEntry) => {
    setBusy(true);
    const before = snapshotStores();
    const ok = await restoreBackup(entry.name);
    setBusy(false);
    if (ok) {
      successHaptic();
      onClose();
      Alert.alert(
        'Backup restored',
        `DayFlow now matches the backup from ${dayLabel(entry.date)}.`,
        [{ text: 'OK', onPress: () => showUndo('Backup restored', () => applySnapshot(before)) }]
      );
    } else {
      warningHaptic();
      Alert.alert('Restore failed', 'That backup could not be read. Nothing was changed.');
    }
  };

  const confirmRestore = (entry: BackupEntry) => {
    tapHaptic();
    Alert.alert(
      'Restore this backup?',
      `Tasks, habits, focus history, meeting history and settings will be replaced with the backup from ${dayLabel(entry.date)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Overwrite current data?',
              'Everything currently in DayFlow will be replaced by this backup.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Restore', style: 'destructive', onPress: () => runRestore(entry) },
              ]
            ),
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              tapHaptic();
              onClose();
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
            accessibilityLabel="Close backups"
          >
            <Ionicons name="close" size={19} color={theme.textSecondary} />
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>Backups</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          Saved daily on your phone; included in iCloud device backups.
        </Text>

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {entries.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="archive-outline"
                title="No backups yet"
                subtitle="DayFlow saves one automatically each day when you open the app."
              />
            </View>
          ) : (
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              {entries.map((entry, i) => (
                <View key={entry.name}>
                  {i > 0 ? (
                    <View
                      style={[styles.separator, { backgroundColor: theme.separator }]}
                    />
                  ) : null}
                  <View style={styles.row}>
                    <View style={styles.rowLabels}>
                      <Text style={[styles.rowDate, { color: theme.text }]} numberOfLines={1}>
                        {formatDayRelative(entry.date)}
                      </Text>
                      <Text style={[styles.rowSize, { color: theme.textTertiary }]}>
                        {formatSize(entry.size)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => confirmRestore(entry)}
                      disabled={busy}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.restoreBtn,
                        {
                          backgroundColor: theme.surface,
                          borderColor: theme.border,
                          opacity: busy ? 0.4 : pressed ? 0.65 : 1,
                          transform: [{ scale: pressed && !busy ? 0.96 : 1 }],
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Restore backup from ${formatDayRelative(entry.date)}`}
                      accessibilityState={{ disabled: busy }}
                    >
                      <Text style={[styles.restoreLabel, { color: theme.accent }]}>
                        Restore
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
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
  title: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  headerSpacer: { width: 34 },
  hint: {
    fontSize: 12.5,
    lineHeight: 17,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  content: { paddingHorizontal: 16 },
  emptyWrap: { paddingTop: 48 },
  card: {
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  rowLabels: { flex: 1, gap: 1 },
  rowDate: { fontSize: 15, fontWeight: '600' },
  rowSize: { fontSize: 12.5, fontWeight: '500', fontVariant: ['tabular-nums'] },
  restoreBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  restoreLabel: { fontSize: 13, fontWeight: '700' },
});
