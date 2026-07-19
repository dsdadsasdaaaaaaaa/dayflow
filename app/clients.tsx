import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { BackButton } from '../src/components/clients/BackButton';
import { ClientAvatar } from '../src/components/clients/ClientAvatar';
import { ClientChip } from '../src/components/clients/ClientChip';
import { GlassCard } from '../src/components/glass/GlassCard';
import { formatDayRelative } from '../src/lib/dates';
import { tapHaptic } from '../src/lib/haptics';
import { clientProfiles, formatMoney, type ClientProfile } from '../src/lib/meetings';
import { useMeetingSession } from '../src/store/meetingSession';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { SPACING, taskColor, useTheme } from '../src/theme';

/** One client row: avatar, name, stats subtitle, money on the right. */
function ClientRow({
  profile,
  symbol,
}: {
  profile: ClientProfile;
  symbol: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;
  const money = theme.success;

  const hours = Math.round((profile.loggedMinutes / 60) * 10) / 10;
  const parts = [
    `${profile.meetingsDone} meeting${profile.meetingsDone === 1 ? '' : 's'}`,
    `${hours}h`,
  ];
  if (profile.lastSeen) parts.push(`last seen ${formatDayRelative(profile.lastSeen)}`);

  return (
    <View>
      <Pressable
        onPress={() => {
          tapHaptic();
          router.push(`/client-detail?name=${encodeURIComponent(profile.name)}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${profile.name}`}
        style={({ pressed }) => [pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <GlassCard padding={14} style={{ marginBottom: SPACING.md }}>
          <View style={styles.rowInner}>
            <ClientAvatar name={profile.name} size={46} />
            <View style={styles.rowText}>
              <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                {profile.name}
              </Text>
              <Text style={[styles.rowSub, { color: theme.textTertiary }]} numberOfLines={1}>
                {parts.join(' · ')}
              </Text>
              {profile.nextMeeting ? (
                <View style={styles.rowChips}>
                  <ClientChip
                    icon="calendar-outline"
                    label={`Next: ${formatDayRelative(profile.nextMeeting)}`}
                    tint={theme.accent}
                    fill={theme.accentSoft}
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowEarned, { color: money }]} numberOfLines={1}>
                {formatMoney(profile.earned, symbol)}
              </Text>
              {profile.outstanding > 0 ? (
                <ClientChip
                  label={`owes ${formatMoney(profile.outstanding, symbol)}`}
                  tint={amberFg}
                />
              ) : null}
            </View>
          </View>
        </GlassCard>
      </Pressable>
    </View>
  );
}

/** The client book: every client the user has met, ranked by earnings. */
export default function ClientsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tasks = useTasks((s) => s.tasks);
  const log = useMeetingSession((s) => s.log);
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const profiles = useMemo(() => clientProfiles(tasks, log), [tasks, log]);
  const outstanding = useMemo(
    () => profiles.reduce((sum, p) => sum + p.outstanding, 0),
    [profiles]
  );
  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Clients</Text>
          {profiles.length > 0 ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {profiles.length} client{profiles.length === 1 ? '' : 's'}
              {outstanding > 0 ? (
                <Text style={{ color: amberFg, fontWeight: '700' }}>
                  {'  ·  '}
                  {formatMoney(outstanding, symbol)} outstanding
                </Text>
              ) : null}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {profiles.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No clients yet"
            subtitle="Turn any task into a client meeting and they'll appear here."
          />
        ) : (
          profiles.map((p) => (
            <ClientRow key={p.name.toLowerCase()} profile={p} symbol={symbol} />
          ))
        )}
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
    paddingBottom: SPACING.md,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 4,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '700',
  },
  rowSub: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  rowChips: {
    flexDirection: 'row',
    marginTop: 6,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  rowEarned: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
