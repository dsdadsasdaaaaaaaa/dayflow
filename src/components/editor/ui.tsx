import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { RADIUS, SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Labeled section block — the editor's section unit. A small sentence-case
 * label above a plain card holding the content.
 */
export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
        {right}
      </View>
      <GlassCard radius={RADIUS.xl} padding={SPACING.lg - 2}>
        {children}
      </GlassCard>
    </View>
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: string;
  /** Solid color used as the selected fill (priority etc.). Defaults to theme.accent. */
  tint?: string;
  small?: boolean;
}

/**
 * Rounded selectable pill. Unselected = quiet surface; selected = solid
 * accent (or `tint`) fill with white text.
 */
export function Chip({ label, selected = false, onPress, icon, tint, small = false }: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
    >
      <View
        style={[
          styles.chip,
          small && styles.chipSmall,
          selected
            ? { backgroundColor: tint ?? theme.accent }
            : {
                backgroundColor: theme.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.border,
              },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon as IconName}
            size={small ? 13 : 15}
            color={selected ? '#FFFFFF' : theme.textSecondary}
            style={{ marginRight: 5 }}
          />
        ) : null}
        <Text
          style={[
            styles.chipLabel,
            small && styles.chipLabelSmall,
            { color: selected ? '#FFFFFF' : theme.textSecondary },
            selected && styles.chipLabelSelected,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** Segmented control: recessed track, solid accent thumb. */
export function GlassSegmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View
      style={[styles.segTrack, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
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
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: theme.accent }]}
          >
            <Text
              style={[
                styles.segLabel,
                { color: active ? '#FFFFFF' : theme.textSecondary },
                active && styles.segLabelActive,
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

interface StepperProps {
  /** Formatted center label, e.g. "1 h 30 min" or "2". */
  label: string;
  onDecrement: () => void;
  onIncrement: () => void;
  /** Big variant. */
  big?: boolean;
}

/** Minus / label / plus stepper with round tap targets. */
export function Stepper({ label, onDecrement, onIncrement, big = false }: StepperProps) {
  const theme = useTheme();
  const size = big ? 44 : 32;
  const btn = (iconName: IconName, onPress: () => void) => (
    <Pressable
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.stepBtn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
        },
        pressed && { opacity: 0.6, transform: [{ scale: 0.94 }] },
      ]}
      hitSlop={6}
    >
      <Ionicons name={iconName} size={big ? 22 : 17} color={theme.accent} />
    </Pressable>
  );
  return (
    <View style={styles.stepperRow}>
      {btn('remove', onDecrement)}
      <Text
        style={[styles.stepperLabel, big && styles.stepperLabelBig, { color: theme.text }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {btn('add', onIncrement)}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: SPACING.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm + 2,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    overflow: 'hidden',
  },
  chipSmall: {
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  chipLabelSmall: {
    fontSize: 13,
  },
  chipLabelSelected: {
    fontWeight: '700',
  },
  segTrack: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  segLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  segLabelActive: {
    fontWeight: '700',
  },
  stepBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  stepperLabel: {
    fontSize: 15,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  stepperLabelBig: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    minWidth: 150,
    flexShrink: 1,
  },
});
