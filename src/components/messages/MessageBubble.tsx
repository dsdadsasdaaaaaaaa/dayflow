import { StyleSheet, Text, View } from 'react-native';
import type { SmsMessage } from '../../lib/smsApi';
import { useTheme } from '../../theme';

interface Props {
  msg: SmsMessage;
  /** Show the delivery status line under the bubble (last outbound only). */
  showStatus?: boolean;
}

const FAILED = new Set(['failed', 'undelivered', 'canceled']);

function statusLabel(status: string): string {
  if (FAILED.has(status)) return 'Not delivered';
  if (status === 'queued' || status === 'accepted' || status === 'sending') return 'Sending…';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** One chat bubble: outbound = solid accent right, inbound = flat surface left. */
export function MessageBubble({ msg, showStatus = false }: Props) {
  const theme = useTheme();
  const out = msg.direction === 'out';

  return (
    <View style={[styles.wrap, out ? styles.wrapOut : styles.wrapIn]}>
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
      {showStatus ? (
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
});
