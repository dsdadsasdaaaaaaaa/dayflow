import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { useTheme, RADIUS } from '../../theme';

interface Props {
  top: number;
  height: number;
  startMinutes: number;
  onPress: (startMinutes: number) => void;
}

/** Ghost "+ Add" affordance rendered inside free gaps ≥ 30 minutes. */
export const GapButton = memo(function GapButton({ top, height, startMinutes, onPress }: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress(startMinutes);
      }}
      style={({ pressed }) => [
        styles.gap,
        { top, height, borderColor: theme.border, opacity: pressed ? 0.9 : 1 },
      ]}
      accessibilityLabel="Add task in this gap"
    >
      <View
        style={[
          styles.hint,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name="add" size={13} color={theme.textTertiary} />
        <Text style={[styles.hintText, { color: theme.textTertiary }]}>Add</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  gap: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
    marginVertical: 2,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintText: { fontSize: 11, fontWeight: '600' },
});
