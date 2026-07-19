import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';
import { tapHaptic } from '../lib/haptics';
import { useTheme } from '../theme';

interface Props {
  onPress: () => void;
  icon?: string;
  /** Distance from the bottom tab bar. */
  bottom?: number;
}

/** Floating action button — solid accent circle with a soft shadow. */
export function Fab({ onPress, icon = 'add', bottom = 96 }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.wrap,
        {
          bottom,
          backgroundColor: theme.accent,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
      accessibilityLabel="Add task"
    >
      <Ionicons name={icon as never} size={30} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
});
