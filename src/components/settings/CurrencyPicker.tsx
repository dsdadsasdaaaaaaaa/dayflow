import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { Chip } from './Chip';

const PRESETS = ['$', '€', '£', 'C$', 'A$'];

interface Props {
  value: string;
  onChange: (symbol: string) => void;
}

/**
 * Currency symbol picker for meeting earnings: preset chips plus a
 * single-character custom input. Selected symbol fills money-green.
 */
export function CurrencyPicker({ value, onChange }: Props) {
  const theme = useTheme();
  const customActive = !PRESETS.includes(value);
  const [custom, setCustom] = useState(customActive ? value : '');

  const onCustomChange = (text: string) => {
    // Keep only the most recent character so typing replaces the symbol.
    const ch = text.trim().slice(-1);
    setCustom(ch);
    if (ch) {
      selectionHaptic();
      onChange(ch);
    }
  };

  return (
    <View style={styles.wrap}>
      {PRESETS.map((symbol) => (
        <Chip
          key={symbol}
          label={symbol}
          active={value === symbol}
          money
          onPress={() => onChange(symbol)}
        />
      ))}
      <View
        style={[
          styles.customChip,
          {
            backgroundColor: customActive ? theme.success : theme.surface,
            borderColor: customActive ? theme.success : theme.border,
          },
        ]}
      >
        <TextInput
          value={custom}
          onChangeText={onCustomChange}
          placeholder="¥"
          placeholderTextColor={
            customActive ? 'rgba(255,255,255,0.75)' : theme.textTertiary
          }
          style={[
            styles.customInput,
            {
              color: customActive ? '#fff' : theme.text,
              fontWeight: customActive ? '700' : '600',
            },
          ]}
          maxLength={2}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Custom currency symbol"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  customChip: {
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 46,
  },
  customInput: {
    fontSize: 13,
    paddingHorizontal: 13,
    paddingVertical: 7,
    textAlign: 'center',
  },
});
