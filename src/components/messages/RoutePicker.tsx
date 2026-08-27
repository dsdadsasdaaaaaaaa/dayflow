import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { routeLabel, type ProviderId } from '../../lib/messaging';
import { RADIUS, SPACING, useTheme } from '../../theme';
import { formatPhoneDisplay } from './format';

interface Props {
  routes: ProviderId[];
  active: ProviderId;
  /** The number each route sends from, for showing what the client will see. */
  numbers: Partial<Record<ProviderId, string>>;
  onSelect: (route: ProviderId) => void;
}

/**
 * Which line this conversation sends on.
 *
 * Only rendered when both are connected — with one route there is no choice
 * to make and a picker would just be noise. Carrier filtering is decided per
 * recipient, so the useful unit is the conversation: move the people who
 * stopped receiving, leave everyone else on the number they already have.
 */
export function RoutePicker({ routes, active, numbers, onSelect }: Props) {
  const theme = useTheme();
  if (routes.length < 2) return null;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.lead, { color: theme.textTertiary }]}>Send from</Text>
      <View style={styles.row}>
        {routes.map((r) => {
          const on = r === active;
          const number = numbers[r];
          return (
            <Pressable
              key={r}
              onPress={() => {
                if (on) return;
                selectionHaptic();
                onSelect(r);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Send from ${routeLabel(r)}${
                number ? `, ${formatPhoneDisplay(number)}` : ''
              }`}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: on ? theme.accentSoft : 'transparent',
                  borderColor: on ? theme.accent : theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {on ? (
                <Ionicons name="checkmark" size={12} color={theme.accent} />
              ) : null}
              <Text
                style={[
                  styles.label,
                  { color: on ? theme.accent : theme.textSecondary },
                ]}
                numberOfLines={1}
              >
                {routeLabel(r)}
                {number ? ` · ${formatPhoneDisplay(number)}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xs,
    gap: 4,
  },
  lead: { fontSize: 11, fontWeight: '600' },
  row: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  label: { fontSize: 12, fontWeight: '600' },
});
