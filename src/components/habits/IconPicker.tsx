import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ALL_ICONS, ICON_GROUPS } from '../../lib/icons';
import { selectionHaptic } from '../../lib/haptics';
import { RADIUS, useTheme } from '../../theme';

interface Props {
  value: string;
  /** Solid hex of the currently selected habit color (selected-cell background). */
  solidColor: string;
  onChange: (icon: string) => void;
}

/** Searchable icon grid built on ICON_GROUPS; the selection fills with the habit color. */
export function IconPicker({ value, solidColor, onChange }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return ALL_ICONS.filter((name) => name.replace(/-outline$/, '').includes(q));
  }, [query]);

  const renderCell = (name: string) => {
    const selected = name === value;
    return (
      <Pressable
        key={name}
        onPress={() => {
          selectionHaptic();
          onChange(name);
        }}
        style={({ pressed }) => [
          styles.cell,
          { backgroundColor: selected ? solidColor : theme.surface },
          { transform: [{ scale: pressed ? 0.9 : 1 }] },
        ]}
        accessibilityLabel={`Icon ${name.replace(/-outline$/, '')}`}
        accessibilityState={{ selected }}
      >
        <Ionicons
          name={name as never}
          size={20}
          color={selected ? '#fff' : theme.textSecondary}
        />
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.searchRow,
          {
            backgroundColor: theme.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
          },
        ]}
      >
        <Ionicons name="search" size={16} color={theme.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search icons"
          placeholderTextColor={theme.textTertiary}
          style={[styles.searchInput, { color: theme.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={theme.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {filtered ? (
        filtered.length > 0 ? (
          <View style={styles.grid}>{filtered.map(renderCell)}</View>
        ) : (
          <Text style={[styles.noResults, { color: theme.textTertiary }]}>
            No icons match “{query.trim()}”
          </Text>
        )
      ) : (
        ICON_GROUPS.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
              {group.label}
            </Text>
            <View style={styles.grid}>{group.icons.map(renderCell)}</View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', paddingVertical: 0 },
  group: { gap: 8 },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  cell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResults: { fontSize: 13, fontWeight: '500', textAlign: 'center', paddingVertical: 16 },
});
