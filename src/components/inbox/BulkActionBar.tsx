import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RADIUS, SPACING, useTheme } from '../../theme';

interface Props {
  count: number;
  onCompleteAll: () => void;
  onScheduleAll: () => void;
  onDeleteAll: () => void;
}

/**
 * Bottom action bar shown while bulk-selecting inbox tasks. Plain card pinned
 * above the tab bar: selection count + complete / schedule / delete actions.
 */
export function BulkActionBar({ count, onCompleteAll, onScheduleAll, onDeleteAll }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const disabled = count === 0;

  const actions = [
    {
      key: 'complete',
      icon: 'checkmark-done' as const,
      label: 'Complete',
      color: theme.success,
      onPress: onCompleteAll,
    },
    {
      key: 'schedule',
      icon: 'calendar-outline' as const,
      label: 'Schedule',
      color: theme.accent,
      onPress: onScheduleAll,
    },
    {
      key: 'delete',
      icon: 'trash-outline' as const,
      label: 'Delete',
      color: theme.danger,
      onPress: onDeleteAll,
    },
  ];

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(150)}
      style={[
        styles.bar,
        {
          bottom: 90 + insets.bottom,
          backgroundColor: theme.card,
          borderColor: theme.border,
        },
      ]}
    >
      <Text style={[styles.count, { color: theme.text }]}>
        {count} selected
      </Text>
      <View style={styles.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.key}
            disabled={disabled}
            onPress={a.onPress}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`${a.label} selected tasks`}
            style={({ pressed }) => [
              styles.actionBtn,
              { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name={a.icon} size={20} color={a.color} />
            <Text style={[styles.actionLabel, { color: a.color }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 50,
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 2,
    width: 62,
    paddingVertical: 4,
  },
  actionLabel: { fontSize: 11, fontWeight: '600' },
});
