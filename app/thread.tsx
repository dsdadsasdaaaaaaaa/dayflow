import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { ClientPanel, LEAD_AMBER } from '../src/components/messages/ClientPanel';
import { Composer } from '../src/components/messages/Composer';
import { ErrorBanner } from '../src/components/messages/ErrorBanner';
import { LinkClientRow } from '../src/components/messages/LinkClientRow';
import { MessageBubble } from '../src/components/messages/MessageBubble';
import { PhotoViewer } from '../src/components/messages/PhotoViewer';
import { QuickReplies, type PhotoReply } from '../src/components/messages/QuickReplies';
import { formatPhoneDisplay } from '../src/components/messages/format';
import {
  addDays,
  daysBetween,
  formatDayLong,
  formatDayRelative,
  formatMinutes,
  fromDayKey,
  toDayKey,
  todayKey,
} from '../src/lib/dates';
import { tapHaptic } from '../src/lib/haptics';
import {
  knownClients,
  meetingOccurrences,
  type MeetingOccurrence,
} from '../src/lib/meetings';
import type { SmsMessage } from '../src/lib/smsApi';
import { normalizePhone } from '../src/lib/smsCredentials';
import {
  clientMetaKey,
  clientNameForPhone,
  effectiveStatus,
  useClientMeta,
} from '../src/store/clientMeta';
import { threadMessages, useMessages } from '../src/store/messages';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { SPACING, useTheme } from '../src/theme';
import type { DayKey } from '../src/types';

type Row =
  | { type: 'day'; key: string; day: DayKey }
  | { type: 'message'; key: string; msg: SmsMessage; showStatus: boolean };

/** Optional media send path — lands with the media agent's store update. */
type MediaSend = (to: string, body: string, mediaUrls: string[]) => Promise<boolean>;

/** "Today" / "Tomorrow" / "Friday" / "Wednesday, July 16" + optional time. */
function confirmationDraft(occ: MeetingOccurrence): string {
  const diff = daysBetween(todayKey(), occ.dateKey);
  const dayLabel =
    diff <= 1
      ? formatDayRelative(occ.dateKey)
      : diff < 7
        ? fromDayKey(occ.dateKey).toLocaleDateString('en-US', { weekday: 'long' })
        : formatDayLong(occ.dateKey);
  const time =
    !occ.task.allDay && occ.task.startMinutes != null
      ? ` at ${formatMinutes(occ.task.startMinutes)}`
      : '';
  return `Confirmed — ${dayLabel}${time}. See you then!`;
}

/** One conversation: bubbles, day separators, CRM panel, pinned composer. */
export default function ThreadScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ number?: string }>();
  const number = normalizePhone(typeof params.number === 'string' ? params.number : '');

  const messages = useMessages((s) => s.messages);
  const sendingTo = useMessages((s) => s.sendingTo);
  const lastError = useMessages((s) => s.lastError);
  const lastSyncAt = useMessages((s) => s.lastSyncAt);
  const send = useMessages((s) => s.send);
  const markRead = useMessages((s) => s.markRead);
  const sendWithMedia = useMessages(
    (s) => (s as unknown as { sendWithMedia?: MediaSend }).sendWithMedia
  );
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);
  const settings = useSettings((s) => s.settings);

  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  // Read state: clear the unread count on focus and again after each sync.
  useFocusEffect(
    useCallback(() => {
      if (number) markRead(number);
    }, [number, markRead])
  );
  useEffect(() => {
    if (number && lastSyncAt != null) markRead(number);
  }, [number, lastSyncAt, markRead]);

  const known = useMemo(() => knownClients(tasks), [tasks]);
  const clientName = useMemo(
    () => clientNameForPhone(meta, number, known),
    [meta, number, known]
  );
  const hasMeetings =
    clientName != null && known.some((n) => clientMetaKey(n) === clientMetaKey(clientName));
  const status = clientName ? effectiveStatus(meta, clientName, hasMeetings) : 'lead';

  /** Earliest uncompleted booking for the linked client in the next 30 days. */
  const nextBooking = useMemo(() => {
    if (!clientName) return null;
    const key = clientName.trim().toLowerCase();
    const today = todayKey();
    const days = Array.from({ length: 31 }, (_, i) => addDays(today, i));
    const upcoming = meetingOccurrences(tasks, days)
      .filter((o) => !o.completed && o.client.trim().toLowerCase() === key)
      .sort((a, b) =>
        a.dateKey !== b.dateKey
          ? a.dateKey < b.dateKey
            ? -1
            : 1
          : (a.task.startMinutes ?? 0) - (b.task.startMinutes ?? 0)
      );
    return upcoming[0] ?? null;
  }, [clientName, tasks]);

  const bookingId = nextBooking ? `${nextBooking.task.id}|${nextBooking.dateKey}` : null;

  // ── Book-then-confirm: snapshot the next booking before opening the editor;
  // on return, a NEW booking pre-fills a confirmation draft (never auto-sent).
  const bookingSnapshot = useRef<{ prev: string | null } | null>(null);

  const openBooking = useCallback(() => {
    if (!clientName) return;
    bookingSnapshot.current = { prev: bookingId };
    router.push(`/task-editor?client=${encodeURIComponent(clientName)}`);
  }, [clientName, bookingId, router]);

  useFocusEffect(
    useCallback(() => {
      const snap = bookingSnapshot.current;
      if (!snap) return;
      bookingSnapshot.current = null;
      if (!nextBooking || bookingId === snap.prev) return;
      const confirmation = confirmationDraft(nextBooking);
      setDraft((d) => (d.trim() ? d : confirmation));
    }, [bookingId, nextBooking])
  );

  const msgs = useMemo(() => threadMessages(messages, number), [messages, number]);

  /** Chronological rows with day separators, reversed for the inverted list. */
  const rows = useMemo<Row[]>(() => {
    let lastOutSid: string | null = null;
    for (const m of msgs) if (m.direction === 'out') lastOutSid = m.sid;
    const out: Row[] = [];
    let prevDay: DayKey | null = null;
    for (const m of msgs) {
      const day = toDayKey(new Date(m.sentAt));
      if (day !== prevDay) {
        out.push({ type: 'day', key: `day-${day}`, day });
        prevDay = day;
      }
      out.push({
        type: 'message',
        key: m.sid,
        msg: m,
        // Only surface real problems — queued/sending settle on their own
        // (the store re-checks the status after a send).
        showStatus:
          m.sid === lastOutSid && (m.status === 'failed' || m.status === 'undelivered'),
      });
    }
    return out.reverse();
  }, [msgs]);

  const handleSend = useCallback(
    async (body: string) => {
      // The store merges the sent message optimistically and settles its
      // status itself — no full history re-sync needed here.
      return send(number, body);
    },
    [send, number]
  );

  // ── Quick replies ──────────────────────────────────────────────────────────
  /** Photo quick-replies — surfaced by the media layer when available. */
  const photoReplies =
    (settings as unknown as { photoTemplates?: PhotoReply[] }).photoTemplates ?? [];

  const insertTemplate = useCallback((text: string) => {
    setDraft((d) => (d.trim() ? `${d} ${text}` : text));
    setQuickOpen(false);
  }, []);

  const sendPhotoReply = useCallback(
    async (photo: PhotoReply) => {
      setQuickOpen(false);
      if (sendWithMedia) {
        await sendWithMedia(number, '', [photo.url]);
      } else {
        Alert.alert('Almost there', 'Photo sending arrives with the next app update.');
      }
    },
    [sendWithMedia, number]
  );

  // ── Attach a photo (OTA-safe: expo-image-picker is NOT in the current
  // binary — import it only inside the handler, with a friendly fallback). ──
  const handleAttach = useCallback(async () => {
    try {
      const picker = await import('expo-image-picker');
      const perm = await picker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos', 'Allow photo access in Settings to attach pictures.');
        return;
      }
      const res = await picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      const uri = res.canceled ? null : res.assets?.[0]?.uri ?? null;
      if (!uri) return;
      if (sendWithMedia) {
        await sendWithMedia(number, '', [uri]);
      } else {
        Alert.alert('Almost there', 'Photo sending arrives with the next app update.');
      }
    } catch {
      Alert.alert('Photos', 'Photo picking arrives with the next app update.');
    }
  }, [sendWithMedia, number]);

  const subtitle = clientName
    ? nextBooking
      ? `Next: ${formatDayRelative(nextBooking.dateKey)}${
          !nextBooking.task.allDay && nextBooking.task.startMinutes != null
            ? ` · ${formatMinutes(nextBooking.task.startMinutes)}`
            : ''
        }`
      : formatPhoneDisplay(number)
    : null;

  const showError = lastError != null && lastError !== dismissedError;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: theme.background }]}
    >
      {/* Header — tap anywhere on the title to open the CRM panel */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: theme.separator },
        ]}
      >
        <BackButton />
        <Pressable
          onPress={() => {
            tapHaptic();
            setPanelOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Contact details for ${clientName ?? formatPhoneDisplay(number)}`}
          style={styles.titleCol}
        >
          <View style={styles.titleRow}>
            {status !== 'client' ? (
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      status === 'blocked' ? theme.textTertiary : LEAD_AMBER,
                  },
                ]}
              />
            ) : null}
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
              {clientName ?? formatPhoneDisplay(number)}
            </Text>
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
        {clientName ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              openBooking();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Book a meeting with ${clientName}`}
            style={[styles.calendarBtn, { backgroundColor: theme.surface }]}
          >
            <Ionicons name="calendar-outline" size={18} color={theme.accent} />
          </Pressable>
        ) : null}
      </View>

      {/* Conversation */}
      {rows.length > 0 ? (
        <FlatList
          data={rows}
          inverted
          keyExtractor={(r) => r.key}
          renderItem={({ item }) =>
            item.type === 'day' ? (
              <Text style={[styles.daySep, { color: theme.textTertiary }]}>
                {formatDayRelative(item.day)}
              </Text>
            ) : (
              <MessageBubble
                msg={item.msg}
                showStatus={item.showStatus}
                onPressPhoto={setViewerUrl}
              />
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
            No messages yet — say hello.
          </Text>
        </View>
      )}

      {/* Footer: link row, inline error, quick replies, composer */}
      <View
        style={[
          styles.footer,
          {
            borderTopColor: theme.separator,
            paddingBottom: Math.max(insets.bottom, SPACING.sm) + 4,
          },
        ]}
      >
        {!clientName ? <LinkClientRow number={number} /> : null}
        {showError ? (
          <ErrorBanner message={lastError} onDismiss={() => setDismissedError(lastError)} />
        ) : null}
        {quickOpen ? (
          <QuickReplies
            templates={settings.messageTemplates}
            photos={photoReplies}
            onPickText={insertTemplate}
            onPickPhoto={sendPhotoReply}
          />
        ) : null}
        <Composer
          onSend={handleSend}
          sending={sendingTo === number}
          text={draft}
          onChangeText={setDraft}
          quickOpen={quickOpen}
          onToggleQuick={() => setQuickOpen((v) => !v)}
          onAttach={handleAttach}
        />
      </View>

      <ClientPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        number={number}
        clientName={clientName}
        onBook={openBooking}
      />
      <PhotoViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleCol: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 },
  subtitle: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  calendarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySep: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
  listContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.sm,
  },
});
