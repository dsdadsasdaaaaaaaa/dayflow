import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { todayKey } from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { DayKey } from '../../types';
import { CalendarGrid } from '../editor/CalendarGrid';

interface Props {
  visible: boolean;
  onClose: () => void;
  selected: DayKey;
  onSelect: (day: DayKey) => void;
}

/**
 * Jump-to-date bottom sheet: plain overlay + flat card sheet holding a month
 * calendar (reuses the editor's CalendarGrid) with a Today shortcut.
 * Fully self-contained — the parent just mounts it and handles onSelect.
 */
export function JumpDateSheet({ visible, onClose, selected, onSelect }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const pick = (day: DayKey) => {
    onSelect(day);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
        <Pressable
          style={[StyleSheet.absoluteFill]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close date picker"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              paddingBottom: insets.bottom + SPACING.lg,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={[styles.title, { color: theme.text }]}>Jump to date</Text>
            <Pressable
              onPress={() => {
                tapHaptic();
                pick(todayKey());
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Jump to today"
              style={({ pressed }) => [
                styles.todayBtn,
                { backgroundColor: theme.accentSoft },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.todayLabel, { color: theme.accent }]}>Today</Text>
            </Pressable>
          </View>
          {/* Re-key per open so the grid re-anchors its month on `selected`. */}
          <CalendarGrid
            key={`${visible ? 'open' : 'closed'}-${selected}`}
            value={selected}
            onChange={pick}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  todayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  todayLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
