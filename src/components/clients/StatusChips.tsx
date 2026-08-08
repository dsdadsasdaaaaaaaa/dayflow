import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import type { ClientStatus } from '../../store/clientMeta';
import { SPACING, useTheme } from '../../theme';
import { STATUS_LABELS, STATUS_ORDER, statusColor } from './status';
import { StatusDot } from './StatusDot';

interface Props {
  value: ClientStatus;
  onChange: (status: ClientStatus) => void;
}

/**
 * The three-stage status row (Client · Lead · Blocked) on the client profile.
 * Selected chip is a solid fill in its status color with white text.
 */
export function StatusChips({ value, onChange }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {STATUS_ORDER.map((status) => {
        const selected = value === status;
        const color = statusColor(status, theme);
        return (
          <Pressable
            key={status}
            onPress={() => {
              if (selected) return;
              selectionHaptic();
              onChange(status);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Set status to ${STATUS_LABELS[status].toLowerCase()}`}
            style={({ pressed }) => [
              styles.chip,
              selected
                ? { backgroundColor: color, borderColor: color }
                : { backgroundColor: theme.card, borderColor: theme.border },
              pressed && !selected && { opacity: 0.8, transform: [{ scale: 0.97 }] },
            ]}
          >
            {!selected ? <StatusDot color={color} size={7} /> : null}
            <Text
              style={[
                styles.label,
                { color: selected ? '#FFFFFF' : theme.textSecondary },
                selected && styles.labelSelected,
              ]}
            >
              {STATUS_LABELS[status]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  chip: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  labelSelected: {
    fontWeight: '700',
  },
});
