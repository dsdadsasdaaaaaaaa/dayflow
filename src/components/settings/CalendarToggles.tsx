import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { listCalendars, type DeviceCalendar } from '../../lib/calendar';
import { selectionHaptic } from '../../lib/haptics';
import { useSettings } from '../../store/settings';
import { useTheme } from '../../theme';

/**
 * Per-calendar visibility toggles. Loads the device's event calendars and
 * maps each switch onto `settings.hiddenCalendarIds`.
 */
export function CalendarToggles() {
  const theme = useTheme();
  const hiddenIds = useSettings((s) => s.settings.hiddenCalendarIds);
  const update = useSettings((s) => s.update);
  const [calendars, setCalendars] = useState<DeviceCalendar[] | null>(null);

  useEffect(() => {
    let alive = true;
    listCalendars().then((cals) => {
      if (alive) setCalendars(cals);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (calendars === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.textTertiary} />
      </View>
    );
  }

  if (calendars.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textTertiary }]}>
        No device calendars found.
      </Text>
    );
  }

  const setVisible = (id: string, visible: boolean) => {
    selectionHaptic();
    update({
      hiddenCalendarIds: visible
        ? hiddenIds.filter((h) => h !== id)
        : [...hiddenIds, id],
    });
  };

  return (
    <View>
      {calendars.map((cal, i) => (
        <View key={cal.id}>
          {i > 0 ? (
            <View
              style={[styles.separator, { backgroundColor: theme.separator }]}
            />
          ) : null}
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: cal.color }]} />
            <Text
              style={[styles.title, { color: theme.text }]}
              numberOfLines={1}
            >
              {cal.title}
            </Text>
            <Switch
              value={!hiddenIds.includes(cal.id)}
              onValueChange={(on) => setVisible(cal.id, on)}
              trackColor={{ false: theme.surface, true: theme.accent }}
              ios_backgroundColor={theme.surface}
              accessibilityLabel={`Show ${cal.title}`}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 18, alignItems: 'center' },
  empty: {
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 21,
    paddingRight: 14,
    paddingVertical: 8,
    minHeight: 48,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 47,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  title: { flex: 1, fontSize: 15, fontWeight: '500' },
});
