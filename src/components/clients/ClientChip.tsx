import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  label: string;
  icon?: string;
  /** Text/icon color. Defaults to textSecondary. */
  tint?: string;
  /** Fill behind the label. Defaults to theme.surface. */
  fill?: string;
  /** Solid fill color with white text (e.g. theme.success for money). */
  solid?: string;
}

/** Small rounded info chip used across the client book. */
export function ClientChip({ label, icon, tint, fill, solid }: Props) {
  const theme = useTheme();
  const fg = solid ? '#FFFFFF' : tint ?? theme.textSecondary;

  return (
    <View
      style={[
        styles.chip,
        solid
          ? { backgroundColor: solid }
          : {
              backgroundColor: fill ?? theme.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
            },
      ]}
    >
      {icon ? <Ionicons name={icon as never} size={12} color={fg} /> : null}
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 220,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
