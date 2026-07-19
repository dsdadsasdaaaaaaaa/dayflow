import { StyleSheet, Text, View } from 'react-native';
import { formatMinutes } from '../../lib/dates';
import { useTheme } from '../../theme';

interface Props {
  /** Vertical offset in px inside the grid. */
  top: number;
  nowMinutes: number;
}

/** Current-time indicator: small dot + solid line, no glow or pulse. */
export function NowLine({ top, nowMinutes }: Props) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, { top: top - 5 }]} pointerEvents="none">
      <View style={[styles.dot, { backgroundColor: theme.nowLine }]} />
      <Text style={[styles.label, { color: theme.nowLine }]}>
        {formatMinutes(nowMinutes)}
      </Text>
      <View style={[styles.line, { backgroundColor: theme.nowLine }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 6,
    right: 0,
    height: 10,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 30,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    marginLeft: 3,
    marginRight: 4,
    fontVariant: ['tabular-nums'],
  },
  line: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },
});
