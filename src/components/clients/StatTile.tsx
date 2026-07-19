import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

interface Props {
  label: string;
  value: string;
  /** Value color override (money green, amber, …). Defaults to theme.text. */
  tint?: string;
  delay?: number;
}

/** One plain stat tile for the client-detail grid. */
export function StatTile({ label, value, tint }: Props) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <GlassCard padding={14} radius={RADIUS.lg}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
        <Text
          style={[styles.value, { color: tint ?? theme.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
});
