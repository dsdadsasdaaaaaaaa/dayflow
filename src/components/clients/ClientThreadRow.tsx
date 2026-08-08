import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClientStatus } from '../../store/clientMeta';
import type { Thread } from '../../store/messages';
import { SPACING, useTheme } from '../../theme';
import { formatPhoneDisplay, formatWhenShort } from '../messages/format';
import { ClientAvatar } from './ClientAvatar';
import { STATUS_LABELS, statusColor } from './status';
import { StatusDot } from './StatusDot';

interface Props {
  thread: Thread;
  /** Linked client display name, when the number matched one. */
  clientName: string | null;
  /** CRM stage for the linked contact; null = unknown number (plain row). */
  status: ClientStatus | null;
  /** Blocked-section styling: dimmed, no unread pill. */
  dimmed?: boolean;
  onPress: () => void;
}

/**
 * Conversation row with CRM awareness: avatar, name/number with a status
 * badge (small dot + label for leads and blocked; plain for clients and
 * unknown numbers), last-message preview, time, unread pill.
 */
export function ClientThreadRow({ thread, clientName, status, dimmed, onPress }: Props) {
  const theme = useTheme();
  const { lastMessage, unread } = thread;
  const preview =
    (lastMessage.direction === 'out' ? 'You: ' : '') +
    lastMessage.body.replace(/\s+/g, ' ').trim();

  const showBadge = status === 'lead' || status === 'blocked';
  const badgeColor = status ? statusColor(status, theme) : theme.textTertiary;
  const showUnread = unread > 0 && status !== 'blocked';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${clientName ?? formatPhoneDisplay(thread.counterparty)}${
        showBadge && status ? `, ${STATUS_LABELS[status].toLowerCase()}` : ''
      }`}
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
            {clientName ?? formatPhoneDisplay(thread.counterparty)}
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
        <Text style={[styles.time, { color: theme.textTertiary }]}>
          {formatWhenShort(lastMessage.sentAt)}
        </Text>
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
