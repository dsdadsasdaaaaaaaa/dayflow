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
import { StatusFilterChips } from '../../src/components/clients/StatusFilterChips';
import { ErrorBanner } from '../../src/components/messages/ErrorBanner';
import { NewMessageSheet } from '../../src/components/messages/NewMessageSheet';
import { SetupCard } from '../../src/components/messages/SetupCard';
import { tapHaptic } from '../../src/lib/haptics';
import { knownClients } from '../../src/lib/meetings';
import {
  clientMetaKey,
  clientNameForPhone,
  effectiveStatus,
  useClientMeta,
  type ClientStatus,
} from '../../src/store/clientMeta';
import { buildThreads, useMessages, type Thread } from '../../src/store/messages';
import { useTasks } from '../../src/store/tasks';
import { SPACING, useTheme } from '../../src/theme';

type ThreadFilter = 'all' | 'lead' | 'client';

interface ThreadInfo {
  name: string | null;
  status: ClientStatus | null;
}

/** Messages tab: CRM-aware conversation list backed by the local message cache. */
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
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [blockedOpen, setBlockedOpen] = useState(false);

  // Refresh the credential gate and pull new traffic on mount + every focus.
  useFocusEffect(
    useCallback(() => {
      void refreshConfigured().then(() => sync());
    }, [refreshConfigured, sync])
  );

  const threads = useMemo(() => buildThreads(messages, lastReadAt), [messages, lastReadAt]);
  const clientNames = useMemo(() => knownClients(tasks), [tasks]);

  /** counterparty → linked name + CRM status (null status = unknown number). */
  const infoByNumber = useMemo(() => {
    const map = new Map<string, ThreadInfo>();
    for (const t of threads) {
      const name = clientNameForPhone(meta, t.counterparty, clientNames);
      if (!name) {
        map.set(t.counterparty, { name: null, status: null });
        continue;
      }
      const hasMeetings = clientNames.some((n) => clientMetaKey(n) === clientMetaKey(name));
      map.set(t.counterparty, { name, status: effectiveStatus(meta, name, hasMeetings) });
    }
    return map;
  }, [threads, meta, clientNames]);

  const statusOf = useCallback(
    (t: Thread): ClientStatus | null => infoByNumber.get(t.counterparty)?.status ?? null,
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
  const visibleThreads = useMemo(
    () => (filter === 'all' ? activeThreads : activeThreads.filter((t) => statusOf(t) === filter)),
    [filter, activeThreads, statusOf]
  );
  /** Unread for the subtitle — blocked threads never count. */
  const unread = useMemo(
    () => activeThreads.reduce((sum, t) => sum + t.unread, 0),
    [activeThreads]
  );

  const bottomPad = 96 + insets.bottom;
  const showError = lastError != null && lastError !== dismissedError;

  const openThread = (counterparty: string) => {
    tapHaptic();
    router.push(`/thread?number=${encodeURIComponent(counterparty)}`);
  };

  const startNew = (number: string) => {
    setSheetOpen(false);
    router.push(`/thread?number=${encodeURIComponent(number)}`);
  };

  const renderThread = (item: Thread, dimmed?: boolean) => {
    const info = infoByNumber.get(item.counterparty);
    return (
      <ClientThreadRow
        thread={item}
        clientName={info?.name ?? null}
        status={info?.status ?? null}
        dimmed={dimmed}
        onPress={() => openThread(item.counterparty)}
      />
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
      {syncing ? <ActivityIndicator size="small" color={theme.textTertiary} /> : null}
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
          configured ? (unread > 0 ? `${unread} unread` : 'All caught up') : undefined
        }
        right={headerRight}
      />

      {showError ? (
        <ErrorBanner message={lastError} onDismiss={() => setDismissedError(lastError)} />
      ) : null}

      {!configured ? (
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
              refreshing={syncing}
              onRefresh={() => void sync()}
              tintColor={theme.textTertiary}
            />
          }
        >
          <EmptyState
            icon="chatbubbles-outline"
            title="No conversations yet"
            subtitle="Texts to and from your number show up here."
          />
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
        </ScrollView>
      ) : (
        <>
          <StatusFilterChips<ThreadFilter>
            options={[
              { value: 'all', label: 'All' },
              { value: 'lead', label: 'Leads', count: leadCount },
              { value: 'client', label: 'Clients' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <FlatList
            data={visibleThreads}
            keyExtractor={(t: Thread) => t.counterparty}
            renderItem={({ item }) => renderThread(item)}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            )}
            ListEmptyComponent={
              filter !== 'all' ? (
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
                refreshing={syncing}
                onRefresh={() => void sync()}
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
