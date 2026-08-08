import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDayShort, isToday, toDayKey } from '../../lib/dates';
import { useMediaDataUri } from '../../lib/mediaCache';
import { successHaptic, tapHaptic } from '../../lib/haptics';
import { tdResolvePhoto } from '../../lib/tdlib';
import { RADIUS, useTheme } from '../../theme';
import { formatClockTime } from './format';

/**
 * Structural message shape — SmsMessage (lib/smsApi) and TgMessage (lib/tdlib)
 * both satisfy it, so the same bubble renders SMS/MMS and Telegram traffic.
 */
export interface BubbleMessage {
  direction: 'in' | 'out';
  body: string;
  /** Epoch ms — powers the tap-to-reveal timestamp. */
  sentAt: number;
  /** Delivery status (SMS channel only). */
  status?: string;
  /** MMS attachments — Twilio media URLs (SMS channel). */
  mediaUrls?: string[];
  /** Telegram photo attachment — TDLib file id. */
  photoFileId?: number;
  /** Telegram voice note — TDLib file id + duration. */
  voiceFileId?: number;
  voiceDurationSec?: number;
  /** Telegram: TDLib reported the send failed after queuing. */
  failed?: boolean;
}

interface Props {
  msg: BubbleMessage;
  /** Show the delivery status line under the bubble (last outbound only). */
  showStatus?: boolean;
  /**
   * Telegram sent-state tick under outgoing bubbles: true = still sending
   * (clock), false = confirmed (double check). Omit to render no tick (SMS
   * uses the status line instead).
   */
  pending?: boolean;
  /** Open the full-screen viewer for a tapped photo (URL or local file uri). */
  onPressPhoto?: (url: string) => void;
}

const FAILED = new Set(['failed', 'undelivered', 'canceled']);

function statusLabel(status: string): string {
  if (FAILED.has(status)) return 'Not delivered';
  if (status === 'queued' || status === 'accepted' || status === 'sending') return 'Sending…';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** How long the "Copied" confirmation caption stays visible. */
const COPIED_MS = 1500;

/**
 * One chat bubble: outbound = solid accent right, inbound = flat surface left.
 *
 * Interactions (both channels — SMS and Telegram share this component):
 * - TEXT bubbles: tap toggles the exact timestamp caption; long-press copies
 *   the text (haptic + brief "Copied" caption).
 * - PHOTO attachments keep tap = open the full-screen viewer, so their
 *   secondary actions move to LONG-PRESS: it toggles the timestamp and, when
 *   the message has a caption, copies it too. One consistent rule: tap is the
 *   primary action, long-press the secondary.
 */
export function MessageBubble({ msg, showStatus = false, pending, onPressPhoto }: Props) {
  const theme = useTheme();
  const out = msg.direction === 'out';
  const mediaUrls = msg.mediaUrls ?? [];
  const hasBody = msg.body.trim().length > 0;
  const hasAttachment =
    mediaUrls.length > 0 || msg.photoFileId != null || msg.voiceFileId != null;

  const [showTime, setShowTime] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  const toggleTime = () => {
    tapHaptic();
    setShowTime((v) => !v);
  };

  const copyBody = () => {
    if (!hasBody) return;
    void Clipboard.setStringAsync(msg.body);
    successHaptic();
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  /** Photo long-press: timestamp + copy the caption when there is one. */
  const photoLongPress = () => {
    setShowTime((v) => !v);
    if (hasBody) copyBody();
    else tapHaptic();
  };

  const sentDay = toDayKey(new Date(msg.sentAt));
  const timeLabel = isToday(sentDay)
    ? formatClockTime(msg.sentAt)
    : `${formatDayShort(sentDay)} · ${formatClockTime(msg.sentAt)}`;

  return (
    <View style={[styles.wrap, out ? styles.wrapOut : styles.wrapIn]}>
      {mediaUrls.map((url) => (
        <MediaPhoto key={url} url={url} onPress={onPressPhoto} onLongPress={photoLongPress} />
      ))}
      {msg.photoFileId != null ? (
        <TelegramPhoto
          fileId={msg.photoFileId}
          onPress={onPressPhoto}
          onLongPress={photoLongPress}
        />
      ) : null}
      {msg.voiceFileId != null ? (
        <TelegramVoice fileId={msg.voiceFileId} durationSec={msg.voiceDurationSec ?? 0} out={out} />
      ) : null}
      {hasBody || !hasAttachment ? (
        <Pressable
          onPress={toggleTime}
          onLongPress={hasBody ? copyBody : undefined}
          accessibilityRole="button"
          accessibilityLabel={`${out ? 'Sent' : 'Received'} message: ${msg.body}`}
          accessibilityHint="Shows the time sent. Long press to copy."
          style={[
            styles.bubble,
            out
              ? { backgroundColor: theme.accent, borderBottomRightRadius: 6 }
              : { backgroundColor: theme.surface, borderBottomLeftRadius: 6 },
          ]}
        >
          <Text style={[styles.body, { color: out ? '#FFFFFF' : theme.text }]}>{msg.body}</Text>
        </Pressable>
      ) : null}
      {showTime || copied ? (
        <Text
          style={[
            styles.caption,
            { color: copied ? theme.success : theme.textTertiary },
          ]}
          accessibilityLiveRegion="polite"
        >
          {copied ? 'Copied' : timeLabel}
        </Text>
      ) : null}
      {showStatus && msg.status ? (
        <Text
          style={[
            styles.status,
            { color: FAILED.has(msg.status) ? theme.danger : theme.textTertiary },
          ]}
        >
          {statusLabel(msg.status)}
        </Text>
      ) : out && msg.failed ? (
        // Telegram send that failed after queuing — same styling as the SMS
        // "Not delivered" line, shown on every failed bubble.
        <Text style={[styles.status, { color: theme.danger }]}>Not delivered</Text>
      ) : out && pending != null ? (
        <Ionicons
          name={pending ? 'time-outline' : 'checkmark-done'}
          size={12}
          color={theme.textTertiary}
          style={styles.tick}
          accessibilityLabel={pending ? 'Sending' : 'Sent'}
        />
      ) : null}
    </View>
  );
}

/** One photo attachment: cached image, tap to view full screen. */
function MediaPhoto({
  url,
  onPress,
  onLongPress,
}: {
  url: string;
  onPress?: (url: string) => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const { dataUri, loading } = useMediaDataUri(url);

  return (
    <Pressable
      onPress={() => onPress?.(url)}
      onLongPress={onLongPress}
      disabled={!onPress || !dataUri}
      accessibilityRole="button"
      accessibilityLabel="Photo attachment"
      accessibilityHint="Opens the photo. Long press for the time sent."
      style={({ pressed }) => [
        styles.photoFrame,
        { backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {dataUri ? (
        <Image source={{ uri: dataUri }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={styles.photoPlaceholder}>
          {loading ? (
            <ActivityIndicator size="small" color={theme.textTertiary} />
          ) : (
            <Ionicons name="image-outline" size={22} color={theme.textTertiary} />
          )}
        </View>
      )}
    </Pressable>
  );
}

/** Resolved Telegram photo uris by TDLib file id — instant on re-render. */
const tgPhotoUriCache = new Map<number, string>();

/**
 * Does a local file uri still exist? TDLib's storage optimizer may delete
 * rarely-used downloads mid-session, leaving the cache pointing at nothing.
 * Returns true when unverifiable (web / FS unavailable) — trust the cache.
 */
function localFileExists(uri: string): boolean {
  try {
    // Static require keeps this synchronous; expo-file-system is in the binary.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    return new File(uri).exists;
  } catch {
    return true;
  }
}

/**
 * One Telegram photo attachment: downloads via TDLib (loading placeholder
 * while it resolves), then renders the local file. Tap to view full screen.
 * Cached paths are stat'd before use and re-resolved when the file is gone.
 */
function TelegramPhoto({
  fileId,
  onPress,
  onLongPress,
}: {
  fileId: number;
  onPress?: (uri: string) => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retriedRef = useRef(false);

  useEffect(() => {
    const cached = tgPhotoUriCache.get(fileId);
    if (cached && localFileExists(cached)) {
      setUri(cached);
      setFailed(false);
      return;
    }
    // Evicted by TDLib's storage optimizer (or never resolved) — re-download.
    if (cached) tgPhotoUriCache.delete(fileId);
    let alive = true;
    setUri(null);
    setFailed(false);
    void tdResolvePhoto(fileId).then((path) => {
      if (!alive) return;
      if (path) {
        const local = path.startsWith('file://') ? path : `file://${path}`;
        tgPhotoUriCache.set(fileId, local);
        setUri(local);
      } else {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [fileId, attempt]);

  return (
    <Pressable
      onPress={() => {
        if (uri) onPress?.(uri);
      }}
      onLongPress={onLongPress}
      disabled={!onPress || !uri}
      accessibilityRole="button"
      accessibilityLabel="Photo attachment"
      accessibilityHint="Opens the photo. Long press for the time sent."
      style={({ pressed }) => [
        styles.photoFrame,
        { backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.photo}
          resizeMode="cover"
          onError={() => {
            // Stale/corrupt file — invalidate and re-resolve once.
            tgPhotoUriCache.delete(fileId);
            if (retriedRef.current) {
              setUri(null);
              setFailed(true);
              return;
            }
            retriedRef.current = true;
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <View style={styles.photoPlaceholder}>
          {failed ? (
            <Ionicons name="image-outline" size={22} color={theme.textTertiary} />
          ) : (
            <ActivityIndicator size="small" color={theme.textTertiary} />
          )}
        </View>
      )}
    </Pressable>
  );
}

/** "0:42" for a voice note length. */
function formatVoiceDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * One Telegram voice note: play/pause + duration. Audio playback lazy-loads
 * expo-audio (absent on old binaries — falls back to a friendly caption).
 */
function TelegramVoice({
  fileId,
  durationSec,
  out,
}: {
  fileId: number;
  durationSec: number;
  out: boolean;
}) {
  const theme = useTheme();
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const playerRef = useRef<{ pause: () => void; remove: () => void } | null>(null);

  useEffect(
    () => () => {
      try {
        playerRef.current?.pause();
        playerRef.current?.remove();
      } catch {
        // Already torn down.
      }
    },
    []
  );

  const toggle = async () => {
    if (state === 'playing') {
      try {
        playerRef.current?.pause();
      } catch {
        // Player already gone.
      }
      setState('idle');
      return;
    }
    tapHaptic();
    setState('loading');
    try {
      const path = await tdResolvePhoto(fileId); // generic TDLib file download
      if (!path) throw new Error('download failed');
      const audio = await import('expo-audio');
      const player = audio.createAudioPlayer(
        path.startsWith('file://') ? path : `file://${path}`
      );
      playerRef.current = player;
      player.addListener('playbackStatusUpdate', (s: { didJustFinish?: boolean }) => {
        if (s.didJustFinish) setState('idle');
      });
      player.play();
      setState('playing');
    } catch {
      setState('idle');
      // Old binary without expo-audio, or the download failed — say so
      // instead of failing silently.
      Alert.alert(
        'Voice message',
        'Playback needs the newest app build — or the download failed. Try again on a connection.'
      );
    }
  };

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={state === 'playing' ? 'Pause voice message' : 'Play voice message'}
      style={[
        styles.voiceBubble,
        out
          ? { backgroundColor: theme.accent, borderBottomRightRadius: 6 }
          : { backgroundColor: theme.surface, borderBottomLeftRadius: 6 },
      ]}
    >
      {state === 'loading' ? (
        <ActivityIndicator size="small" color={out ? '#FFFFFF' : theme.accent} />
      ) : (
        <Ionicons
          name={state === 'playing' ? 'pause' : 'play'}
          size={16}
          color={out ? '#FFFFFF' : theme.accent}
        />
      )}
      <Ionicons
        name="mic-outline"
        size={14}
        color={out ? 'rgba(255,255,255,0.8)' : theme.textSecondary}
      />
      <Text style={[styles.voiceDuration, { color: out ? '#FFFFFF' : theme.text }]}>
        {formatVoiceDuration(durationSec)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 2, maxWidth: '78%' },
  wrapOut: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapIn: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  body: { fontSize: 16, lineHeight: 21 },
  caption: { fontSize: 11, fontWeight: '500', marginTop: 3, marginHorizontal: 4 },
  status: { fontSize: 11, fontWeight: '500', marginTop: 3, marginHorizontal: 4 },
  tick: { marginTop: 2, marginRight: 4 },
  voiceBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 110,
  },
  voiceDuration: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  photoFrame: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginVertical: 2,
  },
  photo: { width: 210, height: 210 },
  photoPlaceholder: {
    width: 210,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
