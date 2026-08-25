import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { SPACING, useTheme } from '../../theme';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  /** Fired with the trimmed question; the screen clears the input. */
  onSend: () => void;
  /** A request is in flight — the send button spins and refuses taps. */
  busy: boolean;
  /** No API key yet: the field stays visible but inert. */
  disabled?: boolean;
  placeholder?: string;
}

/** Pinned question composer: grow-able input + solid accent send circle. */
export function AskComposer({
  value,
  onChangeText,
  onSend,
  busy,
  disabled = false,
  placeholder = 'Ask your secretary',
}: Props) {
  const theme = useTheme();
  const canSend = value.trim().length > 0 && !busy && !disabled;

  return (
    <View style={styles.row}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        editable={!disabled}
        multiline
        style={[
          styles.input,
          {
            backgroundColor: theme.surface,
            color: theme.text,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
        accessibilityLabel="Question for your secretary"
      />
      <Pressable
        onPress={() => {
          if (!canSend) return;
          tapHaptic();
          onSend();
        }}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send question"
        style={({ pressed }) => [
          styles.sendBtn,
          {
            backgroundColor: theme.accent,
            opacity: canSend ? (pressed ? 0.85 : 1) : 0.4,
          },
        ]}
      >
        {busy ? (
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
