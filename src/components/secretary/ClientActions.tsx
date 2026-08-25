import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { SPACING, useTheme } from '../../theme';

interface Props {
  /** Real client names the answer referred to. */
  names: string[];
}

type Route = { label: string; icon: 'chatbubble-outline' | 'paper-plane-outline' | 'person-outline'; href: string };

/**
 * One-tap follow-through under an answer: when the secretary suggests
 * contacting someone, go straight to their conversation instead of hunting
 * for it. Prefers the channel they actually use — SMS if a number is linked,
 * Telegram otherwise, and their profile when neither is.
 */
export function ClientActions({ names }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const meta = useClientMeta((s) => s.meta);

  const routes = useMemo<Route[]>(() => {
    const out: Route[] = [];
    for (const name of names.slice(0, 4)) {
      const m = meta[clientMetaKey(name)];
      if (m?.phone) {
        out.push({
          label: name,
          icon: 'chatbubble-outline',
          href: `/thread?number=${encodeURIComponent(m.phone)}`,
        });
      } else if (m?.telegram) {
        out.push({
          label: name,
          icon: 'paper-plane-outline',
          href: `/thread?number=${encodeURIComponent(`tgc:${m.telegram}`)}`,
        });
      } else {
        out.push({
          label: name,
          icon: 'person-outline',
          href: `/client-detail?name=${encodeURIComponent(name)}`,
        });
      }
    }
    return out;
  }, [names, meta]);

  if (routes.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {routes.map((r) => (
        <Pressable
          key={r.href}
          onPress={() => {
            tapHaptic();
            router.push(r.href as never);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            r.icon === 'person-outline' ? `Open ${r.label}'s profile` : `Message ${r.label}`
          }
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: theme.accentSoft },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons name={r.icon} size={13} color={theme.accent} />
          <Text style={[styles.label, { color: theme.accent }]} numberOfLines={1}>
            {r.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: 6,
    marginBottom: 2,
    alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    maxWidth: 190,
  },
  label: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
});
