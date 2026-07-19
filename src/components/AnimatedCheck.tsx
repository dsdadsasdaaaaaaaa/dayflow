import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { successHaptic } from '../lib/haptics';

interface Props {
  checked: boolean;
  /** Solid color of the check circle when checked. */
  color: string;
  size?: number;
  onToggle: () => void;
  borderColor?: string;
}

/** Circular check with a springy pop animation, Structured-style. */
export function AnimatedCheck({ checked, color, size = 26, onToggle, borderColor }: Props) {
  const scale = useSharedValue(1);
  const fill = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(checked ? 1 : 0, { duration: 160 });
  }, [checked, fill]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: fill.value > 0.5 ? color : 'transparent',
    borderColor: fill.value > 0.5 ? color : (borderColor ?? '#9AA3B8'),
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withTiming(0.8, { duration: 80 }),
      withSpring(1.08, { damping: 9, stiffness: 300 }),
      withSpring(1, { damping: 12 })
    );
    if (!checked) successHaptic();
    onToggle();
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <Animated.View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2 },
          outerStyle,
        ]}
      >
        {checked ? <Ionicons name="checkmark" size={size * 0.62} color="#fff" /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
