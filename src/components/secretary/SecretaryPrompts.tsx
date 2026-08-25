import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { RADIUS, SPACING, useTheme } from '../../theme';

/**
 * The four questions that teach what this thing is for. Each one exercises a
 * different tool: unanswered threads, rebook candidates, money, availability.
 */
export const SECRETARY_EXAMPLES = [
  'Who should I follow up with?',
  "Find someone who'd want tomorrow evening",
  'Who owes me money?',
  'When am I free Thursday?',
] as const;

interface Props {
  /** Tapping an example asks it straight away. */
  onPick: (prompt: string) => void;
  /** Disabled while a key is missing or a request is already running. */
  disabled?: boolean;
}

/** Empty state: one line of what it does, then the examples, tappable. */
export function SecretaryPrompts({ onPick, disabled = false }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name="sparkles" size={22} color={theme.accent} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>Ask about your week</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Your secretary reads your bookings, your free time, what is owed and which
        conversations have gone quiet — then answers in a sentence.
      </Text>

      <View style={styles.list}>
        {SECRETARY_EXAMPLES.map((prompt) => (
          <Pressable
            key={prompt}
            onPress={() => {
              if (disabled) return;
              tapHaptic();
              onPick(prompt);
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Ask: ${prompt}`}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={2}>
              {prompt}
            </Text>
            <Ionicons name="arrow-forward" size={15} color={theme.textTertiary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
  },
  list: { alignSelf: 'stretch', gap: SPACING.sm, marginTop: SPACING.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
});
