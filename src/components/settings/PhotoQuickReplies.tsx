import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { loadSmsCredentials } from '../../lib/smsCredentials';
import { uploadPhotoAsset } from '../../lib/twilioAssets';
import { useSettings } from '../../store/settings';
import { useTheme } from '../../theme';

/**
 * Settings → Messaging → "Photo quick replies": the photo library the
 * composer can attach in one tap. Photos are hosted publicly on the user's
 * OWN Twilio Serverless Assets (uploaded once, here).
 *
 * OTA safety: expo-image-picker's native module is not in the currently
 * shipped binary — it is imported lazily inside the handler and any failure
 * degrades to a friendly alert.
 */
export function PhotoQuickReplies() {
  const theme = useTheme();
  const photos = useSettings((s) => s.settings.photoQuickReplies);
  const update = useSettings((s) => s.update);
  const [busy, setBusy] = useState(false);

  const removePhoto = (index: number) => {
    tapHaptic();
    const current = useSettings.getState().settings.photoQuickReplies;
    update({ photoQuickReplies: current.filter((_, i) => i !== index) });
  };

  const addPhoto = async () => {
    if (busy) return;
    tapHaptic();

    // Dynamic import keeps this OTA-safe on binaries without the native module.
    let picker: typeof import('expo-image-picker');
    try {
      picker = await import('expo-image-picker');
    } catch {
      Alert.alert('Almost there', 'Photo picking arrives with the next app update.');
      return;
    }

    try {
      const perm = await picker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photos access needed',
          'Allow photo library access for DayFlow in iOS Settings to add photo replies.'
        );
        return;
      }
      const res = await picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset) return;

      const creds = await loadSmsCredentials();
      if (!creds) {
        Alert.alert(
          'Connect messaging first',
          'Photo replies are hosted on your own Twilio account — connect it above, then add photos.'
        );
        return;
      }

      setBusy(true);
      const filename = asset.fileName ?? `photo-${Date.now()}.jpg`;
      const result = await uploadPhotoAsset(creds, asset.uri, filename);
      if (!result.ok) {
        warningHaptic();
        Alert.alert('Photo not added', result.error);
        return;
      }
      const label = filename.replace(/\.[^.]+$/, '');
      const current = useSettings.getState().settings.photoQuickReplies;
      update({ photoQuickReplies: [...current, { label, url: result.url }] });
      successHaptic();
    } catch {
      Alert.alert('Almost there', 'Photo picking arrives with the next app update.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.block}>
      <Text style={[styles.blockLabel, { color: theme.textTertiary }]}>
        Photo quick replies
      </Text>

      {photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbRow}
        >
          {photos.map((p, i) => (
            <View key={`${p.url}-${i}`} style={styles.thumbWrap}>
              <View>
                <Image
                  source={{ uri: p.url }}
                  style={[
                    styles.thumb,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                  accessibilityLabel={p.label || 'Photo quick reply'}
                />
                <Pressable
                  onPress={() => removePhoto(i)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.label || 'photo'}`}
                  style={({ pressed }) => [
                    styles.removeBtn,
                    { backgroundColor: theme.overlay },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons name="close" size={11} color="#FFFFFF" />
                </Pressable>
              </View>
              {p.label ? (
                <Text
                  numberOfLines={1}
                  style={[styles.thumbLabel, { color: theme.textTertiary }]}
                >
                  {p.label}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          Photos you send often, ready to attach in one tap. Hosted on your own
          Twilio account.
        </Text>
      )}

      <Pressable
        onPress={() => void addPhoto()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Add photo"
        style={({ pressed }) => [
          styles.addRow,
          pressed && { opacity: 0.7 },
          busy && { opacity: 0.5 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.accent} />
        ) : (
          <Ionicons name="image-outline" size={16} color={theme.accent} />
        )}
        <Text style={[styles.addLabel, { color: theme.accent }]}>
          {busy ? 'Publishing photo…' : 'Add photo'}
        </Text>
      </Pressable>
      {busy ? (
        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          Publishing to your Twilio hosting can take up to a minute.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  blockLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 10,
  },
  thumbWrap: {
    width: 64,
    gap: 4,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  hint: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
});
