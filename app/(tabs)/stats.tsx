import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/EmptyState';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { CompletionChart } from '../../src/components/stats/CompletionChart';
import { GlassSegmented } from '../../src/components/stats/GlassSegmented';
import { EarningsCard } from '../../src/components/stats/EarningsCard';
import { FocusCard } from '../../src/components/stats/FocusCard';
import { HabitsCard } from '../../src/components/stats/HabitsCard';
import { HeroTiles } from '../../src/components/stats/HeroTiles';
import { HourHeatStrip } from '../../src/components/stats/HourHeatStrip';
import { InsightsCard } from '../../src/components/stats/InsightsCard';
import { MoneyInsights } from '../../src/components/stats/MoneyInsights';
import { TimeDonut } from '../../src/components/stats/TimeDonut';
import {
  buildInsights,
  clientStats,
  completionByDay,
  focusStats,
  habitOverallRate,
  habitRowsFor,
  hourLoad,
  minutesByColor,
  periodStats,
} from '../../src/components/stats/compute';
import { addDays, lastNDays, todayKey } from '../../src/lib/dates';
import { earningsForDays, meetingOccurrences } from '../../src/lib/meetings';
import { useFocus } from '../../src/store/focus';
import { useHabits } from '../../src/store/habits';
import { useMeetingSession } from '../../src/store/meetingSession';
import { useSettings } from '../../src/store/settings';
import { useTasks } from '../../src/store/tasks';
import { useTheme } from '../../src/theme';

type Range = 'week' | 'month';

export default function StatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tasks = useTasks((s) => s.tasks);
  const habitsMap = useHabits((s) => s.habits);
  const sessions = useFocus((s) => s.sessions);
  const meetingLog = useMeetingSession((s) => s.log);
  const currency = useSettings((s) => s.settings.currencySymbol);
  const weeklyGoal = useSettings((s) => s.settings.weeklyEarningsGoal);
  const [range, setRange] = useState<Range>('week');

  const today = todayKey();
  const n = range === 'week' ? 7 : 30;
  const rangeLabel = range === 'week' ? 'week' : 'month';

  const days = useMemo(() => lastNDays(n, today), [n, today]);
  const prevDays = useMemo(() => lastNDays(n, addDays(today, -n)), [n, today]);

  // Tasks / completion
  const perDay = useMemo(() => completionByDay(tasks, days), [tasks, days]);
  const current = useMemo(() => periodStats(tasks, sessions, days), [tasks, sessions, days]);
  const previous = useMemo(
    () => periodStats(tasks, sessions, prevDays),
    [tasks, sessions, prevDays]
  );
  const hours = useMemo(() => hourLoad(tasks, days), [tasks, days]);
  const slices = useMemo(() => minutesByColor(tasks, days), [tasks, days]);

  // Earnings
  const occurrences = useMemo(() => meetingOccurrences(tasks, days), [tasks, days]);
  const earnings = useMemo(() => earningsForDays(tasks, days), [tasks, days]);

  // Focus
  const focus = useMemo(() => focusStats(sessions, days), [sessions, days]);

  // Habits
  const activeHabits = useMemo(
    () => Object.values(habitsMap).filter((h) => !h.archived),
    [habitsMap]
  );
  const habitRows = useMemo(() => habitRowsFor(activeHabits, days), [activeHabits, days]);
  const habitOverall = useMemo(() => habitOverallRate(habitRows), [habitRows]);

  // Insights
  const insights = useMemo(
    () =>
      buildInsights({
        perDay,
        clients: clientStats(occurrences, meetingLog, days),
        habits: habitRows,
        hours,
        focus,
        currency,
        rangeLabel,
      }),
    [perDay, occurrences, meetingLog, days, habitRows, hours, focus, currency, rangeLabel]
  );

  const hasAnyData = useMemo(
    () =>
      current.planned > 0 ||
      previous.planned > 0 ||
      focus.sessions > 0 ||
      activeHabits.length > 0 ||
      earnings.meetingsPlanned > 0 ||
      meetingLog.length > 0,
    [current.planned, previous.planned, focus.sessions, activeHabits.length, earnings.meetingsPlanned, meetingLog.length]
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Stats" subtitle={`Last ${n} days`} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <GlassSegmented<Range>
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
          value={range}
          onChange={setRange}
        />

        {!hasAnyData ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Nothing to chart yet"
            subtitle="Plan a few tasks, run a focus session, or complete a meeting — your trends will appear here."
          />
        ) : (
          <>
            <HeroTiles current={current} previous={previous} />

            <EarningsCard
              summary={earnings}
              occurrences={occurrences}
              tasks={tasks}
              log={meetingLog}
              days={days}
              currency={currency}
              rangeLabel={rangeLabel}
              weeklyGoal={weeklyGoal}
            />

            <MoneyInsights tasks={tasks} log={meetingLog} currency={currency} />

            <CompletionChart data={perDay} />

            <HourHeatStrip hours={hours} />

            <TimeDonut slices={slices} />

            <FocusCard stats={focus} days={days} />

            <HabitsCard rows={habitRows} overall={habitOverall} />

            <InsightsCard insights={insights} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
});
