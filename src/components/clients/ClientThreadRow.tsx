import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClientStatus } from '../../store/clientMeta';
import { SPACING, useTheme } from '../../theme';
import { formatPhoneDisplay, formatWhenShort } from '../messages/format';
import { ClientAvatar } from './ClientAvatar';
import { STATUS_LABELS, statusColor } from './status';
import { StatusDot } from './StatusDot';

/**
 * Structural thread shape — both SMS Threads (store/messages) and Telegram
 * threads (store/telegramAccount) satisfy it, so one row serves both channels.
 */
export interface ThreadRowData {
  counterparty: string;
  unread: number;
  lastMessage: {
    body: string;
    direction: 'in' | 'out';
    sentAt: number;
    /** MMS attachments (SMS channel). */
    mediaUrls?: string[];
    /** Telegram photo attachment (TDLib file id). */
    photoFileId?: number;
  };
}

interface Props {
  thread: ThreadRowData;
  /** Linked client display name, when the counterparty matched one. */
  clientName: string | null;
  /** CRM stage for the linked contact; null = unknown counterparty (plain row). */
  status: ClientStatus | null;
  /** Which messenger the thread lives on (default 'sms'). */
  channel?: 'sms' | 'telegram';
  /** Display title for unlinked non-phone threads (e.g. Telegram chat title). */
  fallbackName?: string;
  /** Blocked-section styling: dimmed, no unread pill. */
  dimmed?: boolean;
  onPress: () => void;
}

/**
 * Conversation row with CRM awareness: avatar, name/number with a status
 * badge (small dot + label for leads and blocked; plain for clients and
 * unknown numbers), last-message preview, time, unread pill.
 */
export function ClientThreadRow({
  thread,
  clientName,
  status,
  channel = 'sms',
  fallbackName,
  dimmed,
  onPress,
}: Props) {
  const theme = useTheme();
  const { lastMessage, unread } = thread;
  const body = lastMessage.body.replace(/\s+/g, ' ').trim();
  // Photo-only messages preview as a photo, not '(no text)' / a bare 'You: '.
  const hasPhoto = (lastMessage.mediaUrls?.length ?? 0) > 0 || lastMessage.photoFileId != null;
  const content = body || (hasPhoto ? '📷 Photo' : '');
  const preview = content
    ? (lastMessage.direction === 'out' ? 'You: ' : '') + content
    : '';
  const displayName =
    clientName ?? fallbackName ?? formatPhoneDisplay(thread.counterparty);

  const showBadge = status === 'lead' || status === 'blocked';
  const badgeColor = status ? statusColor(status, theme) : theme.textTertiary;
  const showUnread = unread > 0 && status !== 'blocked';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${displayName}${
        showBadge && status ? `, ${STATUS_LABELS[status].toLowerCase()}` : ''
      }${channel === 'telegram' ? ', on Telegram' : ''}`}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.surface },
        dimmed && { opacity: 0.55 },
      ]}
    >
      {clientName ? (
        <ClientAvatar name={clientName} size={46} />
      ) : (
        <View style={[styles.neutralAvatar, { backgroundColor: theme.surface }]}>
          <Ionicons name="person-outline" size={20} color={theme.textTertiary} />
        </View>
      )}
      <View style={styles.textCol}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.title,
              { color: theme.text, fontWeight: showUnread ? '700' : '600' },
            ]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {showBadge && status ? (
            <View style={styles.badge}>
              <StatusDot color={badgeColor} size={7} />
              <Text style={[styles.badgeLabel, { color: badgeColor }]}>
                {STATUS_LABELS[status]}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          style={[
            styles.preview,
            { color: showUnread ? theme.textSecondary : theme.textTertiary },
          ]}
          numberOfLines={1}
        >
          {preview || '(no text)'}
        </Text>
      </View>
      <View style={styles.metaCol}>
        <View style={styles.timeRow}>
          {channel === 'telegram' ? (
            <Ionicons name="paper-plane-outline" size={12} color={theme.textTertiary} />
          ) : null}
          <Text style={[styles.time, { color: theme.textTertiary }]}>
            {formatWhenShort(lastMessage.sentAt)}
          </Text>
        </View>
        {showUnread ? (
          <View style={[styles.unreadPill, { backgroundColor: theme.accent }]}>
            <Text style={styles.unreadLabel}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  neutralAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  title: { fontSize: 16, letterSpacing: -0.2, flexShrink: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  preview: { fontSize: 14 },
  metaCol: { alignItems: 'flex-end', gap: 5 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { fontSize: 12, fontWeight: '500' },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
