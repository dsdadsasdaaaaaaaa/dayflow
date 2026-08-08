import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMediaDataUri } from '../../lib/mediaCache';

interface Props {
  /** Media URL to show; null keeps the viewer closed. */
  url: string | null;
  onClose: () => void;
}

/** Plain full-screen photo viewer: dark backdrop, contained image, close X. */
export function PhotoViewer({ url, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { dataUri, loading, error } = useMediaDataUri(url ?? undefined);

  return (
    <Modal visible={url != null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {dataUri ? (
          <Image
            source={{ uri: dataUri }}
            style={[StyleSheet.absoluteFill]}
            resizeMode="contain"
          />
        ) : loading ? (
          <ActivityIndicator size="large" color="#FFFFFF" />
        ) : (
          <Text style={styles.errorText}>{error ?? 'Photo could not be loaded.'}</Text>
        )}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={[styles.closeBtn, { top: insets.top + 10 }]}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { color: '#FFFFFF', fontSize: 14, paddingHorizontal: 32, textAlign: 'center' },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
