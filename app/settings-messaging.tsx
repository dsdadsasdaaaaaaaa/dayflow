import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { CallingSection } from '../src/components/settings/CallingSection';
import { MessagingSection } from '../src/components/settings/MessagingSection';
import { SafetySection } from '../src/components/settings/SafetySection';
import { TelegramSection } from '../src/components/settings/TelegramSection';
import { SPACING, useTheme } from '../src/theme';

/**
 * Settings → Messaging & calls: everything about reaching clients lives on
 * one page — Twilio texting, Telegram, the work phone line, and the safety
 * check-in — instead of four sections stacked mid-list on the main screen.
 */
export default function SettingsMessagingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  useRouter(); // keep the hook order stable with sibling settings screens

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text style={[styles.title, { color: theme.text }]}>Messaging & calls</Text>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 60 },
          ]}
        >
          <MessagingSection />
          <TelegramSection />
          <CallingSection />
          <SafetySection />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 4,
  },
});
