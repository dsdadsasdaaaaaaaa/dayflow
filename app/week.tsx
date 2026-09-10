import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { setPendingDay } from '../src/components/week/dayHandoff';
import {
  addDays,
  formatMinutes,
  fromDayKey,
  isToday,
  monthShort,
  todayKey,
  weekOf,
} from '../src/lib/dates';
import { selectionHaptic, tapHaptic } from '../src/lib/haptics';
import { earningsForDays, formatMoney } from '../src/lib/meetings';
import { isRuleMarker } from '../src/lib/schoolDay';
import { isImportedSchool } from '../src/lib/schoolWords';
import { isSchoolTask } from '../src/lib/timetableImport';
import { useSettings } from '../src/store/settings';
import { instancesForDay, useTasks } from '../src/store/tasks';
import { SPACING, taskColor, useTheme } from '../src/theme';
import type { DayKey, TaskInstance } from '../src/types';

const WD_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** "Jul 13 – 19" (or "Jul 28 – Aug 3" across months). */
function rangeLabel(days: DayKey[]): string {
  const start = fromDayKey(days[0]);
  const end = fromDayKey(days[6]);
  const sm = monthShort(start.getMonth());
  const em = monthShort(end.getMonth());
  return sm === em
    ? `${sm} ${start.getDate()} – ${end.getDate()}`
    : `${sm} ${start.getDate()} – ${em} ${end.getDate()}`;
}

/** One compact task block inside a day column. */
function DayBlock({ inst, onPress }: { inst: TaskInstance; onPress: () => void }) {
  const theme = useTheme();
  const color = taskColor(inst.task.color).solid;
  const allDay = inst.task.allDay || inst.task.startMinutes == null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={inst.task.title}
      style={({ pressed }) => [
        styles.block,
        inst.completed && { opacity: 0.4 },
        pressed && { opacity: 0.25 },
      ]}
    >
      {allDay ? (
        <View style={styles.allDayRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text style={[styles.blockTitle, { color: theme.text }]} numberOfLines={2}>
            {inst.task.title}
          </Text>
        </View>
      ) : (
        <View style={styles.timedRow}>
          <View style={[styles.bar, { backgroundColor: color }]} />
          <View style={styles.blockBody}>
            <Text style={[styles.blockTitle, { color: theme.text }]} numberOfLines={2}>
              {inst.task.title}
            </Text>
            <View style={styles.timeRow}>
              <Text style={[styles.timeLabel, { color: theme.textTertiary }]} numberOfLines={1}>
                {formatMinutes(inst.task.startMinutes ?? 0)}
              </Text>
              {inst.task.meeting ? (
                <Ionicons name="cash-outline" size={9} color={theme.success} />
              ) : null}
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Pushed week overview: 7 slim day columns of compact task blocks. */
type ColumnItem =
  | { kind: 'task'; inst: TaskInstance }
  | { kind: 'school'; start: number; end: number; count: number };

/**
 * A day's column, with the timetable folded to one block.
 *
 * Seven columns of eight class cards each was the timeline's wall-of-school
 * problem multiplied by seven, at a size where nothing in a card could be
 * read anyway. In a week view the only thing a school day needs to say is
 * where it sits and how long it is; the periods live on the day itself.
 * The block goes where the first period would, so the column still reads
 * in time order.
 */
function columnItems(instances: TaskInstance[]): ColumnItem[] {
  const classes = instances.filter(
    (i) => isSchoolTask(i.task) && i.task.recurrence != null && i.task.startMinutes != null
  );
  if (classes.length < 3) return instances.map((inst) => ({ kind: 'task', inst }));
  const start = Math.min(...classes.map((i) => i.task.startMinutes as number));
  const end = Math.max(
    ...classes.map((i) => (i.task.startMinutes as number) + i.task.durationMinutes)
  );
  const out: ColumnItem[] = [];
  let placed = false;
  for (const inst of instances) {
    if (classes.includes(inst)) {
      if (!placed) {
        out.push({ kind: 'school', start, end, count: classes.length });
        placed = true;
      }
      continue;
    }
    // A dismissal marker says what the block's end already says.
    if (isSchoolTask(inst.task) && !inst.task.recurrence && isRuleMarker(inst.task.title)) continue;
    out.push({ kind: 'task', inst });
  }
  return out;
}

function SchoolDayBlock({
  startMinutes,
  endMinutes,
  count,
  onPress,
}: {
  startMinutes: number;
  endMinutes: number;
  count: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const c = taskColor('sky');
  const fg = theme.dark ? c.fgDark : c.fgLight;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`School, ${formatMinutes(startMinutes)} to ${formatMinutes(endMinutes)}, ${count} periods. Opens the day.`}
      style={({ pressed }) => [
        styles.schoolBlock,
        {
          backgroundColor: theme.dark ? `${c.solid}1F` : `${c.solid}14`,
          borderColor: theme.dark ? `${c.solid}55` : `${c.solid}40`,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name="school" size={11} color={fg} />
      <Text style={[styles.schoolLabel, { color: theme.text }]} numberOfLines={1}>
        School
      </Text>
      <Text style={[styles.schoolTime, { color: theme.textTertiary }]} numberOfLines={1}>
        {formatMinutes(startMinutes)}
      </Text>
      <Text style={[styles.schoolTime, { color: theme.textTertiary }]} numberOfLines={1}>
        {`– ${formatMinutes(endMinutes)}`}
      </Text>
    </Pressable>
  );
}

export default function WeekScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tasks = useTasks((s) => s.tasks);
  const weekStartsOn = useSettings((s) => s.settings.weekStartsOn);
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const [anchor, setAnchor] = useState<DayKey>(() => todayKey());
  const days = useMemo(() => weekOf(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const onCurrentWeek = days.some((d) => d === todayKey());

  const dayInstances = useMemo(() => days.map((d) => instancesForDay(tasks, d)), [tasks, days]);

  const stats = useMemo(() => {
    let total = 0;
    let done = 0;
    let minutes = 0;
    for (const list of dayInstances) {
      for (const inst of list) {
        // Classes are where you have to be, not what you have to do. Counted,
        // a school week read "41 tasks, 31.7 h planned" when the week's own
        // plan was four things — true, useless, and discouraging.
        if (isImportedSchool(inst.task)) continue;
        total += 1;
        if (inst.completed) done += 1;
        if (!inst.task.allDay && inst.task.startMinutes != null) {
          minutes += inst.task.durationMinutes;
        }
      }
    }
    return { total, done, hours: Math.round((minutes / 60) * 10) / 10 };
  }, [dayInstances]);

  const earnings = useMemo(() => earningsForDays(tasks, days), [tasks, days]);

  const pageWeek = (delta: number) => {
    selectionHaptic();
    setAnchor((a) => addDays(a, delta * 7));
  };

  const openDay = (day: DayKey) => {
    tapHaptic();
    setPendingDay(day);
    router.back();
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Header: back · week range · today pill · week paging */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {rangeLabel(days)}
        </Text>
        {!onCurrentWeek ? (
          <Pressable
            onPress={() => {
              selectionHaptic();
              setAnchor(todayKey());
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back to this week"
            style={({ pressed }) => [
              styles.todayPill,
              { backgroundColor: theme.accentSoft },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.todayLabel, { color: theme.accent }]}>Today</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => pageWeek(-1)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          style={({ pressed }) => [
            styles.navBtn,
            { backgroundColor: theme.card, borderColor: theme.border },
            pressed && { opacity: 0.5 },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.accent} />
        </Pressable>
        <Pressable
          onPress={() => pageWeek(1)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next week"
          style={({ pressed }) => [
            styles.navBtn,
            { backgroundColor: theme.card, borderColor: theme.border },
            pressed && { opacity: 0.5 },
          ]}
        >
          <Ionicons name="chevron-forward" size={18} color={theme.accent} />
        </Pressable>
      </View>

      {/* Weekly summary strip */}
      <View style={[styles.summary, { borderBottomColor: theme.separator }]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.text }]}>{stats.total}</Text>
          <Text style={[styles.statLabel, { color: theme.textTertiary }]}>tasks</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.text }]}>{stats.done}</Text>
          <Text style={[styles.statLabel, { color: theme.textTertiary }]}>done</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.text }]}>{stats.hours} h</Text>
          <Text style={[styles.statLabel, { color: theme.textTertiary }]}>planned</Text>
        </View>
        {earnings.earned > 0 ? (
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.success }]}>
              {formatMoney(earnings.earned, symbol)}
            </Text>
            <Text style={[styles.statLabel, { color: theme.textTertiary }]}>earned</Text>
          </View>
        ) : null}
      </View>

      {/* Day headers (fixed above the scrolling columns) */}
      <View style={[styles.headerRow, { borderBottomColor: theme.separator }]}>
        {days.map((day, i) => {
          const today = isToday(day);
          const d = fromDayKey(day);
          return (
            <Pressable
              key={day}
              onPress={() => openDay(day)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${day} on the timeline`}
              style={({ pressed }) => [
                styles.dayHeader,
                i < 6 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: theme.separator },
                pressed && { opacity: 0.5 },
              ]}
            >
              <Text
                style={[
                  styles.dayLetter,
                  { color: today ? theme.accent : theme.textTertiary },
                ]}
              >
                {WD_LETTERS[d.getDay()]}
              </Text>
              <Text
                style={[
                  styles.dayNumber,
                  { color: today ? theme.accent : theme.text },
                  today && { fontWeight: '800' },
                ]}
              >
                {d.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 7 slim columns of stacked blocks (all-day first — instancesForDay sorts) */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.columnsContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.columns}>
          {days.map((day, i) => (
            <View
              key={day}
              style={[
                styles.column,
                i < 6 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: theme.separator },
              ]}
            >
              {columnItems(dayInstances[i]).map((item) =>
                item.kind === 'school' ? (
                  <SchoolDayBlock
                    key="school"
                    startMinutes={item.start}
                    endMinutes={item.end}
                    count={item.count}
                    onPress={() => openDay(day)}
                  />
                ) : (
                  <DayBlock
                    key={item.inst.task.id}
                    inst={item.inst}
                    onPress={() => {
                      tapHaptic();
                      router.push(`/task-editor?id=${item.inst.task.id}&date=${day}`);
                    }}
                  />
                )
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  schoolBlock: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 5,
    paddingVertical: 6,
    marginBottom: 4,
    gap: 1,
  },
  schoolLabel: { fontSize: 11, fontWeight: '800' },
  schoolTime: { fontSize: 9, fontWeight: '600', fontVariant: ['tabular-nums'] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  todayPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  todayLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    gap: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: {
    alignItems: 'flex-start',
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  dayLetter: {
    fontSize: 10,
    fontWeight: '600',
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  columnsContent: {
    flexGrow: 1,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  column: {
    flex: 1,
    paddingHorizontal: 3,
    paddingTop: 6,
  },
  block: {
    marginBottom: 6,
  },
  allDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  timedRow: {
    flexDirection: 'row',
    gap: 4,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
    alignSelf: 'stretch',
  },
  blockBody: {
    flex: 1,
  },
  blockTitle: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 11,
    flexShrink: 1,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  timeLabel: {
    fontSize: 8,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
