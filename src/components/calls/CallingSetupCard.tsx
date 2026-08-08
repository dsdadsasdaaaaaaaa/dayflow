import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

/** Shown when calling isn't enabled yet: points the user at Settings. */
export function CallingSetupCard() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        router.push('/settings');
      }}
      accessibilityRole="button"
      accessibilityLabel="Open Settings to turn on calling"
      style={({ pressed }) => [pressed && { opacity: 0.9 }]}
    >
      <GlassCard padding={0}>
        <View style={styles.head}>
          <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="call-outline" size={22} color={theme.accent} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>Your calls live here</Text>
          <Text style={[styles.blurb, { color: theme.textSecondary }]}>
            Turn on calling in Settings → Calling and your work number's call log and
            voicemails show up on this screen.
          </Text>
        </View>
        <View style={[styles.linkRow, { borderTopColor: theme.separator }]}>
          <Text style={[styles.linkLabel, { color: theme.accent }]}>Open Settings</Text>
          <Ionicons name="chevron-forward" size={15} color={theme.accent} />
        </View>
      </GlassCard>
    </Pressable>
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.md,
  },
  linkLabel: { fontSize: 15, fontWeight: '600' },
});
