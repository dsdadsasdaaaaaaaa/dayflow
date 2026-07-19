import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDuration } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { formatMoney } from '../../lib/meetings';
import { RADIUS, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

/** Warm amber for overtime. */
const AMBER = '#D97706';

const TIP_STEPS = [25, 50, 100];

interface Props {
  visible: boolean;
  onClose: () => void;
  startedAt: number;
  plannedEndAt: number;
  /** Prefill: occurrence amount for this meeting/day. */
  prefillAmount: number;
  /** Prefill: whether the payment is already marked collected. */
  prefillPaid: boolean;
  currencySymbol: string;
  /** Confirm — the caller logs the session and updates the task store. */
  onConfirm: (amount: number, paid: boolean) => void;
  busy?: boolean;
}

function parseAmount(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function amountToText(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** End-of-session sheet: duration summary, final amount + tips, paid switch. */
export function EndMeetingSheet({
  visible,
  onClose,
  startedAt,
  plannedEndAt,
  prefillAmount,
  prefillPaid,
  currencySymbol,
  onConfirm,
  busy = false,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [mounted, setMounted] = useState(visible);
  const [endedAt, setEndedAt] = useState(() => Date.now());
  const [amountText, setAmountText] = useState(() => amountToText(prefillAmount));
  const [paid, setPaid] = useState(prefillPaid);
  const progress = useSharedValue(0);

  // Snapshot fresh values every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setEndedAt(Date.now());
      setAmountText(amountToText(prefillAmount));
      setPaid(prefillPaid);
      setMounted(true);
      progress.value = withTiming(1, { duration: 220 });
    } else {
      progress.value = withTiming(0, { duration: 180 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep the displayed duration honest while the sheet sits open — the store
  // stamps the real end time on confirm, so the preview should track it.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setEndedAt(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 520 }],
  }));

  if (!mounted) return null;

  const plannedMin = Math.max(1, Math.round((plannedEndAt - startedAt) / 60000));
  const actualMin = Math.max(1, Math.round((endedAt - startedAt) / 60000));
  const overtimeMin = Math.max(0, actualMin - plannedMin);
  const amount = parseAmount(amountText);

  const addTip = (tip: number) => {
    tapHaptic();
    setAmountText(amountToText(parseAmount(amountText) + tip));
  };

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Dimmed backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, overlayStyle]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} />
          <Pressable style={styles.flex} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheetWrap,
            { paddingBottom: insets.bottom + 12 },
            sheetStyle,
          ]}
        >
          <GlassCard radius={RADIUS.xl + 4} padding={18}>
            <View style={styles.sheetInner}>
              <View style={[styles.grabber, { backgroundColor: theme.border }]} />
              <Text style={[styles.title, { color: theme.text }]}>Wrap up</Text>

              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <SummaryRow label="Planned" value={formatDuration(plannedMin)} />
                <SummaryRow label="Actual" value={formatDuration(actualMin)} />
                {overtimeMin > 0 ? (
                  <SummaryRow
                    label="Over planned"
                    value={`+${overtimeMin} min`}
                    valueColor={AMBER}
                  />
                ) : null}
              </View>

              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                Final amount
              </Text>
              <View
                style={[
                  styles.amountRow,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.amountSymbol, { color: theme.success }]}>
                  {currencySymbol}
                </Text>
                <TextInput
                  value={amountText}
                  onChangeText={(t) => setAmountText(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  style={[styles.amountInput, { color: theme.text }]}
                  placeholder="0"
                  placeholderTextColor={theme.textTertiary}
                  accessibilityLabel="Final amount"
                />
                <View style={styles.tipRow}>
                  {TIP_STEPS.map((tip) => (
                    <Pressable
                      key={tip}
                      onPress={() => addTip(tip)}
                      style={({ pressed }) => [
                        styles.tipChip,
                        {
                          backgroundColor: theme.card,
                          borderColor: theme.border,
                          transform: [{ scale: pressed ? 0.94 : 1 }],
                        },
                      ]}
                      accessibilityLabel={`Add ${tip}`}
                    >
                      <Text style={[styles.tipLabel, { color: theme.success }]}>
                        +{tip}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View
                style={[
                  styles.paidRow,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <View style={styles.paidText}>
                  <Text style={[styles.paidTitle, { color: theme.text }]}>
                    Payment collected
                  </Text>
                  <Text style={[styles.paidSubtitle, { color: theme.textSecondary }]}>
                    {paid ? 'Marked as paid for this date' : 'You can mark it paid later'}
                  </Text>
                </View>
                <Switch
                  value={paid}
                  onValueChange={(v) => {
                    selectionHaptic();
                    setPaid(v);
                  }}
                  trackColor={{ true: theme.accent, false: theme.card }}
                  accessibilityLabel="Payment collected"
                />
              </View>

              <Pressable
                onPress={() => onConfirm(amount, paid)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  {
                    backgroundColor: theme.success,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                    opacity: busy ? 0.6 : 1,
                  },
                ]}
                accessibilityLabel="Log meeting"
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.confirmLabel}>
                  Log meeting · {formatMoney(amount, currencySymbol)}
                </Text>
              </Pressable>
            </View>
          </GlassCard>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SummaryRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: valueColor ?? theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  flex: { flex: 1 },
  sheetWrap: { paddingHorizontal: 10 },
  sheetInner: { gap: 12 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 2.5,
    marginBottom: 2,
  },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  summaryCard: {
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: { fontSize: 14, fontWeight: '500' },
  summaryValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sectionLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  amountSymbol: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  amountInput: {
    flex: 1,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    paddingVertical: 4,
    fontVariant: ['tabular-nums'],
  },
  tipRow: { flexDirection: 'row', gap: 6 },
  tipChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tipLabel: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  paidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  paidText: { flex: 1, gap: 2 },
  paidTitle: { fontSize: 15, fontWeight: '600' },
  paidSubtitle: { fontSize: 12, fontWeight: '500' },
  confirmBtn: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  confirmLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
