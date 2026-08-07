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
import { ErrorBanner } from '../../src/components/messages/ErrorBanner';
import { NewMessageSheet } from '../../src/components/messages/NewMessageSheet';
import { SetupCard } from '../../src/components/messages/SetupCard';
import { ThreadRow } from '../../src/components/messages/ThreadRow';
import { tapHaptic } from '../../src/lib/haptics';
import { knownClients } from '../../src/lib/meetings';
import { clientNameForPhone, useClientMeta } from '../../src/store/clientMeta';
import { buildThreads, totalUnread, useMessages, type Thread } from '../../src/store/messages';
import { useTasks } from '../../src/store/tasks';
import { SPACING, useTheme } from '../../src/theme';

/** Messages tab: conversation list backed by the local message cache. */
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

  // Refresh the credential gate and pull new traffic on mount + every focus.
  useFocusEffect(
    useCallback(() => {
      void refreshConfigured().then(() => sync());
    }, [refreshConfigured, sync])
  );

  const threads = useMemo(() => buildThreads(messages, lastReadAt), [messages, lastReadAt]);
  const unread = useMemo(() => totalUnread(messages, lastReadAt), [messages, lastReadAt]);
  const clientNames = useMemo(() => knownClients(tasks), [tasks]);
  /** counterparty → linked client display name (or null). */
  const nameByNumber = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const t of threads) {
      map.set(t.counterparty, clientNameForPhone(meta, t.counterparty, clientNames));
    }
    return map;
  }, [threads, meta, clientNames]);

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
        <FlatList
          data={threads}
          keyExtractor={(t: Thread) => t.counterparty}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              clientName={nameByNumber.get(item.counterparty) ?? null}
              onPress={() => openThread(item.counterparty)}
            />
          )}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: theme.separator }]} />
          )}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={() => void sync()}
              tintColor={theme.textTertiary}
            />
          }
        />
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
});
