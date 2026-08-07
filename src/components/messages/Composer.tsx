import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { SPACING, useTheme } from '../../theme';

interface Props {
  /** Sends the trimmed body; resolve true on success (input clears). */
  onSend: (body: string) => Promise<boolean>;
  sending: boolean;
}

/** Pinned message composer: grow-able input + solid accent send circle. */
export function Composer({ onSend, sending }: Props) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !sending;

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    tapHaptic();
    const ok = await onSend(body);
    if (ok) {
      setText('');
      successHaptic();
    } else {
      // Keep the draft so nothing is lost; the screen shows the error inline.
      warningHaptic();
    }
  };

  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Text message"
        placeholderTextColor={theme.textTertiary}
        multiline
        style={[
          styles.input,
          { backgroundColor: theme.surface, color: theme.text },
        ]}
        accessibilityLabel="Message text"
      />
      <Pressable
        onPress={handleSend}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        style={({ pressed }) => [
          styles.sendBtn,
          {
            backgroundColor: theme.accent,
            opacity: canSend ? (pressed ? 0.85 : 1) : 0.4,
          },
        ]}
      >
        {sending ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 16,
    lineHeight: 20,
    maxHeight: 110,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
});
