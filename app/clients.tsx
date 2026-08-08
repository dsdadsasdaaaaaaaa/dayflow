import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { BackButton } from '../src/components/clients/BackButton';
import { ClientAvatar } from '../src/components/clients/ClientAvatar';
import { ClientChip } from '../src/components/clients/ClientChip';
import { StatusDot } from '../src/components/clients/StatusDot';
import { statusColor } from '../src/components/clients/status';
import { GlassCard } from '../src/components/glass/GlassCard';
import { formatPhoneDisplay } from '../src/components/messages/format';
import { formatDayRelative } from '../src/lib/dates';
import { tapHaptic } from '../src/lib/haptics';
import { clientProfiles, formatMoney, type ClientProfile } from '../src/lib/meetings';
import {
  clientMetaKey,
  effectiveStatus,
  useClientMeta,
  type ClientStatus,
} from '../src/store/clientMeta';
import { useMeetingSession } from '../src/store/meetingSession';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { SPACING, taskColor, useTheme } from '../src/theme';

/** One row of the book: a full meeting profile, or a contact-only entry. */
interface BookEntry {
  key: string;
  name: string;
  status: ClientStatus;
  profile: ClientProfile | null;
  phone?: string;
}

/** "jamie r" (lowercased meta key) → "Jamie R" for display. */
function titleCase(key: string): string {
  return key
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** One client row: avatar, name + status dot, stats subtitle, money on the right. */
function ClientRow({
  entry,
  symbol,
  dimmed,
}: {
  entry: BookEntry;
  symbol: string;
  dimmed?: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;
  const money = theme.success;
  const { profile } = entry;

  const parts: string[] = [];
  if (profile) {
    const hours = Math.round((profile.loggedMinutes / 60) * 10) / 10;
    parts.push(
      `${profile.meetingsDone} meeting${profile.meetingsDone === 1 ? '' : 's'}`,
      `${hours}h`
    );
    if (profile.lastSeen) parts.push(`last seen ${formatDayRelative(profile.lastSeen)}`);
  } else {
    parts.push(entry.phone ? formatPhoneDisplay(entry.phone) : 'No meetings yet');
  }

  return (
    <View style={dimmed ? { opacity: 0.55 } : null}>
      <Pressable
        onPress={() => {
          tapHaptic();
          router.push(`/client-detail?name=${encodeURIComponent(entry.name)}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${entry.name}`}
        style={({ pressed }) => [pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <GlassCard padding={14} style={{ marginBottom: SPACING.md }}>
          <View style={styles.rowInner}>
            <ClientAvatar name={entry.name} size={46} />
            <View style={styles.rowText}>
              <View style={styles.rowNameRow}>
                <StatusDot color={statusColor(entry.status, theme)} size={7} />
                <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                  {entry.name}
                </Text>
              </View>
              <Text style={[styles.rowSub, { color: theme.textTertiary }]} numberOfLines={1}>
                {parts.join(' · ')}
              </Text>
              {profile?.nextMeeting ? (
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
            {profile ? (
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
            ) : (
              <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
            )}
          </View>
        </GlassCard>
      </Pressable>
    </View>
  );
}

/** Sentence-case section label. */
function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{children}</Text>
  );
}

/**
 * The client book, sectioned by relationship stage: established clients,
 * then leads still being screened, then a collapsed blocked list.
 */
export default function ClientsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tasks = useTasks((s) => s.tasks);
  const log = useMeetingSession((s) => s.log);
  const symbol = useSettings((s) => s.settings.currencySymbol);
  const meta = useClientMeta((s) => s.meta);

  const [blockedOpen, setBlockedOpen] = useState(false);

  const profiles = useMemo(() => clientProfiles(tasks, log), [tasks, log]);

  /** Meeting profiles + contact-only entries from the messenger/lead pipeline. */
  const entries = useMemo<BookEntry[]>(() => {
    const list: BookEntry[] = profiles.map((p) => ({
      key: clientMetaKey(p.name),
      name: p.name,
      status: effectiveStatus(meta, p.name, p.meetingsDone > 0),
      profile: p,
      phone: meta[clientMetaKey(p.name)]?.phone,
    }));
    const seen = new Set(list.map((e) => e.key));
    for (const [key, m] of Object.entries(meta)) {
      if (seen.has(key) || (!m.status && !m.phone)) continue;
      list.push({
        key,
        name: m.displayName ?? titleCase(key),
        status: m.status ?? 'lead',
        profile: null,
        phone: m.phone,
      });
    }
    return list;
  }, [profiles, meta]);

  const byEarned = (a: BookEntry, b: BookEntry) =>
    (b.profile?.earned ?? 0) - (a.profile?.earned ?? 0) || a.name.localeCompare(b.name);

  const clients = useMemo(
    () => entries.filter((e) => e.status === 'client').sort(byEarned),
    [entries]
  );
  const leads = useMemo(
    () => entries.filter((e) => e.status === 'lead').sort(byEarned),
    [entries]
  );
  const blocked = useMemo(
    () => entries.filter((e) => e.status === 'blocked').sort(byEarned),
    [entries]
  );

  const outstanding = useMemo(
    () => profiles.reduce((sum, p) => sum + p.outstanding, 0),
    [profiles]
  );
  const amber = taskColor('amber');
  const amberFg = theme.dark ? amber.fgDark : amber.fgLight;

  const subtitleParts: string[] = [];
  if (clients.length > 0) {
    subtitleParts.push(`${clients.length} client${clients.length === 1 ? '' : 's'}`);
  }
  if (leads.length > 0) {
    subtitleParts.push(`${leads.length} lead${leads.length === 1 ? '' : 's'}`);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Clients</Text>
          {subtitleParts.length > 0 ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {subtitleParts.join(' · ')}
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
        {entries.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No clients yet"
            subtitle="Turn any task into a client meeting and they'll appear here."
          />
        ) : (
          <>
            {clients.length > 0 ? (
              <View>
                <SectionLabel>Clients</SectionLabel>
                {clients.map((e) => (
                  <ClientRow key={e.key} entry={e} symbol={symbol} />
                ))}
              </View>
            ) : null}

            {leads.length > 0 ? (
              <View>
                <SectionLabel>Leads</SectionLabel>
                {leads.map((e) => (
                  <ClientRow key={e.key} entry={e} symbol={symbol} />
                ))}
              </View>
            ) : null}

            {blocked.length > 0 ? (
              <View>
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setBlockedOpen((v) => !v);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: blockedOpen }}
                  accessibilityLabel={`Blocked clients, ${blocked.length}`}
                  style={({ pressed }) => [styles.blockedHeader, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.sectionLabelInline, { color: theme.textSecondary }]}>
                    Blocked
                  </Text>
                  <Text style={[styles.blockedCount, { color: theme.textTertiary }]}>
                    {blocked.length}
                  </Text>
                  <Ionicons
                    name={blockedOpen ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={theme.textTertiary}
                  />
                </Pressable>
                {blockedOpen
                  ? blocked.map((e) => (
                      <ClientRow key={e.key} entry={e} symbol={symbol} dimmed />
                    ))
                  : null}
              </View>
            ) : null}
          </>
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm + 2,
    marginLeft: 2,
  },
  sectionLabelInline: {
    fontSize: 12,
    fontWeight: '600',
  },
  blockedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm + 2,
    marginLeft: 2,
  },
  blockedCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  rowText: {
    flex: 1,
  },
  rowNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowName: {
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
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
