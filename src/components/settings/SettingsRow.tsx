import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props {
  /** Ionicons glyph name. */
  icon: string;
  /** Solid color for the icon circle. */
  tint: string;
  label: string;
  sublabel?: string;
  /** Right accessory (Switch, Stepper, value text…). */
  right?: ReactNode;
  onPress?: () => void;
  /** Danger styling for destructive actions. */
  destructive?: boolean;
}

/** One settings row: tinted icon circle, label(s), right accessory. */
export function SettingsRow({
  icon,
  tint,
  label,
  sublabel,
  right,
  onPress,
  destructive,
}: Props) {
  const theme = useTheme();

  // Subtle red-tinted wash behind destructive rows.
  const dangerWash = destructive
    ? { backgroundColor: `${theme.danger}${theme.dark ? '1C' : '12'}` }
    : null;

  const body = (
    <>
      <View style={[styles.iconCircle, { backgroundColor: tint }]}>
        <Ionicons name={icon as never} size={16} color="#fff" />
      </View>
      <View style={styles.labels}>
        <Text
          style={[styles.label, { color: destructive ? theme.danger : theme.text }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {sublabel ? (
          <Text
            style={[styles.sublabel, { color: theme.textTertiary }]}
            numberOfLines={1}
          >
            {sublabel}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && !right ? (
        <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={() => {
          tapHaptic();
          onPress();
        }}
        style={({ pressed }) => [
          styles.row,
          dangerWash,
          {
            opacity: pressed ? 0.65 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.row, dangerWash]}>{body}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 52,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: { flex: 1, gap: 1 },
  label: { fontSize: 15, fontWeight: '600' },
  sublabel: { fontSize: 12.5, fontWeight: '500' },
});
