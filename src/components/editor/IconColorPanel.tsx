import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { ALL_ICONS, ICON_GROUPS } from '../../lib/icons';
import { RADIUS, SPACING, TASK_COLORS, taskColor, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';
import { loadRecentIcons } from './recentIcons';

type IconName = keyof typeof Ionicons.glyphMap;

interface Props {
  color: string;
  icon: string;
  onColorChange: (key: string) => void;
  onIconChange: (icon: string) => void;
}

/**
 * Expandable icon + color picker: 12 color swatches (selected shows a ring
 * in its own color), recently used icons, a search field, and the full
 * grouped Ionicon catalog.
 */
export function IconColorPanel({ color, icon, onColorChange, onIconChange }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const solid = taskColor(color).solid;

  useEffect(() => {
    let alive = true;
    loadRecentIcons().then((list) => {
      if (alive) setRecent(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? ALL_ICONS.filter((name) => name.includes(q)) : null),
    [q]
  );
  const recentAvailable = recent.filter((r) => ALL_ICONS.includes(r));

  const renderIcon = (name: string) => {
    const selected = name === icon;
    return (
      <Pressable
        key={name}
        onPress={() => {
          tapHaptic();
          onIconChange(name);
        }}
        accessibilityRole="button"
        accessibilityLabel={name.replace(/-outline$/, '').replace(/-/g, ' ')}
        style={({ pressed }) => [
          styles.iconCell,
          selected
            ? { backgroundColor: solid, borderColor: solid }
            : { backgroundColor: theme.surface, borderColor: theme.border },
          pressed && { opacity: 0.7, transform: [{ scale: 0.92 }] },
        ]}
      >
        <Ionicons
          name={name as IconName}
          size={21}
          color={selected ? '#FFFFFF' : theme.textSecondary}
        />
      </Pressable>
    );
  };

  return (
    <View style={styles.host}>
      <GlassCard radius={RADIUS.xl} padding={SPACING.md}>
        {/* Color swatches */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.colorRow}
          keyboardShouldPersistTaps="handled"
        >
          {TASK_COLORS.map((c) => {
            const selected = c.key === color;
            return (
              <Pressable
                key={c.key}
                onPress={() => {
                  selectionHaptic();
                  onColorChange(c.key);
                }}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                accessibilityState={{ selected }}
                style={[styles.swatchRing, selected && { borderColor: c.solid }]}
              >
                <View style={[styles.swatch, { backgroundColor: c.solid }]}>
                  {selected ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Icon search */}
        <View
          style={[
            styles.searchBox,
            { backgroundColor: theme.surface, borderColor: theme.border },
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
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={theme.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        {filtered ? (
          filtered.length > 0 ? (
            <View style={styles.grid}>{filtered.map(renderIcon)}</View>
          ) : (
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
              No icons match “{query.trim()}”
            </Text>
          )
        ) : (
          <>
            {recentAvailable.length > 0 ? (
              <View>
                <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>Recent</Text>
                <View style={styles.grid}>{recentAvailable.map(renderIcon)}</View>
              </View>
            ) : null}
            {ICON_GROUPS.map((group) => (
              <View key={group.label}>
                <Text style={[styles.groupLabel, { color: theme.textSecondary }]}>
                  {group.label}
                </Text>
                <View style={styles.grid}>{group.icons.map(renderIcon)}</View>
              </View>
            ))}
          </>
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    marginTop: SPACING.md,
  },
  colorRow: {
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  swatchRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: SPACING.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: SPACING.md + 2,
    marginBottom: SPACING.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconCell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginVertical: SPACING.lg,
  },
});
