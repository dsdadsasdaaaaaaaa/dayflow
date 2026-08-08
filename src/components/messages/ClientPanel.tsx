import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDayRelative } from '../../lib/dates';
import { selectionHaptic, successHaptic, tapHaptic } from '../../lib/haptics';
import { clientProfiles, formatMoney, knownClients } from '../../lib/meetings';
import { loadSmsCredentials } from '../../lib/smsCredentials';
import { clickToCall } from '../../lib/voiceApi';
import {
  clientMetaKey,
  effectiveStatus,
  useClientMeta,
  type ClientStatus,
} from '../../store/clientMeta';
import { useMeetingSession } from '../../store/meetingSession';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import {
  telegramChatId,
  telegramChatTitle,
  useTelegram,
} from '../../store/telegramAccount';
import { RADIUS, SPACING, useTheme } from '../../theme';
import { formatPhoneDisplay } from './format';

/** Lead/warning accent from the contract's CRM layer. */
export const LEAD_AMBER = '#D97706';

/**
 * Shared click-to-call flow: gate on the calling setting, confirm, then ask
 * Twilio to ring the user's own cell and bridge in the client. The client
 * only ever sees the work number.
 */
export function startClientCall(
  callingEnabled: boolean,
  forwardTo: string,
  number: string,
  clientName?: string | null
): void {
  const label = clientName ?? formatPhoneDisplay(number);
  if (!callingEnabled) {
    Alert.alert('Calling is off', 'Turn on calling in Settings → Calling & voicemail first.');
    return;
  }
  Alert.alert(
    'Call via your work number?',
    `Your phone rings first — answer and we connect ${label}. They see your work number.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Call',
        onPress: async () => {
          const creds = await loadSmsCredentials();
          if (!creds) {
            Alert.alert('Call failed', 'Connect messaging in Settings first.');
            return;
          }
          const res = await clickToCall(creds, forwardTo, number);
          if (res.ok) Alert.alert('Calling — pick up your phone.');
          else Alert.alert('Call failed', res.error);
        },
      },
    ]
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The thread's counterparty — E.164, or 'tgc:<chatId>' for Telegram. */
  number: string;
  /** Linked client display name, or null for unknown numbers. */
  clientName: string | null;
  /** Open the meeting editor (the screen snapshots bookings for confirm drafts). */
  onBook: () => void;
}

/**
 * The thread's CRM cockpit: a flat sheet with status, save-this-number,
 * notes, money stats, and quick actions for the current counterparty.
 */
export function ClientPanel({ visible, onClose, number, clientName, onBook }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const tasks = useTasks((s) => s.tasks);
  const log = useMeetingSession((s) => s.log);
  const meta = useClientMeta((s) => s.meta);
  const setStatus = useClientMeta((s) => s.setStatus);
  const setNotes = useClientMeta((s) => s.setNotes);
  const upsertContact = useClientMeta((s) => s.upsertContact);
  const upsertTelegramContact = useClientMeta((s) => s.upsertTelegramContact);
  const tgChats = useTelegram((s) => s.chats);
  const symbol = useSettings((s) => s.settings.currencySymbol);
  const callingEnabled = useSettings((s) => s.settings.callingEnabled);
  const callForwardTo = useSettings((s) => s.settings.callForwardTo);

  // Telegram threads: no phone number, no calling — the chat title stands in.
  const isTelegram = number.startsWith('tgc:');
  const fallbackTitle = isTelegram
    ? telegramChatTitle({ chats: tgChats }, number)
    : formatPhoneDisplay(number);

  const hasMeetings = useMemo(
    () =>
      clientName != null &&
      knownClients(tasks).some((n) => clientMetaKey(n) === clientMetaKey(clientName)),
    [tasks, clientName]
  );

  const profile = useMemo(() => {
    if (!clientName) return null;
    const key = clientMetaKey(clientName);
    return clientProfiles(tasks, log).find((p) => clientMetaKey(p.name) === key) ?? null;
  }, [clientName, tasks, log]);

  const status: ClientStatus | null = clientName
    ? effectiveStatus(meta, clientName, hasMeetings)
    : null;

  // ── Save-this-number (unknown counterparty) ────────────────────────────────
  const [nameDraft, setNameDraft] = useState('');
  const saveAs = (as: ClientStatus) => {
    const name = nameDraft.trim();
    if (!name) return;
    successHaptic();
    if (isTelegram) upsertTelegramContact(name, telegramChatId(number), as);
    else upsertContact(name, number, as);
    setNameDraft('');
  };

  // ── Auto-saving notes (600ms debounce, flushed on close/unmount) ───────────
  const [notesDraft, setNotesDraft] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNotes = useRef<string | null>(null);

  useEffect(() => {
    if (visible && clientName) {
      setNotesDraft(meta[clientMetaKey(clientName)]?.notes ?? '');
    }
    // Seed only when the panel opens or relinks — not on every keystroke echo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, clientName]);

  useEffect(
    () => () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
      if (clientName && pendingNotes.current != null) {
        setNotes(clientName, pendingNotes.current);
        pendingNotes.current = null;
      }
    },
    [clientName, setNotes]
  );

  const handleNotesChange = (text: string) => {
    setNotesDraft(text);
    if (!clientName) return;
    pendingNotes.current = text;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      if (pendingNotes.current != null) {
        setNotes(clientName, pendingNotes.current);
        pendingNotes.current = null;
      }
    }, 600);
  };

  // ── Copy number feedback ───────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const copyNumber = async () => {
    tapHaptic();
    await Clipboard.setStringAsync(number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const chips: { key: ClientStatus; label: string; color: string }[] = [
    { key: 'lead', label: 'Lead', color: LEAD_AMBER },
    { key: 'client', label: 'Client', color: theme.accent },
    { key: 'blocked', label: 'Blocked', color: theme.textTertiary },
  ];

  const avg =
    profile && profile.meetingsDone > 0 ? profile.earned / profile.meetingsDone : 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close contact panel"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              paddingBottom: Math.max(insets.bottom, SPACING.md),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            {/* Name row */}
            <View style={styles.nameRow}>
              {status && status !== 'client' ? (
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        status === 'blocked' ? theme.textTertiary : LEAD_AMBER,
                    },
                  ]}
                />
              ) : null}
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {clientName ?? fallbackTitle}
              </Text>
            </View>
            {clientName ? (
              <Text style={[styles.numberLine, { color: theme.textSecondary }]}>
                {isTelegram ? 'Telegram' : formatPhoneDisplay(number)}
              </Text>
            ) : isTelegram ? (
              <Text style={[styles.numberLine, { color: theme.textSecondary }]}>
                Telegram
              </Text>
            ) : null}

            {clientName ? (
              /* Status selector */
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                  Status
                </Text>
                <View style={styles.chipRow}>
                  {chips.map((c) => {
                    const selected = status === c.key;
                    return (
                      <Pressable
                        key={c.key}
                        onPress={() => {
                          selectionHaptic();
                          setStatus(clientName, c.key);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Mark as ${c.label}`}
                        style={[
                          styles.chip,
                          selected
                            ? { backgroundColor: c.color }
                            : { backgroundColor: theme.surface },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipLabel,
                            { color: selected ? '#FFFFFF' : theme.textSecondary },
                          ]}
                        >
                          {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : (
              /* Save this number / contact */
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                  {isTelegram ? 'Save this contact' : 'Save this number'}
                </Text>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Name"
                  placeholderTextColor={theme.textTertiary}
                  autoCapitalize="words"
                  style={[
                    styles.input,
                    { backgroundColor: theme.surface, color: theme.text },
                  ]}
                  accessibilityLabel="Contact name"
                />
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => saveAs('lead')}
                    disabled={!nameDraft.trim()}
                    accessibilityRole="button"
                    style={[
                      styles.saveBtn,
                      {
                        backgroundColor: LEAD_AMBER,
                        opacity: nameDraft.trim() ? 1 : 0.4,
                      },
                    ]}
                  >
                    <Text style={styles.saveBtnLabel}>Save as lead</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => saveAs('client')}
                    disabled={!nameDraft.trim()}
                    accessibilityRole="button"
                    style={[
                      styles.saveBtn,
                      {
                        backgroundColor: theme.accent,
                        opacity: nameDraft.trim() ? 1 : 0.4,
                      },
                    ]}
                  >
                    <Text style={styles.saveBtnLabel}>Save as client</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Notes */}
            {clientName ? (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                  Notes
                </Text>
                <TextInput
                  value={notesDraft}
                  onChangeText={handleNotesChange}
                  placeholder="Preferences, boundaries, reminders…"
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  style={[
                    styles.input,
                    styles.notesInput,
                    { backgroundColor: theme.surface, color: theme.text },
                  ]}
                  accessibilityLabel="Client notes"
                />
              </View>
            ) : null}

            {/* Stats */}
            {clientName && profile ? (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                  History
                </Text>
                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: theme.success }]}>
                      {formatMoney(profile.earned, symbol)}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
                      Earned
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: theme.text }]}>
                      {profile.meetingsDone}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
                      Meetings
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: theme.text }]}>
                      {formatMoney(avg, symbol)}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
                      Avg
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={[styles.statValue, { color: theme.text }]}>
                      {profile.nextMeeting ? formatDayRelative(profile.nextMeeting) : '—'}
                    </Text>
                    <Text style={[styles.statLabel, { color: theme.textTertiary }]}>
                      Next
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Actions */}
            <View style={[styles.actions, { borderTopColor: theme.separator }]}>
              {clientName && !isTelegram ? (
                <ActionRow
                  icon="call-outline"
                  label="Call"
                  color={theme.accent}
                  onPress={() => {
                    tapHaptic();
                    startClientCall(callingEnabled, callForwardTo, number, clientName);
                  }}
                />
              ) : null}
              {clientName ? (
                <ActionRow
                  icon="calendar-outline"
                  label="Book meeting"
                  color={theme.accent}
                  onPress={() => {
                    tapHaptic();
                    onClose();
                    onBook();
                  }}
                />
              ) : null}
              {clientName ? (
                <ActionRow
                  icon="person-circle-outline"
                  label="View full profile"
                  color={theme.text}
                  onPress={() => {
                    tapHaptic();
                    onClose();
                    router.push(`/client-detail?name=${encodeURIComponent(clientName)}`);
                  }}
                />
              ) : null}
              {!isTelegram ? (
                <ActionRow
                  icon={copied ? 'checkmark' : 'copy-outline'}
                  label={copied ? 'Copied' : 'Copy number'}
                  color={copied ? theme.success : theme.text}
                  onPress={copyNumber}
                />
              ) : null}
              {clientName && status === 'blocked' ? (
                <ActionRow
                  icon="lock-open-outline"
                  label="Unblock"
                  color={theme.success}
                  onPress={() => {
                    successHaptic();
                    setStatus(clientName, hasMeetings ? 'client' : 'lead');
                  }}
                />
              ) : null}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.actionRow,
        pressed && { backgroundColor: theme.surface },
      ]}
    >
      <Ionicons name={icon} size={19} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: SPACING.sm,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 },
  numberLine: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  section: { marginTop: SPACING.lg },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginBottom: SPACING.sm },
  chipRow: { flexDirection: 'row', gap: SPACING.sm },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  input: {
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: SPACING.sm,
  },
  notesInput: { minHeight: 84, textAlignVertical: 'top', marginBottom: 0 },
  saveBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  saveBtnLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: SPACING.sm },
  stat: { flex: 1 },
  statValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  actions: {
    marginTop: SPACING.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.xs,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.xs,
    borderRadius: RADIUS.sm,
  },
  actionLabel: { fontSize: 15, fontWeight: '500' },
});
