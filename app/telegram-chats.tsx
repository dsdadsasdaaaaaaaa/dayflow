import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { BackButton } from '../src/components/clients/BackButton';
import { GlassCard } from '../src/components/glass/GlassCard';
import { selectionHaptic, tapHaptic } from '../src/lib/haptics';
import { tdAvailable, tdLoadChats, type TgChat } from '../src/lib/tdlib';
import { useTelegram } from '../src/store/telegramAccount';
import { RADIUS, SPACING, useTheme } from '../src/theme';

const PRIVACY_CAPTION =
  'Only chats you turn on appear in DayFlow. Everything else stays only in Telegram.';

/** One selectable chat: flat avatar-less row, title + toggle. */
function ChatRow({
  chat,
  imported,
  onToggle,
}: {
  chat: TgChat;
  imported: boolean;
  onToggle: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
        {chat.title}
      </Text>
      <Switch
        value={imported}
        onValueChange={(next) => {
          selectionHaptic();
          onToggle(next);
        }}
        trackColor={{ false: theme.surface, true: theme.accent }}
        ios_backgroundColor={theme.surface}
        accessibilityLabel={`Show ${chat.title} in DayFlow`}
      />
    </View>
  );
}

/** A plain card of rows with inset hairline separators. */
function RowCard({
  chats,
  importedIds,
  onToggle,
}: {
  chats: TgChat[];
  importedIds: Set<string>;
  onToggle: (chat: TgChat, next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <GlassCard radius={RADIUS.xl} padding={0}>
      {chats.map((chat, i) => (
        <Fragment key={chat.chatId}>
          {i > 0 ? (
            <View style={[styles.separator, { backgroundColor: theme.separator }]} />
          ) : null}
          <ChatRow
            chat={chat}
            imported={importedIds.has(chat.chatId)}
            onToggle={(next) => onToggle(chat, next)}
          />
        </Fragment>
      ))}
    </GlassCard>
  );
}

/**
 * "Choose what shows in DayFlow": the user's private Telegram chats with an
 * on/off toggle per chat. Nothing is cached or synced until a chat is turned
 * on; turning it off removes its local copy again.
 */
export default function TelegramChatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const authState = useTelegram((s) => s.authState);
  const importedChatIds = useTelegram((s) => s.importedChatIds);
  const importChat = useTelegram((s) => s.importChat);
  const removeChat = useTelegram((s) => s.removeChat);

  const available = tdAvailable();
  const ready = authState === 'ready';

  const [chats, setChats] = useState<TgChat[] | null>(null);
  const [loading, setLoading] = useState(available);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await tdLoadChats();
    if (result.ok) {
      setChats(result.value);
    } else {
      setError(result.error);
    }
  }, []);

  // Make sure TDLib is running (app may have been cold-started), then list.
  useEffect(() => {
    if (!available) return;
    let alive = true;
    (async () => {
      await useTelegram.getState().connectAndSync();
      if (!alive) return;
      if (useTelegram.getState().authState === 'ready') await load();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [available, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await useTelegram.getState().refreshAuth();
      if (useTelegram.getState().authState === 'ready') await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const importedIds = useMemo(() => new Set(importedChatIds), [importedChatIds]);

  // Imported chats float to the top; both groups alphabetical.
  const { importedChats, otherChats } = useMemo(() => {
    const all = [...(chats ?? [])].sort((a, b) => a.title.localeCompare(b.title));
    return {
      importedChats: all.filter((c) => importedIds.has(c.chatId)),
      otherChats: all.filter((c) => !importedIds.has(c.chatId)),
    };
  }, [chats, importedIds]);

  const toggle = (chat: TgChat, next: boolean) => {
    if (next) void importChat(chat.chatId);
    else removeChat(chat.chatId);
  };

  const renderBody = () => {
    if (!available) {
      return (
        <GlassCard>
          <View style={styles.noticeInner}>
            <View style={[styles.noticeIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="paper-plane-outline" size={26} color={theme.accent} />
            </View>
            <Text style={[styles.noticeTitle, { color: theme.text }]}>
              Telegram arrives with the next app build
            </Text>
            <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>
              This version of DayFlow was installed before Telegram support.
              Your chat picker will live right here.
            </Text>
          </View>
        </GlassCard>
      );
    }
    if (loading) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={theme.textTertiary} />
        </View>
      );
    }
    if (!ready) {
      return (
        <GlassCard>
          <View style={styles.noticeInner}>
            <View style={[styles.noticeIcon, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="log-in-outline" size={26} color={theme.accent} />
            </View>
            <Text style={[styles.noticeTitle, { color: theme.text }]}>
              Connect your Telegram first
            </Text>
            <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>
              Sign in with your own account, then pick which chats show up in
              DayFlow.
            </Text>
            <Pressable
              onPress={() => {
                tapHaptic();
                router.replace('/telegram-login');
              }}
              accessibilityRole="button"
              accessibilityLabel="Connect Telegram"
              style={({ pressed }) => [
                styles.noticeBtn,
                { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.noticeBtnLabel}>Connect Telegram</Text>
            </Pressable>
          </View>
        </GlassCard>
      );
    }
    if (error) {
      return (
        <GlassCard>
          <View style={styles.noticeInner}>
            <Text style={[styles.noticeTitle, { color: theme.text }]}>
              Couldn’t load your chats
            </Text>
            <Text style={[styles.noticeBody, { color: theme.textSecondary }]}>{error}</Text>
            <Pressable
              onPress={() => {
                tapHaptic();
                void refresh();
              }}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              style={({ pressed }) => [
                styles.noticeBtn,
                { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.noticeBtnLabel}>Try again</Text>
            </Pressable>
          </View>
        </GlassCard>
      );
    }
    if (importedChats.length === 0 && otherChats.length === 0) {
      return (
        <EmptyState
          icon="paper-plane-outline"
          title="No private chats yet"
          subtitle="Your Telegram DMs will appear here, ready to choose from."
        />
      );
    }
    return (
      <>
        {importedChats.length > 0 ? (
          <View style={styles.group}>
            <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
              Shown in DayFlow
            </Text>
            <RowCard chats={importedChats} importedIds={importedIds} onToggle={toggle} />
          </View>
        ) : null}
        {otherChats.length > 0 ? (
          <View style={styles.group}>
            <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
              From your Telegram
            </Text>
            <RowCard chats={otherChats} importedIds={importedIds} onToggle={toggle} />
          </View>
        ) : null}
        <Text style={[styles.caption, { color: theme.textTertiary }]}>{PRIVACY_CAPTION}</Text>
      </>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Telegram chats</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Choose what shows in DayFlow
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          available ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={theme.textTertiary}
            />
          ) : undefined
        }
      >
        {renderBody()}
      </ScrollView>
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
  headerText: { flex: 1, gap: 1 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, fontWeight: '600' },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  group: { marginBottom: SPACING.lg },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    marginLeft: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 52,
  },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
  },
  caption: {
    fontSize: 12.5,
    lineHeight: 17,
    marginHorizontal: 6,
  },
  loadingWrap: { paddingVertical: 48, alignItems: 'center' },
  noticeInner: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  noticeIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  noticeBody: { fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  noticeBtn: {
    marginTop: 4,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeBtnLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
