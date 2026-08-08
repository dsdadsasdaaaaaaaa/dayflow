import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { warningHaptic } from '../../lib/haptics';
import { tdAvailable } from '../../lib/tdlib';
import {
  clearTelegramCredentials,
  loadTelegramCredentials,
} from '../../lib/telegramCredentials';
import { useTelegram } from '../../store/telegramAccount';
import { useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const CAPTION_PITCH =
  'Your Telegram DMs in the same inbox — clients, notes, statuses, quick replies.';
const CAPTION_CONNECTED =
  'Telegram runs as your own account, on this phone only. Just the chats you turn on appear in DayFlow.';

/**
 * Settings → Telegram: connect the user's personal Telegram account and pick
 * which chats show in DayFlow. Degrades to a "next app build" sublabel on
 * binaries without the native module (the login screen explains in full).
 */
export function TelegramSection() {
  const theme = useTheme();
  const router = useRouter();

  const authState = useTelegram((s) => s.authState);
  const importedCount = useTelegram((s) => s.importedChatIds.length);
  const disconnect = useTelegram((s) => s.disconnect);
  const refreshAuth = useTelegram((s) => s.refreshAuth);

  const available = tdAvailable();
  const connected = authState === 'ready';

  // Resume the session on open: with saved keys, a full start reveals the
  // true auth state (a cold TDLib otherwise reports unconfigured).
  useEffect(() => {
    if (!available) return;
    let alive = true;
    (async () => {
      const creds = await loadTelegramCredentials();
      if (!alive) return;
      if (creds) await useTelegram.getState().connectAndSync();
      else await refreshAuth();
    })();
    return () => {
      alive = false;
    };
  }, [available, refreshAuth]);

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect Telegram?',
      'This signs DayFlow out of its own Telegram session and removes the imported chats from this phone. The official Telegram app and your account are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            warningHaptic();
            await disconnect();
            await clearTelegramCredentials();
          },
        },
      ]
    );
  };

  if (connected) {
    return (
      <SettingsSection title="Telegram" caption={CAPTION_CONNECTED}>
        <SettingsRow
          icon="paper-plane"
          tint={theme.accent}
          label="Telegram"
          sublabel="Connected"
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        <SettingsRow
          icon="chatbox-ellipses"
          tint={theme.accent}
          label="Choose chats"
          sublabel={
            importedCount === 0
              ? 'None shown in DayFlow yet'
              : `${importedCount} chat${importedCount === 1 ? '' : 's'} shown in DayFlow`
          }
          onPress={() => router.push('/telegram-chats')}
        />
        <SettingsRow
          icon="unlink"
          tint={theme.danger}
          label="Disconnect"
          destructive
          onPress={confirmDisconnect}
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Telegram" caption={CAPTION_PITCH}>
      <SettingsRow
        icon="paper-plane"
        tint={theme.accent}
        label="Connect Telegram"
        sublabel={
          available ? 'Sign in with your own account' : 'Arrives with the next app build'
        }
        onPress={() => router.push('/telegram-login')}
      />
    </SettingsSection>
  );
}
