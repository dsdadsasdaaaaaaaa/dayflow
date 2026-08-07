import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { normalizePhone } from '../../lib/smsCredentials';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

export interface ClientPhoneRowHandle {
  focus: () => void;
}

interface Props {
  client: string;
}

const SAVE_DEBOUNCE_MS = 600;

/** "+15551234567" → "+1 (555) 123-4567"; other countries keep plain E.164. */
function formatPhoneDisplay(phone: string): string {
  const e164 = normalizePhone(phone);
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (us) return `+1 (${us[1]}) ${us[2]}-${us[3]}`;
  return e164;
}

/**
 * Inline-editable phone number for one client. Auto-saves (debounced) to the
 * clientMeta store while typing; the display snaps to a normalized, readable
 * format on blur. Links the client to their messenger thread.
 */
export const ClientPhoneRow = forwardRef<ClientPhoneRowHandle, Props>(
  function ClientPhoneRow({ client }, ref) {
    const theme = useTheme();
    const saved = useClientMeta((s) => s.meta[clientMetaKey(client)]?.phone ?? '');
    const setPhone = useClientMeta((s) => s.setPhone);

    const [text, setText] = useState(saved ? formatPhoneDisplay(saved) : '');
    const dirty = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latest = useRef(text);
    const inputRef = useRef<TextInput>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    // Adopt store changes (e.g. late rehydration) until the user has typed.
    useEffect(() => {
      if (!dirty.current) {
        const display = saved ? formatPhoneDisplay(saved) : '';
        setText(display);
        latest.current = display;
      }
    }, [saved]);

    // Flush any pending edit on unmount so the last keystrokes aren't lost.
    useEffect(
      () => () => {
        if (timer.current) {
          clearTimeout(timer.current);
          setPhone(client, latest.current);
        }
      },
      [client, setPhone]
    );

    const onChange = (t: string) => {
      dirty.current = true;
      latest.current = t;
      setText(t);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setPhone(client, t);
      }, SAVE_DEBOUNCE_MS);
    };

    const onBlur = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        setPhone(client, latest.current);
      }
      dirty.current = false;
      const display = latest.current.trim()
        ? formatPhoneDisplay(latest.current)
        : '';
      setText(display);
      latest.current = display;
    };

    return (
      <GlassCard padding={0}>
        <View style={styles.row}>
          <Ionicons name="call-outline" size={18} color={theme.textTertiary} />
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Add a phone number"
            placeholderTextColor={theme.textTertiary}
            keyboardType="phone-pad"
            autoCorrect={false}
            textContentType="telephoneNumber"
            style={[styles.input, { color: theme.text }]}
            accessibilityLabel={`Phone number for ${client}`}
          />
        </View>
      </GlassCard>
    );
  }
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});
