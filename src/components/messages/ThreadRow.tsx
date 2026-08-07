import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Thread } from '../../store/messages';
import { SPACING, useTheme } from '../../theme';
import { ClientAvatar } from '../clients/ClientAvatar';
import { formatPhoneDisplay, formatWhenShort } from './format';

interface Props {
  thread: Thread;
  /** Linked client display name, when the number matched one. */
  clientName: string | null;
  onPress: () => void;
}

/** One conversation row: avatar, name/number, last-message preview, time, unread pill. */
export function ThreadRow({ thread, clientName, onPress }: Props) {
  const theme = useTheme();
  const { lastMessage, unread } = thread;
  const preview =
    (lastMessage.direction === 'out' ? 'You: ' : '') + lastMessage.body.replace(/\s+/g, ' ').trim();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${clientName ?? formatPhoneDisplay(thread.counterparty)}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surface }]}
    >
      {clientName ? (
        <ClientAvatar name={clientName} size={46} />
      ) : (
        <View style={[styles.neutralAvatar, { backgroundColor: theme.surface }]}>
          <Ionicons name="person-outline" size={20} color={theme.textTertiary} />
        </View>
      )}
      <View style={styles.textCol}>
        <Text
          style={[styles.title, { color: theme.text, fontWeight: unread > 0 ? '700' : '600' }]}
          numberOfLines={1}
        >
          {clientName ?? formatPhoneDisplay(thread.counterparty)}
        </Text>
        <Text
          style={[styles.preview, { color: unread > 0 ? theme.textSecondary : theme.textTertiary }]}
          numberOfLines={1}
        >
          {preview || '(no text)'}
        </Text>
      </View>
      <View style={styles.metaCol}>
        <Text style={[styles.time, { color: theme.textTertiary }]}>
          {formatWhenShort(lastMessage.sentAt)}
        </Text>
        {unread > 0 ? (
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
  title: { fontSize: 16, letterSpacing: -0.2 },
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
