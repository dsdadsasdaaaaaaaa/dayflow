import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { BackButton } from '../src/components/clients/BackButton';
import { StatusFilterChips } from '../src/components/clients/StatusFilterChips';
import { CallRow, type PlayState } from '../src/components/calls/CallRow';
import { CallingSetupCard } from '../src/components/calls/CallingSetupCard';
import { ErrorBanner } from '../src/components/messages/ErrorBanner';
import { tapHaptic } from '../src/lib/haptics';
import { knownClients } from '../src/lib/meetings';
import { loadSmsCredentials } from '../src/lib/smsCredentials';
import { downloadRecording } from '../src/lib/voiceApi';
import {
  buildCallRows,
  unheardCount,
  useCalls,
  type CallRow as CallRowData,
} from '../src/store/calls';
import { clientNameForPhone, isPhoneBlocked, useClientMeta } from '../src/store/clientMeta';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { SPACING, useTheme } from '../src/theme';

type CallFilter = 'all' | 'missed' | 'voicemail';

/** Minimal handle on the lazily-imported expo-audio player (OTA safety). */
interface ActivePlayer {
  player: { pause: () => void; remove: () => void };
  sub: { remove: () => void };
}

const EMPTY_STATES: Record<CallFilter, { icon: string; title: string; subtitle: string }> = {
  all: {
    icon: 'call-outline',
    title: 'No calls yet',
    subtitle: 'Calls to and from your work number show up here.',
  },
  missed: {
    icon: 'checkmark-circle-outline',
    title: 'No missed calls',
    subtitle: "You're all caught up.",
  },
  voicemail: {
    icon: 'mic-outline',
    title: 'No voicemails',
    subtitle: 'When a caller leaves a message, it shows up here.',
  },
};

/** Call log + voicemail inbox, backed by the local call cache. */
export default function CallsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const calls = useCalls((s) => s.calls);
  const voicemails = useCalls((s) => s.voicemails);
  const heardAt = useCalls((s) => s.heardAt);
  const syncing = useCalls((s) => s.syncing);
  const lastError = useCalls((s) => s.lastError);
  const sync = useCalls((s) => s.sync);
  const markHeard = useCalls((s) => s.markHeard);
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);
  const callingEnabled = useSettings((s) => s.settings.callingEnabled);
  const forwardTo = useSettings((s) => s.settings.callForwardTo);

  const [filter, setFilter] = useState<CallFilter>('all');
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [loadingSid, setLoadingSid] = useState<string | null>(null);
  const [playingSid, setPlayingSid] = useState<string | null>(null);
  const playerRef = useRef<ActivePlayer | null>(null);

  // Pull fresh history on mount + every focus (like the messages tab).
  useFocusEffect(
    useCallback(() => {
      if (callingEnabled) void sync(forwardTo);
    }, [callingEnabled, forwardTo, sync])
  );

  const stopPlayback = useCallback(() => {
    const active = playerRef.current;
    playerRef.current = null;
    setPlayingSid(null);
    if (active) {
      try {
        active.sub.remove();
        active.player.pause();
        active.player.remove();
      } catch {
        // Player already released — fine.
      }
    }
  }, []);

  // Release the native player when the screen unmounts.
  useEffect(() => stopPlayback, [stopPlayback]);

  const togglePlay = useCallback(
    async (row: CallRowData) => {
      const vm = row.voicemail;
      if (!vm) return;
      tapHaptic();
      if (playingSid === vm.sid) {
        stopPlayback();
        return;
      }
      stopPlayback();
      setLoadingSid(vm.sid);
      try {
        const creds = await loadSmsCredentials();
        if (!creds) {
          Alert.alert('Voicemail', 'Calling is not set up yet.');
          return;
        }
        const dl = await downloadRecording(creds, vm.sid, vm.mediaUrl);
        if (!dl.ok) {
          Alert.alert('Voicemail', dl.error);
          return;
        }
        // OTA safety: expo-audio is NOT in the current binary — import it only
        // here, with a friendly fallback (see app/thread.tsx handleAttach).
        const { createAudioPlayer } = await import('expo-audio');
        const player = createAudioPlayer(dl.uri);
        const sub = player.addListener('playbackStatusUpdate', (status) => {
          if (status.didJustFinish) stopPlayback();
        });
        playerRef.current = { player, sub };
        player.play();
        setPlayingSid(vm.sid);
        markHeard(vm.sid);
      } catch {
        Alert.alert('Voicemail', 'Voicemail playback arrives with the next app update.');
      } finally {
        setLoadingSid(null);
      }
    },
    [playingSid, stopPlayback, markHeard]
  );

  // Blocked contacts are excluded from the log entirely.
  const rows = useMemo(
    () =>
      buildCallRows({ calls, voicemails }).filter(
        (r) => !isPhoneBlocked(meta, r.counterparty)
      ),
    [calls, voicemails, meta]
  );
  const visibleRows = useMemo(() => {
    if (filter === 'missed') return rows.filter((r) => r.missed);
    if (filter === 'voicemail') return rows.filter((r) => r.voicemail != null);
    return rows;
  }, [rows, filter]);

  const clientNames = useMemo(() => knownClients(tasks), [tasks]);
  /** counterparty → linked client display name (null = unknown number). */
  const nameByNumber = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of rows) {
      if (!map.has(r.counterparty)) {
        map.set(r.counterparty, clientNameForPhone(meta, r.counterparty, clientNames));
      }
    }
    return map;
  }, [rows, meta, clientNames]);

  const unheard = useMemo(() => unheardCount({ voicemails, heardAt }, meta), [
    voicemails,
    heardAt,
    meta,
  ]);

  const bottomPad = insets.bottom + 48;
  const showError = lastError != null && lastError !== dismissedError;
  const empty = EMPTY_STATES[filter];

  const openThread = (counterparty: string) => {
    tapHaptic();
    router.push(`/thread?number=${encodeURIComponent(counterparty)}`);
  };

  const playStateFor = (row: CallRowData): PlayState => {
    const sid = row.voicemail?.sid;
    if (!sid) return 'idle';
    if (loadingSid === sid) return 'loading';
    if (playingSid === sid) return 'playing';
    return 'idle';
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Calls</Text>
          {callingEnabled && unheard > 0 ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {unheard} new voicemail{unheard === 1 ? '' : 's'}
            </Text>
          ) : null}
        </View>
      </View>

      {showError ? (
        <ErrorBanner message={lastError} onDismiss={() => setDismissedError(lastError)} />
      ) : null}

      {!callingEnabled ? (
        <ScrollView
          contentContainerStyle={[styles.setupContent, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
        >
          <CallingSetupCard />
        </ScrollView>
      ) : (
        <>
          <StatusFilterChips<CallFilter>
            options={[
              { value: 'all', label: 'All' },
              { value: 'missed', label: 'Missed' },
              { value: 'voicemail', label: 'Voicemail', count: unheard },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <FlatList
            data={visibleRows}
            keyExtractor={(r: CallRowData) => r.sid}
            renderItem={({ item }) => (
              <CallRow
                row={item}
                name={nameByNumber.get(item.counterparty) ?? null}
                unheard={item.voicemail != null && !heardAt[item.voicemail.sid]}
                playState={playStateFor(item)}
                onPress={() => openThread(item.counterparty)}
                onTogglePlay={() => void togglePlay(item)}
              />
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            )}
            ListEmptyComponent={
              <EmptyState icon={empty.icon} title={empty.title} subtitle={empty.subtitle} />
            }
            contentContainerStyle={{ paddingBottom: bottomPad }}
            refreshControl={
              <RefreshControl
                refreshing={syncing}
                onRefresh={() => void sync(forwardTo)}
                tintColor={theme.textTertiary}
              />
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  headerText: { flex: 1 },
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
  setupContent: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg + 40 + SPACING.md,
  },
});
