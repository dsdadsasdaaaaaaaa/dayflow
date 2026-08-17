import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

const NOTE_SAVE_DEBOUNCE_MS = 600;

/**
 * Inline note row shown under an expanded call: "Add note" / the saved note;
 * tapping swaps in a TextInput that autosaves on blur (debounced while
 * typing, like the client notes card). Notes are private context.
 */
function CallNoteEditor({ sid }: { sid: string }) {
  const theme = useTheme();
  const saved = useCalls((s) => s.callNotes[sid] ?? '');
  const setCallNote = useCalls((s) => s.setCallNote);

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(saved);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);

  // Adopt store changes (e.g. late rehydration) until the user has typed.
  useEffect(() => {
    if (!dirty.current) {
      setText(saved);
      latest.current = saved;
    }
  }, [saved]);

  // Flush any pending edit on unmount (row collapsed / screen left).
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        setCallNote(sid, latest.current);
      }
    },
    [sid, setCallNote]
  );

  const onChange = (t: string) => {
    dirty.current = true;
    latest.current = t;
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCallNote(sid, t);
    }, NOTE_SAVE_DEBOUNCE_MS);
  };

  const onBlur = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setCallNote(sid, latest.current);
    setEditing(false);
  };

  if (editing) {
    return (
      <TextInput
        value={text}
        onChangeText={onChange}
        onBlur={onBlur}
        autoFocus
        multiline
        placeholder="Private note about this call…"
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.noteInput,
          { backgroundColor: theme.surface, color: theme.text },
        ]}
        accessibilityLabel="Call note"
      />
    );
  }

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        setEditing(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={saved ? `Edit note: ${saved}` : 'Add note'}
      style={({ pressed }) => [styles.noteRow, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="create-outline" size={13} color={theme.textTertiary} />
      <Text
        style={[
          styles.noteRowText,
          { color: saved ? theme.textSecondary : theme.textTertiary },
        ]}
        numberOfLines={1}
      >
        {saved || 'Add note'}
      </Text>
    </Pressable>
  );
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
  const callNotes = useCalls((s) => s.callNotes);
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
  /** Call SID whose row is expanded — full transcript + note editor (one at a time). */
  const [expandedSid, setExpandedSid] = useState<string | null>(null);
  const playerRef = useRef<ActivePlayer | null>(null);

  // Pull fresh history on mount + every focus (like the messages tab).
  useFocusEffect(
    useCallback(() => {
      if (!callingEnabled) return;
      void sync(forwardTo);
      // Keep the log live while the screen is open — new calls/voicemails
      // should not require pull-to-refresh.
      const id = setInterval(() => void sync(forwardTo), 30000);
      return () => clearInterval(id);
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

  const toggleExpanded = useCallback(
    (sid: string, voicemailSid?: string) => {
      tapHaptic();
      setExpandedSid((cur) => {
        const expanding = cur !== sid;
        // Reading the transcript counts as hearing the voicemail — the
        // unheard dot must not survive an expanded read.
        if (expanding && voicemailSid) markHeard(voicemailSid);
        return expanding ? sid : null;
      });
    },
    [markHeard]
  );

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
              <View>
                <CallRow
                  row={item}
                  name={nameByNumber.get(item.counterparty) ?? null}
                  unheard={item.voicemail != null && !heardAt[item.voicemail.sid]}
                  playState={playStateFor(item)}
                  expanded={expandedSid === item.sid}
                  note={callNotes[item.sid] ?? null}
                  onPress={() => openThread(item.counterparty)}
                  onLongPress={() => toggleExpanded(item.sid, item.voicemail?.sid)}
                  onTogglePlay={() => void togglePlay(item)}
                  onToggleTranscript={() => toggleExpanded(item.sid, item.voicemail?.sid)}
                />
                {expandedSid === item.sid ? <CallNoteEditor sid={item.sid} /> : null}
              </View>
            )}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            )}
            ListEmptyComponent={
              <EmptyState icon={empty.icon} title={empty.title} subtitle={empty.subtitle} />
            }
            contentContainerStyle={{ paddingBottom: bottomPad }}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
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
  // Note affordance/input line up with the row's text column (glyph + gap).
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: SPACING.lg + 40 + SPACING.md,
    marginRight: SPACING.lg,
    paddingVertical: 6,
    marginBottom: SPACING.sm,
  },
  noteRowText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  noteInput: {
    marginLeft: SPACING.lg + 40 + SPACING.md,
    marginRight: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    lineHeight: 18,
    minHeight: 52,
    textAlignVertical: 'top',
  },
});
