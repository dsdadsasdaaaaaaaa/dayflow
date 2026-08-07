import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatDayShort, formatMinutes } from '../../lib/dates';
import { successHaptic, tapHaptic } from '../../lib/haptics';
import { formatMoney, occurrenceDeposit } from '../../lib/meetings';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { SPACING, useTheme } from '../../theme';
import type { DayKey, Task } from '../../types';

interface Props {
  /** The next scheduled (uncompleted) meeting task for this client. */
  task: Task;
  dateKey: DayKey;
}

function parseAmount(text: string): number {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function amountToText(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return rounded > 0
    ? Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(2)
    : '';
}

/**
 * Next-meeting row with a small deposit affordance: shows the booking date
 * and the deposit already received (or "Add deposit"), expanding to a plain
 * inline numeric input. Saving 0 / empty clears the deposit.
 */
export function DepositRow({ task, dateKey }: Props) {
  const theme = useTheme();
  const setOccurrenceDeposit = useTasks((s) => s.setOccurrenceDeposit);
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const deposit = occurrenceDeposit(task, dateKey);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const openEditor = () => {
    tapHaptic();
    setText(amountToText(deposit));
    setEditing(true);
  };

  const save = () => {
    const amount = parseAmount(text);
    setOccurrenceDeposit(task.id, dateKey, amount);
    successHaptic();
    setEditing(false);
  };

  const when =
    task.allDay || task.startMinutes == null
      ? formatDayShort(dateKey)
      : `${formatDayShort(dateKey)} · ${formatMinutes(task.startMinutes)}`;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="calendar-outline" size={15} color={theme.accent} />
        </View>
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            Next meeting
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {when}
          </Text>
        </View>
        <Pressable
          onPress={openEditor}
          accessibilityRole="button"
          accessibilityLabel={deposit > 0 ? 'Edit deposit' : 'Add deposit'}
          hitSlop={6}
          style={({ pressed }) => [
            styles.depositPill,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
          ]}
        >
          <Ionicons
            name="wallet-outline"
            size={13}
            color={deposit > 0 ? theme.success : theme.accent}
          />
          <Text
            numberOfLines={1}
            style={[
              styles.depositLabel,
              { color: deposit > 0 ? theme.success : theme.accent },
            ]}
          >
            {deposit > 0 ? `Deposit ${formatMoney(deposit, symbol)}` : 'Add deposit'}
          </Text>
        </Pressable>
      </View>

      {editing ? (
        <View style={[styles.editRow, { borderTopColor: theme.separator }]}>
          <View
            style={[
              styles.inputWrap,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.inputSymbol, { color: theme.success }]}>{symbol}</Text>
            <TextInput
              value={text}
              onChangeText={(t) => setText(t.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              placeholder="0"
              placeholderTextColor={theme.textTertiary}
              onSubmitEditing={save}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Deposit amount"
            />
          </View>
          <Pressable
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="Save deposit"
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: theme.accent },
              pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={styles.saveLabel}>Save</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              tapHaptic();
              setEditing(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={6}
            style={styles.cancelBtn}
          >
            <Text style={[styles.cancelLabel, { color: theme.textTertiary }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, fontWeight: '500' },
  depositPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 160,
  },
  depositLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm + 2,
    paddingTop: SPACING.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  inputSymbol: { fontSize: 15, fontWeight: '800' },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
  saveBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  cancelLabel: { fontSize: 13, fontWeight: '600' },
});
