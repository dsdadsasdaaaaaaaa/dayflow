import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip } from '../src/components/settings/Chip';
import { Stepper } from '../src/components/settings/Stepper';
import { successHaptic, tapHaptic } from '../src/lib/haptics';
import { useSettings } from '../src/store/settings';
import { RADIUS, useTheme } from '../src/theme';

const CURRENCIES = ['$', '€', '£', 'C$', 'A$'];

/** "6 AM" / "Noon" / "Midnight" labels for the day window. */
function formatHour(h: number): string {
  if (h === 0 || h === 24) return 'Midnight';
  if (h === 12) return 'Noon';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** Hour (0..24) → a Date the native time wheel can display. */
function hourToDate(hour: number): Date {
  return new Date(2000, 0, 1, hour % 24, 0);
}

/**
 * First-run setup: a clean two-step flow presented as a modal when
 * `settings.onboardingDone` is false. Step 1 sets the day window, step 2
 * picks a currency and an optional weekly goal. Skip works from both steps.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  const [step, setStep] = useState<0 | 1>(0);
  const [activeField, setActiveField] = useState<'start' | 'end' | null>(null);
  const [goalText, setGoalText] = useState('');

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const skip = () => {
    tapHaptic();
    update({ onboardingDone: true });
    close();
  };

  const finish = () => {
    successHaptic();
    const parsed = parseFloat(goalText.replace(',', '.').replace(/[^0-9.]/g, ''));
    update({
      weeklyEarningsGoal: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      onboardingDone: true,
    });
    close();
  };

  // ---- Day window ----------------------------------------------------------

  const startMax = Math.min(12, settings.dayEndHour - 1);
  const endMin = Math.max(12, settings.dayStartHour + 1);

  const onWheelChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      // Android presents a dialog — close it on either outcome.
      setActiveField(null);
      if (event.type !== 'set' || !date) return;
    }
    if (!date) return;
    const rawHour = Math.round((date.getHours() * 60 + date.getMinutes()) / 60);
    if (activeField === 'start') {
      update({ dayStartHour: Math.max(0, Math.min(startMax, rawHour)) });
    } else if (activeField === 'end') {
      const h = rawHour === 0 ? 24 : rawHour; // wheel midnight = end of day
      update({ dayEndHour: Math.max(endMin, Math.min(24, h)) });
    }
  };

  const dayRow = (which: 'start' | 'end', label: string, hour: number) => {
    const open = activeField === which;
    if (Platform.OS === 'web') {
      return (
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
          <Stepper
            value={hour}
            onChange={(v) =>
              which === 'start' ? update({ dayStartHour: v }) : update({ dayEndHour: v })
            }
            min={which === 'start' ? 0 : endMin}
            max={which === 'start' ? startMax : 24}
            format={formatHour}
          />
        </View>
      );
    }
    return (
      <Pressable
        onPress={() => {
          tapHaptic();
          setActiveField((prev) => (prev === which ? null : which));
        }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatHour(hour)}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: open ? theme.accent : theme.textSecondary }]}>
          {formatHour(hour)}
        </Text>
      </Pressable>
    );
  };

  // ---- Steps ---------------------------------------------------------------

  const stepOne = (
    <Animated.View key="step-0" entering={FadeIn.duration(220)}>
      <Text style={[styles.title, { color: theme.text }]}>Welcome to DayFlow</Text>
      <Text style={[styles.pitch, { color: theme.textSecondary }]}>
        Your day on one timeline — tasks, habits, focus and earnings, all free.
      </Text>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
        Your day window
      </Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        {dayRow('start', 'Day starts', settings.dayStartHour)}
        {activeField === 'start' && Platform.OS !== 'web' ? (
          <DateTimePicker
            value={hourToDate(settings.dayStartHour)}
            mode="time"
            display="spinner"
            minuteInterval={30}
            themeVariant={theme.dark ? 'dark' : 'light'}
            onChange={onWheelChange}
            style={styles.wheel}
          />
        ) : null}
        <View style={[styles.separator, { backgroundColor: theme.separator }]} />
        {dayRow('end', 'Day ends', settings.dayEndHour)}
        {activeField === 'end' && Platform.OS !== 'web' ? (
          <DateTimePicker
            value={hourToDate(settings.dayEndHour)}
            mode="time"
            display="spinner"
            minuteInterval={30}
            themeVariant={theme.dark ? 'dark' : 'light'}
            onChange={onWheelChange}
            style={styles.wheel}
          />
        ) : null}
      </View>
      <Text style={[styles.caption, { color: theme.textTertiary }]}>
        The timeline shows these hours. You can change them anytime in Settings.
      </Text>
    </Animated.View>
  );

  const stepTwo = (
    <Animated.View key="step-1" entering={FadeIn.duration(220)}>
      <Text style={[styles.title, { color: theme.text }]}>Earnings</Text>
      <Text style={[styles.pitch, { color: theme.textSecondary }]}>
        Used for meeting rates and totals across the app.
      </Text>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Currency</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.chipsWrap}>
          {CURRENCIES.map((symbol) => (
            <Chip
              key={symbol}
              label={symbol}
              active={settings.currencySymbol === symbol}
              money
              onPress={() => update({ currencySymbol: symbol })}
            />
          ))}
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Weekly goal</Text>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>
            {settings.currencySymbol} per week
          </Text>
          <TextInput
            value={goalText}
            onChangeText={setGoalText}
            placeholder="None"
            placeholderTextColor={theme.textTertiary}
            keyboardType="numeric"
            style={[
              styles.goalInput,
              {
                color: theme.text,
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
            accessibilityLabel="Weekly earnings goal"
          />
        </View>
      </View>
      <Text style={[styles.caption, { color: theme.textTertiary }]}>
        Optional — shows as a progress bar in Stats. Leave blank for no goal.
      </Text>
    </Animated.View>
  );

  // ---- Render --------------------------------------------------------------

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[
          styles.header,
          { paddingTop: Platform.OS === 'ios' ? 18 : insets.top + 12 },
        ]}
      >
        {step === 1 ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              setStep(0);
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.backBtn,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              },
            ]}
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={19} color={theme.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.backBtnSpacer} />
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 ? stepOne : stepTwo}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <View style={styles.dots}>
          {[0, 1].map((i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === step ? theme.accent : theme.border },
              ]}
            />
          ))}
        </View>
        <Pressable
          onPress={() => {
            if (step === 0) {
              tapHaptic();
              setActiveField(null);
              setStep(1);
            } else {
              finish();
            }
          }}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: theme.accent,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={step === 0 ? 'Continue' : 'Get started'}
        >
          <Text style={styles.primaryLabel}>
            {step === 0 ? 'Continue' : 'Get started'}
          </Text>
        </Pressable>
        <Pressable
          onPress={skip}
          hitSlop={8}
          style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Skip setup"
        >
          <Text style={[styles.skipLabel, { color: theme.textSecondary }]}>Skip</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnSpacer: { width: 34, height: 34 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  pitch: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
    fontWeight: '500',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
  },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowValue: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
  },
  wheel: { alignSelf: 'stretch' },
  caption: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 8,
    marginHorizontal: 4,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
  },
  goalInput: {
    minWidth: 96,
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 12,
    alignItems: 'stretch',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryLabel: { fontSize: 16, fontWeight: '700', color: '#fff' },
  skipBtn: { alignSelf: 'center', paddingVertical: 2 },
  skipLabel: { fontSize: 14, fontWeight: '600' },
});
