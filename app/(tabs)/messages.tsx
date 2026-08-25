import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../../src/components/EmptyState';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ClientThreadRow } from '../../src/components/clients/ClientThreadRow';
import { LEAD_AMBER } from '../../src/components/clients/status';
import { StatusFilterChips } from '../../src/components/clients/StatusFilterChips';
import { ErrorBanner } from '../../src/components/messages/ErrorBanner';
import { NewMessageSheet } from '../../src/components/messages/NewMessageSheet';
import { SetupCard } from '../../src/components/messages/SetupCard';
import {
  bookedClientKeys,
  buildFollowUps,
  formatQuiet,
  type FollowUp,
} from '../../src/lib/followUps';
import { tapHaptic } from '../../src/lib/haptics';
import { knownClients } from '../../src/lib/meetings';
import type { SmsMessage } from '../../src/lib/smsApi';
import type { TgMessage } from '../../src/lib/tdlib';
import { unheardCount, useCalls } from '../../src/store/calls';
import {
  clientMetaKey,
  clientNameForPhone,
  clientNameForTelegram,
  effectiveStatus,
  isTelegramBlocked,
  useClientMeta,
  type ClientStatus,
} from '../../src/store/clientMeta';
import { buildThreads, useMessages } from '../../src/store/messages';
import { useTasks } from '../../src/store/tasks';
import {
  buildTelegramThreads,
  telegramChatTitle,
  useTelegram,
} from '../../src/store/telegramAccount';
import { SPACING, useTheme } from '../../src/theme';

type ThreadFilter = 'all' | 'waiting' | 'lead' | 'client';

/** How often the quiet durations (and the Waiting count) re-tick. */
const QUIET_TICK_MS = 60_000;

/** One row in the unified list — an SMS thread or an imported Telegram chat. */
interface UnifiedThread {
  channel: 'sms' | 'telegram';
  counterparty: string;
  unread: number;
  lastMessage: SmsMessage | TgMessage;
}

interface ThreadInfo {
  name: string | null;
  status: ClientStatus | null;
}

/**
 * Messages tab: CRM-aware conversation list uniting the SMS cache and the
 * user's imported Telegram chats (personal account, explicit imports only).
 */
export default function MessagesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const messages = useMessages((s) => s.messages);
  const lastReadAt = useMessages((s) => s.lastReadAt);
  const syncing = useMessages((s) => s.syncing);
  const lastError = useMessages((s) => s.lastError);
  const configured = useMessages((s) => s.configured);
  const refreshConfigured = useMessages((s) => s.refreshConfigured);
  const sync = useMessages((s) => s.sync);
  const followUpSnoozedUntil = useMessages((s) => s.followUpSnoozedUntil);
  const followUpDismissed = useMessages((s) => s.followUpDismissed);
  const tgMessages = useTelegram((s) => s.messages);
  const tgLastReadAt = useTelegram((s) => s.lastReadAt);
  const tgImportedChatIds = useTelegram((s) => s.importedChatIds);
  const tgChats = useTelegram((s) => s.chats);
  const tgSyncing = useTelegram((s) => s.syncing);
  const tgLastError = useTelegram((s) => s.lastError);
  const connectAndSync = useTelegram((s) => s.connectAndSync);
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);
  // Unheard voicemail count for the calls-button badge (blocked excluded).
  // Subscribe to raw slices; derive in a memo so the selector stays cheap.
  const voicemails = useCalls((s) => s.voicemails);
  const heardAt = useCalls((s) => s.heardAt);
  const unheardVoicemails = useMemo(
    () => unheardCount({ voicemails, heardAt }, meta),
    [voicemails, heardAt, meta]
  );

  // Quiet stretches are clock-derived, so the list re-ticks on its own.
  const [now, setNow] = useState(() => Date.now());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [blockedOpen, setBlockedOpen] = useState(false);

  /** Telegram counts as set up once the user has imported at least one chat. */
  const tgConfigured = tgImportedChatIds.length > 0;
  const anyConfigured = configured || tgConfigured;

  // Refresh the credential gate and pull new traffic on mount + every focus,
  // then keep the list live with a gentle incremental re-sync while it stays
  // on screen (incremental syncs only fetch past the high-water mark — cheap).
  useFocusEffect(
    useCallback(() => {
      void refreshConfigured().then(() => sync());
      if (tgConfigured) void connectAndSync();
      setNow(Date.now());
      const id = setInterval(() => void sync(), 15000);
      const tick = setInterval(() => setNow(Date.now()), QUIET_TICK_MS);
      return () => {
        clearInterval(id);
        clearInterval(tick);
      };
    }, [refreshConfigured, sync, tgConfigured, connectAndSync])
  );

  /** Both channels merged, newest conversation first. */
  const threads = useMemo<UnifiedThread[]>(() => {
    const sms = buildThreads(messages, lastReadAt).map<UnifiedThread>((t) => ({
      channel: 'sms',
      ...t,
    }));
    const tg = buildTelegramThreads({
      messages: tgMessages,
      lastReadAt: tgLastReadAt,
      importedChatIds: tgImportedChatIds,
    }).map<UnifiedThread>((t) => ({ channel: 'telegram', ...t }));
    return [...sms, ...tg].sort((a, b) => b.lastMessage.sentAt - a.lastMessage.sentAt);
  }, [messages, lastReadAt, tgMessages, tgLastReadAt, tgImportedChatIds]);
  const clientNames = useMemo(() => knownClients(tasks), [tasks]);
  /** Clients with a booking still ahead — they are not loose ends. */
  const bookedClients = useMemo(() => bookedClientKeys(tasks), [tasks]);

  /** counterparty → linked name + CRM status (null status = unknown contact). */
  const infoByNumber = useMemo(() => {
    const map = new Map<string, ThreadInfo>();
    for (const t of threads) {
      const name =
        t.channel === 'telegram'
          ? clientNameForTelegram(meta, t.counterparty, clientNames)
          : clientNameForPhone(meta, t.counterparty, clientNames);
      if (!name) {
        // Unlinked threads carry no CRM stage — except a blocked Telegram
        // link without a display name, which must still collapse.
        const blocked = t.channel === 'telegram' && isTelegramBlocked(meta, t.counterparty);
        map.set(t.counterparty, { name: null, status: blocked ? 'blocked' : null });
        continue;
      }
      const hasMeetings = clientNames.some((n) => clientMetaKey(n) === clientMetaKey(name));
      map.set(t.counterparty, { name, status: effectiveStatus(meta, name, hasMeetings) });
    }
    return map;
  }, [threads, meta, clientNames]);

  const statusOf = useCallback(
    (t: UnifiedThread): ClientStatus | null => infoByNumber.get(t.counterparty)?.status ?? null,
    [infoByNumber]
  );

  /** Blocked threads collapse to the bottom; everything else is "active". */
  const activeThreads = useMemo(
    () => threads.filter((t) => statusOf(t) !== 'blocked'),
    [threads, statusOf]
  );
  const blockedThreads = useMemo(
    () => threads.filter((t) => statusOf(t) === 'blocked'),
    [threads, statusOf]
  );
  const leadCount = useMemo(
    () => activeThreads.filter((t) => statusOf(t) === 'lead').length,
    [activeThreads, statusOf]
  );
  /** Threads where OUR last message went unanswered, longest-quiet first. */
  const followUps = useMemo<FollowUp[]>(
    () =>
      buildFollowUps({
        threads: activeThreads,
        tasks,
        meta,
        snoozedUntil: followUpSnoozedUntil,
        dismissed: followUpDismissed,
        now,
        clientNames,
        bookedClients,
      }),
    [
      activeThreads,
      tasks,
      meta,
      followUpSnoozedUntil,
      followUpDismissed,
      now,
      clientNames,
      bookedClients,
    ]
  );
  const quietByCounterparty = useMemo(
    () => new Map(followUps.map((f) => [f.counterparty, f.quietMs] as const)),
    [followUps]
  );
  /** Same order as followUps: the longest silence sits at the top. */
  const waitingThreads = useMemo(() => {
    const byId = new Map(activeThreads.map((t) => [t.counterparty, t] as const));
    return followUps
      .map((f) => byId.get(f.counterparty))
      .filter((t): t is UnifiedThread => t != null);
  }, [followUps, activeThreads]);

  const visibleThreads = useMemo(
    () =>
      filter === 'all'
        ? activeThreads
        : filter === 'waiting'
          ? waitingThreads
          : activeThreads.filter((t) => statusOf(t) === filter),
    [filter, activeThreads, waitingThreads, statusOf]
  );
  /** Unread for the subtitle — blocked threads never count. */
  const unread = useMemo(
    () => activeThreads.reduce((sum, t) => sum + t.unread, 0),
    [activeThreads]
  );

  const bottomPad = 96 + insets.bottom;
  const errorMessage = lastError ?? tgLastError;
  const showError = errorMessage != null && errorMessage !== dismissedError;
  const refreshing = syncing || tgSyncing;

  const refreshAll = useCallback(() => {
    void sync();
    if (tgConfigured) void connectAndSync();
  }, [sync, tgConfigured, connectAndSync]);

  const openThread = (counterparty: string) => {
    tapHaptic();
    router.push(`/thread?number=${encodeURIComponent(counterparty)}`);
  };

  const startNew = (number: string) => {
    setSheetOpen(false);
    router.push(`/thread?number=${encodeURIComponent(number)}`);
  };

  const renderThread = (item: UnifiedThread, dimmed?: boolean) => {
    const info = infoByNumber.get(item.counterparty);
    return (
      <ClientThreadRow
        thread={item}
        channel={item.channel}
        clientName={info?.name ?? null}
        fallbackName={
          item.channel === 'telegram'
            ? telegramChatTitle({ chats: tgChats }, item.counterparty)
            : undefined
        }
        status={info?.status ?? null}
        dimmed={dimmed}
        onPress={() => openThread(item.counterparty)}
      />
    );
  };

  /** Row + the amber "how long they have been quiet" line under it. */
  const renderWaiting = (item: UnifiedThread) => {
    const quietMs = quietByCounterparty.get(item.counterparty);
    return (
      <View>
        {renderThread(item)}
        {quietMs != null ? (
          <View style={styles.quietRow}>
            <Ionicons name="time-outline" size={12} color={LEAD_AMBER} />
            <Text style={[styles.quietText, { color: LEAD_AMBER }]} numberOfLines={1}>
              {formatQuiet(quietMs)}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const blockedFooter =
    filter === 'all' && blockedThreads.length > 0 ? (
      <View style={styles.blockedSection}>
        <Pressable
          onPress={() => {
            tapHaptic();
            setBlockedOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: blockedOpen }}
          accessibilityLabel={`Blocked conversations, ${blockedThreads.length}`}
          style={({ pressed }) => [styles.blockedHeader, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="remove-circle-outline" size={15} color={theme.textTertiary} />
          <Text style={[styles.blockedTitle, { color: theme.textSecondary }]}>Blocked</Text>
          <Text style={[styles.blockedCount, { color: theme.textTertiary }]}>
            {blockedThreads.length}
          </Text>
          <Ionicons
            name={blockedOpen ? 'chevron-up' : 'chevron-down'}
            size={15}
            color={theme.textTertiary}
          />
        </Pressable>
        {blockedOpen
          ? blockedThreads.map((t, i) => (
              <View key={t.counterparty}>
                {i > 0 ? (
                  <View style={[styles.separator, { backgroundColor: theme.separator }]} />
                ) : null}
                {renderThread(t, true)}
              </View>
            ))
          : null}
      </View>
    ) : null;

  const headerRight = (
    <View style={styles.headerRight}>
      {refreshing ? <ActivityIndicator size="small" color={theme.textTertiary} /> : null}
      <Pressable
        onPress={() => {
          tapHaptic();
          router.push('/search');
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search everything"
        style={[styles.iconBtn, { backgroundColor: theme.surface }]}
      >
        <Ionicons name="search-outline" size={19} color={theme.accent} />
      </Pressable>
      <Pressable
        onPress={() => {
          tapHaptic();
          router.push('/calls');
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          unheardVoicemails > 0
            ? `Calls, ${unheardVoicemails} new voicemail${unheardVoicemails === 1 ? '' : 's'}`
            : 'Calls'
        }
        style={[styles.iconBtn, { backgroundColor: theme.surface }]}
      >
        <Ionicons name="call-outline" size={19} color={theme.accent} />
        {unheardVoicemails > 0 ? (
          <View style={[styles.callBadge, { backgroundColor: theme.accent }]}>
            <Text style={styles.callBadgeLabel}>
              {unheardVoicemails > 9 ? '9+' : unheardVoicemails}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {configured ? (
        <Pressable
          onPress={() => {
            tapHaptic();
            setSheetOpen(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="New message"
          style={[styles.iconBtn, { backgroundColor: theme.surface }]}
        >
          <Ionicons name="create-outline" size={19} color={theme.accent} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Messages"
        subtitle={
          anyConfigured
            ? unread > 0
              ? `${unread} unread`
              : unheardVoicemails > 0
                ? `${unheardVoicemails} new voicemail${unheardVoicemails === 1 ? '' : 's'}`
                : 'All caught up'
            : undefined
        }
        right={headerRight}
      />

      {showError && errorMessage ? (
        <ErrorBanner
          message={errorMessage}
          onDismiss={() => setDismissedError(errorMessage)}
        />
      ) : null}

      {!anyConfigured ? (
        <ScrollView
          contentContainerStyle={[styles.setupContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
        >
          <SetupCard />
        </ScrollView>
      ) : threads.length === 0 ? (
        <ScrollView
          contentContainerStyle={[styles.emptyContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshAll}
              tintColor={theme.textTertiary}
            />
          }
        >
          <EmptyState
            icon="chatbubbles-outline"
            title="No conversations yet"
            subtitle={
              tgConfigured
                ? 'Texts and imported Telegram chats show up here.'
                : 'Texts to and from your number show up here.'
            }
          />
          {configured ? (
            <Pressable
              onPress={() => {
                tapHaptic();
                setSheetOpen(true);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.newBtn,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Ionicons name="create-outline" size={17} color="#FFFFFF" />
              <Text style={styles.newBtnLabel}>New message</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        <>
          <StatusFilterChips<ThreadFilter>
            options={[
              { value: 'all', label: 'All' },
              {
                value: 'waiting',
                label: 'Waiting',
                count: followUps.length,
                tone: 'warn',
              },
              { value: 'lead', label: 'Leads', count: leadCount },
              { value: 'client', label: 'Clients' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <FlatList
            data={visibleThreads}
            keyExtractor={(t: UnifiedThread) => t.counterparty}
            renderItem={({ item }) =>
              filter === 'waiting' ? renderWaiting(item) : renderThread(item)
            }
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            )}
            ListEmptyComponent={
              filter === 'waiting' ? (
                <EmptyState
                  icon="checkmark-done-outline"
                  title="Nobody is waiting"
                  subtitle="Threads where your last message went unanswered show up here."
                />
              ) : filter !== 'all' ? (
                <EmptyState
                  icon={filter === 'lead' ? 'sparkles-outline' : 'people-outline'}
                  title={filter === 'lead' ? 'No leads right now' : 'No client threads'}
                  subtitle={
                    filter === 'lead'
                      ? 'New numbers you mark as leads show up here.'
                      : 'Threads linked to clients show up here.'
                  }
                />
              ) : null
            }
            ListFooterComponent={blockedFooter}
            contentContainerStyle={{ paddingBottom: bottomPad }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refreshAll}
                tintColor={theme.textTertiary}
              />
            }
          />
        </>
      )}

      <NewMessageSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onStart={startNew}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBadge: {
    position: 'absolute',
    top: -2,
    right: -3,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBadgeLabel: { color: '#FFFFFF', fontSize: 9, fontWeight: '700' },
  setupContent: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  emptyContent: { paddingHorizontal: SPACING.lg, alignItems: 'center' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  newBtnLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg + 46 + SPACING.md,
  },
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -SPACING.sm,
    paddingBottom: SPACING.sm + 2,
    paddingLeft: SPACING.lg + 46 + SPACING.md,
    paddingRight: SPACING.lg,
  },
  quietText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  blockedSection: {
    marginTop: SPACING.lg,
  },
  blockedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  blockedTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  blockedCount: {
    fontSize: 12,
    fontWeight: '600',
    marginRight: 2,
  },
});
