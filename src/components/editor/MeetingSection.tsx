import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatDayRelative, isToday } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { isPaidOn, knownClients, lastMeetingFor, MEETING_KINDS } from '../../lib/meetings';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { DayKey, MeetingKind } from '../../types';
import { Chip, GlassSegmented } from './ui';

/** Editable meeting fields held by the task editor while the sheet is open. */
export interface MeetingDraft {
  enabled: boolean;
  kind: MeetingKind;
  client: string;
  /** Rate kept as raw input text so partial numbers ("12.") type naturally. */
  rate: string;
  location: string;
}

export function emptyMeetingDraft(): MeetingDraft {
  return { enabled: false, kind: 'incall', client: '', rate: '', location: '' };
}

/** Parse the draft's rate text into a non-negative amount. */
export function draftRate(draft: MeetingDraft): number {
  const n = parseFloat(draft.rate.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

interface Props {
  draft: MeetingDraft;
  onChange: (draft: MeetingDraft) => void;
  /** Id of the task being edited, or null when creating. */
  editingId: string | null;
  /** Occurrence being edited: route `date` param, falling back to task.date. */
  occurrenceDate: DayKey | null;
  /**
   * Called when the section thinks the task deserves an alert (e.g. out-calls
   * default to a 60-min heads-up so there's time to travel). The parent owns
   * the alerts array and decides whether to add it.
   */
  onSuggestAlert?: (minutesBefore: number) => void;
}

/**
 * The paid client-meeting section of the task editor: toggle, kind,
 * client (with suggestions from past meetings), rate, location — plus a
 * paid-toggle and a "Start meeting now" launcher when editing today's
 * scheduled occurrence.
 */
export function MeetingSection({ draft, onChange, editingId, occurrenceDate, onSuggestAlert }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const tasks = useTasks((s) => s.tasks);
  const togglePaid = useTasks((s) => s.togglePaid);
  const currencySymbol = useSettings((s) => s.settings.currencySymbol);
  const money = theme.success;

  const liveTask = editingId ? tasks[editingId] : undefined;
  /** Occurrence controls only make sense for an already-saved, scheduled meeting. */
  const savedMeeting = liveTask && liveTask.meeting && liveTask.date ? liveTask : null;
  const paidDay = occurrenceDate ?? savedMeeting?.date ?? null;
  const paid = savedMeeting && paidDay ? isPaidOn(savedMeeting, paidDay) : false;
  const canStartNow = !!savedMeeting && !!paidDay && isToday(paidDay);

  const clientSuggestions = useMemo(() => {
    const q = draft.client.trim().toLowerCase();
    return knownClients(tasks)
      .filter((name) => {
        const lower = name.toLowerCase();
        if (lower === q) return false;
        return q.length === 0 || lower.includes(q);
      })
      .slice(0, 8);
  }, [tasks, draft.client]);

  const selectClient = (name: string) => {
    selectionHaptic();
    const prefill = lastMeetingFor(tasks, name);
    onChange({
      ...draft,
      client: name,
      kind: prefill?.kind ?? draft.kind,
      rate: prefill && prefill.rate > 0 ? String(prefill.rate) : draft.rate,
      location: prefill?.location ? prefill.location : draft.location,
    });
  };

  const startNow = () => {
    if (!editingId || !paidDay) return;
    tapHaptic();
    router.replace(`/meeting-live?id=${editingId}&date=${paidDay}`);
  };

  return (
    <View>
      {/* Toggle row */}
      <View
        style={[
          styles.toggleRow,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View style={[styles.cashCircle, { backgroundColor: theme.success + '22' }]}>
          <Ionicons name="cash-outline" size={18} color={theme.success} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.toggleTitle, { color: theme.text }]}>Client meeting</Text>
          <Text style={[styles.toggleSub, { color: theme.textTertiary }]}>
            Track who, where and what it pays
          </Text>
        </View>
        <Switch
          value={draft.enabled}
          onValueChange={(v) => {
            tapHaptic();
            onChange({ ...draft, enabled: v });
            // Out-calls default to an hour's heads-up — time to get there.
            if (v && draft.kind === 'outcall') onSuggestAlert?.(60);
          }}
          trackColor={{ false: theme.border, true: theme.accent }}
          thumbColor="#FFFFFF"
        />
      </View>

      {draft.enabled ? (
        <View>
          {/* Kind */}
          <View style={{ marginTop: SPACING.md }}>
            <GlassSegmented
              options={MEETING_KINDS.map((k) => ({ value: k.key, label: k.label }))}
              value={draft.kind}
              onChange={(kind) => {
                onChange({ ...draft, kind });
                if (kind === 'outcall' && draft.kind !== 'outcall') onSuggestAlert?.(60);
              }}
            />
          </View>

          {/* Client */}
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Client</Text>
          <TextInput
            value={draft.client}
            onChangeText={(client) => onChange({ ...draft, client })}
            placeholder="Client name"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="words"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: theme.surface,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />
          {clientSuggestions.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionRow}
              keyboardShouldPersistTaps="handled"
            >
              {clientSuggestions.map((name) => (
                <Chip
                  key={name}
                  small
                  icon="person-outline"
                  label={name}
                  onPress={() => selectClient(name)}
                />
              ))}
            </ScrollView>
          ) : null}

          {/* Rate */}
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Rate</Text>
          <View
            style={[
              styles.rateBox,
              { backgroundColor: theme.surface, borderColor: money + '55' },
            ]}
          >
            <Text style={[styles.rateSymbol, { color: money }]}>{currencySymbol}</Text>
            <TextInput
              value={draft.rate}
              onChangeText={(rate) => onChange({ ...draft, rate })}
              placeholder="0"
              placeholderTextColor={theme.textTertiary}
              keyboardType="decimal-pad"
              style={[styles.rateInput, { color: theme.text }]}
            />
          </View>

          {/* Location */}
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Location</Text>
          <TextInput
            value={draft.location}
            onChangeText={(location) => onChange({ ...draft, location })}
            placeholder="Address or spot — optional"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="sentences"
            style={[
              styles.input,
              {
                backgroundColor: theme.surface,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />

          {/* Occurrence controls — only for an existing scheduled meeting */}
          {savedMeeting && paidDay ? (
            <View
              style={[
                styles.paidRow,
                paid
                  ? {
                      backgroundColor: theme.success + (theme.dark ? '26' : '1A'),
                      borderColor: theme.success + '66',
                    }
                  : {
                      backgroundColor: theme.card,
                      borderColor: theme.border,
                    },
              ]}
            >
              <Ionicons
                name={paid ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={paid ? theme.success : theme.textTertiary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.toggleTitle, { color: paid ? theme.success : theme.text }]}>
                  Paid for {formatDayRelative(paidDay).toLowerCase()}
                </Text>
                <Text style={[styles.toggleSub, { color: theme.textTertiary }]}>
                  {paid ? 'Payment collected' : 'Mark when the payment is collected'}
                </Text>
              </View>
              <Switch
                value={paid}
                onValueChange={() => {
                  tapHaptic();
                  togglePaid(savedMeeting.id, paidDay);
                }}
                trackColor={{ false: theme.border, true: theme.success }}
                thumbColor="#FFFFFF"
              />
            </View>
          ) : null}

          {canStartNow ? (
            <Pressable
              onPress={startNow}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.startBtn,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Ionicons name="play" size={18} color="#FFFFFF" />
              <Text style={styles.startLabel}>Start meeting now</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
  },
  cashCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleSub: {
    fontSize: 12,
    marginTop: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.md + 2,
    marginBottom: SPACING.xs + 2,
  },
  input: {
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
  suggestionRow: {
    gap: SPACING.sm,
    paddingRight: SPACING.lg,
    marginTop: SPACING.sm,
    paddingVertical: 2,
  },
  rateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  rateSymbol: {
    fontSize: 24,
    fontWeight: '800',
    marginRight: 8,
  },
  rateInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    paddingVertical: 10,
    fontVariant: ['tabular-nums'],
  },
  paidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    marginTop: SPACING.md + 2,
  },
  startBtn: {
    marginTop: SPACING.md,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  startLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
