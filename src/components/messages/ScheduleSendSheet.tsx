import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addDays,
  formatDayRelative,
  formatMinutes,
  fromDayKey,
  minutesOfDay,
  toDayKey,
  todayKey,
} from '../../lib/dates';
import { selectionHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '../../lib/smsApi';
import { threadScheduled, useMessages } from '../../store/messages';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { DayKey } from '../../types';
import { LEAD_AMBER } from './ClientPanel';

/** How many days out the custom day selector reaches (Today + 6 more). */
const CUSTOM_DAYS = 7;
const DAY_MIN = 24 * 60;

/** "Tomorrow 9 AM" — delivery-time label for banner rows and the CTA. */
function whenLabel(atMs: number): string {
  const d = new Date(atMs);
  return `${formatDayRelative(toDayKey(d))} ${formatMinutes(minutesOfDay(d))}`;
}

/** Epoch ms for a day key + minutes-from-midnight (local time). */
function atTime(day: DayKey, minutes: number): number {
  return fromDayKey(day).getTime() + minutes * 60_000;
}

interface Preset {
  label: string;
  atMs: number;
}

/** Preset delivery times; anything inside Twilio's 15-min minimum is skipped. */
function buildPresets(now: number): Preset[] {
  const today = todayKey();
  const tomorrow = addDays(today, 1);
  const all: Preset[] = [
    { label: 'In 1 hour', atMs: now + 60 * 60_000 },
    { label: 'This evening · 8 PM', atMs: atTime(today, 20 * 60) },
    { label: 'Tomorrow morning · 9 AM', atMs: atTime(tomorrow, 9 * 60) },
    { label: 'Tomorrow evening · 7 PM', atMs: atTime(tomorrow, 19 * 60) },
  ];
  return all.filter((p) => p.atMs - now >= SCHEDULE_MIN_LEAD_MS);
}

/** Roughly an hour out, snapped to the next half hour (custom-time default). */
function defaultCustomMinutes(): number {
  return Math.min(23 * 60 + 30, Math.ceil((minutesOfDay() + 60) / 30) * 30);
}

/** Minutes-from-midnight → a Date for the native wheel (5-min grid snap). */
function minutesToDate(minutes: number): Date {
  const m = Math.max(0, Math.min(DAY_MIN - 1, Math.round(minutes)));
  const snapped = Math.round(m / 5) * 5;
  return new Date(2000, 0, 1, Math.floor(snapped / 60), snapped % 60);
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The trimmed draft to schedule — shown as a preview, never edited here. */
  body: string;
  /**
   * Hand the chosen delivery time back to the thread; resolve true on
   * success (the thread clears the draft and closes the sheet).
   */
  onSchedule: (sendAtMs: number) => Promise<boolean>;
}

/**
 * Bottom sheet for scheduled sends (SMS only): preset chips, a day selector
 * up to a week out, and the task editor's inline time-wheel pattern. Twilio
 * holds the message, so delivery works even with the phone off.
 */
export function ScheduleSendSheet({ visible, onClose, body, onSchedule }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [presetIdx, setPresetIdx] = useState(0);
  const [dayKey, setDayKey] = useState<DayKey>(todayKey());
  const [customMinutes, setCustomMinutes] = useState(defaultCustomMinutes);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fresh presets and defaults every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setOpenedAt(Date.now());
    setMode('preset');
    setPresetIdx(0);
    setDayKey(todayKey());
    setCustomMinutes(defaultCustomMinutes());
    setWheelOpen(false);
    setSubmitting(false);
  }, [visible]);

  const presets = useMemo(() => buildPresets(openedAt), [openedAt]);
  const days = useMemo(
    () => Array.from({ length: CUSTOM_DAYS }, (_, i) => addDays(todayKey(), i)),
    // Recompute on open so "Today" tracks the calendar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openedAt]
  );

  const sendAtMs =
    mode === 'preset' ? presets[presetIdx]?.atMs ?? null : atTime(dayKey, customMinutes);
  const lead = sendAtMs != null ? sendAtMs - Date.now() : 0;
  const tooSoon = sendAtMs != null && lead < SCHEDULE_MIN_LEAD_MS;
  const tooFar = sendAtMs != null && lead > SCHEDULE_MAX_LEAD_MS;
  const canConfirm =
    sendAtMs != null && !tooSoon && !tooFar && !submitting && body.length > 0;

  const pickPreset = (idx: number) => {
    selectionHaptic();
    setMode('preset');
    setPresetIdx(idx);
    setWheelOpen(false);
  };

  const pickDay = (day: DayKey) => {
    selectionHaptic();
    setMode('custom');
    setDayKey(day);
  };

  const onWheelChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      // Android presents a dialog — close it on either outcome.
      setWheelOpen(false);
      if (event.type !== 'set' || !date) return;
    }
    if (!date) return;
    setCustomMinutes(date.getHours() * 60 + date.getMinutes());
  };

  const confirm = async () => {
    if (!canConfirm || sendAtMs == null) return;
    tapHaptic();
    setSubmitting(true);
    const ok = await onSchedule(sendAtMs);
    setSubmitting(false);
    // On success the thread closes the sheet; on failure it shows the error
    // and the sheet stays open for another try.
    if (!ok) warningHaptic();
  };

  const timeFieldOpen = mode === 'custom' && wheelOpen;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close schedule send"
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
          <Text style={[styles.title, { color: theme.text }]}>Schedule send</Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* Message preview */}
            <View style={[styles.preview, { backgroundColor: theme.surface }]}>
              <Text
                style={[styles.previewText, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {body}
              </Text>
            </View>

            {/* Presets */}
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Deliver
            </Text>
            <View style={styles.chipWrap}>
              {presets.map((p, i) => {
                const selected = mode === 'preset' && presetIdx === i;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => pickPreset(i)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Deliver ${p.label}`}
                    style={[
                      styles.chip,
                      { backgroundColor: selected ? theme.accent : theme.surface },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipLabel,
                        { color: selected ? '#FFFFFF' : theme.text },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Custom day + time */}
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Or pick a time
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayRow}
              keyboardShouldPersistTaps="handled"
            >
              {days.map((day) => {
                const selected = mode === 'custom' && dayKey === day;
                return (
                  <Pressable
                    key={day}
                    onPress={() => pickDay(day)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Deliver ${formatDayRelative(day)}`}
                    style={[
                      styles.chip,
                      { backgroundColor: selected ? theme.accent : theme.surface },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipLabel,
                        { color: selected ? '#FFFFFF' : theme.text },
                      ]}
                    >
                      {formatDayRelative(day)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {/* Time field — same expandable-wheel pattern as the task editor. */}
            <Pressable
              onPress={() => {
                tapHaptic();
                setMode('custom');
                setWheelOpen((v) => !(v && mode === 'custom'));
              }}
              accessibilityRole="button"
              accessibilityLabel={`Delivery time ${formatMinutes(customMinutes)}`}
              accessibilityState={{ expanded: timeFieldOpen }}
              style={({ pressed }) => [
                styles.timeField,
                {
                  backgroundColor: timeFieldOpen ? theme.accentSoft : theme.surface,
                  borderColor: timeFieldOpen ? theme.accent : theme.border,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.timeFieldLabel, { color: theme.textSecondary }]}>
                Time
              </Text>
              <Text
                style={[
                  styles.timeFieldValue,
                  { color: timeFieldOpen ? theme.accent : theme.text },
                ]}
              >
                {formatMinutes(customMinutes)}
              </Text>
            </Pressable>
            {timeFieldOpen ? (
              Platform.OS === 'web' ? (
                <WebTimeChips minutes={customMinutes} onChange={setCustomMinutes} />
              ) : (
                <DateTimePicker
                  value={minutesToDate(customMinutes)}
                  mode="time"
                  display="spinner"
                  minuteInterval={5}
                  themeVariant={theme.dark ? 'dark' : 'light'}
                  onChange={onWheelChange}
                  style={styles.wheel}
                />
              )
            ) : null}

            {/* Constraint hints — amber, never alarming. */}
            {tooSoon ? (
              <Text style={[styles.hint, { color: LEAD_AMBER }]}>
                Needs at least 15 minutes of lead time — pick a later time.
              </Text>
            ) : tooFar ? (
              <Text style={[styles.hint, { color: LEAD_AMBER }]}>
                Scheduled sends can be at most 35 days out.
              </Text>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={confirm}
            disabled={!canConfirm}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}
            accessibilityLabel={
              sendAtMs != null
                ? `Schedule for ${whenLabel(sendAtMs)}`
                : 'Schedule message'
            }
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: theme.accent,
                opacity: !canConfirm ? 0.4 : pressed ? 0.9 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaLabel}>
                {sendAtMs != null ? `Schedule · ${whenLabel(sendAtMs)}` : 'Schedule'}
              </Text>
            )}
          </Pressable>
          <Text style={[styles.footnote, { color: theme.textTertiary }]}>
            Delivers even if your phone is off.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Web fallback for the native wheel — the editor's chip-row pattern:
 * hours on one row, 5-minute steps on the other.
 */
function WebTimeChips({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const theme = useTheme();
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;

  const chip = (key: number, label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.webChip,
        selected
          ? { backgroundColor: theme.accent }
          : {
              backgroundColor: theme.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
            },
      ]}
    >
      <Text
        style={[
          styles.webChipLabel,
          { color: selected ? '#FFFFFF' : theme.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ marginTop: SPACING.sm }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.webChipRow}
        keyboardShouldPersistTaps="handled"
      >
        {Array.from({ length: 24 }, (_, h) =>
          chip(h, formatMinutes(h * 60), h === hour, () => onChange(h * 60 + minute))
        )}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.webChipRow, { marginTop: 8 }]}
        keyboardShouldPersistTaps="handled"
      >
        {Array.from({ length: 12 }, (_, i) =>
          chip(i * 5 + 100, `:${String(i * 5).padStart(2, '0')}`, i * 5 === minute, () =>
            onChange(hour * 60 + i * 5)
          )
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Slim banner above the composer: "1 scheduled · Tomorrow 9 AM". Tap expands
 * per-message rows with a body preview and Cancel. Renders nothing when the
 * thread has no pending scheduled sends. SMS threads only.
 */
export function ScheduledBanner({ counterparty }: { counterparty: string }) {
  const theme = useTheme();
  const scheduled = useMessages((s) => s.scheduled);
  const cancelScheduled = useMessages((s) => s.cancelScheduled);
  const [expanded, setExpanded] = useState(false);
  const [cancelingSid, setCancelingSid] = useState<string | null>(null);

  const entries = useMemo(
    () => threadScheduled(scheduled, counterparty),
    [scheduled, counterparty]
  );

  if (entries.length === 0) return null;
  const next = entries[0];

  const confirmCancel = (sid: string) => {
    tapHaptic();
    Alert.alert('Cancel scheduled message?', 'It will not be sent.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel send',
        style: 'destructive',
        onPress: async () => {
          setCancelingSid(sid);
          const ok = await cancelScheduled(sid);
          setCancelingSid(null);
          if (!ok) {
            Alert.alert(
              'Could not cancel',
              useMessages.getState().lastError ?? 'Please try again.'
            );
          }
        },
      },
    ]);
  };

  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: theme.accentSoft },
      ]}
    >
      <Pressable
        onPress={() => {
          tapHaptic();
          setExpanded((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${entries.length} scheduled message${
          entries.length === 1 ? '' : 's'
        }, next ${whenLabel(next.sendAtMs)}`}
        style={styles.bannerHeader}
      >
        <Ionicons name="time-outline" size={14} color={theme.accent} />
        <Text style={[styles.bannerText, { color: theme.accent }]} numberOfLines={1}>
          {entries.length} scheduled · {whenLabel(next.sendAtMs)}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-up'}
          size={13}
          color={theme.accent}
        />
      </Pressable>
      {expanded
        ? entries.map((e) => (
            <View key={e.sid} style={styles.bannerRow}>
              <View style={styles.bannerRowText}>
                <Text
                  style={[styles.bannerBody, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {e.body}
                </Text>
                <Text style={[styles.bannerWhen, { color: theme.textSecondary }]}>
                  {whenLabel(e.sendAtMs)}
                </Text>
              </View>
              <Pressable
                onPress={() => confirmCancel(e.sid)}
                disabled={cancelingSid === e.sid}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Cancel scheduled message: ${e.body}`}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { opacity: cancelingSid === e.sid ? 0.5 : pressed ? 0.7 : 1 },
                ]}
              >
                {cancelingSid === e.sid ? (
                  <ActivityIndicator size="small" color={theme.danger} />
                ) : (
                  <Text style={[styles.cancelLabel, { color: theme.danger }]}>
                    Cancel
                  </Text>
                )}
              </Pressable>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '85%',
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
  preview: {
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewText: { fontSize: 13, lineHeight: 18 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  dayRow: { gap: SPACING.sm, paddingRight: SPACING.lg },
  timeField: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    marginTop: SPACING.sm,
  },
  timeFieldLabel: { fontSize: 12, fontWeight: '600' },
  timeFieldValue: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  wheel: { alignSelf: 'stretch', marginTop: SPACING.xs },
  hint: { fontSize: 12, fontWeight: '600', marginTop: SPACING.sm },
  cta: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  ctaLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  footnote: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  webChipRow: { gap: 6, paddingRight: SPACING.lg, paddingVertical: 2 },
  webChip: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
  },
  webChipLabel: { fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] },
  banner: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '600' },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  bannerRowText: { flex: 1 },
  bannerBody: { fontSize: 13, fontWeight: '500' },
  bannerWhen: { fontSize: 11, fontWeight: '500', marginTop: 1 },
  cancelBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  cancelLabel: { fontSize: 13, fontWeight: '600' },
});
