import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { taskColor, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

export interface HabitSuggestion {
  title: string;
  icon: string;
  color: string;
}

export const HABIT_SUGGESTIONS: HabitSuggestion[] = [
  { title: 'Drink water', icon: 'water-outline', color: 'sky' },
  { title: 'Read 20 min', icon: 'book-outline', color: 'amber' },
  { title: 'Workout', icon: 'barbell-outline', color: 'coral' },
  { title: 'Meditate', icon: 'flower-outline', color: 'violet' },
  { title: 'Journal', icon: 'pencil-outline', color: 'teal' },
  { title: 'Sleep by 11', icon: 'moon-outline', color: 'indigo' },
];

interface Props {
  onPick: (suggestion: HabitSuggestion) => void;
}

/** Tappable starter-habit chips for the empty state. */
export function SuggestedHabits({ onPick }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      {HABIT_SUGGESTIONS.map((s) => {
        const c = taskColor(s.color);
        return (
          <Pressable
            key={s.title}
            onPress={() => onPick(s)}
            style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.95 : 1 }] }]}
            accessibilityLabel={`Add habit: ${s.title}`}
          >
            <GlassCard radius={999} padding={0}>
              <View style={styles.chip}>
                <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
                  <Ionicons name={s.icon as never} size={13} color="#fff" />
                </View>
                <Text style={[styles.label, { color: theme.text }]}>{s.title}</Text>
              </View>
            </GlassCard>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 14,
  },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
});
