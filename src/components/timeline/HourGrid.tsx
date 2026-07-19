import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMinutes } from '../../lib/dates';
import { useTheme } from '../../theme';
import { MINUTE_SCALE } from './layout';

export const GUTTER_WIDTH = 56;

interface Props {
  startHour: number;
  endHour: number;
  /**
   * Current minutes-of-day when the now-line is visible; hour labels within
   * ~18 min of it are hidden so the two labels never overlap.
   */
  nowMinutes?: number | null;
}

/** Hour labels in the left gutter + hairline separators per hour. */
export const HourGrid = memo(function HourGrid({ startHour, endHour, nowMinutes }: Props) {
  const theme = useTheme();
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {hours.map((h) => {
        const top = (h - startHour) * 60 * MINUTE_SCALE;
        const nearNow =
          nowMinutes != null && Math.abs(h * 60 - nowMinutes) * MINUTE_SCALE < 20;
        return (
          <View key={h} style={[styles.row, { top }]}>
            <Text
              style={[
                styles.label,
                { color: theme.textTertiary, opacity: nearNow ? 0 : 1 },
              ]}
            >
              {formatMinutes(h * 60)}
            </Text>
            <View style={[styles.line, { backgroundColor: theme.separator }]} />
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    width: GUTTER_WIDTH - 8,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
    marginTop: -6,
    fontVariant: ['tabular-nums'],
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    marginLeft: 8,
  },
});
