import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMediaDataUri } from '../../lib/mediaCache';
import { tdResolvePhoto } from '../../lib/tdlib';
import { RADIUS, useTheme } from '../../theme';

/**
 * Structural message shape — SmsMessage (lib/smsApi) and TgMessage (lib/tdlib)
 * both satisfy it, so the same bubble renders SMS/MMS and Telegram traffic.
 */
export interface BubbleMessage {
  direction: 'in' | 'out';
  body: string;
  /** Delivery status (SMS channel only). */
  status?: string;
  /** MMS attachments — Twilio media URLs (SMS channel). */
  mediaUrls?: string[];
  /** Telegram photo attachment — TDLib file id. */
  photoFileId?: number;
}

interface Props {
  msg: BubbleMessage;
  /** Show the delivery status line under the bubble (last outbound only). */
  showStatus?: boolean;
  /** Open the full-screen viewer for a tapped photo (URL or local file uri). */
  onPressPhoto?: (url: string) => void;
}

const FAILED = new Set(['failed', 'undelivered', 'canceled']);

function statusLabel(status: string): string {
  if (FAILED.has(status)) return 'Not delivered';
  if (status === 'queued' || status === 'accepted' || status === 'sending') return 'Sending…';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** One chat bubble: outbound = solid accent right, inbound = flat surface left. */
export function MessageBubble({ msg, showStatus = false, onPressPhoto }: Props) {
  const theme = useTheme();
  const out = msg.direction === 'out';
  const mediaUrls = msg.mediaUrls ?? [];
  const hasBody = msg.body.trim().length > 0;
  const hasAttachment = mediaUrls.length > 0 || msg.photoFileId != null;

  return (
    <View style={[styles.wrap, out ? styles.wrapOut : styles.wrapIn]}>
      {mediaUrls.map((url) => (
        <MediaPhoto key={url} url={url} onPress={onPressPhoto} />
      ))}
      {msg.photoFileId != null ? (
        <TelegramPhoto fileId={msg.photoFileId} onPress={onPressPhoto} />
      ) : null}
      {hasBody || !hasAttachment ? (
        <View
          style={[
            styles.bubble,
            out
              ? { backgroundColor: theme.accent, borderBottomRightRadius: 6 }
              : { backgroundColor: theme.surface, borderBottomLeftRadius: 6 },
          ]}
        >
          <Text style={[styles.body, { color: out ? '#FFFFFF' : theme.text }]}>{msg.body}</Text>
        </View>
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
      ) : null}
    </View>
  );
}

/** One photo attachment: cached image, tap to view full screen. */
function MediaPhoto({ url, onPress }: { url: string; onPress?: (url: string) => void }) {
  const theme = useTheme();
  const { dataUri, loading } = useMediaDataUri(url);

  return (
    <Pressable
      onPress={() => onPress?.(url)}
      disabled={!onPress || !dataUri}
      accessibilityRole="button"
      accessibilityLabel="Photo attachment"
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
 * One Telegram photo attachment: downloads via TDLib (loading placeholder
 * while it resolves), then renders the local file. Tap to view full screen.
 */
function TelegramPhoto({
  fileId,
  onPress,
}: {
  fileId: number;
  onPress?: (uri: string) => void;
}) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(tgPhotoUriCache.get(fileId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = tgPhotoUriCache.get(fileId);
    if (cached) {
      setUri(cached);
      setFailed(false);
      return;
    }
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
  }, [fileId]);

  return (
    <Pressable
      onPress={() => {
        if (uri) onPress?.(uri);
      }}
      disabled={!onPress || !uri}
      accessibilityRole="button"
      accessibilityLabel="Photo attachment"
      style={({ pressed }) => [
        styles.photoFrame,
        { backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.photo} resizeMode="cover" />
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
  status: { fontSize: 11, fontWeight: '500', marginTop: 3, marginHorizontal: 4 },
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
