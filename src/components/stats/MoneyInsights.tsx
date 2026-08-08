import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { formatMoney, meetingKindMeta } from '../../lib/meetings';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { MeetingKind, MeetingLogEntry, Task } from '../../types';
import { moneyStats, monthlyEarnings } from './compute';
import { fmtHoursCompact } from './format';
import { InlineEmpty, StatsCard } from './StatsCard';

interface Props {
  /** Full task record — lifetime rollups walk every meeting task. */
  tasks: Record<string, Task>;
  /** Full live-session log (all time). */
  log: MeetingLogEntry[];
  currency: string;
}

const TREND_HEIGHT = 56;
/** Headroom above the tallest bar for the selected month's total. */
const TREND_VALUE_ROOM = 16;

/** Hex-alpha tiers of the accent so the kind split stays one-accent clean. */
const KIND_ALPHA: Record<MeetingKind, string> = {
  incall: 'FF',
  outcall: 'B3',
  public: '5C',
};

/**
 * Lifetime money analytics: 6-month trend, effective hourly, kind split, and
 * top clients all-time. Complements EarningsCard, which is range-windowed.
 */
export function MoneyInsights({ tasks, log, currency }: Props) {
  const theme = useTheme();
  const router = useRouter();

  const money = useMemo(() => moneyStats(tasks, log), [tasks, log]);
  const months = useMemo(() => monthlyEarnings(tasks), [tasks]);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = picked ?? months.length - 1;

  const hasTrend = useMemo(() => months.some((m) => m.earned > 0), [months]);
  const trendMax = useMemo(
    () => Math.max(...months.map((m) => m.earned), 1),
    [months]
  );
  const kindTotal = useMemo(
    () => money.kinds.reduce((sum, k) => sum + k.earned, 0),
    [money.kinds]
  );

  const empty = money.meetings === 0 && money.loggedMinutes === 0;

  const lifetimeHourly =
    money.loggedMinutes > 0 ? money.earned / (money.loggedMinutes / 60) : null;
  const monthHourly =
    money.monthLoggedMinutes > 0
      ? money.monthEarned / (money.monthLoggedMinutes / 60)
      : null;

  const kindColor = (kind: MeetingKind) =>
    KIND_ALPHA[kind] === 'FF' ? theme.accent : `${theme.accent}${KIND_ALPHA[kind]}`;

  return (
    <StatsCard
      label="Money"
      right={
        empty ? undefined : (
          <View
            style={[
              styles.pill,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons name="wallet-outline" size={11} color={theme.textSecondary} />
            <Text style={[styles.pillLabel, { color: theme.textSecondary }]}>
              {formatMoney(money.earned, currency)} lifetime
            </Text>
          </View>
        )
      }
    >
      {empty ? (
        <InlineEmpty
          icon="cash-outline"
          text="No completed meetings yet — money insights build here after your first one."
        />
      ) : (
        <View style={styles.body}>
          {/* 1 · Monthly trend */}
          {hasTrend ? (
            <View style={styles.section}>
              <Text style={[styles.subHeader, { color: theme.textSecondary }]}>
                Monthly trend
              </Text>
              <View style={styles.trendRow}>
                {months.map((m, i) => {
                  const isSelected = i === selected;
                  const isCurrent = i === months.length - 1;
                  const h =
                    m.earned <= 0
                      ? 3
                      : Math.max(5, Math.round((m.earned / trendMax) * TREND_HEIGHT));
                  return (
                    <Pressable
                      key={`${m.label}-${i}`}
                      onPress={() => {
                        tapHaptic();
                        setPicked(i);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${m.label}: ${formatMoney(
                        m.earned,
                        currency
                      )} earned${isCurrent ? ', current month' : ''}`}
                      style={styles.trendCol}
                    >
                      <View
                        style={[
                          styles.trendSlot,
                          { height: TREND_HEIGHT + TREND_VALUE_ROOM },
                        ]}
                      >
                        {isSelected ? (
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.trendValue,
                              { color: theme.text, bottom: h + 3 },
                            ]}
                          >
                            {formatMoney(m.earned, currency)}
                          </Text>
                        ) : null}
                        <View
                          style={[
                            styles.trendBar,
                            m.earned > 0
                              ? {
                                  height: h,
                                  backgroundColor: isSelected
                                    ? theme.success
                                    : theme.accent,
                                  opacity: isSelected ? 1 : 0.75,
                                }
                              : { height: h, backgroundColor: theme.surface },
                          ]}
                        />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.trendInitial,
                          {
                            color:
                              isSelected || isCurrent
                                ? theme.text
                                : theme.textTertiary,
                          },
                        ]}
                      >
                        {m.label.slice(0, 1)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* 2 · Effective hourly */}
          <View style={styles.hourlyRow}>
            <HourlyBox
              label="Effective hourly"
              hourly={lifetimeHourly}
              loggedMinutes={money.loggedMinutes}
              currency={currency}
            />
            <HourlyBox
              label="This month"
              hourly={monthHourly}
              loggedMinutes={money.monthLoggedMinutes}
              currency={currency}
            />
          </View>

          {/* 3 · Kind split */}
          {kindTotal > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.subHeader, { color: theme.textSecondary }]}>
                By kind
              </Text>
              <View
                style={[styles.kindBar, { backgroundColor: theme.surface }]}
                accessibilityLabel={money.kinds
                  .map(
                    (k) =>
                      `${meetingKindMeta(k.kind).label} ${Math.round(
                        (k.earned / kindTotal) * 100
                      )} percent`
                  )
                  .join(', ')}
              >
                {money.kinds.map((k) => (
                  <View
                    key={k.kind}
                    style={{ flex: k.earned, backgroundColor: kindColor(k.kind) }}
                  />
                ))}
              </View>
              <View style={styles.kindLegend}>
                {money.kinds.map((k) => {
                  const meta = meetingKindMeta(k.kind);
                  return (
                    <View key={k.kind} style={styles.kindLegendItem}>
                      <Ionicons
                        name={meta.icon as never}
                        size={12}
                        color={kindColor(k.kind)}
                      />
                      <Text
                        numberOfLines={1}
                        style={[styles.kindLegendLabel, { color: theme.textSecondary }]}
                      >
                        {meta.label}
                      </Text>
                      <Text style={[styles.kindLegendPct, { color: theme.text }]}>
                        {Math.round((k.earned / kindTotal) * 100)}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* 4 · Top clients, lifetime */}
          {money.clients.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.subHeader, { color: theme.textSecondary }]}>
                Top clients · lifetime
              </Text>
              {money.clients.slice(0, 5).map((c, i) => (
                <Pressable
                  key={c.client.toLowerCase()}
                  onPress={() => {
                    tapHaptic();
                    router.push(`/client-detail?name=${encodeURIComponent(c.client)}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.client}: ${formatMoney(
                    c.earned,
                    currency
                  )} earned across ${c.meetings} ${
                    c.meetings === 1 ? 'meeting' : 'meetings'
                  }. Opens client details.`}
                  style={({ pressed }) => [
                    styles.clientRow,
                    pressed && { opacity: 0.65 },
                  ]}
                >
                  <Text style={[styles.clientRank, { color: theme.textTertiary }]}>
                    {i + 1}
                  </Text>
                  <View style={styles.clientCol}>
                    <Text
                      numberOfLines={1}
                      style={[styles.clientName, { color: theme.text }]}
                    >
                      {c.client}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.clientMeetings, { color: theme.textTertiary }]}
                    >
                      {c.meetings} {c.meetings === 1 ? 'meeting' : 'meetings'}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[styles.clientEarned, { color: theme.success }]}
                  >
                    {formatMoney(c.earned, currency)}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={theme.textTertiary}
                  />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </StatsCard>
  );
}

/** One flat effective-hourly tile; "—" with a caption when nothing is logged. */
function HourlyBox({
  label,
  hourly,
  loggedMinutes,
  currency,
}: {
  label: string;
  hourly: number | null;
  loggedMinutes: number;
  currency: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.hourlyBox,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
      accessibilityLabel={
        hourly != null
          ? `${label}: ${formatMoney(hourly, currency)} per hour across ${fmtHoursCompact(
              loggedMinutes
            )} logged`
          : `${label}: no sessions logged yet`
      }
    >
      <Text numberOfLines={1} style={[styles.hourlyLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
      {hourly != null ? (
        <>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.hourlyValue, { color: theme.success }]}
          >
            {formatMoney(hourly, currency)}
            <Text style={styles.hourlyUnit}>/hr</Text>
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.hourlyCaption, { color: theme.textTertiary }]}
          >
            {fmtHoursCompact(loggedMinutes)} logged
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.hourlyValue, { color: theme.textTertiary }]}>—</Text>
          <Text
            numberOfLines={1}
            style={[styles.hourlyCaption, { color: theme.textTertiary }]}
          >
            no sessions logged
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: SPACING.lg },
  section: { gap: 10 },
  subHeader: { fontSize: 12, fontWeight: '600' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillLabel: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Monthly trend
  trendRow: { flexDirection: 'row', gap: 8 },
  trendCol: { flex: 1, alignItems: 'stretch', gap: 4 },
  trendSlot: { justifyContent: 'flex-end' },
  trendBar: {
    width: '100%',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  trendValue: {
    position: 'absolute',
    left: -20,
    right: -20,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  trendInitial: { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  // Effective hourly
  hourlyRow: { flexDirection: 'row', gap: 10 },
  hourlyBox: {
    flex: 1,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    gap: 3,
  },
  hourlyLabel: { fontSize: 11, fontWeight: '600' },
  hourlyValue: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  hourlyUnit: { fontSize: 13, fontWeight: '600', letterSpacing: 0 },
  hourlyCaption: { fontSize: 11, fontWeight: '500' },
  // Kind split
  kindBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
  },
  kindLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kindLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  kindLegendLabel: { fontSize: 11, fontWeight: '600' },
  kindLegendPct: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Top clients
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clientRank: {
    width: 16,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  clientCol: { flex: 1, gap: 1 },
  clientName: { fontSize: 14, fontWeight: '600' },
  clientMeetings: { fontSize: 12, fontWeight: '500' },
  clientEarned: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
});
