import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fromDayKey, isToday } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { useTheme, type Theme } from '../../theme';
import type { DayKey } from '../../types';

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface Props {
  selectedDay: DayKey;
  hideCompleted: boolean;
  onToggleHideCompleted: () => void;
  onPressToday: () => void;
  /** Tapping the date title opens the jump-to-date sheet. */
  onPressTitle?: () => void;
}

/** Small plain circular button on a solid surface. */
function CircleButton({
  theme,
  onPress,
  accessibilityLabel,
  active = false,
  children,
}: {
  theme: Theme;
  onPress: () => void;
  accessibilityLabel: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        {
          backgroundColor: active ? theme.accentSoft : theme.surface,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

/** Big bold date header matching ScreenHeader's look, plus timeline actions. */
export function TodayHeader({
  selectedDay,
  hideCompleted,
  onToggleHideCompleted,
  onPressToday,
  onPressTitle,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const d = fromDayKey(selectedDay);
  const today = isToday(selectedDay);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const dateLine = `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
  const title = today ? 'Today' : WEEKDAYS_LONG[d.getDay()];

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <Pressable
        style={styles.textCol}
        onPress={() => {
          if (onPressTitle) {
            tapHaptic();
            onPressTitle();
          }
        }}
        accessibilityLabel="Jump to a date"
      >
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.subtitleRow}>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{dateLine}</Text>
          {onPressTitle ? (
            <Ionicons name="chevron-down" size={13} color={theme.textTertiary} />
          ) : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <CircleButton
          theme={theme}
          onPress={() => {
            tapHaptic();
            router.push('/search');
          }}
          accessibilityLabel="Search everything"
        >
          <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
        </CircleButton>
        <CircleButton
          theme={theme}
          onPress={() => {
            tapHaptic();
            router.push('/week');
          }}
          accessibilityLabel="Week view"
        >
          <Ionicons name="grid-outline" size={18} color={theme.textSecondary} />
        </CircleButton>
        {!today ? (
          <Pressable
            onPress={() => {
              tapHaptic();
              onPressToday();
            }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.todayBtn,
              {
                backgroundColor: theme.accent,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            accessibilityLabel="Jump back to today"
          >
            <Ionicons name="arrow-undo" size={13} color="#fff" />
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        ) : null}
        <CircleButton
          theme={theme}
          active={hideCompleted}
          onPress={() => {
            selectionHaptic();
            onToggleHideCompleted();
          }}
          accessibilityLabel={hideCompleted ? 'Show completed tasks' : 'Hide completed tasks'}
        >
          <Ionicons
            name={hideCompleted ? 'eye-off-outline' : 'eye-outline'}
            size={19}
            color={hideCompleted ? theme.accent : theme.textSecondary}
          />
        </CircleButton>
        <CircleButton
          theme={theme}
          onPress={() => router.push('/clients')}
          accessibilityLabel="Clients"
        >
          <Ionicons name="people-outline" size={19} color={theme.textSecondary} />
        </CircleButton>
        <CircleButton
          theme={theme}
          onPress={() => router.push('/settings')}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={19} color={theme.textSecondary} />
        </CircleButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
  },
  textCol: { flex: 1 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { fontSize: 13, fontWeight: '500' },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
  },
  todayText: { fontSize: 13, fontWeight: '700', color: '#fff' },
});
