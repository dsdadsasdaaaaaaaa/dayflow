import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

/** Shown when messaging isn't configured: the two honest ways to text clients. */
export function SetupCard() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <GlassCard padding={0}>
      <View style={styles.head}>
        <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="chatbubble-outline" size={22} color={theme.accent} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Text clients right here</Text>
        <Text style={[styles.blurb, { color: theme.textSecondary }]}>
          Two ways to message from DayFlow — pick whichever fits.
        </Text>
      </View>

      <Pressable
        onPress={() => {
          tapHaptic();
          router.push('/settings');
        }}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.optionRow,
          { borderTopColor: theme.separator },
          pressed && { backgroundColor: theme.surface },
        ]}
      >
        <View style={[styles.optionIcon, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="call-outline" size={17} color={theme.accent} />
        </View>
        <View style={styles.optionText}>
          <Text style={[styles.optionTitle, { color: theme.text }]}>Connect a number</Text>
          <Text style={[styles.optionCaption, { color: theme.textSecondary }]}>
            A $1/mo number from Twilio, or port your own — set up in Settings → Messaging
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={theme.textTertiary} />
      </Pressable>

      <View style={[styles.optionRow, { borderTopColor: theme.separator }]}>
        <View style={[styles.optionIcon, { backgroundColor: theme.surface }]}>
          <Ionicons name="open-outline" size={17} color={theme.textSecondary} />
        </View>
        <View style={styles.optionText}>
          <Text style={[styles.optionTitle, { color: theme.text }]}>Keep using TextNow</Text>
          <Text style={[styles.optionCaption, { color: theme.textSecondary }]}>
            Add phone numbers to clients and DayFlow hands off to TextNow when you tap Message
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  blurb: { fontSize: 14, textAlign: 'center', lineHeight: 19 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md + 2,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 15, fontWeight: '600' },
  optionCaption: { fontSize: 13, lineHeight: 18 },
});
