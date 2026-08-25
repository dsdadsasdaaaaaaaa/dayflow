import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatTurn } from '../../lib/gemini';
import { successHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { ClientActions } from './ClientActions';

/** How long the "Copied" confirmation caption stays visible. */
const COPIED_MS = 1500;

interface Props {
  turn: ChatTurn;
}

/**
 * One turn of the secretary conversation: the question as a solid accent
 * bubble on the right, the answer as a flat surface bubble on the left —
 * the same visual language as MessageBubble, without any of its message
 * plumbing (no delivery status, no attachments, no channel differences).
 *
 * Long-press copies the text, so an answer can go straight into a client
 * message. The text shown here is the LOCAL one, with real names.
 */
export function SecretaryBubble({ turn }: Props) {
  const theme = useTheme();
  const mine = turn.role === 'user';

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  const copy = () => {
    void Clipboard.setStringAsync(turn.text);
    successHaptic();
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <View style={[styles.wrap, mine ? styles.wrapOut : styles.wrapIn]}>
      <Pressable
        onLongPress={copy}
        delayLongPress={350}
        accessibilityRole="text"
        accessibilityLabel={`${mine ? 'You' : 'Secretary'}: ${turn.text}`}
        accessibilityHint="Long press to copy"
        style={({ pressed }) => [
          styles.bubble,
          mine
            ? { backgroundColor: theme.accent, borderBottomRightRadius: 6 }
            : { backgroundColor: theme.surface, borderBottomLeftRadius: 6 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={[styles.body, { color: mine ? '#FFFFFF' : theme.text }]}>
          {turn.text}
        </Text>
      </Pressable>
      {copied ? (
        <Text style={[styles.caption, { color: theme.textTertiary }]}>Copied</Text>
      ) : null}
      {!mine && turn.mentions && turn.mentions.length > 0 ? (
        <ClientActions names={turn.mentions} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 2, maxWidth: '84%' },
  wrapOut: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapIn: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 11, fontWeight: '500', marginTop: 3, marginHorizontal: 4 },
});
