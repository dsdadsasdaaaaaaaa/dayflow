import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { formatMinutes } from '../../lib/dates';
import { useTheme, RADIUS } from '../../theme';
import type { CalendarEventLite } from '../../types';

interface Props {
  event: CalendarEventLite;
  top: number;
  height: number;
}

/** Read-only device-calendar event: slim outlined block behind tasks. */
export const EventBlock = memo(function EventBlock({ event, top, height }: Props) {
  const theme = useTheme();
  const tiny = height < 34;

  return (
    <Pressable
      onPress={() => {}}
      style={[
        styles.block,
        {
          top,
          height,
          borderColor: event.color,
          backgroundColor: `${event.color}${theme.dark ? '26' : '1C'}`,
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.title, { color: theme.textSecondary }]}>
        {event.title}
      </Text>
      {!tiny ? (
        <Text numberOfLines={1} style={[styles.time, { color: theme.textTertiary }]}>
          {formatMinutes(event.startMinutes)} – {formatMinutes(event.endMinutes)}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 1,
    overflow: 'hidden',
  },
  title: { fontSize: 12, fontWeight: '600' },
  time: { fontSize: 11, fontWeight: '500', marginTop: 1 },
});
