import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

const ICONS: Record<string, [string, string]> = {
  index: ['today-outline', 'today'],
  inbox: ['file-tray-outline', 'file-tray'],
  focus: ['timer-outline', 'timer'],
  habits: ['leaf-outline', 'leaf'],
  stats: ['stats-chart-outline', 'stats-chart'],
};

/** Minimal structural typing for the react-navigation tab-bar contract
 * (the package is vendored inside expo-router, so we avoid importing it). */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

/**
 * Design v3: a clean, standard tab bar — solid background, hairline top
 * border, accent tint on the active tab. No blur, no gradients.
 */
export function GlassTabBar({ state, descriptors, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.separator,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = options.title ?? route.name;
        const focused = state.index === index;
        const [outline, filled] = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            selectionHaptic();
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
          >
            <Ionicons
              name={(focused ? filled : outline) as never}
              size={23}
              color={focused ? theme.accent : theme.textTertiary}
            />
            <Text
              style={[
                styles.label,
                {
                  color: focused ? theme.accent : theme.textTertiary,
                  fontWeight: focused ? '700' : '500',
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  label: { fontSize: 10 },
});
