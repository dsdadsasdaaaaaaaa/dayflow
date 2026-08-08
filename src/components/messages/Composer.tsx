import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { SPACING, useTheme } from '../../theme';

interface Props {
  /** Sends the trimmed body; resolve true on success (input clears). */
  onSend: (body: string) => Promise<boolean>;
  sending: boolean;
  /** Controlled draft (optional — uncontrolled with internal state otherwise). */
  text?: string;
  onChangeText?: (text: string) => void;
  /** Renders the ⚡ quick-replies toggle when provided. */
  onToggleQuick?: () => void;
  quickOpen?: boolean;
  /** Renders the paperclip attach button when provided. */
  onAttach?: () => void;
}

/** Pinned message composer: grow-able input + solid accent send circle. */
export function Composer({
  onSend,
  sending,
  text,
  onChangeText,
  onToggleQuick,
  quickOpen = false,
  onAttach,
}: Props) {
  const theme = useTheme();
  const [inner, setInner] = useState('');
  const value = text ?? inner;
  const setValue = onChangeText ?? setInner;
  const canSend = value.trim().length > 0 && !sending;

  const handleSend = async () => {
    const body = value.trim();
    if (!body || sending) return;
    tapHaptic();
    const ok = await onSend(body);
    if (ok) {
      setValue('');
      successHaptic();
    } else {
      // Keep the draft so nothing is lost; the screen shows the error inline.
      warningHaptic();
    }
  };

  return (
    <View style={styles.row}>
      {onToggleQuick ? (
        <Pressable
          onPress={() => {
            tapHaptic();
            onToggleQuick();
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Quick replies"
          accessibilityState={{ expanded: quickOpen }}
          style={[
            styles.sideBtn,
            { backgroundColor: quickOpen ? theme.accentSoft : theme.surface },
          ]}
        >
          <Ionicons
            name={quickOpen ? 'flash' : 'flash-outline'}
            size={17}
            color={quickOpen ? theme.accent : theme.textSecondary}
          />
        </Pressable>
      ) : null}
      {onAttach ? (
        <Pressable
          onPress={() => {
            tapHaptic();
            onAttach();
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Attach a photo"
          style={[styles.sideBtn, { backgroundColor: theme.surface }]}
        >
          <Ionicons name="attach-outline" size={19} color={theme.textSecondary} />
        </Pressable>
      ) : null}
      <TextInput
        value={value}
        onChangeText={setValue}
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
  sideBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
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
