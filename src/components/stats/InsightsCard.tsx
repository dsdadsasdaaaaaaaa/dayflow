import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import type { Insight } from './compute';
import { StatsCard } from './StatsCard';

interface Props {
  insights: Insight[];
}

/** 2-3 computed observations, crowned with a sparkle. */
export function InsightsCard({ insights }: Props) {
  const theme = useTheme();
  if (insights.length === 0) return null;

  return (
    <StatsCard
      label="Insights"
      right={<Ionicons name="sparkles" size={14} color={theme.accent} />}
    >
      <View style={styles.list}>
        {insights.map((insight, i) => (
          <View key={i} style={styles.row}>
            <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name={insight.icon as never} size={15} color={theme.accent} />
            </View>
            <Text style={[styles.text, { color: theme.textSecondary }]}>
              {insight.text}
            </Text>
          </View>
        ))}
      </View>
    </StatsCard>
  );
}

const styles = StyleSheet.create({
  list: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 19 },
});
