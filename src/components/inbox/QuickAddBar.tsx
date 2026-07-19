import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { formatDayRelative, formatDuration, formatMinutes } from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import { parseQuickAdd } from '../../lib/nlp';
import { syncTaskNotifications } from '../../lib/notifications';
import { describeRecurrence } from '../../lib/recurrence';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { PRIORITY_META, RADIUS, SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

/**
 * Pinned quick-capture bar. Natural-language parsing via parseQuickAdd:
 * "Gym tomorrow 7am 45min" schedules directly from the inbox. A live
 * preview row shows what got understood before you commit, and a brief
 * inline banner confirms scheduled captures. Keyboard stays up for
 * rapid-fire entry.
 */
export function QuickAddBar() {
  const theme = useTheme();
  const addTask = useTasks((s) => s.addTask);
  const defaultDuration = useSettings((s) => s.settings.defaultDurationMinutes);
  const defaultAlerts = useSettings((s) => s.settings.defaultAlerts);

  const [value, setValue] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const preview = useMemo(() => {
    if (!value.trim()) return null;
    const p = parseQuickAdd(value);
    const chips: { icon: string; label: string; color?: string }[] = [];
    if (p.date) chips.push({ icon: 'calendar-outline', label: formatDayRelative(p.date) });
    if (p.startMinutes != null)
      chips.push({ icon: 'time-outline', label: formatMinutes(p.startMinutes) });
    if (p.durationMinutes != null)
      chips.push({ icon: 'hourglass-outline', label: formatDuration(p.durationMinutes) });
    if (p.recurrence) chips.push({ icon: 'repeat', label: describeRecurrence(p.recurrence) });
    if (p.priority > 0)
      chips.push({
        icon: 'flag',
        label: PRIORITY_META[p.priority].label,
        color: PRIORITY_META[p.priority].color,
      });
    return chips.length > 0 ? chips : null;
  }, [value]);

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const submit = () => {
    const parsed = parseQuickAdd(value);
    if (!parsed.title) return;

    const scheduledWithTime = parsed.date != null && parsed.startMinutes != null;
    const task = addTask({
      title: parsed.title,
      date: parsed.date,
      startMinutes: parsed.startMinutes,
      durationMinutes: parsed.durationMinutes ?? defaultDuration,
      priority: parsed.priority,
      recurrence: parsed.recurrence,
      alerts: scheduledWithTime ? defaultAlerts : [],
    });
    if (task.date && task.alerts.length > 0) void syncTaskNotifications(task);

    tapHaptic();
    setValue('');
    if (task.date) {
      const when =
        formatDayRelative(task.date) +
        (task.startMinutes != null ? ` ${formatMinutes(task.startMinutes)}` : '');
      showToast(`Scheduled for ${when} ✓`);
    }
    // Keep the keyboard up for rapid capture.
    inputRef.current?.focus();
  };

  const canSend = value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <GlassCard radius={28} padding={0}>
        <View style={styles.bar}>
          <Ionicons
            name="sparkles-outline"
            size={17}
            color={canSend && preview ? theme.accent : theme.textTertiary}
          />
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            placeholder={'Add a task… try "Gym tomorrow 7am 45min"'}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.text }]}
            returnKeyType="send"
            submitBehavior="submit"
            autoCapitalize="sentences"
            autoCorrect
            accessibilityLabel="Quick add task"
          />
          <Pressable
            onPress={submit}
            disabled={!canSend}
            hitSlop={6}
            accessibilityLabel="Add task"
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: theme.accent,
                opacity: canSend ? 1 : 0.35,
                transform: [{ scale: pressed ? 0.9 : 1 }],
              },
            ]}
          >
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </Pressable>
        </View>
      </GlassCard>

      {preview ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(120)}
          layout={LinearTransition}
          style={styles.previewRow}
        >
          {preview.map((chip, i) => (
            <View
              key={`${chip.icon}-${i}`}
              style={[
                styles.previewChip,
                { backgroundColor: theme.accentSoft, borderColor: theme.border },
              ]}
            >
              <Ionicons
                name={chip.icon as never}
                size={11}
                color={chip.color ?? theme.accent}
              />
              <Text style={[styles.previewText, { color: chip.color ?? theme.accent }]}>
                {chip.label}
              </Text>
            </View>
          ))}
        </Animated.View>
      ) : null}

      {toast ? (
        <Animated.View
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(180)}
        >
          <GlassCard
            radius={RADIUS.lg}
            padding={0}
            style={{ borderColor: `${theme.success}55` }}
          >
            <View style={[styles.toast, { backgroundColor: `${theme.success}1F` }]}>
              <Ionicons name="checkmark-circle" size={15} color={theme.success} />
              <Text style={[styles.toastText, { color: theme.success }]}>{toast}</Text>
            </View>
          </GlassCard>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 8,
    height: 54,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    paddingVertical: 0,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 4,
  },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});
