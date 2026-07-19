import { Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  name: string;
  /** Diameter. Defaults to 46. */
  size?: number;
}

/** Solid accent identity circle with the client's initial — the client-book mark. */
export function ClientAvatar({ name, size = 46 }: Props) {
  const theme = useTheme();
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.accent,
      }}
    >
      <Text
        style={{
          color: '#FFFFFF',
          fontSize: size * 0.42,
          fontWeight: '700',
          letterSpacing: -0.5,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}
