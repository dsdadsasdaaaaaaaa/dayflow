import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

interface CardProps {
  /** Section label rendered above the content (sentence case). */
  label?: string;
  /** Small element rendered at the right end of the label row. */
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Plain stats section card with a sentence-case label. */
export function StatsCard({ label, right, children, style }: CardProps) {
  const theme = useTheme();
  return (
    <View style={style}>
      <GlassCard padding={SPACING.lg}>
        {label ? (
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
            {right}
          </View>
        ) : null}
        {children}
      </GlassCard>
    </View>
  );
}

/** Friendly inline zero-data state used inside stats cards. */
export function InlineEmpty({
  icon = 'sparkles-outline',
  text,
}: {
  icon?: string;
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyCircle, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name={icon as never} size={18} color={theme.accent} />
      </View>
      <Text style={[styles.emptyText, { color: theme.textTertiary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  label: { fontSize: 12, fontWeight: '600' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  emptyCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 260,
  },
});
