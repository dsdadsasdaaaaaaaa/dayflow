import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
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
import { formatMinutes } from '../src/lib/dates';
import { selectionHaptic, successHaptic, tapHaptic } from '../src/lib/haptics';
import {
  classNote,
  classTags,
  isSchoolTask,
  isTimetableTask,
  nextWeekday,
  parseTimetable,
  SCHOOL_TAG,
  TIMETABLE_TAG,
  weeklyOn,
  type ParsedClass,
} from '../src/lib/timetableImport';
import { rebuildSpecialDays } from '../src/lib/bellSchedule';
import { applyStoredRules } from '../src/lib/schoolDay';
import { useTasks } from '../src/store/tasks';
import { SPACING, useTheme } from '../src/theme';
import type { ClassConflict } from '../src/lib/timetableImport';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Turn a school timetable into a repeating week.
 *
 * Done once a term rather than once a week, which is why it is a screen of
 * its own and not a mode of the newsletter import: the two produce different
 * things — a repeating class against a one-off assembly — and a single
 * screen that did both would have to explain the difference every time.
 */
export default function TimetableImportScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const addTask = useTasks((s) => s.addTask);
  const deleteTask = useTasks((s) => s.deleteTask);
  const tasks = useTasks((s) => s.tasks);
  const [replace, setReplace] = useState(true);

  /**
   * Classes already on the calendar from an earlier import.
   *
   * Worth knowing about because the usual reason for importing twice is that
   * the first lot got dragged out of place by accident, and adding a correct
   * copy alongside a wrong one helps nobody.
   */
  const existing = useMemo(() => Object.values(tasks).filter(isTimetableTask), [tasks]);

  const [raw, setRaw] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classes, setClasses] = useState<ParsedClass[] | null>(null);
  const [dropped, setDropped] = useState(0);
  const [conflicts, setConflicts] = useState<ClassConflict[]>([]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<number | null>(null);

  const keyOf = (c: ParsedClass) => `${c.weekday}|${c.startMinutes}|${c.title}`;

  /** Classes already repeating on that weekday at that time. */
  const alreadyThere = useMemo(() => {
    const have = new Set<string>();
    for (const t of Object.values(tasks)) {
      const days = t.recurrence?.weekdays;
      if (!days || t.startMinutes == null) continue;
      for (const d of days) have.add(`${d}|${t.startMinutes}|${t.title.trim().toLowerCase()}`);
    }
    return have;
  }, [tasks]);

  const isDuplicate = (c: ParsedClass) =>
    alreadyThere.has(`${c.weekday}|${c.startMinutes}|${c.title.trim().toLowerCase()}`);

  // When replacing, everything goes back in: what is already there is about
  // to be removed, so calling it a duplicate would silently drop it.
  const replacing = replace && existing.length > 0;
  const chosen = (classes ?? []).filter(
    (c) => !skipped[keyOf(c)] && (replacing || !isDuplicate(c))
  );

  const days = useMemo(() => {
    const byDay = new Map<number, ParsedClass[]>();
    for (const c of classes ?? []) {
      const group = byDay.get(c.weekday);
      if (group) group.push(c);
      else byDay.set(c.weekday, [c]);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  }, [classes]);

  async function read() {
    tapHaptic();
    setReading(true);
    setError(null);
    setAdded(null);
    const result = await parseTimetable(raw);
    setReading(false);
    if (!result.ok) {
      setError(result.error);
      setClasses(null);
      return;
    }
    setClasses(result.classes);
    setDropped(result.dropped);
    setConflicts(result.conflicts);
    setSkipped({});
  }

  function addAll() {
    if (replacing) {
      for (const t of existing) deleteTask(t.id);
      // Single days that were split off a class — by a drag, or by an early
      // bell cutting a period short — are one-offs with a class's name and
      // no repeat. They are part of the old timetable too, and leaving them
      // put two Business Leaderships on Labour Day after the last replace.
      // A newsletter item never shares a name with a class, so the incoming
      // class names are a safe test.
      const classNames = new Set(chosen.map((c) => c.title.trim().toLowerCase()));
      for (const t of Object.values(tasks)) {
        if (t.recurrence || !isSchoolTask(t)) continue;
        if (classNames.has(t.title.trim().toLowerCase())) deleteTask(t.id);
      }
    }
    for (const c of chosen) {
      addTask({
        title: c.title,
        // Anchored to the next such weekday so it appears straight away,
        // and repeated weekly from there rather than from some term start
        // nobody typed in.
        date: nextWeekday(c.weekday),
        allDay: false,
        startMinutes: c.startMinutes,
        durationMinutes: c.durationMinutes,
        recurrence: weeklyOn(c.weekday),
        notes: classNote(c),
        icon: 'school-outline',
        color: 'sky',
        tags: classTags(c),
      });
    }
    // Classes that have just arrived know nothing about closures the
    // newsletter announced before them, so every remembered amendment is
    // re-applied. Without this, importing in the other order puts a full day
    // of school back on the day the school is shut.
    void applyStoredRules()
      .then(() => rebuildSpecialDays())
      .catch(() => {});
    successHaptic();
    setAdded(chosen.length);
    setClasses(null);
    setRaw('');
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text style={[styles.title, { color: theme.text }]}>Import timetable</Text>
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
          {classes == null ? (
            <>
              <Text style={[styles.blurb, { color: theme.textSecondary }]}>
                Paste your weekly timetable — periods, times, rooms, teachers. Each class
                becomes a weekly repeat, so this is a once-a-term job, not a weekly one.
              </Text>

              <GlassCard padding={0}>
                <TextInput
                  value={raw}
                  onChangeText={setRaw}
                  placeholder="Paste the timetable here"
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, { color: theme.text }]}
                  accessibilityLabel="Timetable text"
                />
              </GlassCard>

              <View style={styles.row}>
                <Pressable
                  onPress={async () => {
                    const text = await Clipboard.getStringAsync();
                    if (text.trim()) {
                      selectionHaptic();
                      setRaw(text);
                    }
                  }}
                  style={[styles.ghostBtn, { borderColor: theme.separator }]}
                  accessibilityRole="button"
                  accessibilityLabel="Paste from clipboard"
                >
                  <Ionicons name="clipboard-outline" size={17} color={theme.textSecondary} />
                  <Text style={[styles.ghostLabel, { color: theme.textSecondary }]}>Paste</Text>
                </Pressable>
                <Pressable
                  onPress={() => void read()}
                  disabled={reading || !raw.trim()}
                  style={[
                    styles.cta,
                    styles.flex,
                    { backgroundColor: theme.accent, opacity: reading || !raw.trim() ? 0.4 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Read this timetable"
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

              {error ? (
                <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
              ) : null}
              {added != null ? (
                <Text style={[styles.done, { color: theme.success }]}>
                  {added === 1
                    ? 'Added 1 weekly class.'
                    : `Added ${added} weekly classes. They repeat every week from now on.`}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[styles.blurb, { color: theme.textSecondary }]}>
                {chosen.length === 1
                  ? '1 class will repeat every week.'
                  : `${chosen.length} classes will repeat every week.`}
                {dropped > 0
                  ? ` ${dropped} row${dropped === 1 ? '' : 's'} could not be read and ${
                      dropped === 1 ? 'was' : 'were'
                    } left out.`
                  : ''}
              </Text>

              {conflicts.length > 0 ? (
                <View style={[styles.conflicts, { borderColor: '#F59E0B' }]}>
                  <Text style={[styles.conflictTitle, { color: theme.text }]}>
                    {conflicts.length === 1
                      ? 'One period overlaps the one before it'
                      : `${conflicts.length} periods overlap the one before them`}
                  </Text>
                  <Text style={[styles.conflictBody, { color: theme.textSecondary }]}>
                    A timetable cannot have two classes at once, so one of these times was read
                    wrong. Check them against your own copy before importing.
                  </Text>
                  {conflicts.slice(0, 6).map((c, i) => (
                    <Text
                      key={`${c.weekday}-${i}`}
                      style={[styles.conflictRow, { color: theme.textSecondary }]}
                    >
                      {DAY_NAMES[c.weekday]}: {c.later.title} starts{' '}
                      {formatMinutes(c.later.startMinutes)}, but {c.earlier.title} runs to{' '}
                      {formatMinutes(c.earlier.startMinutes + c.earlier.durationMinutes)}
                    </Text>
                  ))}
                </View>
              ) : null}

              {existing.length > 0 ? (
                <GlassCard padding={0}>
                  <View style={styles.replaceRow}>
                    <View style={styles.flex}>
                      <Text style={[styles.className, { color: theme.text }]}>
                        Replace the timetable I already have
                      </Text>
                      <Text style={[styles.classMeta, { color: theme.textTertiary }]}>
                        {replace
                          ? `The ${existing.length} class${existing.length === 1 ? '' : 'es'} already on your calendar will be removed first, so anything nudged out of place goes back to what the timetable says.`
                          : `Your ${existing.length} existing class${existing.length === 1 ? '' : 'es'} stay as they are, and only classes not already there get added.`}
                      </Text>
                    </View>
                    <Switch
                      value={replace}
                      onValueChange={(v) => {
                        selectionHaptic();
                        setReplace(v);
                      }}
                      accessibilityLabel="Replace the timetable I already have"
                    />
                  </View>
                </GlassCard>
              ) : null}

              {days.map(([day, items]) => (
                <View key={day} style={styles.day}>
                  <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>
                    {DAY_NAMES[day]}
                  </Text>
                  <GlassCard padding={6}>
                    {items.map((c, i) => {
                      const dupe = !replacing && isDuplicate(c);
                      const off = dupe || skipped[keyOf(c)];
                      const note = classNote(c);
                      return (
                        <Pressable
                          key={keyOf(c)}
                          onPress={() => {
                            if (dupe) return;
                            selectionHaptic();
                            setSkipped((s) => ({ ...s, [keyOf(c)]: !s[keyOf(c)] }));
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: !off, disabled: dupe }}
                          accessibilityLabel={`${c.title}, ${formatMinutes(c.startMinutes)}${
                            dupe ? ', already in your week' : ''
                          }`}
                          style={[
                            styles.classRow,
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
                            color={dupe || off ? theme.textTertiary : theme.accent}
                          />
                          <View style={styles.flex}>
                            <Text style={[styles.className, { color: theme.text }]}>
                              {c.title}
                            </Text>
                            <Text
                              style={[styles.classMeta, { color: theme.textTertiary }]}
                              numberOfLines={1}
                            >
                              {`${formatMinutes(c.startMinutes)} · ${c.durationMinutes}m`}
                              {note ? ` · ${note}` : ''}
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
                    setClasses(null);
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
                  accessibilityLabel={`Add ${chosen.length} weekly classes`}
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
  conflicts: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    marginBottom: 12,
  },
  conflictTitle: { fontSize: 14, fontWeight: '700' },
  conflictBody: { fontSize: 13, lineHeight: 18 },
  conflictRow: { fontSize: 12, lineHeight: 17 },
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
  input: { minHeight: 200, padding: SPACING.md, fontSize: 14, lineHeight: 20 },
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
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.sm + 4,
  },
  replaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  className: { fontSize: 15, fontWeight: '600' },
  classMeta: { fontSize: 12, marginTop: 1 },
});
