import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapHaptic } from '../../lib/haptics';
import { knownClients } from '../../lib/meetings';
import { normalizePhone } from '../../lib/smsCredentials';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { useTasks } from '../../store/tasks';
import { RADIUS, SPACING, useTheme } from '../../theme';
import { ClientAvatar } from '../clients/ClientAvatar';
import { formatPhoneDisplay } from './format';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with a normalized E.164 number to open its thread. */
  onStart: (number: string) => void;
}

/** Small bottom sheet: type a number or pick a client that has one saved. */
export function NewMessageSheet({ visible, onClose, onStart }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);
  const [input, setInput] = useState('');

  /** Clients with a saved phone number, most recent first. */
  const suggestions = useMemo(
    () =>
      knownClients(tasks)
        .map((name) => ({ name, phone: meta[clientMetaKey(name)]?.phone ?? '' }))
        .filter((c) => c.phone),
    [tasks, meta]
  );

  const normalized = normalizePhone(input);
  const valid = normalized.length >= 8;

  const start = (number: string) => {
    tapHaptic();
    setInput('');
    onStart(number);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={styles.kav}
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              paddingBottom: Math.max(insets.bottom, SPACING.lg),
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>New message</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.closeBtn, { backgroundColor: theme.surface }]}
            >
              <Ionicons name="close" size={16} color={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={[styles.inputRow, { backgroundColor: theme.surface }]}>
            <Ionicons name="call-outline" size={17} color={theme.textTertiary} />
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Phone number"
              placeholderTextColor={theme.textTertiary}
              keyboardType="phone-pad"
              autoFocus
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Phone number"
            />
          </View>

          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Clients</Text>
              <ScrollView style={{ maxHeight: 236 }} keyboardShouldPersistTaps="handled">
                {suggestions.map((c, i) => (
                  <Pressable
                    key={c.name}
                    onPress={() => start(normalizePhone(c.phone))}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.clientRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.separator,
                      },
                      pressed && { backgroundColor: theme.surface },
                    ]}
                  >
                    <ClientAvatar name={c.name} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.clientName, { color: theme.text }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={[styles.clientPhone, { color: theme.textTertiary }]}>
                        {formatPhoneDisplay(normalizePhone(c.phone))}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Pressable
            onPress={() => valid && start(normalized)}
            disabled={!valid}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: theme.accent, opacity: valid ? (pressed ? 0.9 : 1) : 0.4 },
            ]}
          >
            <Text style={styles.ctaLabel}>Start conversation</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  suggestions: { marginTop: SPACING.md },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginBottom: SPACING.xs },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  clientName: { fontSize: 15, fontWeight: '600' },
  clientPhone: { fontSize: 12, marginTop: 1 },
  cta: {
    marginTop: SPACING.lg,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
});
