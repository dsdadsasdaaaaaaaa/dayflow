import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../src/components/glass/GlassCard';
import { ColorSwatchRow } from '../src/components/habits/ColorSwatchRow';
import { IconPicker } from '../src/components/habits/IconPicker';
import { TimesStepper } from '../src/components/habits/TimesStepper';
import { WeekdayPicker } from '../src/components/habits/WeekdayPicker';
import { successHaptic, tapHaptic, warningHaptic } from '../src/lib/haptics';
import { habitBestStreak, habitStreak, useHabits } from '../src/store/habits';
import { useSettings } from '../src/store/settings';
import { RADIUS, SPACING, taskColor, useTheme } from '../src/theme';

/**
 * Habit editor modal. No `id` param = create a new habit; `id` = edit an
 * existing one (shows streaks and a delete action).
 */
export default function HabitEditorScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const habitId = typeof params.id === 'string' ? params.id : undefined;

  const existing = useHabits((s) => (habitId ? s.habits[habitId] : undefined));
  const addHabit = useHabits((s) => s.addHabit);
  const updateHabit = useHabits((s) => s.updateHabit);
  const deleteHabit = useHabits((s) => s.deleteHabit);
  const weekStartsOn = useSettings((s) => s.settings.weekStartsOn);

  // Captured once so the UI doesn't flip to "New Habit" while closing after delete.
  const [isEdit] = useState(() => existing != null);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? 'sparkles-outline');
  const [color, setColor] = useState(existing?.color ?? 'emerald');
  const [timesPerDay, setTimesPerDay] = useState(existing?.timesPerDay ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    existing?.activeWeekdays ?? []
  );

  const c = taskColor(color);
  const canSave = title.trim().length > 0;

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    successHaptic();
    if (isEdit && habitId) {
      updateHabit(habitId, {
        title: trimmed,
        icon,
        color,
        timesPerDay,
        activeWeekdays: weekdays,
      });
    } else {
      addHabit({
        title: trimmed,
        icon,
        color,
        timesPerDay,
        activeWeekdays: weekdays,
      });
    }
    router.back();
  };

  const confirmDelete = () => {
    if (!habitId) return;
    tapHaptic();
    Alert.alert(
      'Delete habit?',
      `“${existing?.title ?? title}” and its whole history will be gone for good.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            warningHaptic();
            deleteHabit(habitId);
            router.back();
          },
        },
      ]
    );
  };

  const streak = existing ? habitStreak(existing) : 0;
  const best = existing ? habitBestStreak(existing) : 0;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[
          styles.header,
          { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 10 },
        ]}
      >
        <Pressable
          onPress={() => {
            tapHaptic();
            router.back();
          }}
          hitSlop={8}
          style={[
            styles.closeBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={19} color={theme.textSecondary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {isEdit ? 'Edit Habit' : 'New Habit'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View>
          <GlassCard radius={RADIUS.xl} padding={12}>
            <View style={styles.titleRow}>
              <View style={[styles.iconPreview, { backgroundColor: c.solid }]}>
                <Ionicons name={icon as never} size={22} color="#fff" />
              </View>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Habit name"
                placeholderTextColor={theme.textTertiary}
                style={[styles.titleInput, { color: theme.text }]}
                autoFocus={!isEdit}
                maxLength={60}
                returnKeyType="done"
                accessibilityLabel="Habit name"
              />
            </View>
          </GlassCard>
        </View>

        {isEdit ? (
          <View style={styles.streakRow}>
            <StreakTile
              icon="flame"
              tint={taskColor('amber').solid}
              value={streak}
              label="Current streak"
            />
            <StreakTile
              icon="trophy"
              tint={c.solid}
              value={best}
              label="Best streak"
            />
          </View>
        ) : null}

        <Section title="Color">
          <ColorSwatchRow value={color} onChange={setColor} />
        </Section>

        <Section title="Icon">
          <IconPicker value={icon} solidColor={c.solid} onChange={setIcon} />
        </Section>

        <Section title="Repeat on">
          <WeekdayPicker
            value={weekdays}
            onChange={setWeekdays}
            weekStartsOn={weekStartsOn}
            solidColor={c.solid}
          />
        </Section>

        <Section title="Daily goal">
          <TimesStepper value={timesPerDay} onChange={setTimesPerDay} />
        </Section>

        {isEdit ? (
          <Pressable
            onPress={confirmDelete}
            style={({ pressed }) => [
              styles.deleteBtn,
              { opacity: pressed ? 0.55 : 1 },
            ]}
            accessibilityLabel="Delete habit"
          >
            <Ionicons name="trash-outline" size={15} color={theme.danger} />
            <Text style={[styles.deleteLabel, { color: theme.danger }]}>
              Delete Habit
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <Pressable
          onPress={save}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: theme.accent,
              opacity: canSave ? 1 : 0.4,
              transform: [{ scale: pressed && canSave ? 0.97 : 1 }],
            },
          ]}
          accessibilityLabel={isEdit ? 'Save changes' : 'Create habit'}
          accessibilityState={{ disabled: !canSave }}
        >
          <Ionicons
            name={isEdit ? 'checkmark' : 'add'}
            size={20}
            color="#fff"
          />
          <Text style={styles.saveLabel}>
            {isEdit ? 'Save Changes' : 'Create Habit'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        {title}
      </Text>
      <GlassCard radius={RADIUS.xl} padding={14}>
        {children}
      </GlassCard>
    </View>
  );
}

function StreakTile({
  icon,
  tint,
  value,
  label,
}: {
  icon: string;
  tint: string;
  value: number;
  label: string;
}) {
  const theme = useTheme();
  return (
    <GlassCard radius={RADIUS.xl} padding={14} style={styles.streakTile}>
      <View style={styles.streakInner}>
        <Ionicons name={icon as never} size={18} color={tint} />
        <Text style={[styles.streakValue, { color: theme.text }]}>
          {value}
          <Text style={[styles.streakUnit, { color: theme.textTertiary }]}>
            {' '}
            {value === 1 ? 'day' : 'days'}
          </Text>
        </Text>
        <Text style={[styles.streakLabel, { color: theme.textTertiary }]}>
          {label}
        </Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  headerSpacer: { width: 34 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 28,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconPreview: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    paddingVertical: 8,
  },
  streakRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: SPACING.md,
  },
  streakTile: { flex: 1 },
  streakInner: { gap: 2, alignItems: 'flex-start' },
  streakValue: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  streakUnit: { fontSize: 13, fontWeight: '600', letterSpacing: 0 },
  streakLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  section: { marginTop: SPACING.xl },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.sm + 2,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.xl + 4,
    paddingVertical: 12,
  },
  deleteLabel: { fontSize: 14, fontWeight: '600' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 15,
    borderRadius: 14,
  },
  saveLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
