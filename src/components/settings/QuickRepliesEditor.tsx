import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { useSettings } from '../../store/settings';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';

const COMMIT_DEBOUNCE_MS = 500;

/**
 * Settings → Messaging → "Quick replies": a collapsible plain editor for the
 * composer's text templates. Edits save in place (debounced); empty lines are
 * dropped on commit.
 */
export function QuickRepliesEditor() {
  const theme = useTheme();
  const templates = useSettings((s) => s.settings.messageTemplates);
  const update = useSettings((s) => s.update);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[]>(templates);
  const itemsRef = useRef(items);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt store changes (e.g. late rehydration) until the user has edited.
  useEffect(() => {
    if (!dirty.current) {
      setItems(templates);
      itemsRef.current = templates;
    }
  }, [templates]);

  // Flush a pending edit on unmount so the last keystrokes aren't lost.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        update({
          messageTemplates: itemsRef.current.map((t) => t.trim()).filter(Boolean),
        });
      }
    },
    [update]
  );

  const setAndSchedule = (next: string[], immediate = false) => {
    dirty.current = true;
    setItems(next);
    itemsRef.current = next;
    if (timer.current) clearTimeout(timer.current);
    const commit = () => {
      timer.current = null;
      update({ messageTemplates: next.map((t) => t.trim()).filter(Boolean) });
    };
    if (immediate) commit();
    else timer.current = setTimeout(commit, COMMIT_DEBOUNCE_MS);
  };

  const editItem = (index: number, text: string) => {
    const next = [...items];
    next[index] = text;
    setAndSchedule(next);
  };

  const deleteItem = (index: number) => {
    tapHaptic();
    setAndSchedule(items.filter((_, i) => i !== index), true);
  };

  const addItem = () => {
    tapHaptic();
    setOpen(true);
    const next = [...items, ''];
    // No commit needed yet — an empty line is dropped anyway.
    dirty.current = true;
    setItems(next);
    itemsRef.current = next;
  };

  const savedCount = templates.length;

  return (
    <View>
      <SettingsRow
        icon="chatbox-ellipses"
        tint={taskColor('indigo').solid}
        label="Quick replies"
        sublabel={savedCount === 0 ? 'None yet' : `${savedCount} saved`}
        onPress={() => setOpen((v) => !v)}
        right={
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={theme.textTertiary}
          />
        }
      />
      {open ? (
        <View style={styles.editor}>
          {items.map((text, i) => (
            <View key={i} style={styles.itemRow}>
              <TextInput
                value={text}
                onChangeText={(t) => editItem(i, t)}
                placeholder="Type a reply…"
                placeholderTextColor={theme.textTertiary}
                multiline
                style={[
                  styles.input,
                  { backgroundColor: theme.surface, color: theme.text },
                ]}
                accessibilityLabel={`Quick reply ${i + 1}`}
              />
              <Pressable
                onPress={() => deleteItem(i)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Delete quick reply ${i + 1}`}
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="close-circle" size={20} color={theme.textTertiary} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={addItem}
            accessibilityRole="button"
            accessibilityLabel="Add reply"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="add-circle-outline" size={17} color={theme.accent} />
            <Text style={[styles.addLabel, { color: theme.accent }]}>Add reply</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    minHeight: 38,
  },
  deleteBtn: {
    padding: 2,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
