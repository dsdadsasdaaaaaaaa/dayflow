import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

const TRACK_PAD = 3;

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Clean segmented control: flat track with a solid accent thumb that slides
 * between segments. Local to the stats screen.
 */
export function GlassSegmented<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const count = Math.max(options.length, 1);
  const segWidth = trackWidth > 0 ? (trackWidth - TRACK_PAD * 2) / count : 0;
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  const thumbStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: withSpring(index * segWidth, { damping: 19, stiffness: 230 }) },
      ],
    }),
    [index, segWidth]
  );

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
    borderRadius: 999,
    padding: TRACK_PAD,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    position: 'absolute',
    top: TRACK_PAD,
    bottom: TRACK_PAD,
    left: TRACK_PAD,
    borderRadius: 999,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
});
