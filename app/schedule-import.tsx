import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { GlassCard } from '../src/components/glass/GlassCard';
import { formatDayShort, formatMinutes } from '../src/lib/dates';
import { selectionHaptic, successHaptic, tapHaptic } from '../src/lib/haptics';
import { parseScheduleEmail, type ParsedEvent } from '../src/lib/scheduleImport';
import { fetchRelaySchedule, type RelaySchedule } from '../src/lib/smsgate';
import { loadSmsGateCredentials } from '../src/lib/smsgateCredentials';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { SPACING, useTheme } from '../src/theme';

/**
 * Turn a school schedule email into a week of DayFlow.
 *
 * The screen is a confirmation step, not a progress bar. A model read the
 * email, and a model reading an email can be wrong or be misled by one, so
 * nothing reaches the timeline until it has been looked at. Everything is
 * ticked by default — the common case is that it got it right, and making
 * someone tick twenty boxes to accept a correct answer is its own failure —
 * but every row can be dropped, and the count of what will be added is
 * always on screen.
 */
export default function ScheduleImportScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addTask = useTasks((s) => s.addTask);
  const auto = useSettings((s) => s.settings.autoImportSchedule);
  const updateSettings = useSettings((s) => s.update);
  const tasks = useTasks((s) => s.tasks);

  const [email, setEmail] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** An email with no timetable in it is normal, not a failure. */
  const [announcement, setAnnouncement] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[] | null>(null);
  const [dropped, setDropped] = useState(0);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<number | null>(null);
  const [waiting, setWaiting] = useState<RelaySchedule | null>(null);

  /**
   * A schedule email the relay is already holding. This is the automatic
   * path: a script in the user's own mailbox posts the email as it arrives,
   * so opening this screen usually means the week is already here and the
   * pasting is only ever a fallback.
   */
  useEffect(() => {
    let alive = true;
    loadSmsGateCredentials()
      .then((creds) => (creds ? fetchRelaySchedule(creds) : null))
      .then((found) => {
        if (alive && found) setWaiting(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const keyOf = (e: ParsedEvent) => `${e.date}|${e.startMinutes ?? 'all'}|${e.title}`;

  /**
   * Which of these are already on the timeline. Re-reading the same email —
   * which is exactly what happens when a week's schedule is re-sent with one
   * change — must not put the whole week on twice.
   */
  const alreadyThere = useMemo(() => {
    const have = new Set<string>();
    for (const t of Object.values(tasks)) {
      if (!t.date) continue;
      have.add(`${t.date}|${t.startMinutes ?? 'all'}|${t.title.trim().toLowerCase()}`);
    }
    return have;
  }, [tasks]);

  const isDuplicate = (e: ParsedEvent) =>
    alreadyThere.has(`${e.date}|${e.startMinutes ?? 'all'}|${e.title.trim().toLowerCase()}`);

  const chosen = (events ?? []).filter((e) => !skipped[keyOf(e)] && !isDuplicate(e));

  /** Grouped into days, so it reads as a week rather than a list of rows. */
  const days = useMemo(() => {
    const byDay = new Map<string, ParsedEvent[]>();
    for (const e of events ?? []) {
      const group = byDay.get(e.date);
      if (group) group.push(e);
      else byDay.set(e.date, [e]);
    }
    return [...byDay.entries()];
  }, [events]);

  async function read(source?: string) {
    tapHaptic();
    setReading(true);
    setError(null);
    setAnnouncement(false);
    setAdded(null);
    const result = await parseScheduleEmail(source ?? email);
    setReading(false);
    if (!result.ok) {
      setError(result.error);
      setAnnouncement(result.announcement === true);
      setEvents(null);
      return;
    }
    setEvents(result.events);
    setDropped(result.dropped);
    setSkipped({});
  }

  async function paste() {
    const text = await Clipboard.getStringAsync();
    if (text.trim()) {
      selectionHaptic();
      setEmail(text);
    }
  }

  function addAll() {
    for (const e of chosen) {
      addTask({
        title: e.title,
        date: e.date,
        allDay: e.startMinutes == null,
        startMinutes: e.startMinutes,
        durationMinutes: e.durationMinutes,
        notes: [e.location, e.notes].filter(Boolean).join('\n'),
        icon: 'school-outline',
        color: 'indigo',
      });
    }
    successHaptic();
    setAdded(chosen.length);
    setEvents(null);
    setEmail('');
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text style={[styles.title, { color: theme.text }]}>Import schedule</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        >
          {events == null ? (
            <>
              <Text style={[styles.blurb, { color: theme.textSecondary }]}>
                Paste your school's newsletter and the schedule grids in it will be read
                into your week. Everything else in the email is ignored, and nothing is
                added until you have seen it.
              </Text>

              {waiting ? (
                <Pressable
                  onPress={() => {
                    setEmail(waiting.body);
                    void read(waiting.body);
                  }}
                  disabled={reading}
                  accessibilityRole="button"
                  accessibilityLabel={`Read the schedule email that arrived: ${waiting.subject}`}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <GlassCard padding={0}>
                    <View style={styles.waitingRow}>
                      <Ionicons name="mail-unread" size={22} color={theme.accent} />
                      <View style={styles.flex}>
                        <Text style={[styles.eventTitle, { color: theme.text }]} numberOfLines={1}>
                          {waiting.subject || 'Schedule email'}
                        </Text>
                        <Text
                          style={[styles.eventMeta, { color: theme.textTertiary }]}
                          numberOfLines={1}
                        >
                          {`Arrived ${formatDayShort(
                            new Date(waiting.sentAt).toISOString().slice(0, 10)
                          )} · tap to read it`}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
                    </View>
                  </GlassCard>
                </Pressable>
              ) : null}

              <GlassCard padding={0}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Paste the email here"
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, { color: theme.text }]}
                  accessibilityLabel="Schedule email text"
                />
              </GlassCard>

              <View style={styles.row}>
                <Pressable
                  onPress={paste}
                  style={[styles.ghostBtn, { borderColor: theme.separator }]}
                  accessibilityRole="button"
                  accessibilityLabel="Paste from clipboard"
                >
                  <Ionicons name="clipboard-outline" size={17} color={theme.textSecondary} />
                  <Text style={[styles.ghostLabel, { color: theme.textSecondary }]}>Paste</Text>
                </Pressable>
                <Pressable
                  onPress={() => void read()}
                  disabled={reading || !email.trim()}
                  style={[
                    styles.cta,
                    styles.flex,
                    { backgroundColor: theme.accent, opacity: reading || !email.trim() ? 0.4 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Read this email"
                >
                  {reading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={17} color="#FFFFFF" />
                      <Text style={styles.ctaLabel}>Read it</Text>
                    </>
                  )}
                </Pressable>
              </View>

              <GlassCard padding={0}>
                <View style={styles.autoRow}>
                  <View style={styles.flex}>
                    <Text style={[styles.eventTitle, { color: theme.text }]}>
                      Add new schedules automatically
                    </Text>
                    <Text style={[styles.eventMeta, { color: theme.textTertiary }]}>
                      {auto
                        ? 'New newsletters go straight on your calendar, and you get a notification saying what was added.'
                        : 'New newsletters wait here until you come and read them.'}
                    </Text>
                  </View>
                  <Switch
                    value={auto}
                    onValueChange={(autoImportSchedule) => {
                      selectionHaptic();
                      updateSettings({ autoImportSchedule });
                    }}
                    accessibilityLabel="Add new schedules automatically"
                  />
                </View>
              </GlassCard>

              {error ? (
                <Text
                  style={[
                    styles.error,
                    { color: announcement ? theme.textSecondary : theme.danger },
                  ]}
                >
                  {error}
                </Text>
              ) : null}

              {added != null ? (
                <Text style={[styles.done, { color: theme.success }]}>
                  {added === 1 ? 'Added 1 item to your calendar.' : `Added ${added} items to your calendar.`}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[styles.blurb, { color: theme.textSecondary }]}>
                {chosen.length === 1 ? '1 item will be added.' : `${chosen.length} items will be added.`}
                {dropped > 0
                  ? ` ${dropped} line${dropped === 1 ? '' : 's'} could not be read and ${
                      dropped === 1 ? 'was' : 'were'
                    } left out.`
                  : ''}
              </Text>

              {days.map(([day, items]) => (
                <View key={day} style={styles.day}>
                  <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>
                    {formatDayShort(day)}
                  </Text>
                  <GlassCard padding={6}>
                    {items.map((e, i) => {
                      const dupe = isDuplicate(e);
                      const off = dupe || skipped[keyOf(e)];
                      return (
                        <Pressable
                          key={keyOf(e)}
                          onPress={() => {
                            if (dupe) return;
                            selectionHaptic();
                            setSkipped((s) => ({ ...s, [keyOf(e)]: !s[keyOf(e)] }));
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: !off, disabled: dupe }}
                          accessibilityLabel={`${e.title}, ${
                            e.startMinutes == null ? 'all day' : formatMinutes(e.startMinutes)
                          }${dupe ? ', already in your week' : ''}`}
                          style={[
                            styles.eventRow,
                            i > 0 && {
                              borderTopWidth: StyleSheet.hairlineWidth,
                              borderTopColor: theme.separator,
                            },
                            off && { opacity: 0.45 },
                          ]}
                        >
                          <Ionicons
                            name={
                              dupe
                                ? 'checkmark-done-circle'
                                : off
                                  ? 'ellipse-outline'
                                  : 'checkmark-circle'
                            }
                            size={22}
                            color={
                              dupe ? theme.textTertiary : off ? theme.textTertiary : theme.accent
                            }
                          />
                          <View style={styles.flex}>
                            <Text style={[styles.eventTitle, { color: theme.text }]}>
                              {e.title}
                            </Text>
                            <Text
                              style={[styles.eventMeta, { color: theme.textTertiary }]}
                              numberOfLines={1}
                            >
                              {e.startMinutes == null ? 'All day' : formatMinutes(e.startMinutes)}
                              {e.startMinutes != null ? ` · ${e.durationMinutes}m` : ''}
                              {e.location ? ` · ${e.location}` : ''}
                              {dupe ? ' · already added' : ''}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </GlassCard>
                </View>
              ))}

              <View style={styles.row}>
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    setEvents(null);
                  }}
                  style={[styles.ghostBtn, { borderColor: theme.separator }]}
                  accessibilityRole="button"
                  accessibilityLabel="Start over"
                >
                  <Text style={[styles.ghostLabel, { color: theme.textSecondary }]}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={addAll}
                  disabled={chosen.length === 0}
                  style={[
                    styles.cta,
                    styles.flex,
                    { backgroundColor: theme.accent, opacity: chosen.length === 0 ? 0.4 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${chosen.length} to my week`}
                >
                  <Ionicons name="add" size={19} color="#FFFFFF" />
                  <Text style={styles.ctaLabel}>Add to my week</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: 4, gap: SPACING.md },
  blurb: { fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 200,
    padding: SPACING.md,
    fontSize: 14,
    lineHeight: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
  },
  ghostLabel: { fontSize: 15, fontWeight: '600' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
  },
  ctaLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  error: { fontSize: 14, lineHeight: 19 },
  done: { fontSize: 14, fontWeight: '600' },
  day: { gap: 6 },
  dayLabel: { fontSize: 13, fontWeight: '700', paddingHorizontal: SPACING.xs },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm + 4,
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  eventTitle: { fontSize: 15, fontWeight: '600' },
  eventMeta: { fontSize: 12, marginTop: 1 },
});
