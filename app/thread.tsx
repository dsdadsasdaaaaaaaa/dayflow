import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import {
  ClientPanel,
  LEAD_AMBER,
  startClientCall,
} from '../src/components/messages/ClientPanel';
import { Composer } from '../src/components/messages/Composer';
import { ErrorBanner } from '../src/components/messages/ErrorBanner';
import { LinkClientRow } from '../src/components/messages/LinkClientRow';
import { MessageBubble } from '../src/components/messages/MessageBubble';
import { PhotoViewer } from '../src/components/messages/PhotoViewer';
import {
  QuickReplies,
  buildDepositRequest,
  type PhotoReply,
  type QuickAction,
} from '../src/components/messages/QuickReplies';
import {
  ScheduleSendSheet,
  ScheduledBanner,
} from '../src/components/messages/ScheduleSendSheet';
import { ShareAvailability } from '../src/components/messages/ShareAvailability';
import { formatPhoneDisplay } from '../src/components/messages/format';
import {
  bookedClientKeys,
  buildFollowUpDraft,
  buildFollowUps,
  formatQuietShort,
  FOLLOW_UP_SNOOZE_MS,
  type FollowUp,
} from '../src/lib/followUps';
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
  lastMeetingFor,
  meetingOccurrences,
  type MeetingOccurrence,
} from '../src/lib/meetings';
import type { SmsMessage } from '../src/lib/smsApi';
import { normalizePhone } from '../src/lib/smsCredentials';
import type { TgMessage } from '../src/lib/tdlib';
import {
  clientMetaKey,
  clientNameForPhone,
  clientNameForTelegram,
  effectiveStatus,
  useClientMeta,
} from '../src/store/clientMeta';
import {
  threadMessages,
  threadOutbox,
  useMessages,
  type OutboxEntry,
} from '../src/store/messages';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { telegramChatTitle, useTelegram } from '../src/store/telegramAccount';
import { RADIUS, SPACING, useTheme } from '../src/theme';
import type { DayKey } from '../src/types';

/** A message from either channel — SMS/MMS (Twilio) or Telegram (TDLib). */
type ThreadMsg = SmsMessage | TgMessage;

/** Stable row key: Twilio SID or TgMessage id. */
function msgKey(m: ThreadMsg): string {
  return 'sid' in m ? m.sid : m.id;
}

type Row =
  | { type: 'day'; key: string; day: DayKey }
  | { type: 'message'; key: string; msg: ThreadMsg; showStatus: boolean }
  /** A failed send waiting in the retry outbox — pinned to the bottom. */
  | { type: 'outbox'; key: string; entry: OutboxEntry };

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
  return `Confirmed for ${dayLabel}${time}. See you then!`;
}

/**
 * Preset for the first text to someone you already know, from a NEWLY rotated
 * number. Framed as the deliberate practice it is: a rotating line is normal
 * for discreet work and protects both sides. Reads far better than an
 * apology, and it primes clients to expect the next rotation instead of being
 * surprised by it. Editable in the composer before sending.
 */
const NUMBER_CHANGE_NOTICE =
  "Hey, it's Drew! I rotate my number every so often, it keeps things " +
  'private for both of us. This is my current one, so save it and delete the ' +
  'old one. Same me, nothing else changes.';

/** One conversation: bubbles, day separators, CRM panel, pinned composer. */
export default function ThreadScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ number?: string; draft?: string }>();
  const rawNumber = typeof params.number === 'string' ? params.number : '';
  /** Telegram threads use 'tgc:<chatId>' counterparties beside SMS E.164 ids. */
  const isTelegram = rawNumber.startsWith('tgc:');
  const number = isTelegram ? rawNumber : normalizePhone(rawNumber);

  const messages = useMessages((s) => s.messages);
  const sendingTo = useMessages((s) => s.sendingTo);
  const smsLastError = useMessages((s) => s.lastError);
  const lastSyncAt = useMessages((s) => s.lastSyncAt);
  const send = useMessages((s) => s.send);
  const markRead = useMessages((s) => s.markRead);
  const sendPhoto = useMessages((s) => s.sendPhoto);
  const photoSending = useMessages((s) => s.photoSending);
  const hiddenSids = useMessages((s) => s.hiddenSids);
  const outbox = useMessages((s) => s.outbox);
  const hasMoreOlder = useMessages((s) => s.hasMoreOlder);
  const loadingOlder = useMessages((s) => s.loadingOlder);
  const loadOlder = useMessages((s) => s.loadOlder);
  const retryOutbox = useMessages((s) => s.retryOutbox);
  const discardOutbox = useMessages((s) => s.discardOutbox);
  const scheduleSend = useMessages((s) => s.scheduleSend);
  const currentNumber = useMessages((s) => s.currentNumber);
  const followUpSnoozedUntil = useMessages((s) => s.followUpSnoozedUntil);
  const followUpDismissed = useMessages((s) => s.followUpDismissed);
  const snoozeFollowUp = useMessages((s) => s.snoozeFollowUp);
  const dismissFollowUp = useMessages((s) => s.dismissFollowUp);
  const clearFollowUp = useMessages((s) => s.clearFollowUp);
  const tgMessages = useTelegram((s) => s.messages);
  const tgChats = useTelegram((s) => s.chats);
  const typingUntil = useTelegram((s) => s.typingUntil);
  /** Re-evaluated every 3s so a stale typing flag clears without an update. */
  const [typingNow, setTypingNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isTelegram) return;
    const id = setInterval(() => setTypingNow(Date.now()), 3000);
    return () => clearInterval(id);
  }, [isTelegram]);
  const tgSendingTo = useTelegram((s) => s.sendingTo);
  const tgPhotoSending = useTelegram((s) => s.photoSending);
  const tgLastError = useTelegram((s) => s.lastError);
  const tgSend = useTelegram((s) => s.send);
  const tgSendPhoto = useTelegram((s) => s.sendPhoto);
  const tgMarkRead = useTelegram((s) => s.markRead);
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);
  const settings = useSettings((s) => s.settings);

  const lastError = isTelegram ? tgLastError : smsLastError;

  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  // The follow-up bar is clock-derived ("Quiet for 3 days") — re-tick slowly.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Seed the composer from ?draft= (e.g. client-detail's "Request deposit").
  // Once only — never clobber what the user has typed since.
  const draftParam = typeof params.draft === 'string' ? params.draft : '';
  const draftSeeded = useRef(false);
  useEffect(() => {
    if (!draftParam || draftSeeded.current) return;
    draftSeeded.current = true;
    setDraft((d) => (d.trim() ? d : draftParam));
  }, [draftParam]);

  // Unsent drafts survive leaving the thread (like task drafts do): seed from
  // the persisted map once, then save what's typed (debounced + on unmount).
  const setThreadDraft = useMessages((s) => s.setThreadDraft);
  const storedDraftSeeded = useRef(false);
  useEffect(() => {
    if (storedDraftSeeded.current || !number) return;
    storedDraftSeeded.current = true;
    const stored = useMessages.getState().threadDrafts[number];
    if (stored) setDraft((d) => (d.trim() ? d : stored));
  }, [number]);
  // First message to a known client from a NEW number: preset the explainer
  // once. Only when this thread has history, none of it sent from the number
  // in use now, and nothing is already typed or saved.
  const noticeSeeded = useRef(false);
  useEffect(() => {
    if (noticeSeeded.current || isTelegram || !number) return;
    const state = useMessages.getState();
    if (state.previousNumbers.length === 0) return;
    const mine = state.currentNumber;
    if (!mine) return;
    const history = threadMessages(state.messages, number, state.hiddenSids);
    if (history.length === 0) return;
    const sentFromCurrent = history.some(
      (m) => m.direction === 'out' && m.ownNumber === mine
    );
    if (sentFromCurrent) return;
    noticeSeeded.current = true;
    setDraft((d) => (d.trim() ? d : NUMBER_CHANGE_NOTICE));
  }, [isTelegram, number, messages]);

  /**
   * Footnote for a message that used a number we have since rotated away
   * from. Inbound means the client still has an old number saved; outbound
   * means it predates the current one. Only labelled once we actually have a
   * current number to compare against, and never on Telegram.
   */
  const retiredLabelFor = useCallback(
    (m: ThreadMsg): string | undefined => {
      if (isTelegram || !currentNumber) return undefined;
      const own = 'ownNumber' in m ? m.ownNumber : undefined;
      if (!own || normalizePhone(own) === normalizePhone(currentNumber)) {
        return undefined;
      }
      return m.direction === 'in'
        ? `To your old ${formatPhoneDisplay(own)}`
        : `From your old ${formatPhoneDisplay(own)}`;
    },
    [isTelegram, currentNumber]
  );

  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    if (!number) return;
    const t = setTimeout(() => setThreadDraft(number, draft), 600);
    return () => clearTimeout(t);
  }, [number, draft, setThreadDraft]);
  useEffect(
    () => () => {
      if (number) setThreadDraft(number, draftRef.current);
    },
    [number, setThreadDraft]
  );

  // Read state: clear the unread count on focus and again after each sync.
  const focusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (number) {
        if (isTelegram) tgMarkRead(number);
        else markRead(number);
      }
      return () => {
        focusedRef.current = false;
      };
    }, [number, isTelegram, markRead, tgMarkRead])
  );
  useEffect(() => {
    // Focus-gated like the Telegram twin below — a thread BURIED in the nav
    // stack must not mark its counterparty read on every global sync bump.
    if (!isTelegram && number && lastSyncAt != null && focusedRef.current) markRead(number);
  }, [isTelegram, number, lastSyncAt, markRead]);
  // Telegram arrivals while the thread is FOCUSED get read receipts
  // immediately — a thread merely buried in the nav stack must not mark.
  useEffect(() => {
    if (isTelegram && number && focusedRef.current) tgMarkRead(number);
  }, [isTelegram, number, tgMessages, tgMarkRead]);

  // SMS has no live socket — while THIS conversation is open on screen, poll
  // for their next message every few seconds so it lands before the user has
  // finished typing a reply. One cheap single-counterparty query per tick;
  // stops the moment the screen blurs.
  const pollThread = useMessages((s) => s.pollThread);
  const backfillThreadMedia = useMessages((s) => s.backfillThreadMedia);
  useFocusEffect(
    useCallback(() => {
      if (isTelegram || !number) return;
      void pollThread(number);
      // One bounded pass for any photos whose URLs never resolved (over the
      // per-sync cap or a transient failure) — placeholders become photos.
      void backfillThreadMedia(number);
      const id = setInterval(() => void pollThread(number), 2500);
      return () => clearInterval(id);
    }, [isTelegram, number, pollThread, backfillThreadMedia])
  );

  const known = useMemo(() => knownClients(tasks), [tasks]);
  /** Clients with a booking still ahead — no follow-up nudge for those. */
  const bookedClients = useMemo(() => bookedClientKeys(tasks), [tasks]);
  const clientName = useMemo(
    () =>
      isTelegram
        ? clientNameForTelegram(meta, number, known)
        : clientNameForPhone(meta, number, known),
    [isTelegram, meta, number, known]
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

  const msgs = useMemo<ThreadMsg[]>(() => {
    if (isTelegram) {
      return Object.values(tgMessages)
        .filter((m) => m.counterparty === number)
        .sort((a, b) => a.sentAt - b.sentAt);
    }
    // hiddenSids excludes failed sends that live in the retry outbox — they
    // render as "Not delivered" bubbles at the bottom instead.
    return threadMessages(messages, number, hiddenSids);
  }, [isTelegram, tgMessages, messages, number, hiddenSids]);

  /** Failed sends for this thread (SMS only), oldest first. */
  const failedSends = useMemo<OutboxEntry[]>(
    () => (isTelegram ? [] : threadOutbox(outbox, number)),
    [isTelegram, outbox, number]
  );

  /** Newest message in the thread, whichever channel it arrived on. */
  const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;

  // They replied → any snooze/dismiss on this thread is stale. Covers
  // Telegram too, whose store has no SMS-style merge hook.
  useEffect(() => {
    if (!number || lastMsg == null || lastMsg.direction !== 'in') return;
    clearFollowUp(number);
  }, [number, lastMsg, clearFollowUp]);

  /** This thread, when it is waiting on a reply (snooze/dismiss respected). */
  const followUp = useMemo<FollowUp | null>(() => {
    if (!number || lastMsg == null) return null;
    const [first] = buildFollowUps({
      threads: [
        {
          counterparty: number,
          channel: isTelegram ? 'telegram' : 'sms',
          lastMessage: { direction: lastMsg.direction, sentAt: lastMsg.sentAt },
        },
      ],
      tasks,
      meta,
      snoozedUntil: followUpSnoozedUntil,
      dismissed: followUpDismissed,
      now: nowMs,
      clientNames: known,
      bookedClients,
    });
    return first ?? null;
  }, [
    number,
    lastMsg,
    isTelegram,
    tasks,
    meta,
    followUpSnoozedUntil,
    followUpDismissed,
    nowMs,
    known,
    bookedClients,
  ]);

  /** Chronological rows with day separators, reversed for the inverted list. */
  const rows = useMemo<Row[]>(() => {
    let lastOutKey: string | null = null;
    for (const m of msgs) if (m.direction === 'out') lastOutKey = msgKey(m);
    const out: Row[] = [];
    let prevDay: DayKey | null = null;
    for (const m of msgs) {
      const day = toDayKey(new Date(m.sentAt));
      if (day !== prevDay) {
        out.push({ type: 'day', key: `day-${day}`, day });
        prevDay = day;
      }
      const key = msgKey(m);
      const status = 'status' in m ? m.status : null;
      out.push({
        type: 'message',
        key,
        msg: m,
        // Only surface real problems — queued/sending settle on their own
        // (the SMS store re-checks the status after a send; Telegram has no
        // delivery-status line at all).
        showStatus:
          key === lastOutKey && (status === 'failed' || status === 'undelivered'),
      });
    }
    // Failed sends pin to the bottom of the thread, awaiting retry/discard.
    for (const entry of failedSends) {
      out.push({ type: 'outbox', key: `outbox-${entry.localId}`, entry });
    }
    return out.reverse();
  }, [msgs, failedSends]);

  /** Older-history pill: show while more may exist (unknown counts as yes). */
  const showLoadOlder = !isTelegram && msgs.length > 0 && hasMoreOlder[number] !== false;

  const handleLoadOlder = useCallback(() => {
    tapHaptic();
    void loadOlder(number);
  }, [loadOlder, number]);

  const handleRetry = useCallback(
    (localId: string) => {
      tapHaptic();
      void retryOutbox(localId);
    },
    [retryOutbox]
  );

  const handleDiscard = useCallback(
    (localId: string) => {
      tapHaptic();
      discardOutbox(localId);
    },
    [discardOutbox]
  );

  const handleSend = useCallback(
    async (body: string) => {
      // Each store merges the sent message optimistically and settles its
      // status itself — no full history re-sync needed here.
      const ok = isTelegram ? await tgSend(number, body) : await send(number, body);
      if (ok) {
        // Clear the persisted draft NOW — backing out before the composer's
        // own clear lands must not resurrect sent text as a draft.
        draftRef.current = '';
        setThreadDraft(number, '');
        // A fresh outbound starts its own quiet clock, so an old snooze or
        // "not needed" must not suppress the next silence forever.
        clearFollowUp(number);
      }
      return ok;
    },
    [isTelegram, tgSend, send, number, setThreadDraft, clearFollowUp]
  );

  // ── Scheduled sends (SMS only — Twilio holds the message, phone can be off)
  const openScheduleSheet = useCallback(() => {
    if (isTelegram) return;
    if (!draft.trim()) {
      Alert.alert('Nothing to schedule', 'Type the message first, then schedule it.');
      return;
    }
    tapHaptic();
    setQuickOpen(false);
    setScheduleOpen(true);
  }, [isTelegram, draft]);

  const handleSchedule = useCallback(
    async (sendAtMs: number) => {
      const body = draft.trim();
      if (!body) return false;
      const ok = await scheduleSend(number, body, sendAtMs);
      if (ok) {
        setDraft('');
        setScheduleOpen(false);
      } else {
        Alert.alert(
          'Could not schedule',
          useMessages.getState().lastError ?? 'Something went wrong.'
        );
      }
      return ok;
    },
    [draft, number, scheduleSend]
  );

  // ── Quick replies ──────────────────────────────────────────────────────────
  const photoReplies = settings.photoQuickReplies;

  const insertTemplate = useCallback((text: string) => {
    setDraft((d) => (d.trim() ? `${d} ${text}` : text));
    setQuickOpen(false);
  }, []);

  // ── Composer power tools (append to the draft, never auto-send) ────────────
  const insertDepositRequest = useCallback(() => {
    const fallbackRate = clientName ? lastMeetingFor(tasks, clientName)?.rate ?? 0 : 0;
    insertTemplate(
      buildDepositRequest({
        occurrence: nextBooking
          ? { task: nextBooking.task, dateKey: nextBooking.dateKey }
          : null,
        fallbackRate,
        symbol: settings.currencySymbol,
      })
    );
  }, [clientName, tasks, nextBooking, settings.currencySymbol, insertTemplate]);

  // ── Follow-up nudge (never auto-sent: it only ever seeds the composer) ────
  const handleFollowUpDraft = useCallback(() => {
    if (!followUp) return;
    tapHaptic();
    insertTemplate(buildFollowUpDraft(followUp.clientName ?? clientName));
  }, [followUp, clientName, insertTemplate]);

  const handleFollowUpSnooze = useCallback(() => {
    if (!number) return;
    tapHaptic();
    snoozeFollowUp(number, Date.now() + FOLLOW_UP_SNOOZE_MS);
  }, [number, snoozeFollowUp]);

  const handleFollowUpDismiss = useCallback(() => {
    if (!number) return;
    tapHaptic();
    dismissFollowUp(number);
  }, [number, dismissFollowUp]);

  const quickActions = useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [
      {
        icon: 'calendar-clear-outline',
        label: 'Share availability',
        onPress: () => {
          setQuickOpen(false);
          setShareOpen(true);
        },
      },
      { icon: 'wallet-outline', label: 'Request deposit', onPress: insertDepositRequest },
    ];
    // Scheduled sends are Twilio-native — SMS threads only.
    if (!isTelegram) {
      actions.push({
        icon: 'time-outline',
        label: 'Schedule message',
        onPress: openScheduleSheet,
      });
    }
    return actions;
  }, [insertDepositRequest, isTelegram, openScheduleSheet]);

  const sendPhotoReply = useCallback(
    async (photo: PhotoReply) => {
      setQuickOpen(false);
      // Library photos are already hosted — MMS the URL directly.
      await send(number, '', [photo.url]);
    },
    [send, number]
  );

  // ── Attach a photo (OTA-safe: expo-image-picker is NOT in the current
  // binary — import it only inside the handler, with a friendly fallback). ──
  const handleAttach = useCallback(async () => {
    let uri: string | null = null;
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
      uri = res.canceled ? null : res.assets?.[0]?.uri ?? null;
    } catch {
      Alert.alert('Photos', 'Photo picking arrives with the next app update.');
      return;
    }
    if (!uri) return;
    if (isTelegram) {
      // Telegram sends the local file directly — no hosting delay.
      await tgSendPhoto(number, uri);
      return;
    }
    // Hosts the photo on the user's Twilio account (~30-60s), then sends;
    // failures surface via the store's lastError banner.
    await sendPhoto(number, uri);
  }, [isTelegram, tgSendPhoto, sendPhoto, number]);

  /** Header title: linked client, else chat title (Telegram) / number (SMS). */
  const displayTitle =
    clientName ??
    (isTelegram ? telegramChatTitle({ chats: tgChats }, number) : formatPhoneDisplay(number));

  // Live "typing…" beats every other subtitle while it's fresh.
  const typingActive =
    isTelegram && (typingUntil[number.slice(4)] ?? 0) > typingNow;
  const subtitle = typingActive
    ? 'typing…'
    : clientName && nextBooking
      ? `Next: ${formatDayRelative(nextBooking.dateKey)}${
          !nextBooking.task.allDay && nextBooking.task.startMinutes != null
            ? ` · ${formatMinutes(nextBooking.task.startMinutes)}`
            : ''
        }`
      : isTelegram
        ? 'Telegram'
        : clientName
          ? formatPhoneDisplay(number)
          : null;

  const composerSending = isTelegram
    ? tgSendingTo === number || tgPhotoSending
    : sendingTo === number || photoSending != null;

  const photoProgress = isTelegram
    ? tgPhotoSending
      ? 'Sending photo…'
      : null
    : photoSending
      ? photoSending === 'uploading'
        ? 'Hosting photo… ~30-60s'
        : 'Sending photo…'
      : null;

  // One viewer for both channels — PhotoViewer handles hosted URLs and
  // local/data uris alike (zoom + share included).
  const openPhoto = useCallback((uri: string) => {
    setViewerUrl(uri);
  }, []);

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
          accessibilityLabel={`Contact details for ${displayTitle}`}
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
              {displayTitle}
            </Text>
            {/* Small chevron so the contact panel is discoverable. */}
            <Ionicons name="chevron-down" size={12} color={theme.textTertiary} />
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
        {!isTelegram ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              startClientCall(
                settings.callingEnabled,
                settings.callForwardTo,
                number,
                clientName
              );
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Call ${displayTitle}`}
            style={[styles.calendarBtn, { backgroundColor: theme.surface }]}
          >
            <Ionicons name="call-outline" size={18} color={theme.accent} />
          </Pressable>
        ) : null}
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
            ) : item.type === 'outbox' ? (
              <FailedBubble
                entry={item.entry}
                onRetry={() => handleRetry(item.entry.localId)}
                onDiscard={() => handleDiscard(item.entry.localId)}
              />
            ) : (
              <MessageBubble
                msg={item.msg}
                showStatus={item.showStatus}
                pending={
                  isTelegram && item.msg.direction === 'out' && !('sid' in item.msg)
                    ? item.msg.pending === true || item.msg.id.includes(':local-')
                    : undefined
                }
                onPressPhoto={openPhoto}
                retiredNumberLabel={retiredLabelFor(item.msg)}
              />
            )
          }
          // Inverted list: the footer renders at the TOP — exactly where the
          // user lands when they scroll back for older history.
          ListFooterComponent={
            showLoadOlder ? (
              <Pressable
                onPress={handleLoadOlder}
                disabled={loadingOlder != null}
                accessibilityRole="button"
                accessibilityLabel="Load earlier messages"
                style={({ pressed }) => [
                  styles.loadOlderPill,
                  {
                    backgroundColor: theme.surface,
                    opacity: loadingOlder != null ? 0.6 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                {loadingOlder === number ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <Text style={[styles.loadOlderText, { color: theme.textSecondary }]}>
                    Load earlier messages
                  </Text>
                )}
              </Pressable>
            ) : null
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
        {/* Gone quiet: a nudge the user sends by hand, or waves off. */}
        {followUp ? (
          <View style={[styles.followUpBar, { backgroundColor: theme.surface }]}>
            <View style={styles.followUpHeader}>
              <Ionicons name="time-outline" size={14} color={LEAD_AMBER} />
              <Text style={[styles.followUpTitle, { color: LEAD_AMBER }]} numberOfLines={1}>
                Quiet for {formatQuietShort(followUp.quietMs)}
              </Text>
            </View>
            <View style={styles.followUpActions}>
              <Pressable
                onPress={handleFollowUpDraft}
                accessibilityRole="button"
                accessibilityLabel={`Draft a follow up to ${displayTitle}`}
                style={({ pressed }) => [
                  styles.followUpPrimary,
                  { backgroundColor: LEAD_AMBER },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.followUpPrimaryLabel}>Follow up</Text>
              </Pressable>
              <Pressable
                onPress={handleFollowUpSnooze}
                accessibilityRole="button"
                accessibilityLabel="Snooze this follow up for 3 days"
                style={({ pressed }) => [styles.followUpGhost, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.followUpGhostLabel, { color: theme.textSecondary }]}>
                  Snooze 3 days
                </Text>
              </Pressable>
              <Pressable
                onPress={handleFollowUpDismiss}
                accessibilityRole="button"
                accessibilityLabel="No follow up needed for this conversation"
                style={({ pressed }) => [styles.followUpGhost, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.followUpGhostLabel, { color: theme.textTertiary }]}>
                  Not needed
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {/* Pending scheduled sends for this thread (renders nothing if none). */}
        {!isTelegram ? <ScheduledBanner counterparty={number} /> : null}
        {!clientName ? <LinkClientRow counterparty={number} /> : null}
        {showError ? (
          <ErrorBanner message={lastError} onDismiss={() => setDismissedError(lastError)} />
        ) : null}
        {photoProgress ? (
          <Text style={[styles.photoProgress, { color: theme.textSecondary }]}>
            {photoProgress}
          </Text>
        ) : null}
        {quickOpen ? (
          <QuickReplies
            templates={settings.messageTemplates}
            // Photo quick-replies are Twilio-hosted URLs — SMS/MMS only.
            photos={isTelegram ? [] : photoReplies}
            actions={quickActions}
            onPickText={insertTemplate}
            onPickPhoto={sendPhotoReply}
          />
        ) : null}
        <Composer
          onSend={handleSend}
          sending={composerSending}
          text={draft}
          onChangeText={setDraft}
          quickOpen={quickOpen}
          onToggleQuick={() => setQuickOpen((v) => !v)}
          onAttach={handleAttach}
          // SMS failures land in the retry outbox, so the draft can clear;
          // Telegram keeps the draft (no outbox on that channel).
          clearOnFail={!isTelegram}
          // CROSS-FILE NEED (Composer.tsx is not owned by this change): the
          // send button should fire an optional `onLongPressSend` prop from
          // its Pressable's onLongPress. Passed via spread so long-press-to-
          // schedule lights up the moment Composer supports it; until then
          // the ⚡ quick action "Schedule message" opens the same sheet.
          {...(!isTelegram ? { onLongPressSend: openScheduleSheet } : {})}
        />
      </View>

      <ClientPanel
        visible={panelOpen}
        onClose={() => setPanelOpen(false)}
        number={number}
        clientName={clientName}
        onBook={openBooking}
      />
      <ShareAvailability
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        onInsert={insertTemplate}
      />
      {!isTelegram ? (
        <ScheduleSendSheet
          visible={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          body={draft.trim()}
          onSchedule={handleSchedule}
        />
      ) : null}
      <PhotoViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </KeyboardAvoidingView>
  );
}

/**
 * A failed send from the retry outbox: dimmed outbound-style bubble pinned to
 * the bottom of the thread. Tap retries, the ✕ (or long-press) discards.
 */
function FailedBubble({
  entry,
  onRetry,
  onDiscard,
}: {
  entry: OutboxEntry;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  const label = entry.body.trim().length > 0 ? entry.body : 'Photo message';

  const confirmDiscard = () => {
    Alert.alert('Discard message?', 'The unsent message will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onDiscard },
    ]);
  };

  return (
    <View style={styles.failedWrap}>
      <View style={styles.failedRow}>
        <Pressable
          onPress={confirmDiscard}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Discard unsent message"
          style={[styles.failedDiscard, { backgroundColor: theme.surface }]}
        >
          <Ionicons name="close" size={14} color={theme.textTertiary} />
        </Pressable>
        <Pressable
          onPress={onRetry}
          onLongPress={confirmDiscard}
          accessibilityRole="button"
          accessibilityLabel={`Not delivered: ${label}. Tap to retry.`}
          style={({ pressed }) => [
            styles.failedBubble,
            { backgroundColor: theme.accent, opacity: pressed ? 0.45 : 0.55 },
          ]}
        >
          <Text style={styles.failedBody}>{label}</Text>
        </Pressable>
      </View>
      <Text style={[styles.failedCaption, { color: theme.danger }]}>
        Not delivered · Tap to retry
      </Text>
      {entry.reason ? (
        // The WHY — carrier filtering, STOP list, etc. Without this, retrying
        // an unfixable message looks like an app bug.
        <Text style={[styles.failedReason, { color: theme.textSecondary }]}>
          {entry.reason}
        </Text>
      ) : null}
    </View>
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
  loadOlderPill: {
    alignSelf: 'center',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginVertical: SPACING.sm,
    minWidth: 150,
    alignItems: 'center',
  },
  loadOlderText: { fontSize: 12, fontWeight: '600' },
  failedWrap: { marginVertical: 2, maxWidth: '78%', alignSelf: 'flex-end', alignItems: 'flex-end' },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failedDiscard: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedBubble: {
    borderRadius: 18,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexShrink: 1,
  },
  failedBody: { fontSize: 16, lineHeight: 21, color: '#FFFFFF' },
  failedCaption: { fontSize: 11, fontWeight: '500', marginTop: 3, marginHorizontal: 4 },
  failedReason: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
    marginHorizontal: 4,
    maxWidth: 260,
    textAlign: 'right',
  },
  followUpBar: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 7,
  },
  followUpHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followUpTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  followUpActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  followUpPrimary: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  followUpPrimaryLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  followUpGhost: { paddingHorizontal: 4, paddingVertical: 7 },
  followUpGhostLabel: { fontSize: 13, fontWeight: '600' },
  photoProgress: {
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.sm,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
