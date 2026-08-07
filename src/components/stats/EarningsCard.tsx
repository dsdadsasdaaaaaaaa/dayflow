import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { tapHaptic } from '../../lib/haptics';
import { formatMoney, meetingKindMeta } from '../../lib/meetings';
import type { EarningsSummary, MeetingOccurrence } from '../../lib/meetings';
import { fromDayKey, weekdayOf, weekdayShort } from '../../lib/dates';
import { RADIUS, SPACING, taskColor, useTheme } from '../../theme';
import type { DayKey, MeetingLogEntry, Task } from '../../types';
import {
  clientStats,
  earningsPerDay,
  kindStats,
  monthlyEarnings,
  sessionStats,
} from './compute';
import type { MonthEarning } from './compute';
import { fmtClockCompact, fmtHoursCompact } from './format';
import { Bars } from './Bars';
import { InlineEmpty, StatsCard } from './StatsCard';

interface Props {
  summary: EarningsSummary;
  occurrences: MeetingOccurrence[];
  /** Full task record — used for the 6-month earnings trend. */
  tasks: Record<string, Task>;
  /** Full session log — filtered to `days` internally. */
  log: MeetingLogEntry[];
  days: DayKey[];
  currency: string;
  /** "week" | "month" — used in copy. */
  rangeLabel: string;
  /** settings.weeklyEarningsGoal — shows the goal progress bar when set. */
  weeklyGoal?: number | null;
}

/** Flagship earnings dashboard: paid client meetings, money in and money owed. */
export function EarningsCard({
  summary,
  occurrences,
  tasks,
  log,
  days,
  currency,
  rangeLabel,
  weeklyGoal = null,
}: Props) {
  const theme = useTheme();
  const router = useRouter();
  const emerald = taskColor('emerald');
  const amber = taskColor('amber');
  const emeraldFg = theme.dark ? emerald.fgDark : emerald.fgLight;
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;

  const perDay = useMemo(() => earningsPerDay(occurrences, days), [occurrences, days]);
  const clients = useMemo(() => clientStats(occurrences, log, days), [occurrences, log, days]);
  const kinds = useMemo(() => kindStats(occurrences), [occurrences]);
  const sessions = useMemo(() => sessionStats(log, days), [log, days]);
  const months = useMemo(() => monthlyEarnings(tasks), [tasks]);
  const hasMonthlyTrend = useMemo(() => months.some((m) => m.earned > 0), [months]);
  const outstandingCount = useMemo(
    () => occurrences.filter((m) => m.completed && !m.paid).length,
    [occurrences]
  );
  const barLabels = useMemo(
    () =>
      days.map((d, i) => {
        if (days.length <= 7) return weekdayShort(weekdayOf(d)).slice(0, 2);
        const dom = fromDayKey(d).getDate();
        return i === 0 || i === days.length - 1 || dom % 5 === 0 ? String(dom) : '';
      }),
    [days]
  );

  const hasLog = sessions.count > 0;
  const empty = summary.meetingsPlanned === 0 && !hasLog;

  // Weekly goal, scaled ×(days/7) when looking at a month.
  const isWeek = rangeLabel === 'week';
  const goalTarget = useMemo(() => {
    if (weeklyGoal == null || weeklyGoal <= 0) return null;
    return isWeek ? weeklyGoal : Math.round((weeklyGoal * days.length) / 7);
  }, [weeklyGoal, isWeek, days.length]);

  return (
    <StatsCard
      label="Earnings"
      right={
        empty ? undefined : (
          <View
            style={[
              styles.countPill,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons name="briefcase-outline" size={11} color={theme.textSecondary} />
            <Text style={[styles.countPillLabel, { color: theme.textSecondary }]}>
              {summary.meetingsDone}/{summary.meetingsPlanned}{' '}
              {summary.meetingsPlanned === 1 ? 'meeting' : 'meetings'}
            </Text>
          </View>
        )
      }
    >
      {empty ? (
        <InlineEmpty
          icon="cash-outline"
          text={`No meetings this ${rangeLabel}. Add a client meeting from the timeline and earnings will show up here.`}
        />
      ) : (
        <View style={styles.body}>
          {/* Big earned number */}
          <View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.earnedValue, { color: theme.success }]}
            >
              {formatMoney(summary.earned, currency)}
            </Text>
            <Text style={[styles.earnedCaption, { color: theme.textSecondary }]}>
              earned this {rangeLabel}
              {summary.expected > summary.earned
                ? ` · ${formatMoney(summary.expected, currency)} expected`
                : ''}
            </Text>
            {goalTarget != null ? (
              <GoalBar
                earned={summary.earned}
                target={goalTarget}
                caption={isWeek ? 'goal' : 'monthly pace'}
                currency={currency}
              />
            ) : null}
          </View>

          {/* Collected / Outstanding split */}
          <View style={styles.splitRow}>
            <View style={styles.splitWrap}>
              <View
                style={[
                  styles.splitBox,
                  {
                    backgroundColor: theme.dark ? emerald.bgDark : emerald.bgLight,
                    borderColor: `${emerald.solid}55`,
                  },
                ]}
              >
                <View style={styles.splitHead}>
                  <Ionicons name="checkmark-done-outline" size={13} color={emeraldFg} />
                  <Text style={[styles.splitLabel, { color: emeraldFg }]}>Collected</Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={[styles.splitValue, { color: emeraldFg }]}
                >
                  {formatMoney(summary.collected, currency)}
                </Text>
              </View>
            </View>

            <View style={styles.splitWrap}>
              <View
                style={[
                  styles.splitBox,
                  summary.outstanding > 0
                    ? {
                        backgroundColor: theme.dark ? amber.bgDark : amber.bgLight,
                        borderColor: `${amber.solid}55`,
                      }
                    : {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                      },
                ]}
              >
                <View style={styles.splitHead}>
                  <Ionicons
                    name="hourglass-outline"
                    size={13}
                    color={summary.outstanding > 0 ? amberFg : theme.textTertiary}
                  />
                  <Text
                    style={[
                      styles.splitLabel,
                      { color: summary.outstanding > 0 ? amberFg : theme.textTertiary },
                    ]}
                  >
                    Outstanding
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.splitValue,
                    { color: summary.outstanding > 0 ? amberFg : theme.textSecondary },
                  ]}
                >
                  {formatMoney(summary.outstanding, currency)}
                </Text>
                {summary.outstanding > 0 ? (
                  <Text style={[styles.splitSub, { color: amberFg }]}>
                    {outstandingCount} unpaid
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Earnings per day */}
          {summary.earned > 0 ? (
            <Bars
              values={perDay}
              color={theme.success}
              height={54}
              highlightIndex={days.length - 1}
              labels={barLabels}
            />
          ) : null}

          {/* 6-month trend */}
          {hasMonthlyTrend ? (
            <View style={styles.trendWrap}>
              <Text style={[styles.subHeader, { color: theme.textSecondary }]}>
                Last 6 months
              </Text>
              <MonthTrend months={months} currency={currency} />
            </View>
          ) : null}

          {/* Split by kind */}
          {kinds.length > 0 ? (
            <View style={styles.kindRow}>
              {kinds.map((k) => {
                const meta = meetingKindMeta(k.kind);
                return (
                  <View
                    key={k.kind}
                    style={[
                      styles.kindChip,
                      { backgroundColor: theme.surface, borderColor: theme.border },
                    ]}
                  >
                    <Ionicons name={meta.icon as never} size={14} color={theme.accent} />
                    <View style={styles.kindTextCol}>
                      <Text
                        numberOfLines={1}
                        style={[styles.kindLabel, { color: theme.textSecondary }]}
                      >
                        {meta.label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.kindValue, { color: theme.text }]}
                      >
                        {k.meetings} · {formatMoney(k.earned, currency)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Top clients */}
          {clients.length > 0 ? (
            <View style={styles.clientsWrap}>
              <Text style={[styles.subHeader, { color: theme.textSecondary }]}>
                Top clients
              </Text>
              {clients.slice(0, 4).map((c) => {
                const minutes = c.loggedMinutes > 0 ? c.loggedMinutes : c.plannedMinutes;
                return (
                  <View key={c.client} style={styles.clientRow}>
                    <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
                      <Text style={styles.avatarLetter}>
                        {c.client.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.clientTextCol}>
                      <Text
                        numberOfLines={1}
                        style={[styles.clientName, { color: theme.text }]}
                      >
                        {c.client}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.clientSub, { color: theme.textTertiary }]}
                      >
                        {c.meetings} {c.meetings === 1 ? 'meeting' : 'meetings'}
                        {minutes > 0 ? ` · ${fmtHoursCompact(minutes)}` : ''}
                        {c.avgPerMeeting > 0
                          ? ` · ${formatMoney(c.avgPerMeeting, currency)} avg`
                          : ''}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[styles.clientAmount, { color: theme.text }]}
                    >
                      {formatMoney(c.earned, currency)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Live session stats */}
          {hasLog ? (
            <View style={[styles.sessionRow, { borderTopColor: theme.separator }]}>
              <View style={styles.sessionItem}>
                <Ionicons name="stopwatch-outline" size={13} color={theme.textTertiary} />
                <Text style={[styles.sessionLabel, { color: theme.textSecondary }]}>
                  Avg session {fmtClockCompact(sessions.avgMinutes)}
                </Text>
              </View>
              <View style={styles.sessionItem}>
                <Ionicons name="add-circle-outline" size={13} color={theme.textTertiary} />
                <Text style={[styles.sessionLabel, { color: theme.textSecondary }]}>
                  {sessions.overtimeMinutes > 0
                    ? `Overtime ${fmtClockCompact(sessions.overtimeMinutes)}`
                    : 'No overtime'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Client book link */}
          <Pressable
            onPress={() => {
              tapHaptic();
              router.push('/clients');
            }}
            style={({ pressed }) => [
              styles.clientsLink,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
            ]}
          >
            <View style={[styles.clientsLinkIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="people-outline" size={15} color={theme.accent} />
            </View>
            <Text style={[styles.clientsLinkText, { color: theme.text }]}>All clients</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
          </Pressable>
        </View>
      )}
    </StatsCard>
  );
}

const TREND_BAR_HEIGHT = 44;

/**
 * Flat 6-month mini bar trend: accent bars, success-green current month,
 * month initials underneath, and a gentle "vs last month" delta line
 * (success when up, neutral gray when down — never shame-red).
 */
function MonthTrend({ months, currency }: { months: MonthEarning[]; currency: string }) {
  const theme = useTheme();
  const max = Math.max(...months.map((m) => m.earned), 1);
  const prev = months.length >= 2 ? months[months.length - 2] : null;
  const currentMonth = months[months.length - 1];
  const delta = prev && currentMonth ? currentMonth.earned - prev.earned : null;

  return (
    <View style={styles.trendBody}>
      <View style={styles.trendRow}>
        {months.map((m, i) => {
          const isCurrent = i === months.length - 1;
          const h =
            m.earned <= 0
              ? 3
              : Math.max(5, Math.round((m.earned / max) * TREND_BAR_HEIGHT));
          return (
            <View key={`${m.label}-${i}`} style={styles.trendCol}>
              <View style={[styles.trendBarSlot, { height: TREND_BAR_HEIGHT }]}>
                <View
                  style={[
                    styles.trendBar,
                    {
                      height: h,
                      backgroundColor:
                        m.earned > 0
                          ? isCurrent
                            ? theme.success
                            : theme.accent
                          : theme.surface,
                      opacity: m.earned > 0 && !isCurrent ? 0.75 : 1,
                    },
                  ]}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.trendLabel,
                  { color: isCurrent ? theme.text : theme.textTertiary },
                ]}
              >
                {m.label.slice(0, 1)}
              </Text>
            </View>
          );
        })}
      </View>
      {delta != null ? (
        <Text
          numberOfLines={1}
          style={[
            styles.trendDelta,
            { color: delta >= 0 ? theme.success : theme.textSecondary },
          ]}
        >
          {delta >= 0 ? '+' : '-'}
          {formatMoney(Math.abs(delta), currency)} vs last month
        </Text>
      ) : null}
    </View>
  );
}

/** Animated weekly-goal progress: flat track + solid success fill. */
function GoalBar({
  earned,
  target,
  /** "goal" (week) or "monthly pace" (month, goal scaled ×days/7). */
  caption,
  currency,
}: {
  earned: number;
  target: number;
  caption: string;
  currency: string;
}) {
  const theme = useTheme();
  const frac = Math.min(1, target > 0 ? earned / target : 0);
  const hit = earned >= target;

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(frac, {
      duration: 800,
      easing: Easing.out(Easing.cubic),
    });
  }, [frac, progress]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={styles.goalWrap}>
      <View
        style={[
          styles.goalTrack,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Animated.View
          style={[styles.goalFill, { backgroundColor: theme.success }, fillStyle]}
        />
      </View>
      <View style={styles.goalCaptionRow}>
        <Text
          numberOfLines={1}
          style={[styles.goalCaption, { color: theme.textSecondary }]}
        >
          {formatMoney(earned, currency)} of {formatMoney(target, currency)} {caption}
        </Text>
        {hit ? (
          <View style={styles.goalHit}>
            <Ionicons name="trophy" size={12} color={theme.success} />
            <Text style={[styles.goalHitLabel, { color: theme.success }]}>Goal hit</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: SPACING.lg },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  countPillLabel: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  earnedValue: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  earnedCaption: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  goalWrap: { marginTop: SPACING.md, gap: 7 },
  goalTrack: {
    height: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    borderRadius: 999,
  },
  goalCaptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  goalCaption: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  goalHit: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  goalHitLabel: { fontSize: 12, fontWeight: '700' },
  clientsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 11,
    paddingHorizontal: SPACING.md,
  },
  clientsLinkIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientsLinkText: { flex: 1, fontSize: 14, fontWeight: '600' },
  splitRow: { flexDirection: 'row', gap: 10 },
  splitWrap: { flex: 1 },
  splitBox: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    gap: 3,
    overflow: 'hidden',
  },
  splitHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  splitLabel: { fontSize: 11, fontWeight: '600' },
  splitValue: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  splitSub: { fontSize: 11, fontWeight: '600', opacity: 0.85 },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  kindTextCol: { flex: 1, gap: 1 },
  kindLabel: { fontSize: 10, fontWeight: '600' },
  kindValue: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  trendWrap: { gap: 10 },
  trendBody: { gap: 8 },
  trendRow: { flexDirection: 'row', gap: 8 },
  trendCol: { flex: 1, alignItems: 'stretch', gap: 4 },
  trendBarSlot: { justifyContent: 'flex-end' },
  trendBar: {
    width: '100%',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  trendLabel: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  trendDelta: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  clientsWrap: { gap: 10 },
  subHeader: { fontSize: 12, fontWeight: '600' },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 15, fontWeight: '800', color: '#fff' },
  clientTextCol: { flex: 1, gap: 1 },
  clientName: { fontSize: 14, fontWeight: '600' },
  clientSub: { fontSize: 12, fontWeight: '500' },
  clientAmount: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  sessionRow: {
    flexDirection: 'row',
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.md,
  },
  sessionItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sessionLabel: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
