import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { addDays, daysBetween, todayKey, weekdayOf, weekdayShort, weekOf } from '../../lib/dates';
import { selectionHaptic } from '../../lib/haptics';
import { instancesForDay } from '../../store/tasks';
import { taskColor, useTheme, type Theme } from '../../theme';
import type { DayKey, Task } from '../../types';
import { GlassCard } from '../glass/GlassCard';

/** Weeks rendered before/after the week containing today. */
const WEEKS_AROUND = 52;
const TOTAL_WEEKS = WEEKS_AROUND * 2 + 1;

/** Horizontal margin around the glass strip. */
const STRIP_MARGIN = 12;

interface Props {
  selectedDay: DayKey;
  onSelectDay: (day: DayKey) => void;
  tasks: Record<string, Task>;
  weekStartsOn: 0 | 1;
}

interface DayCellData {
  day: DayKey;
  dots: string[]; // up to 4 solid colors
}

function DayCell({
  data,
  selected,
  isTodayCell,
  width,
  theme,
  onSelect,
}: {
  data: DayCellData;
  selected: boolean;
  isTodayCell: boolean;
  width: number;
  theme: Theme;
  onSelect: (day: DayKey) => void;
}) {
  const inner = (
    <>
      <Text
        style={[
          styles.weekdayLetter,
          { color: selected ? 'rgba(255,255,255,0.85)' : theme.textTertiary },
        ]}
      >
        {weekdayShort(weekdayOf(data.day)).charAt(0)}
      </Text>
      <Text
        style={[
          styles.dayNumber,
          { color: selected ? '#fff' : isTodayCell ? theme.accent : theme.text },
        ]}
      >
        {Number(data.day.slice(8, 10))}
      </Text>
      <View style={styles.dotRow}>
        {data.dots.length > 0 ? (
          data.dots.map((c, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: selected ? 'rgba(255,255,255,0.9)' : c },
              ]}
            />
          ))
        ) : (
          <View style={styles.dot} />
        )}
      </View>
      {isTodayCell && !selected ? (
        <View style={[styles.todayMarker, { backgroundColor: theme.accent }]} />
      ) : null}
    </>
  );

  return (
    <Pressable
      onPress={() => {
        selectionHaptic();
        onSelect(data.day);
      }}
      style={{ width }}
      accessibilityLabel={`Select ${data.day}`}
      accessibilityState={{ selected }}
    >
      <View
        style={[
          styles.pill,
          selected ? { backgroundColor: theme.accent } : null,
        ]}
      >
        {inner}
      </View>
    </Pressable>
  );
}

const WeekPage = memo(function WeekPage({
  days,
  selectedDay,
  todayK,
  tasks,
  pageWidth,
  theme,
  onSelect,
}: {
  days: DayKey[];
  selectedDay: DayKey;
  todayK: DayKey;
  tasks: Record<string, Task>;
  pageWidth: number;
  theme: Theme;
  onSelect: (day: DayKey) => void;
}) {
  const cells = useMemo<DayCellData[]>(
    () =>
      days.map((day) => ({
        day,
        dots: instancesForDay(tasks, day)
          .slice(0, 4)
          .map((i) => taskColor(i.task.color).solid),
      })),
    [days, tasks]
  );
  const cellWidth = (pageWidth - 16) / 7;

  return (
    <View style={[styles.page, { width: pageWidth }]}>
      {cells.map((c) => (
        <DayCell
          key={c.day}
          data={c}
          selected={c.day === selectedDay}
          isTodayCell={c.day === todayK}
          width={cellWidth}
          theme={theme}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
});

/** Horizontally paged 7-day strip with task-preview dots, on a slim card. */
export function WeekStrip({ selectedDay, onSelectDay, tasks, weekStartsOn }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<number>>(null);
  const visibleIndexRef = useRef(WEEKS_AROUND);
  const todayK = todayKey();

  /** Width of one page inside the glass strip. */
  const pageWidth = width - STRIP_MARGIN * 2;

  // Anchor: start of the week containing today.
  const baseWeekStart = useMemo(() => weekOf(todayK, weekStartsOn)[0], [todayK, weekStartsOn]);
  const weekIndices = useMemo(() => Array.from({ length: TOTAL_WEEKS }, (_, i) => i), []);

  const indexForDay = useCallback(
    (day: DayKey) => {
      const start = weekOf(day, weekStartsOn)[0];
      return WEEKS_AROUND + Math.round(daysBetween(baseWeekStart, start) / 7);
    },
    [baseWeekStart, weekStartsOn]
  );

  // Re-anchor whenever the layout width settles/changes — scroll offsets are
  // in pixels, so a width change (web resize, rotation, late layout) would
  // otherwise leave the list parked on the wrong week.
  useEffect(() => {
    const idx = indexForDay(selectedDay);
    visibleIndexRef.current = idx;
    const raf = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: false });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWidth]);

  // Keep the strip on the selected day's week (Today button, external changes).
  useEffect(() => {
    const idx = indexForDay(selectedDay);
    if (idx >= 0 && idx < TOTAL_WEEKS && idx !== visibleIndexRef.current) {
      visibleIndexRef.current = idx;
      listRef.current?.scrollToIndex({ index: idx, animated: true });
    }
  }, [selectedDay, indexForDay]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<number>) => {
      const weekStart = addDays(baseWeekStart, (item - WEEKS_AROUND) * 7);
      const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      return (
        <WeekPage
          days={days}
          selectedDay={selectedDay}
          todayK={todayK}
          tasks={tasks}
          pageWidth={pageWidth}
          theme={theme}
          onSelect={onSelectDay}
        />
      );
    },
    [baseWeekStart, selectedDay, todayK, tasks, pageWidth, theme, onSelectDay]
  );

  return (
    <View>
      <GlassCard radius={20} padding={0} style={styles.card}>
        <FlatList
          ref={listRef}
          data={weekIndices}
          horizontal
          snapToInterval={pageWidth}
          decelerationRate="fast"
          disableIntervalMomentum
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={WEEKS_AROUND}
          getItemLayout={(_, index) => ({
            length: pageWidth,
            offset: pageWidth * index,
            index,
          })}
          keyExtractor={(i) => String(i)}
          renderItem={renderItem}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          style={styles.list}
          onMomentumScrollEnd={(e) => {
            visibleIndexRef.current = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
          }}
        />
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: STRIP_MARGIN,
    marginBottom: 2,
  },
  list: { flexGrow: 0 },
  page: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pill: {
    marginHorizontal: 3,
    borderRadius: 14,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 1,
    overflow: 'hidden',
  },
  weekdayLetter: { fontSize: 11, fontWeight: '600' },
  dayNumber: { fontSize: 16, fontWeight: '700' },
  dotRow: {
    flexDirection: 'row',
    gap: 2.5,
    height: 4,
    marginTop: 2,
    alignItems: 'center',
  },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  todayMarker: {
    position: 'absolute',
    bottom: 1,
    alignSelf: 'center',
    width: 12,
    height: 3,
    borderRadius: 1.5,
  },
});
