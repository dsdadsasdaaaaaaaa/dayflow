import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

const PAD = 4;
const HEIGHT = 44;

/**
 * Clean segmented control: flat pill track with a solid accent thumb that
 * glides under the selected option.
 */
export function GlassSegmented<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segWidth = trackWidth > 0 ? (trackWidth - PAD * 2) / options.length : 0;

  const x = useSharedValue(index * segWidth);
  useEffect(() => {
    x.value = withSpring(index * segWidth, { damping: 18, stiffness: 280, mass: 0.7 });
  }, [index, segWidth, x]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[
        styles.track,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      {segWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            { width: segWidth, backgroundColor: theme.accent },
            thumbStyle,
          ]}
        />
      ) : null}

      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (!active) {
                selectionHaptic();
                onChange(opt.value);
              }
            }}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={[
                styles.label,
                { color: active ? '#fff' : theme.textSecondary },
                active && styles.labelActive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    padding: PAD,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: (HEIGHT - PAD * 2) / 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13.5, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
});
