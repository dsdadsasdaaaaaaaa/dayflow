import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapHaptic } from '../lib/haptics';
import { useUndo } from '../store/undo';
import { useTheme } from '../theme';

/** Global undo toast host — mounted once in the root layout, above the tabs. */
export function UndoToast() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const current = useUndo((s) => s.current);
  const undo = useUndo((s) => s.undo);
  const dismiss = useUndo((s) => s.dismiss);

  if (!current) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(150)}
      pointerEvents="box-none"
      style={[styles.host, { bottom: Math.max(insets.bottom, 10) + 74 }]}
    >
      <View
        style={[
          styles.toast,
          { backgroundColor: theme.dark ? '#26262D' : '#26262B' },
        ]}
      >
        <Text style={styles.message} numberOfLines={1}>
          {current.message}
        </Text>
        <Pressable
          onPress={() => {
            tapHaptic();
            undo();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Text style={[styles.undo, { color: '#9BA3F5' }]}>Undo</Text>
        </Pressable>
        <Pressable
          onPress={() => dismiss()}
          hitSlop={10}
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.6)" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    maxWidth: 340,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  message: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  undo: { fontSize: 14, fontWeight: '800' },
});
