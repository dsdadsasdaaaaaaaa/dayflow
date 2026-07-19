import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

interface Props {
  title: string;
  /** Small explainer text under the card. */
  caption?: string;
  /** Unused since design v3 (kept so call sites compile). */
  delay?: number;
  children: ReactNode;
}

/**
 * One settings group: sentence-case label, a plain card of rows with inset
 * hairline separators, and an optional footer caption.
 */
export function SettingsSection({ title, caption, children }: Props) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: theme.textSecondary }]}>{title}</Text>
      <GlassCard radius={RADIUS.xl} padding={0}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? (
              <View
                style={[styles.separator, { backgroundColor: theme.separator }]}
              />
            ) : null}
            {child}
          </Fragment>
        ))}
      </GlassCard>
      {caption ? (
        <Text style={[styles.caption, { color: theme.textTertiary }]}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: SPACING.xl },
  title: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.sm + 2,
    marginLeft: 6,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
  caption: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: SPACING.sm,
    marginHorizontal: 6,
  },
});
