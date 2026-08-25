import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { selectionHaptic, successHaptic } from '../../lib/haptics';
import { speechAvailable, startDictation, type StopDictation } from '../../lib/speech';
import { useTheme } from '../../theme';

interface Props {
  /** Called with the settled transcript when the user stops speaking. */
  onText: (text: string) => void;
  disabled?: boolean;
}

/**
 * Hold-free dictation: tap to start, tap again to stop and commit. Partial
 * text is surfaced live through onText's caller via the pulse state only —
 * the transcript itself lands once, on stop, so the composer never flickers.
 */
export function VoiceButton({ onText, disabled = false }: Props) {
  const theme = useTheme();
  const [listening, setListening] = useState(false);
  const stopRef = useRef<StopDictation | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  // Stop dictation if the screen goes away mid-listen.
  useEffect(
    () => () => {
      try {
        stopRef.current?.();
      } catch {
        // Already stopped.
      }
    },
    []
  );

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 620,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const toggle = async () => {
    if (disabled) return;

    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      return;
    }

    if (!speechAvailable()) {
      Alert.alert(
        'Voice input',
        'Talking to the secretary arrives with the next app build. In the meantime, tap the microphone key on your keyboard — that dictates into the box just as well.'
      );
      return;
    }

    selectionHaptic();
    setListening(true);
    const stop = await startDictation({
      onFinal: (text) => {
        setListening(false);
        stopRef.current = null;
        if (text.trim()) {
          successHaptic();
          onText(text.trim());
        }
      },
      onError: (message) => {
        setListening(false);
        stopRef.current = null;
        Alert.alert('Voice input', message);
      },
    });
    if (!stop) {
      setListening(false);
      return;
    }
    stopRef.current = stop;
  };

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={toggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop dictating' : 'Dictate a question'}
        accessibilityState={{ disabled, busy: listening }}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: listening ? theme.accent : theme.surface,
            opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          name={listening ? 'stop' : 'mic-outline'}
          size={19}
          color={listening ? '#FFFFFF' : theme.accent}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
});
