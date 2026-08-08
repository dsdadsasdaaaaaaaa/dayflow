import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '../src/components/EmptyState';
import { ActivityTimeline } from '../src/components/clients/ActivityTimeline';
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
import { startClientCall } from '../src/components/messages/ClientPanel';
import {
  buildDepositRequest,
  buildPaymentReminder,
} from '../src/components/messages/QuickReplies';
import { RebookSuggestion } from '../src/components/clients/RebookSuggestion';
import { StatTile } from '../src/components/clients/StatTile';
import { StatusChips } from '../src/components/clients/StatusChips';
import { GlassCard } from '../src/components/glass/GlassCard';
import {
  formatDayShort,
  formatDuration,
  formatMinutes,
  lastNDays,
} from '../src/lib/dates';
import { successHaptic, tapHaptic, warningHaptic } from '../src/lib/haptics';
import {
  clientProfiles,
  formatMoney,
  meetingKindMeta,
  meetingOccurrences,
} from '../src/lib/meetings';
import { renameClientEverywhere } from '../src/lib/renameClient';
import { clientMetaKey, effectiveStatus, useClientMeta } from '../src/store/clientMeta';
import { useMeetingSession } from '../src/store/meetingSession';
import { useSettings } from '../src/store/settings';
import { useTelegram } from '../src/store/telegramAccount';
import { showUndo } from '../src/store/undo';
import { useTasks } from '../src/store/tasks';
import { SPACING, taskColor, useTheme } from '../src/theme';

/** Sentence-case section label. */
function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{children}</Text>;
}

/**
 * Everything about one client: status, money, settle-up, rebooking, history.
 * Also renders contact-only entries (messenger leads with no meetings yet).
 */
export default function ClientDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const rawName = typeof params.name === 'string' ? params.name : '';

  const phoneRowRef = useRef<ClientPhoneRowHandle>(null);
  /** Non-null while the name is being edited (holds the draft). */
  const [draftName, setDraftName] = useState<string | null>(null);

  const tasks = useTasks((s) => s.tasks);
  const togglePaid = useTasks((s) => s.togglePaid);
  const toggleNoShow = useTasks((s) => s.toggleNoShow);
  const log = useMeetingSession((s) => s.log);
  const symbol = useSettings((s) => s.settings.currencySymbol);
  const callingEnabled = useSettings((s) => s.settings.callingEnabled);
  const callForwardTo = useSettings((s) => s.settings.callForwardTo);
  const metaMap = useClientMeta((s) => s.meta);
  const setStatus = useClientMeta((s) => s.setStatus);
  const setTelegram = useClientMeta((s) => s.setTelegram);

  const profiles = useMemo(() => clientProfiles(tasks, log), [tasks, log]);
  const profile = useMemo(() => {
    const q = rawName.trim().toLowerCase();
    if (!q) return null;
    return profiles.find((p) => p.name.trim().toLowerCase() === q) ?? null;
  }, [profiles, rawName]);

  /** Contact-only fallback: a meta entry (lead pipeline) without meetings. */
  const metaEntry = metaMap[clientMetaKey(rawName)];
  const displayName = profile?.name ?? rawName.trim();
  const status = displayName
    ? effectiveStatus(metaMap, displayName, (profile?.meetingsDone ?? 0) > 0)
    : 'lead';
  const blocked = status === 'blocked';
  /** Linked phone number (E.164) — gates the Call action. */
  const phone = metaMap[clientMetaKey(displayName)]?.phone ?? '';
  /** Linked Telegram chat id — this profile is home to BOTH channels. */
  const telegramChat = metaMap[clientMetaKey(displayName)]?.telegram ?? '';
  const tgChats = useTelegram((s) => s.chats);
  const tgChatTitle = telegramChat
    ? (tgChats[telegramChat]?.title ?? 'Telegram chat')
    : '';

  /**
   * Recent past occurrences for this client, newest first, capped at 20:
   * completed ones plus days marked as a no-show (which stay uncompleted —
   * the flag is what keeps them visible here).
   */
  const history = useMemo(() => {
    if (!profile) return [];
    const key = profile.name.trim().toLowerCase();
    return meetingOccurrences(tasks, lastNDays(90))
      .filter(
        (o) =>
          o.client.trim().toLowerCase() === key &&
          (o.completed || (o.task.meeting?.noShows?.includes(o.dateKey) ?? false))
      )
      .sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
      .slice(0, 20);
  }, [tasks, profile]);

  /** No-show days recorded across this client's meetings (all time). */
  const noShowCount = useMemo(() => {
    const key = displayName.trim().toLowerCase();
    if (!key) return 0;
    let n = 0;
    for (const t of Object.values(tasks)) {
      if (t.meeting && t.meeting.client.trim().toLowerCase() === key) {
        n += t.meeting.noShows?.length ?? 0;
      }
    }
    return n;
  }, [tasks, displayName]);

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

  if (!profile && !metaEntry) {
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

  const kindMeta = profile ? meetingKindMeta(profile.kind) : null;

  const bookAgain = () => {
    tapHaptic();
    router.push(`/task-editor?client=${encodeURIComponent(displayName)}`);
  };

  /** Open the thread with a deposit-request draft prefilled (phone required). */
  const requestDeposit = () => {
    if (!phone) return;
    tapHaptic();
    const draft = buildDepositRequest({
      occurrence: nextOcc ? { task: nextOcc.task, dateKey: nextOcc.dateKey } : null,
      fallbackRate: profile?.rate ?? 0,
      symbol,
    });
    router.push(
      `/thread?number=${encodeURIComponent(phone)}&draft=${encodeURIComponent(draft)}`
    );
  };

  /** Open the thread with a payment-reminder draft prefilled (phone required). */
  const sendPaymentReminder = () => {
    if (!phone || !profile || profile.outstanding <= 0 || profile.unpaid.length === 0) return;
    tapHaptic();
    const oldestOwedDay = profile.unpaid.reduce(
      (min, u) => (u.dateKey < min ? u.dateKey : min),
      profile.unpaid[0].dateKey
    );
    const draft = buildPaymentReminder({
      amount: profile.outstanding,
      symbol,
      oldestOwedDay,
    });
    router.push(
      `/thread?number=${encodeURIComponent(phone)}&draft=${encodeURIComponent(draft)}`
    );
  };

  /** Long-press on a history row: flip its no-show state (undoable). */
  const handleNoShowToggle = (taskId: string, dateKey: string, isNoShow: boolean) => {
    warningHaptic();
    toggleNoShow(taskId, dateKey);
    showUndo(
      isNoShow
        ? `Unmarked ${formatDayShort(dateKey)} no-show`
        : `Marked ${formatDayShort(dateKey)} a no-show`,
      () => toggleNoShow(taskId, dateKey)
    );
  };

  const saveName = () => {
    if (draftName == null) return;
    const next = draftName.trim();
    if (next === displayName) {
      setDraftName(null);
      return;
    }
    const result = renameClientEverywhere(displayName, next);
    if (!result.ok) {
      Alert.alert('Can’t rename', result.error);
      return;
    }
    successHaptic();
    setDraftName(null);
    // Re-point the route at the new name so every lookup resolves again.
    router.setParams({ name: next });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
      </View>

      {/* Keeps the notes card and deposit fields visible above the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <View style={styles.hero}>
          <ClientAvatar name={displayName} size={84} />
          {draftName == null ? (
            <View style={styles.nameRow}>
              <Text style={[styles.heroName, { color: theme.text }]} numberOfLines={1}>
                {displayName}
              </Text>
              <Pressable
                onPress={() => {
                  tapHaptic();
                  setDraftName(displayName);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Edit name"
                style={({ pressed }) => [styles.editNameBtn, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="pencil" size={15} color={theme.textTertiary} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.nameEdit}>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                autoFocus
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={saveName}
                placeholder="Client name"
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.nameInput,
                  { backgroundColor: theme.surface, color: theme.text },
                ]}
                accessibilityLabel="Client name"
              />
              <Pressable
                onPress={() => setDraftName(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel rename"
                style={({ pressed }) => [
                  styles.nameAction,
                  { backgroundColor: theme.surface },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name="close" size={17} color={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={saveName}
                accessibilityRole="button"
                accessibilityLabel="Save name"
                style={({ pressed }) => [
                  styles.nameAction,
                  { backgroundColor: theme.accent },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Ionicons name="checkmark" size={17} color="#FFFFFF" />
              </Pressable>
            </View>
          )}
          {profile && kindMeta ? (
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
          ) : null}
          <MessageButton
            client={displayName}
            onNeedPhone={() => phoneRowRef.current?.focus()}
          />
        </View>

        {/* Status */}
        <View style={styles.statusBlock}>
          <StatusChips value={status} onChange={(s) => setStatus(displayName, s)} />
          {blocked ? (
            <View style={[styles.blockedBanner, { backgroundColor: theme.surface }]}>
              <Ionicons
                name="notifications-off-outline"
                size={15}
                color={theme.textSecondary}
              />
              <Text style={[styles.blockedBannerText, { color: theme.textSecondary }]}>
                Blocked — messages won't notify you
              </Text>
            </View>
          ) : null}
        </View>

        {/* Stat tiles */}
        {profile ? (
          <View style={styles.tileGrid}>
            <StatTile
              label="Earned"
              value={formatMoney(profile.earned, symbol)}
              tint={money}
              delay={40}
            />
            <StatTile
              label="Collected"
              value={formatMoney(profile.collected, symbol)}
              delay={70}
            />
            <StatTile
              label="Outstanding"
              value={formatMoney(profile.outstanding, symbol)}
              tint={profile.outstanding > 0 ? amberFg : undefined}
              delay={100}
            />
            <StatTile label="Hours" value={formatDuration(profile.loggedMinutes)} delay={130} />
            {noShowCount > 0 ? (
              <StatTile
                label="No-shows"
                value={String(noShowCount)}
                tint={amberFg}
                delay={160}
              />
            ) : null}
          </View>
        ) : null}

        {/* Phone */}
        <View>
          <SectionLabel>Phone</SectionLabel>
          <ClientPhoneRow ref={phoneRowRef} client={displayName} />
          {phone ? (
            <Pressable
              onPress={() => {
                tapHaptic();
                startClientCall(callingEnabled, callForwardTo, phone, displayName);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Call ${displayName}`}
              style={({ pressed }) => [
                styles.callBtn,
                { backgroundColor: theme.surface },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Ionicons name="call-outline" size={17} color={theme.accent} />
              <Text style={[styles.callBtnLabel, { color: theme.accent }]}>Call</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Telegram — one profile holds both channels */}
        {telegramChat ? (
          <View>
            <SectionLabel>Telegram</SectionLabel>
            <Pressable
              onPress={() => {
                tapHaptic();
                router.push(`/thread?number=${encodeURIComponent(`tgc:${telegramChat}`)}`);
              }}
              onLongPress={() => {
                Alert.alert(
                  'Unlink Telegram?',
                  `The chat stays in Messages — it just won't be linked to ${displayName} anymore.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Unlink',
                      style: 'destructive',
                      onPress: () => setTelegram(displayName, null),
                    },
                  ]
                );
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open ${displayName}'s Telegram chat`}
              accessibilityHint="Long press to unlink"
              style={({ pressed }) => [
                styles.telegramRow,
                { backgroundColor: theme.surface },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="paper-plane-outline" size={17} color={theme.accent} />
              <Text style={[styles.telegramLabel, { color: theme.text }]} numberOfLines={1}>
                {tgChatTitle}
              </Text>
              <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
            </Pressable>
          </View>
        ) : null}

        {/* Notes */}
        <View>
          <SectionLabel>Notes</SectionLabel>
          <ClientNotesCard client={displayName} />
        </View>

        {/* Activity — renders nothing (no section) when there's no activity */}
        <ActivityTimeline client={displayName} />

        {/* Settle up */}
        {profile && profile.unpaid.length > 0 ? (
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
            {phone && profile.outstanding > 0 ? (
              <Pressable
                onPress={sendPaymentReminder}
                accessibilityRole="button"
                accessibilityLabel={`Send ${displayName} a payment reminder`}
                style={({ pressed }) => [
                  styles.callBtn,
                  { backgroundColor: theme.surface },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
              >
                <Ionicons name="cash-outline" size={17} color={amberFg} />
                <Text style={[styles.callBtnLabel, { color: amberFg }]}>
                  Send payment reminder
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Upcoming — next booking with its deposit affordance */}
        {nextOcc ? (
          <View>
            <SectionLabel>Upcoming</SectionLabel>
            <DepositRow task={nextOcc.task} dateKey={nextOcc.dateKey} />
            {phone ? (
              <Pressable
                onPress={requestDeposit}
                accessibilityRole="button"
                accessibilityLabel={`Request a deposit from ${displayName}`}
                style={({ pressed }) => [
                  styles.callBtn,
                  { backgroundColor: theme.surface },
                  pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
                ]}
              >
                <Ionicons name="wallet-outline" size={17} color={theme.accent} />
                <Text style={[styles.callBtnLabel, { color: theme.accent }]}>
                  Request deposit
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Book again — hidden for blocked contacts */}
        {!blocked ? (
          <View>
            <SectionLabel>Book again</SectionLabel>
            <RebookSuggestion client={displayName} />
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
        ) : null}

        {/* History */}
        {history.length > 0 ? (
          <View>
            <SectionLabel>History</SectionLabel>
            <GlassCard padding={6}>
              {history.map((o, i) => {
                const noShow = o.task.meeting?.noShows?.includes(o.dateKey) ?? false;
                return (
                  <Pressable
                    key={`${o.task.id}-${o.dateKey}`}
                    onLongPress={() => handleNoShowToggle(o.task.id, o.dateKey, noShow)}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatDayShort(o.dateKey)}${
                      noShow ? ', no-show' : `, ${formatMoney(o.rate, symbol)}`
                    }`}
                    accessibilityHint={
                      noShow ? 'Long press to unmark no-show' : 'Long press to mark as a no-show'
                    }
                    style={[
                      styles.historyRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.separator,
                      },
                      noShow && styles.historyRowDimmed,
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
                    {noShow ? (
                      <View
                        style={[
                          styles.noShowTag,
                          { backgroundColor: theme.dark ? amber.bgDark : amber.bgLight },
                        ]}
                      >
                        <Text style={[styles.noShowTagLabel, { color: amberFg }]}>
                          No-show
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[styles.historyAmount, { color: money }]}>
                          {formatMoney(o.rate, symbol)}
                        </Text>
                        <Ionicons
                          name={o.paid ? 'checkmark-circle' : 'ellipse-outline'}
                          size={18}
                          color={o.paid ? theme.success : theme.textTertiary}
                        />
                      </>
                    )}
                  </Pressable>
                );
              })}
            </GlassCard>
          </View>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: { flex: 1 },
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
    marginBottom: SPACING.lg,
  },
  heroName: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    maxWidth: '92%',
  },
  editNameBtn: { padding: 4 },
  nameEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    width: '100%',
  },
  nameInput: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 18,
    fontWeight: '700',
  },
  nameAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  statusBlock: {
    gap: SPACING.sm + 2,
    marginBottom: SPACING.xl,
  },
  blockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  blockedBannerText: {
    fontSize: 13,
    fontWeight: '600',
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
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: SPACING.sm,
  },
  telegramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  telegramLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  callBtnLabel: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
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
  historyRowDimmed: {
    opacity: 0.55,
  },
  noShowTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  noShowTagLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
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
