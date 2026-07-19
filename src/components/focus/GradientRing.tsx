import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  size: number;
  strokeWidth: number;
  /** 0..1 */
  progress: number;
  /** Solid stroke color for the progress arc. */
  color: string;
  trackColor: string;
  children?: React.ReactNode;
}

/**
 * Clean progress ring: a single solid stroke over a flat track.
 * (The name is kept from the glass era so call sites stay stable.)
 */
export function GradientRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor,
  children,
}: Props) {
  const r = (size - strokeWidth) / 2 - 6;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const rotate = `rotate(-90 ${size / 2} ${size / 2})`;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {clamped > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={rotate}
          />
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
