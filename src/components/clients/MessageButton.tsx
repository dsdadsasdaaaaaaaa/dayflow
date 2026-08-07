import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { useMessages } from '../../store/messages';
import { useTheme } from '../../theme';

interface Props {
  client: string;
  /** Called when the client has no phone yet — focus the phone input. */
  onNeedPhone: () => void;
}

const NOTICE_MS = 2600;

/**
 * Hero "Message" action on the client profile.
 * - Messaging configured + phone saved → open the in-app thread.
 * - Not configured but phone saved → TextNow handoff: copy the number,
 *   try the textnow:// scheme, and confirm inline either way.
 * - No phone yet → hand focus to the phone input.
 */
export function MessageButton({ client, onNeedPhone }: Props) {
  const theme = useTheme();
  const router = useRouter();

  const phone = useClientMeta((s) => s.meta[clientMetaKey(client)]?.phone ?? '');
  const configured = useMessages((s) => s.configured);
  const refreshConfigured = useMessages((s) => s.refreshConfigured);

  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refreshConfigured();
  }, [refreshConfigured]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = null;
      setNotice(null);
    }, NOTICE_MS);
  };

  const onPress = async () => {
    tapHaptic();
    if (!phone) {
      onNeedPhone();
      return;
    }
    if (configured) {
      router.push(`/thread?number=${encodeURIComponent(phone)}`);
      return;
    }
    // TextNow handoff: the number rides the clipboard; opening the app is
    // best-effort (scheme may not resolve — the copy already happened).
    try {
      await Clipboard.setStringAsync(phone);
    } catch {
      // Clipboard unavailable (e.g. web permissions) — still try the app.
    }
    try {
      await Linking.openURL('textnow://');
    } catch {
      // TextNow not installed (or web) — the copied number is still the win.
    }
    showNotice('Number copied — paste it in TextNow');
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Message ${client}`}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: theme.accent },
          pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
        ]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={16} color="#FFFFFF" />
        <Text style={styles.btnLabel}>Message</Text>
      </Pressable>
      {notice ? (
        <Text style={[styles.notice, { color: theme.textSecondary }]}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  btnLabel: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  notice: {
    fontSize: 12.5,
    fontWeight: '600',
  },
});
