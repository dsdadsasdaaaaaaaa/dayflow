import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';

/** One full pulse cycle — each dot runs the same loop, staggered. */
const CYCLE_MS = 900;
const FADE_MS = 300;
const DIM = 0.3;

/** Opacity loop for a single dot, offset by `delay` so the three ripple. */
function useDot(delay: number): Animated.Value {
  const value = useRef(new Animated.Value(DIM)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: DIM,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(CYCLE_MS - 2 * FADE_MS - delay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, value]);
  return value;
}

/**
 * The "still thinking" bubble: three dots in an inbound-style surface bubble,
 * so a slow answer never looks like a dropped one.
 */
export function TypingDots() {
  const theme = useTheme();
  const a = useDot(0);
  const b = useDot(140);
  const c = useDot(280);

  return (
    <View style={styles.wrap} accessibilityLabel="Secretary is thinking">
      <View style={[styles.bubble, { backgroundColor: theme.surface }]}>
        {[a, b, c].map((opacity, i) => (
          <Animated.View
            key={i}
            style={[styles.dot, { backgroundColor: theme.textSecondary, opacity }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', marginVertical: 2 },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
