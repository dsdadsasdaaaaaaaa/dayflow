import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  computeFreeSlotsWithCalendar,
  formatSlotRange,
  formatSlotsMessage,
  type DayFreeSlots,
  type FreeSlot,
} from '../../lib/availability';
import { formatDayRelative } from '../../lib/dates';
import { selectionHaptic, successHaptic } from '../../lib/haptics';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { RADIUS, SPACING, useTheme } from '../../theme';

const DAYS_AHEAD = 6;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Receives the formatted availability text; the caller appends it to the draft. */
  onInsert: (text: string) => void;
}

const slotKey = (s: FreeSlot) => `${s.day}:${s.startMinutes}`;

/** "after 7 PM" → "After 7 PM" for chip labels. */
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Bottom sheet listing the next days' free windows as multi-select chips.
 * "Insert into message" hands the compact formatted text back to the thread
 * (never auto-sends).
 */
export function ShareAvailability({ visible, onClose, onInsert }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const tasks = useTasks((s) => s.tasks);
  const dayStartHour = useSettings((s) => s.settings.dayStartHour);
  const dayEndHour = useSettings((s) => s.settings.dayEndHour);
  const showCalendarEvents = useSettings((s) => s.settings.showCalendarEvents);
  const hiddenCalendarIds = useSettings((s) => s.settings.hiddenCalendarIds);

  // Recomputed on open so "today" and its floor track the current time.
  // Async because device-calendar events subtract from availability too.
  const [days, setDays] = useState<DayFreeSlots[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!visible) {
      setDays([]);
      return;
    }
    let alive = true;
    setLoading(true);
    computeFreeSlotsWithCalendar(
      tasks,
      { dayStartHour, dayEndHour, showCalendarEvents, hiddenCalendarIds },
      DAYS_AHEAD
    ).then((result) => {
      if (!alive) return;
      setDays(result);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [visible, tasks, dayStartHour, dayEndHour, showCalendarEvents, hiddenCalendarIds]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (visible) setSelected({});
  }, [visible]);

  const chosen = useMemo(
    () => days.flatMap((d) => d.slots).filter((s) => selected[slotKey(s)]),
    [days, selected]
  );

  const toggle = (s: FreeSlot) => {
    selectionHaptic();
    setSelected((prev) => ({ ...prev, [slotKey(s)]: !prev[slotKey(s)] }));
  };

  const insert = () => {
    if (chosen.length === 0) return;
    successHaptic();
    onInsert(formatSlotsMessage(chosen));
    onClose();
  };

  // Never claim "fully booked" while the calendar is still being read.
  const fullyBooked = !loading && days.every((d) => d.slots.length === 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close availability"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.card,
              borderColor: theme.border,
              paddingBottom: Math.max(insets.bottom, SPACING.md),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <Text style={[styles.title, { color: theme.text }]}>Share availability</Text>

          {loading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator color={theme.textTertiary} />
            </View>
          ) : fullyBooked ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="calendar-outline" size={28} color={theme.textTertiary} />
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                No open slots in the next {DAYS_AHEAD} days
              </Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
            >
              {days.map((d) => (
                <View key={d.day} style={styles.dayRow}>
                  <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>
                    {formatDayRelative(d.day)}
                  </Text>
                  {d.slots.length === 0 ? (
                    <Text style={[styles.bookedLabel, { color: theme.textTertiary }]}>
                      Fully booked
                    </Text>
                  ) : (
                    <View style={styles.chipWrap}>
                      {d.slots.map((s) => {
                        const isSelected = !!selected[slotKey(s)];
                        const label = capitalize(formatSlotRange(s));
                        return (
                          <Pressable
                            key={slotKey(s)}
                            onPress={() => toggle(s)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={`${formatDayRelative(d.day)}, ${label}`}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: isSelected
                                  ? theme.accent
                                  : theme.surface,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.chipLabel,
                                { color: isSelected ? '#FFFFFF' : theme.text },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {!loading && !fullyBooked ? (
            <Pressable
              onPress={insert}
              disabled={chosen.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Insert availability into message"
              style={({ pressed }) => [
                styles.insertBtn,
                {
                  backgroundColor: theme.accent,
                  opacity: chosen.length === 0 ? 0.4 : pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text style={styles.insertLabel}>Insert into message</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '80%',
    paddingHorizontal: SPACING.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: SPACING.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  content: { paddingBottom: SPACING.md },
  dayRow: { marginTop: SPACING.md },
  dayLabel: { fontSize: 12, fontWeight: '600', marginBottom: SPACING.sm },
  bookedLabel: { fontSize: 13, fontWeight: '500' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  emptyWrap: {
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xl,
  },
  emptyText: { fontSize: 14, fontWeight: '500' },
  insertBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  insertLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
