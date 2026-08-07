import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, useTheme } from '../../theme';

interface Props {
  message: string;
  onDismiss: () => void;
}

/** Dismissible inline error strip — flat card, danger text, no drama. */
export function ErrorBanner({ message, onDismiss }: Props) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Ionicons name="alert-circle-outline" size={17} color={theme.danger} />
      <Text style={[styles.text, { color: theme.danger }]} numberOfLines={2}>
        {message}
      </Text>
      <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss error">
        <Ionicons name="close" size={16} color={theme.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  text: { flex: 1, fontSize: 13, fontWeight: '500' },
});
