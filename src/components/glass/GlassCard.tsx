import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, RADIUS } from '../../theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius. Defaults to RADIUS.lg (18). */
  radius?: number;
  /** Kept for call-site compatibility (design v3 renders flat). */
  intensity?: number;
  strong?: boolean;
  /** Padding inside the card. Defaults to 16. */
  padding?: number;
  noHighlight?: boolean;
}

/**
 * Design v3: a plain card — solid background, hairline border, soft radius.
 * (Formerly a blur-glass surface; the name is kept so call sites compile.)
 */
export function GlassCard({ children, style, radius = RADIUS.lg, padding = 16 }: Props) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          borderRadius: radius,
          borderColor: theme.border,
          backgroundColor: theme.card,
        },
        style,
      ]}
    >
      <View style={{ padding }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
