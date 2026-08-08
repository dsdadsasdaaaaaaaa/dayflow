import { View } from 'react-native';

/** Tiny solid status dot (lead/client/blocked color). */
export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }}
    />
  );
}
