import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sanitizeClientMeta, sanitizeHeardAt } from '../../lib/backup';
import {
  decryptBackup,
  isEncryptedBackup,
  loadBackupPassphrase,
} from '../../lib/cryptoBackup';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { useCalls } from '../../store/calls';
import { useClientMeta } from '../../store/clientMeta';
import { useHabits } from '../../store/habits';
import { useTasks } from '../../store/tasks';
import type { Habit, MeetingInfo, Task } from '../../types';
import { RADIUS, useTheme } from '../../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const MEETING_KINDS = ['incall', 'outcall', 'public'] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v)
    ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    : [];
}

function normalizeMeeting(raw: any): MeetingInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const extras: Record<string, number> = {};
  if (raw.extras && typeof raw.extras === 'object') {
    for (const [k, v] of Object.entries(raw.extras)) {
      if (typeof v === 'number' && Number.isFinite(v)) extras[k] = v;
    }
  }
  // Deposits are money ALREADY RECEIVED — dropping them on import would
  // inflate what clients appear to owe. Carry them (and no-show history).
  const deposits: Record<string, number> = {};
  if (raw.deposits && typeof raw.deposits === 'object') {
    for (const [k, v] of Object.entries(raw.deposits)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) deposits[k] = v;
    }
  }
  return {
    kind: MEETING_KINDS.includes(raw.kind) ? raw.kind : 'incall',
    client: typeof raw.client === 'string' ? raw.client : '',
    rate: typeof raw.rate === 'number' && Number.isFinite(raw.rate) ? raw.rate : 0,
    paidDates: asStringArray(raw.paidDates),
    location: typeof raw.location === 'string' ? raw.location : '',
    extras,
    deposits,
    noShows: asStringArray(raw.noShows),
  };
}

function normalizeTask(raw: any): Task {
  const completions: Record<string, boolean> = {};
  if (raw.completions && typeof raw.completions === 'object') {
    for (const [k, v] of Object.entries(raw.completions)) completions[k] = !!v;
  }
  return {
    id: String(raw.id),
    title: String(raw.title),
    icon: typeof raw.icon === 'string' ? raw.icon : 'ellipse-outline',
    color: typeof raw.color === 'string' ? raw.color : 'indigo',
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    date: typeof raw.date === 'string' ? raw.date : null,
    allDay: !!raw.allDay,
    startMinutes:
      typeof raw.startMinutes === 'number' && Number.isFinite(raw.startMinutes)
        ? raw.startMinutes
        : null,
    durationMinutes:
      typeof raw.durationMinutes === 'number' && Number.isFinite(raw.durationMinutes)
        ? raw.durationMinutes
        : 60,
    subtasks: Array.isArray(raw.subtasks)
      ? raw.subtasks
          .filter((s: any) => s && typeof s === 'object' && s.id != null)
          .map((s: any) => ({
            id: String(s.id),
            title: typeof s.title === 'string' ? s.title : '',
            done: !!s.done,
          }))
      : [],
    alerts: asNumberArray(raw.alerts),
    recurrence:
      raw.recurrence && typeof raw.recurrence === 'object' && raw.recurrence.freq
        ? raw.recurrence
        : null,
    priority:
      raw.priority === 1 || raw.priority === 2 || raw.priority === 3
        ? raw.priority
        : 0,
    tags: asStringArray(raw.tags),
    meeting: normalizeMeeting(raw.meeting),
    completed: !!raw.completed,
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
    completions,
    skips: asStringArray(raw.skips),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function normalizeHabit(raw: any): Habit {
  const completions: Record<string, number> = {};
  if (raw.completions && typeof raw.completions === 'object') {
    for (const [k, v] of Object.entries(raw.completions)) {
      if (typeof v === 'number' && Number.isFinite(v)) completions[k] = v;
    }
  }
  return {
    id: String(raw.id),
    title: String(raw.title),
    icon: typeof raw.icon === 'string' ? raw.icon : 'sparkles-outline',
    color: typeof raw.color === 'string' ? raw.color : 'emerald',
    timesPerDay:
      typeof raw.timesPerDay === 'number' && raw.timesPerDay >= 1
        ? Math.round(raw.timesPerDay)
        : 1,
    activeWeekdays: asNumberArray(raw.activeWeekdays),
    completions,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    archived: !!raw.archived,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function isRecordLike(v: unknown): v is { id: unknown; title: unknown } {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { id?: unknown }).id === 'string' &&
    typeof (v as { title?: unknown }).title === 'string'
  );
}

/** Paste-a-backup modal: validates the JSON and merges tasks, habits and the client book in. */
export function ImportBackupModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const importTasks = useTasks((s) => s.importTasks);
  const [text, setText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  useEffect(() => {
    if (visible) {
      setText('');
      setPassphrase('');
      setDecryptError(null);
      setDecrypting(false);
    }
  }, [visible]);

  /** True once the pasted text parses as an encrypted DayFlow envelope. */
  const encrypted = useMemo(() => isEncryptedBackup(text.trim()), [text]);

  const runImport = async () => {
    tapHaptic();
    let source = text.trim();

    if (encrypted) {
      // Prefer the typed passphrase; fall back to the one in the keychain so
      // importing your own file "just works" without retyping it.
      const typed = passphrase.trim();
      const stored = typed ? null : await loadBackupPassphrase();
      const pass = typed || stored;
      if (!pass) {
        setDecryptError('Enter the passphrase this backup was encrypted with.');
        warningHaptic();
        return;
      }
      // scrypt takes ~1s — let the spinner-ish disabled state paint first.
      setDecrypting(true);
      setDecryptError(null);
      await new Promise((r) => setTimeout(r, 30));
      const dec = decryptBackup(source, pass);
      setDecrypting(false);
      if (!dec.ok) {
        setDecryptError(dec.error);
        warningHaptic();
        return;
      }
      source = dec.plaintext;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      Alert.alert(
        'Invalid backup',
        'That text is not valid JSON. Paste the whole backup exactly as it was exported.'
      );
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      Alert.alert(
        'Invalid backup',
        'This does not look like a DayFlow backup file.'
      );
      return;
    }
    const obj = parsed as {
      tasks?: unknown;
      habits?: unknown;
      clientMeta?: unknown;
      callsHeardAt?: unknown;
    };
    const tasks = (Array.isArray(obj.tasks) ? obj.tasks : [])
      .filter(isRecordLike)
      .map(normalizeTask);
    const habits = (Array.isArray(obj.habits) ? obj.habits : [])
      .filter(isRecordLike)
      .map(normalizeHabit);
    // Client book + voicemail read state (message bodies are never in
    // backups — they re-sync from the provider).
    const clientMeta = sanitizeClientMeta(obj.clientMeta);
    const heardAt = sanitizeHeardAt(obj.callsHeardAt);
    const clientCount = Object.keys(clientMeta).length;

    if (tasks.length === 0 && habits.length === 0 && clientCount === 0) {
      Alert.alert(
        'Nothing to import',
        'No tasks, habits or clients were found in that backup.'
      );
      return;
    }

    importTasks(tasks);
    if (habits.length > 0) {
      useHabits.setState((s) => ({
        habits: {
          ...s.habits,
          ...Object.fromEntries(habits.map((h) => [h.id, h])),
        },
      }));
    }
    if (clientCount > 0) {
      // Merge per client, never blanking a field the pasted entry lacks.
      useClientMeta.setState((s) => {
        const meta = { ...s.meta };
        for (const [key, entry] of Object.entries(clientMeta)) {
          const prev = meta[key];
          meta[key] = {
            notes: entry.notes || prev?.notes || '',
            phone: entry.phone ?? prev?.phone,
            status: entry.status ?? prev?.status,
            displayName: entry.displayName ?? prev?.displayName,
          };
        }
        return { meta };
      });
    }
    if (Object.keys(heardAt).length > 0) {
      // Local "first listened" timestamps win over imported ones.
      useCalls.setState((s) => ({ heardAt: { ...heardAt, ...s.heardAt } }));
    }
    successHaptic();
    onClose();
    const parts = [
      `${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
      `${habits.length} habit${habits.length === 1 ? '' : 's'}`,
    ];
    if (clientCount > 0) {
      parts.push(`${clientCount} client${clientCount === 1 ? '' : 's'}`);
    }
    Alert.alert('Import complete', `Restored ${parts.join(', ')}.`);
  };

  const canImport = text.trim().length > 0 && !decrypting;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
            accessibilityLabel="Cancel import"
          >
            <Ionicons name="close" size={19} color={theme.textSecondary} />
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]}>
            Import Backup
          </Text>
          <Pressable
            onPress={() => void runImport()}
            disabled={!canImport}
            hitSlop={8}
            style={({ pressed }) => [
              styles.importBtn,
              {
                backgroundColor: theme.accent,
                opacity: canImport ? (pressed ? 0.85 : 1) : 0.4,
                transform: [{ scale: pressed && canImport ? 0.97 : 1 }],
              },
            ]}
            accessibilityLabel="Import"
            accessibilityState={{ disabled: !canImport }}
          >
            <Text style={styles.importLabel}>
              {decrypting ? 'Unlocking…' : 'Import'}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          Paste the JSON from a DayFlow export below. Tasks, habits and the
          client book are merged into what is already on this device.
        </Text>

        {encrypted ? (
          <View style={styles.passBlock}>
            <View
              style={[
                styles.passField,
                {
                  backgroundColor: theme.card,
                  borderColor: decryptError ? theme.danger : theme.border,
                },
              ]}
            >
              <Ionicons
                name="lock-closed"
                size={15}
                color={theme.textSecondary}
              />
              <TextInput
                value={passphrase}
                onChangeText={(v) => {
                  setPassphrase(v);
                  if (decryptError) setDecryptError(null);
                }}
                placeholder="Backup passphrase"
                placeholderTextColor={theme.textTertiary}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
                style={[styles.passInput, { color: theme.text }]}
                accessibilityLabel="Backup passphrase"
              />
            </View>
            <Text
              style={[
                styles.passHint,
                { color: decryptError ? theme.danger : theme.textTertiary },
              ]}
            >
              {decryptError ??
                'This backup is encrypted. It unlocks with the passphrase it was exported with.'}
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              marginBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={'{"version":1, "tasks": [...] }'}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.text }]}
            autoCorrect={false}
            autoCapitalize="none"
            textAlignVertical="top"
            accessibilityLabel="Backup JSON"
          />
        </View>
      </KeyboardAvoidingView>
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
  importBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  importLabel: { fontSize: 14, fontWeight: '800', color: '#fff' },
  hint: {
    fontSize: 12.5,
    lineHeight: 17,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  passBlock: {
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 6,
  },
  passField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  passInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
  },
  passHint: {
    fontSize: 12,
    lineHeight: 16,
    marginHorizontal: 2,
  },
  inputWrap: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    padding: 14,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
