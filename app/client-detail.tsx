import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { BackButton } from '../src/components/clients/BackButton';
import { ClientAvatar } from '../src/components/clients/ClientAvatar';
import { ClientChip } from '../src/components/clients/ClientChip';
import { ClientNotesCard } from '../src/components/clients/ClientNotesCard';
import {
  ClientPhoneRow,
  type ClientPhoneRowHandle,
} from '../src/components/clients/ClientPhoneRow';
import { DepositRow } from '../src/components/clients/DepositRow';
import { MessageButton } from '../src/components/clients/MessageButton';
import { RebookSuggestion } from '../src/components/clients/RebookSuggestion';
import { StatTile } from '../src/components/clients/StatTile';
import { GlassCard } from '../src/components/glass/GlassCard';
import {
  formatDayShort,
  formatDuration,
  formatMinutes,
  lastNDays,
} from '../src/lib/dates';
import { successHaptic, tapHaptic } from '../src/lib/haptics';
import {
  clientProfiles,
  formatMoney,
  meetingKindMeta,
  meetingOccurrences,
} from '../src/lib/meetings';
import { useMeetingSession } from '../src/store/meetingSession';
import { useSettings } from '../src/store/settings';
import { showUndo } from '../src/store/undo';
import { useTasks } from '../src/store/tasks';
import { SPACING, taskColor, useTheme } from '../src/theme';

/** Sentence-case section label. */
function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{children}</Text>;
}

/** Everything about one client: money, settle-up, rebooking, history. */
export default function ClientDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const rawName = typeof params.name === 'string' ? params.name : '';

  const phoneRowRef = useRef<ClientPhoneRowHandle>(null);

  const tasks = useTasks((s) => s.tasks);
  const togglePaid = useTasks((s) => s.togglePaid);
  const log = useMeetingSession((s) => s.log);
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const profiles = useMemo(() => clientProfiles(tasks, log), [tasks, log]);
  const profile = useMemo(() => {
    const q = rawName.trim().toLowerCase();
    if (!q) return null;
    return profiles.find((p) => p.name.trim().toLowerCase() === q) ?? null;
  }, [profiles, rawName]);

  /** Recent completed occurrences for this client, newest first, capped at 20. */
  const history = useMemo(() => {
    if (!profile) return [];
    const key = profile.name.trim().toLowerCase();
    return meetingOccurrences(tasks, lastNDays(90))
      .filter((o) => o.completed && o.client.trim().toLowerCase() === key)
      .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
      .slice(0, 20);
  }, [tasks, profile]);

  /** The task behind the next scheduled (uncompleted) occurrence, if any. */
  const nextOcc = useMemo(() => {
    if (!profile?.nextMeeting) return null;
    const key = profile.name.trim().toLowerCase();
    return (
      meetingOccurrences(tasks, [profile.nextMeeting]).find(
        (o) => !o.completed && o.client.trim().toLowerCase() === key
      ) ?? null
    );
  }, [tasks, profile]);

  const avgPerMeeting =
    profile && profile.meetingsDone > 0 ? profile.earned / profile.meetingsDone : 0;

  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;
  const money = theme.success;

  if (!profile) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <BackButton />
          <Text style={[styles.headerTitle, { color: theme.text }]}>Client</Text>
        </View>
        <EmptyState
          icon="person-outline"
          title="Client not found"
          subtitle="This client may have been renamed or removed."
        />
      </View>
    );
  }

  const kindMeta = meetingKindMeta(profile.kind);

  const bookAgain = () => {
    tapHaptic();
    router.push(`/task-editor?client=${encodeURIComponent(profile.name)}`);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <ClientAvatar name={profile.name} size={84} />
          <Text style={[styles.heroName, { color: theme.text }]} numberOfLines={1}>
            {profile.name}
          </Text>
          <View style={styles.chipRow}>
            <ClientChip icon={kindMeta.icon} label={kindMeta.label} />
            {profile.rate > 0 ? (
              <ClientChip
                icon="cash-outline"
                label={formatMoney(profile.rate, symbol)}
                solid={theme.success}
              />
            ) : null}
            {avgPerMeeting > 0 ? (
              <ClientChip
                icon="stats-chart-outline"
                label={`avg ${formatMoney(avgPerMeeting, symbol)}/meeting`}
              />
            ) : null}
            {profile.location ? (
              <ClientChip icon="location-outline" label={profile.location} />
            ) : null}
          </View>
          <MessageButton
            client={profile.name}
            onNeedPhone={() => phoneRowRef.current?.focus()}
          />
        </View>

        {/* Stat tiles */}
        <View style={styles.tileGrid}>
          <StatTile
            label="Earned"
            value={formatMoney(profile.earned, symbol)}
            tint={money}
            delay={40}
          />
          <StatTile label="Collected" value={formatMoney(profile.collected, symbol)} delay={70} />
          <StatTile
            label="Outstanding"
            value={formatMoney(profile.outstanding, symbol)}
            tint={profile.outstanding > 0 ? amberFg : undefined}
            delay={100}
          />
          <StatTile label="Hours" value={formatDuration(profile.loggedMinutes)} delay={130} />
        </View>

        {/* Phone */}
        <View>
          <SectionLabel>Phone</SectionLabel>
          <ClientPhoneRow ref={phoneRowRef} client={profile.name} />
        </View>

        {/* Notes */}
        <View>
          <SectionLabel>Notes</SectionLabel>
          <ClientNotesCard client={profile.name} />
        </View>

        {/* Settle up */}
        {profile.unpaid.length > 0 ? (
          <View>
            <SectionLabel>Settle up</SectionLabel>
            <GlassCard padding={6}>
              {profile.unpaid.map((u, i) => (
                <View
                  key={`${u.task.id}-${u.dateKey}`}
                  style={[
                    styles.settleRow,
                    i > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.separator,
                    },
                  ]}
                >
                  <Text style={[styles.settleDate, { color: theme.text }]}>
                    {formatDayShort(u.dateKey)}
                  </Text>
                  <Text style={[styles.settleAmount, { color: amberFg }]}>
                    {formatMoney(u.amount, symbol)}
                  </Text>
                  <Pressable
                    onPress={() => {
                      successHaptic();
                      togglePaid(u.task.id, u.dateKey);
                      showUndo(
                        `Marked ${formatDayShort(u.dateKey)} paid`,
                        () => togglePaid(u.task.id, u.dateKey)
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${formatDayShort(u.dateKey)} paid`}
                    style={({ pressed }) => [
                      styles.paidPill,
                      { backgroundColor: theme.success },
                      pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
                    ]}
                  >
                    <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                    <Text style={styles.paidPillLabel}>Mark paid</Text>
                  </Pressable>
                </View>
              ))}
            </GlassCard>
          </View>
        ) : null}

        {/* Upcoming — next booking with its deposit affordance */}
        {nextOcc ? (
          <View>
            <SectionLabel>Upcoming</SectionLabel>
            <DepositRow task={nextOcc.task} dateKey={nextOcc.dateKey} />
          </View>
        ) : null}

        {/* Book again */}
        <View>
          <SectionLabel>Book again</SectionLabel>
          <RebookSuggestion client={profile.name} />
          <Pressable
            onPress={bookAgain}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: theme.accent },
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Ionicons name="calendar-outline" size={18} color="#FFFFFF" />
            <Text style={styles.ctaLabel}>Book a meeting</Text>
          </Pressable>
        </View>

        {/* History */}
        {history.length > 0 ? (
          <View>
            <SectionLabel>History</SectionLabel>
            <GlassCard padding={6}>
              {history.map((o, i) => (
                <View
                  key={`${o.task.id}-${o.dateKey}`}
                  style={[
                    styles.historyRow,
                    i > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.separator,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyDate, { color: theme.text }]}>
                      {formatDayShort(o.dateKey)}
                    </Text>
                    <Text style={[styles.historyTime, { color: theme.textTertiary }]}>
                      {o.task.allDay || o.task.startMinutes == null
                        ? 'All day'
                        : formatMinutes(o.task.startMinutes)}
                    </Text>
                  </View>
                  <Text style={[styles.historyAmount, { color: money }]}>
                    {formatMoney(o.rate, symbol)}
                  </Text>
                  <Ionicons
                    name={o.paid ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={o.paid ? theme.success : theme.textTertiary}
                  />
                </View>
              ))}
            </GlassCard>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 4,
  },
  hero: {
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  heroName: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    maxWidth: '90%',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm + 2,
  },
  settleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm + 4,
  },
  settleDate: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  settleAmount: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  paidPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  paidPillLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm + 2,
  },
  historyDate: {
    fontSize: 14,
    fontWeight: '600',
  },
  historyTime: {
    fontSize: 12,
    marginTop: 1,
  },
  historyAmount: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
