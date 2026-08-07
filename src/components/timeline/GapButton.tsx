import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { RAIL_CENTER_X } from '../TaskCard';
import { useTheme } from '../../theme';

interface Props {
  top: number;
  height: number;
  startMinutes: number;
  onPress: (startMinutes: number) => void;
}

/**
 * Quiet free-slot affordance: empty time stays visually empty — the whole gap
 * is tappable, with only a small "+" seated on the connector rail as a hint.
 */
export const GapButton = memo(function GapButton({ top, height, startMinutes, onPress }: Props) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress(startMinutes);
      }}
      style={({ pressed }) => [styles.gap, { top, height, opacity: pressed ? 0.6 : 1 }]}
      accessibilityLabel="Add task in this gap"
    >
      <View
        style={[
          styles.hint,
          {
            backgroundColor: theme.background,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name="add" size={14} color={theme.textTertiary} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  gap: {
    position: 'absolute',
    left: 0,
    right: 0,
    justifyContent: 'center',
    zIndex: 0,
  },
  hint: {
    marginLeft: RAIL_CENTER_X - 11,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
