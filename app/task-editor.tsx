import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { AnimatedCheck } from '../src/components/AnimatedCheck';
import { CalendarGrid } from '../src/components/editor/CalendarGrid';
import { IconColorPanel } from '../src/components/editor/IconColorPanel';
import {
  draftRate,
  emptyMeetingDraft,
  MeetingSection,
  type MeetingDraft,
} from '../src/components/editor/MeetingSection';
import { RecurrencePicker } from '../src/components/editor/RecurrencePicker';
import { StartEndPicker } from '../src/components/editor/StartEndPicker';
import { suggestIcon } from '../src/components/editor/iconSuggest';
import { pushRecentIcon } from '../src/components/editor/recentIcons';
import { Chip, GlassSegmented, Section } from '../src/components/editor/ui';
import {
  addDays,
  formatDayRelative,
  formatDuration,
  formatMinutes,
  minutesOfDay,
  todayKey,
} from '../src/lib/dates';
import { successHaptic, tapHaptic, warningHaptic } from '../src/lib/haptics';
import { lastMeetingFor } from '../src/lib/meetings';
import { parseQuickAdd } from '../src/lib/nlp';
import { syncTaskNotifications } from '../src/lib/notifications';
import { describeRecurrence } from '../src/lib/recurrence';
import { draftHasContent, useDrafts } from '../src/store/drafts';
import { showUndo } from '../src/store/undo';
import { useSettings } from '../src/store/settings';
import { useTasks } from '../src/store/tasks';
import { PRIORITY_META, RADIUS, SPACING, taskColor, useTheme } from '../src/theme';
import type { DayKey, MeetingInfo, Priority, Subtask, Task } from '../src/types';

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180];

const ALERT_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At start' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 1440, label: '1 day' },
];

/** Next tidy half-hour from now, clamped to the day. */
function nextHalfHour(): number {
  return Math.min(23 * 60 + 30, Math.ceil((minutesOfDay() + 1) / 30) * 30);
}

function param(v: string | string[] | undefined): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export default function TaskEditorScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id?: string;
    date?: string;
    startMinutes?: string;
    durationMinutes?: string;
    inbox?: string;
    title?: string;
    client?: string;
  }>();

  const editingId = param(params.id);
  const paramDate = param(params.date);
  const paramTitle = param(params.title) ?? '';
  const paramStartRaw = param(params.startMinutes);
  const paramStart = paramStartRaw != null ? parseInt(paramStartRaw, 10) : NaN;
  const paramDurationRaw = param(params.durationMinutes);
  const paramDuration = paramDurationRaw != null ? parseInt(paramDurationRaw, 10) : NaN;
  const wantsInbox = param(params.inbox) === '1';
  const paramClient = param(params.client);

  // Snapshot of the task being edited — state seeds once from this.
  const initial = useMemo<Task | null>(
    () => (editingId ? (useTasks.getState().tasks[editingId] ?? null) : null),
    [editingId]
  );
  const isEditing = initial != null;

  const tasksRecord = useTasks((s) => s.tasks);
  const addTask = useTasks((s) => s.addTask);
  const updateTask = useTasks((s) => s.updateTask);
  const deleteTask = useTasks((s) => s.deleteTask);
  const skipOccurrence = useTasks((s) => s.skipOccurrence);
  const duplicateTask = useTasks((s) => s.duplicateTask);
  const settings = useSettings((s) => s.settings);

  // ---- Auto-saved draft ---------------------------------------------------
  // Restore an unsaved draft: always for edits (when newer than the task),
  // and for creation only on "plain" opens — explicit prefills (a tapped gap
  // time, a client booking, a passed title) win over an old draft.
  const draftKey = editingId ?? 'new';
  const restoredDraft = useMemo(() => {
    const d = useDrafts.getState().getDraft(draftKey);
    if (!d || !draftHasContent(d)) return null;
    if (initial) return d.savedAt > initial.updatedAt ? d : null;
    if (paramStartRaw != null || paramDurationRaw != null || paramClient || paramTitle) return null;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const [draftBanner, setDraftBanner] = useState(restoredDraft != null);

  // ---- Form state ---------------------------------------------------------
  const [title, setTitle] = useState(
    restoredDraft?.title ?? initial?.title ?? (paramTitle || paramClient || '')
  );
  const [icon, setIcon] = useState(
    () => restoredDraft?.icon ?? initial?.icon ?? suggestIcon(paramTitle) ?? 'ellipse-outline'
  );
  const [color, setColor] = useState(restoredDraft?.color ?? initial?.color ?? 'indigo');
  const iconTouched = useRef(isEditing || restoredDraft != null);
  const [showIconPanel, setShowIconPanel] = useState(false);

  const [where, setWhere] = useState<'inbox' | 'scheduled'>(
    restoredDraft?.where ??
      (initial ? (initial.date ? 'scheduled' : 'inbox') : wantsInbox ? 'inbox' : 'scheduled')
  );
  const [date, setDate] = useState<DayKey>(
    restoredDraft?.date ?? initial?.date ?? paramDate ?? todayKey()
  );
  const [showCalendar, setShowCalendar] = useState(false);
  const [allDay, setAllDay] = useState(restoredDraft?.allDay ?? initial?.allDay ?? false);
  const [startMinutes, setStartMinutes] = useState<number>(
    restoredDraft?.startMinutes ??
      initial?.startMinutes ??
      (Number.isFinite(paramStart) ? paramStart : nextHalfHour())
  );
  const [duration, setDuration] = useState(
    restoredDraft?.duration ??
      initial?.durationMinutes ??
      // A booking card that says "1 h" must open an editor showing 1 h.
      (Number.isFinite(paramDuration) && paramDuration > 0
        ? paramDuration
        : settings.defaultDurationMinutes)
  );
  const [recurrence, setRecurrence] = useState(
    restoredDraft ? restoredDraft.recurrence : (initial?.recurrence ?? null)
  );
  const [alerts, setAlerts] = useState<number[]>(
    restoredDraft?.alerts ?? (initial ? initial.alerts : settings.defaultAlerts)
  );
  const [priority, setPriority] = useState<Priority>(
    restoredDraft?.priority ?? initial?.priority ?? 0
  );
  const [tags, setTags] = useState<string[]>(restoredDraft?.tags ?? initial?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [subtasks, setSubtasks] = useState<Subtask[]>(
    restoredDraft?.subtasks ?? initial?.subtasks ?? []
  );
  const [subtaskInput, setSubtaskInput] = useState('');
  const subtaskRef = useRef<TextInput>(null);
  const [notes, setNotes] = useState(restoredDraft?.notes ?? initial?.notes ?? '');
  const [meeting, setMeeting] = useState<MeetingDraft>(() => {
    if (restoredDraft) return restoredDraft.meeting;
    if (initial?.meeting) {
      return {
        enabled: true,
        kind: initial.meeting.kind,
        client: initial.meeting.client,
        rate: initial.meeting.rate > 0 ? String(initial.meeting.rate) : '',
        location: initial.meeting.location,
      };
    }
    // Creating with ?client=Name → meeting prefilled from that client's history.
    if (!initial && paramClient) {
      const prefill = lastMeetingFor(useTasks.getState().tasks, paramClient);
      return {
        enabled: true,
        kind: prefill?.kind ?? 'incall',
        client: paramClient,
        rate: prefill && prefill.rate > 0 ? String(prefill.rate) : '',
        location: prefill?.location ?? '',
      };
    }
    return emptyMeetingDraft();
  });

  const solid = taskColor(color).solid;
  const occurrenceDate = paramDate ?? initial?.date ?? null;

  // ---- Draft auto-save (debounced) ----------------------------------------
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => {
      useDrafts.getState().saveDraft(draftKey, {
        title,
        icon,
        color,
        where,
        date,
        allDay,
        startMinutes,
        duration,
        recurrence,
        alerts,
        priority,
        tags,
        subtasks,
        notes,
        meeting,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [
    draftKey, title, icon, color, where, date, allDay, startMinutes, duration,
    recurrence, alerts, priority, tags, subtasks, notes, meeting,
  ]);

  const discardDraft = () => {
    tapHaptic();
    useDrafts.getState().clearDraft(draftKey);
    setDraftBanner(false);
    // Reset the form to its pre-draft values.
    setTitle(initial?.title ?? (paramTitle || paramClient || ''));
    setIcon(initial?.icon ?? suggestIcon(paramTitle) ?? 'ellipse-outline');
    setColor(initial?.color ?? 'indigo');
    setWhere(initial ? (initial.date ? 'scheduled' : 'inbox') : wantsInbox ? 'inbox' : 'scheduled');
    setDate(initial?.date ?? paramDate ?? todayKey());
    setAllDay(initial?.allDay ?? false);
    setStartMinutes(
      initial?.startMinutes ?? (Number.isFinite(paramStart) ? paramStart : nextHalfHour())
    );
    setDuration(initial?.durationMinutes ?? settings.defaultDurationMinutes);
    setRecurrence(initial?.recurrence ?? null);
    setAlerts(initial ? initial.alerts : settings.defaultAlerts);
    setPriority(initial?.priority ?? 0);
    setTags(initial?.tags ?? []);
    setSubtasks(initial?.subtasks ?? []);
    setNotes(initial?.notes ?? '');
    setMeeting(
      initial?.meeting
        ? {
            enabled: true,
            kind: initial.meeting.kind,
            client: initial.meeting.client,
            rate: initial.meeting.rate > 0 ? String(initial.meeting.rate) : '',
            location: initial.meeting.location,
          }
        : emptyMeetingDraft()
    );
    // The reset itself re-triggers the auto-save effect; clear again after it
    // settles so the pristine state doesn't persist as a fresh draft.
    setTimeout(() => useDrafts.getState().clearDraft(draftKey), 1200);
  };

  // ---- Quick-add suggestion (creating only) -------------------------------
  const parsed = useMemo(() => (isEditing ? null : parseQuickAdd(title)), [isEditing, title]);
  const quickLabel = useMemo(() => {
    if (!parsed) return null;
    const parts: string[] = [];
    if (parsed.date) parts.push(formatDayRelative(parsed.date));
    if (parsed.startMinutes != null) parts.push(formatMinutes(parsed.startMinutes));
    if (parsed.durationMinutes != null) parts.push(formatDuration(parsed.durationMinutes));
    if (parsed.recurrence) parts.push(describeRecurrence(parsed.recurrence));
    if (parsed.priority > 0) parts.push(`${PRIORITY_META[parsed.priority].label} priority`);
    if (parts.length === 0 || !parsed.title) return null;
    return parts.join(' · ');
  }, [parsed]);

  const applyQuickAdd = () => {
    if (!parsed) return;
    tapHaptic();
    setTitle(parsed.title);
    if (parsed.date) {
      setWhere('scheduled');
      setDate(parsed.date);
    }
    if (parsed.startMinutes != null) {
      setStartMinutes(parsed.startMinutes);
      setAllDay(false);
    }
    if (parsed.durationMinutes != null) setDuration(parsed.durationMinutes);
    if (parsed.priority > 0) setPriority(parsed.priority);
    if (parsed.recurrence) setRecurrence(parsed.recurrence);
    if (!iconTouched.current) {
      const s = suggestIcon(parsed.title);
      if (s) setIcon(s);
    }
  };

  const onTitleChange = (text: string) => {
    setTitle(text);
    if (!iconTouched.current) {
      const s = suggestIcon(text);
      if (s) setIcon(s);
    }
  };

  // ---- Tags ---------------------------------------------------------------
  const tagSuggestions = useMemo(() => {
    const all = new Set<string>();
    for (const t of Object.values(tasksRecord)) for (const tag of t.tags) all.add(tag);
    const q = tagInput.trim().toLowerCase();
    return [...all]
      .filter((tag) => !tags.includes(tag) && (q.length === 0 || tag.toLowerCase().includes(q)))
      .sort()
      .slice(0, 8);
  }, [tasksRecord, tags, tagInput]);

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '');
    if (!tag) return;
    if (!tags.includes(tag)) setTags((prev) => [...prev, tag]);
    setTagInput('');
  };

  // ---- Subtasks -----------------------------------------------------------
  const addSubtask = () => {
    const t = subtaskInput.trim();
    if (!t) return;
    tapHaptic();
    setSubtasks((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: t, done: false },
    ]);
    setSubtaskInput('');
    subtaskRef.current?.focus();
  };

  // ---- Save / delete / duplicate -----------------------------------------
  const canSave = title.trim().length > 0;

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      warningHaptic();
      return;
    }
    const scheduled = where === 'scheduled';
    // Read the LIVE task, not the mount-time snapshot — paid toggles made
    // inside this editor session already wrote to the store and must survive.
    const live = editingId ? useTasks.getState().tasks[editingId] : undefined;
    const meetingInfo: MeetingInfo | null = meeting.enabled
      ? {
          kind: meeting.kind,
          client: meeting.client.trim(),
          rate: draftRate(meeting),
          location: meeting.location.trim(),
          paidDates: live?.meeting?.paidDates ?? [],
          extras: live?.meeting?.extras,
          deposits: live?.meeting?.deposits,
          noShows: live?.meeting?.noShows,
        }
      : null;
    const fields = {
      title: trimmed,
      icon,
      color,
      notes: notes.trim(),
      date: scheduled ? date : null,
      allDay: scheduled ? allDay : false,
      startMinutes: scheduled && !allDay ? startMinutes : null,
      durationMinutes: duration,
      subtasks,
      alerts: scheduled && !allDay ? alerts : [],
      recurrence: scheduled ? recurrence : null,
      priority,
      tags,
      meeting: meetingInfo,
    };

    const commit = () => {
      let saved: Task | undefined;
      if (isEditing && editingId) {
        updateTask(editingId, fields);
        saved = useTasks.getState().tasks[editingId];
      } else {
        saved = addTask(fields);
      }
      pushRecentIcon(icon);
      useDrafts.getState().clearDraft(draftKey);
      if (saved) syncTaskNotifications(saved);
      successHaptic();
      router.back();
    };

    const hadMoneyHistory =
      !!live?.meeting &&
      (live.meeting.paidDates.length > 0 ||
        Object.keys(live.meeting.extras ?? {}).length > 0 ||
        Object.keys(live.meeting.deposits ?? {}).length > 0);

    if (isEditing && !meeting.enabled && hadMoneyHistory) {
      Alert.alert(
        'Remove meeting details?',
        'This also clears its payment history — paid marks, deposits, and settled amounts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: commit },
        ]
      );
      return;
    }

    if (
      isEditing &&
      live?.recurrence &&
      fields.recurrence &&
      fields.date &&
      live.date &&
      fields.date !== live.date &&
      (Object.keys(live.completions).length > 0 || hadMoneyHistory)
    ) {
      Alert.alert(
        'Change when this series starts?',
        'Occurrences before the new start date will no longer appear, including anything completed or paid on those days.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change', style: 'destructive', onPress: commit },
        ]
      );
      return;
    }

    commit();
  };

  const remove = () => {
    if (!editingId || !initial) return;
    warningHaptic();
    const wipe = () => {
      const captured = useTasks.getState().tasks[editingId];
      deleteTask(editingId);
      useDrafts.getState().clearDraft(draftKey);
      syncTaskNotifications(null, editingId);
      if (captured) {
        showUndo('Task deleted', () => {
          useTasks.getState().importTasks([captured]);
          void syncTaskNotifications(captured);
        });
      }
      router.back();
    };
    if (initial.recurrence && occurrenceDate) {
      Alert.alert('Delete repeating task', 'Remove just this occurrence, or the whole series?', [
        {
          text: 'This occurrence',
          onPress: () => {
            skipOccurrence(editingId, occurrenceDate);
            const after = useTasks.getState().tasks[editingId];
            if (after) syncTaskNotifications(after);
            router.back();
          },
        },
        { text: 'All occurrences', style: 'destructive', onPress: wipe },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert('Delete task', `Delete “${initial.title}”?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: wipe },
      ]);
    }
  };

  const duplicate = () => {
    if (!editingId) return;
    const copy = duplicateTask(editingId);
    if (copy) {
      syncTaskNotifications(copy);
      successHaptic();
      router.back();
    }
  };

  // ---- Render -------------------------------------------------------------
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, SPACING.md) }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          {isEditing ? 'Edit Task' : 'New Task'}
        </Text>
        <Pressable
          onPress={() => {
            tapHaptic();
            router.back();
          }}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="close" size={18} color={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* (0) Restored-draft notice */}
        {draftBanner ? (
          <View
            style={[
              styles.draftBanner,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons name="document-outline" size={14} color={theme.textSecondary} />
            <Text style={[styles.draftBannerText, { color: theme.textSecondary }]}>
              Unsaved draft restored
            </Text>
            <Pressable onPress={discardDraft} hitSlop={8} accessibilityLabel="Discard draft">
              <Text style={[styles.draftBannerAction, { color: theme.accent }]}>Discard</Text>
            </Pressable>
          </View>
        ) : null}

        {/* (1) Title + icon preview */}
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => {
              tapHaptic();
              setShowIconPanel((s) => !s);
            }}
            accessibilityRole="button"
            accessibilityLabel="Choose icon and color"
            style={({ pressed }) => [
              styles.iconPreview,
              { backgroundColor: solid },
              pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] },
            ]}
          >
            <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={24} color="#FFFFFF" />
          </Pressable>
          <TextInput
            value={title}
            onChangeText={onTitleChange}
            placeholder="What do you want to do?"
            placeholderTextColor={theme.textTertiary}
            style={[styles.titleInput, { color: theme.text }]}
            autoFocus={!isEditing}
            returnKeyType="done"
            multiline={false}
          />
        </View>

        {/* (2) Quick-add suggestion */}
        {quickLabel ? (
          <Pressable
            onPress={applyQuickAdd}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.quickChip,
              {
                backgroundColor: theme.accentSoft,
                borderColor: theme.accent + '55',
              },
              pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Ionicons name="sparkles" size={14} color={theme.accent} />
            <Text style={[styles.quickLabel, { color: theme.accent }]} numberOfLines={1}>
              {quickLabel}
            </Text>
            <Text style={[styles.quickApply, { color: theme.accent }]}>Apply</Text>
          </Pressable>
        ) : null}

        {/* (3) Icon + color picker */}
        {showIconPanel ? (
          <IconColorPanel
            color={color}
            icon={icon}
            onColorChange={setColor}
            onIconChange={(name) => {
              iconTouched.current = true;
              setIcon(name);
            }}
          />
        ) : null}

        {/* (4) Schedule */}
        <Section title="Schedule">
          <GlassSegmented
            options={[
              { value: 'inbox', label: 'Inbox' },
              { value: 'scheduled', label: 'Scheduled' },
            ]}
            value={where}
            onChange={setWhere}
          />
          {where === 'scheduled' ? (
            <View>
              <View style={styles.dateChips}>
                <Chip
                  label="Today"
                  selected={date === todayKey()}
                  onPress={() => setDate(todayKey())}
                />
                <Chip
                  label="Tomorrow"
                  selected={date === addDays(todayKey(), 1)}
                  onPress={() => setDate(addDays(todayKey(), 1))}
                />
                <Chip
                  icon="calendar-outline"
                  label={formatDayRelative(date)}
                  selected={showCalendar}
                  onPress={() => setShowCalendar((s) => !s)}
                />
              </View>
              {showCalendar ? (
                <CalendarGrid
                  value={date}
                  onChange={(day) => {
                    setDate(day);
                    setShowCalendar(false);
                  }}
                />
              ) : null}
              <View style={styles.allDayRow}>
                <Text style={[styles.allDayLabel, { color: theme.text }]}>All day</Text>
                <Switch
                  value={allDay}
                  onValueChange={(v) => {
                    tapHaptic();
                    setAllDay(v);
                  }}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>
              {!allDay ? (
                <View style={{ marginTop: SPACING.sm }}>
                  <StartEndPicker
                    startMinutes={startMinutes}
                    durationMinutes={duration}
                    onStartChange={setStartMinutes}
                    onDurationChange={setDuration}
                  />
                  {/* Quick duration shortcuts — each moves the end time. */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.presetRow}
                    keyboardShouldPersistTaps="handled"
                  >
                    {DURATION_PRESETS.map((p) => (
                      <Chip
                        key={p}
                        small
                        label={formatDuration(p)}
                        selected={duration === p}
                        onPress={() => setDuration(p)}
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>
          ) : null}
        </Section>

        {/* (5) Duration — only when there is no start/end pair to derive it from. */}
        {where !== 'scheduled' || allDay ? (
          <Section title="Duration" right={
            <Text style={[styles.durationHint, { color: theme.textSecondary }]}>
              {formatDuration(duration)}
            </Text>
          }>
            <View style={styles.wrapRow}>
              {DURATION_PRESETS.map((p) => (
                <Chip
                  key={p}
                  small
                  label={formatDuration(p)}
                  selected={duration === p}
                  onPress={() => setDuration(p)}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {/* (6) Repeat */}
        {where === 'scheduled' ? (
          <Section title="Repeat">
            <RecurrencePicker value={recurrence} onChange={setRecurrence} anchor={date} />
          </Section>
        ) : null}

        {/* (7) Alerts */}
        {where === 'scheduled' && !allDay ? (
          <Section title="Alerts">
            <View style={styles.wrapRow}>
              {ALERT_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  small
                  icon="notifications-outline"
                  label={opt.label}
                  selected={alerts.includes(opt.value)}
                  onPress={() =>
                    setAlerts((prev) =>
                      prev.includes(opt.value)
                        ? prev.filter((a) => a !== opt.value)
                        : [...prev, opt.value].sort((a, b) => a - b)
                    )
                  }
                />
              ))}
            </View>
          </Section>
        ) : null}

        {/* (8) Priority */}
        <Section title="Priority">
          <View style={styles.wrapRow}>
            {PRIORITY_META.map((meta, i) => (
              <Chip
                key={meta.label}
                small
                icon={meta.icon}
                label={meta.label}
                tint={meta.color}
                selected={priority === i}
                onPress={() => setPriority(i as Priority)}
              />
            ))}
          </View>
        </Section>

        {/* (9) Tags */}
        <Section title="Tags">
          {tags.length > 0 ? (
            <View style={[styles.wrapRow, { marginBottom: SPACING.sm }]}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  small
                  selected
                  icon="close"
                  label={`#${tag}`}
                  onPress={() => setTags((prev) => prev.filter((t) => t !== tag))}
                />
              ))}
            </View>
          ) : null}
          <View
            style={[
              styles.inputRow,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons name="pricetag-outline" size={16} color={theme.textTertiary} />
            <TextInput
              value={tagInput}
              onChangeText={setTagInput}
              onSubmitEditing={() => addTag(tagInput)}
              placeholder="Add a tag"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              style={[styles.rowInput, { color: theme.text }]}
            />
            {tagInput.trim() ? (
              <Pressable onPress={() => addTag(tagInput)} hitSlop={8}>
                <Ionicons name="add-circle" size={22} color={theme.accent} />
              </Pressable>
            ) : null}
          </View>
          {tagSuggestions.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionRow}
              keyboardShouldPersistTaps="handled"
            >
              {tagSuggestions.map((tag) => (
                <Chip key={tag} small label={`#${tag}`} onPress={() => addTag(tag)} />
              ))}
            </ScrollView>
          ) : null}
        </Section>

        {/* (10) Subtasks */}
        <Section title="Subtasks">
          {subtasks.map((st) => (
            <View key={st.id} style={styles.subtaskRow}>
              <AnimatedCheck
                checked={st.done}
                color={solid}
                size={24}
                borderColor={theme.textTertiary}
                onToggle={() =>
                  setSubtasks((prev) =>
                    prev.map((s) => (s.id === st.id ? { ...s, done: !s.done } : s))
                  )
                }
              />
              <Text
                style={[
                  styles.subtaskTitle,
                  { color: st.done ? theme.textTertiary : theme.text },
                  st.done && { textDecorationLine: 'line-through' },
                ]}
                numberOfLines={2}
              >
                {st.title}
              </Text>
              <Pressable
                onPress={() => {
                  tapHaptic();
                  setSubtasks((prev) => prev.filter((s) => s.id !== st.id));
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${st.title}`}
              >
                <Ionicons name="close" size={17} color={theme.textTertiary} />
              </Pressable>
            </View>
          ))}
          <View
            style={[
              styles.inputRow,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Ionicons name="add" size={18} color={theme.textTertiary} />
            <TextInput
              ref={subtaskRef}
              value={subtaskInput}
              onChangeText={setSubtaskInput}
              onSubmitEditing={addSubtask}
              placeholder="Add a subtask"
              placeholderTextColor={theme.textTertiary}
              blurOnSubmit={false}
              returnKeyType="next"
              style={[styles.rowInput, { color: theme.text }]}
            />
            {subtaskInput.trim() ? (
              <Pressable onPress={addSubtask} hitSlop={8}>
                <Ionicons name="add-circle" size={22} color={theme.accent} />
              </Pressable>
            ) : null}
          </View>
        </Section>

        {/* (11) Notes */}
        <Section title="Notes">
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else to remember?"
            placeholderTextColor={theme.textTertiary}
            multiline
            textAlignVertical="top"
            style={[
              styles.notesInput,
              {
                backgroundColor: theme.surface,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />
        </Section>

        {/* (12) Client meeting */}
        <Section title="Client meeting">
          <MeetingSection
            draft={meeting}
            onChange={setMeeting}
            editingId={editingId}
            occurrenceDate={occurrenceDate}
            onSuggestAlert={(minutesBefore) =>
              setAlerts((prev) =>
                prev.includes(minutesBefore) ? prev : [...prev, minutesBefore]
              )
            }
          />
        </Section>

        {/* Duplicate / delete */}
        {isEditing ? (
          <View style={styles.dangerRow}>
            <Pressable
              onPress={duplicate}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="copy-outline" size={16} color={theme.textSecondary} />
              <Text style={[styles.secondaryLabel, { color: theme.textSecondary }]}>
                Duplicate
              </Text>
            </Pressable>
            <Pressable
              onPress={remove}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryBtn,
                { backgroundColor: theme.surface, borderColor: theme.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="trash-outline" size={16} color={theme.danger} />
              <Text style={[styles.secondaryLabel, { color: theme.danger }]}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* (13) Footer CTA */}
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, SPACING.sm) + SPACING.sm },
        ]}
      >
        <Pressable
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: theme.accent },
            pressed && canSave && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            !canSave && { opacity: 0.4 },
          ]}
        >
          <Text style={styles.ctaLabel}>{isEditing ? 'Save Changes' : 'Create Task'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  iconPreview: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    paddingVertical: 10,
  },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  draftBannerText: { fontSize: 12, fontWeight: '600' },
  draftBannerAction: { fontSize: 12, fontWeight: '700', marginLeft: 4 },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 8,
    marginTop: SPACING.sm + 2,
  },
  quickLabel: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  quickApply: {
    fontSize: 13,
    fontWeight: '700',
  },
  dateChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  allDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  allDayLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  rowInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 9,
  },
  suggestionRow: {
    gap: SPACING.sm,
    paddingRight: SPACING.lg,
    marginTop: SPACING.sm,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: 7,
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  notesInput: {
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    minHeight: 96,
  },
  dangerRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginTop: SPACING.xl,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 13,
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  cta: {
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  presetRow: {
    gap: SPACING.sm,
    paddingRight: SPACING.lg,
    paddingVertical: 2,
    marginTop: SPACING.md,
  },
  durationHint: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
