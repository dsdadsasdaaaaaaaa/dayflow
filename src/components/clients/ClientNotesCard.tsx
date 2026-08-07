import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

interface Props {
  client: string;
}

const SAVE_DEBOUNCE_MS = 600;

/**
 * Free-form notes about one client, auto-saved (debounced) to the
 * clientMeta store as the user types.
 */
export function ClientNotesCard({ client }: Props) {
  const theme = useTheme();
  const saved = useClientMeta((s) => s.meta[clientMetaKey(client)]?.notes ?? '');
  const setNotes = useClientMeta((s) => s.setNotes);

  const [text, setText] = useState(saved);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);

  // Adopt store changes (e.g. late rehydration) until the user has typed.
  useEffect(() => {
    if (!dirty.current) {
      setText(saved);
      latest.current = saved;
    }
  }, [saved]);

  // Flush any pending edit on unmount so the last keystrokes aren't lost.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        setNotes(client, latest.current);
      }
    },
    [client, setNotes]
  );

  const onChange = (t: string) => {
    dirty.current = true;
    latest.current = t;
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setNotes(client, t);
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <GlassCard padding={4}>
      <TextInput
        value={text}
        onChangeText={onChange}
        multiline
        placeholder="Notes about this client — preferences, boundaries, reminders…"
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, { color: theme.text }]}
        accessibilityLabel={`Notes about ${client}`}
      />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 88,
    padding: 12,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
});
