import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { taskColor, useTheme, RADIUS } from '../../theme';
import type { CalendarEventLite, TaskInstance } from '../../types';
import { AnimatedCheck } from '../AnimatedCheck';

interface Props {
  instances: TaskInstance[];
  events: CalendarEventLite[];
  onToggle: (instance: TaskInstance) => void;
  onPress: (instance: TaskInstance) => void;
  onLongPress: (instance: TaskInstance) => void;
}

const AllDayChip = memo(function AllDayChip({
  instance,
  onToggle,
  onPress,
  onLongPress,
}: {
  instance: TaskInstance;
  onToggle: (i: TaskInstance) => void;
  onPress: (i: TaskInstance) => void;
  onLongPress: (i: TaskInstance) => void;
}) {
  const theme = useTheme();
  const c = taskColor(instance.task.color);

  return (
    <Pressable
      onPress={() => onPress(instance)}
      onLongPress={() => onLongPress(instance)}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: theme.dark ? `${c.solid}66` : `${c.solid}40`,
          backgroundColor: theme.dark ? `${c.solid}2E` : `${c.solid}1F`,
          opacity: pressed ? 0.8 : instance.completed ? 0.55 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
        <Ionicons name={instance.task.icon as never} size={12} color="#fff" />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.title,
          { color: theme.text },
          instance.completed && styles.titleDone,
        ]}
      >
        {instance.task.title}
      </Text>
      <AnimatedCheck
        checked={instance.completed}
        color={c.solid}
        size={20}
        onToggle={() => onToggle(instance)}
        borderColor={theme.dark ? c.fgDark : c.solid}
      />
    </Pressable>
  );
});

/** Horizontal shelf of all-day tasks (and all-day calendar events) as tinted chips. */
export function AllDayShelf({ instances, events, onToggle, onPress, onLongPress }: Props) {
  const theme = useTheme();
  if (instances.length === 0 && events.length === 0) return null;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.shelf}
      >
        {instances.map((i) => (
          <AllDayChip
            key={i.task.id}
            instance={i}
            onToggle={onToggle}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        ))}
        {events.map((e) => (
          <View
            key={e.id}
            style={[
              styles.eventChip,
              { borderColor: `${e.color}66`, backgroundColor: `${e.color}1A` },
            ]}
          >
            <Ionicons name="calendar-outline" size={12} color={e.color} />
            <Text numberOfLines={1} style={[styles.eventTitle, { color: theme.textSecondary }]}>
              {e.title}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shelf: { flexGrow: 0, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 10,
    height: 40,
    borderRadius: RADIUS.md,
    maxWidth: 220,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  titleDone: { textDecorationLine: 'line-through' },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 40,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
    overflow: 'hidden',
  },
  eventTitle: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
});
