import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMediaDataUri } from '../../lib/mediaCache';

interface Props {
  /**
   * What to show; null keeps the viewer closed. Accepts a hosted Twilio media
   * URL (fetched through the authed cache) OR an already-local uri
   * (file:// / data:) — Telegram photos and just-sent photos pass those.
   */
  url: string | null;
  onClose: () => void;
}

/** Directly displayable without the authed fetch pipeline? */
function isDirectUri(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('data:');
}

/**
 * Full-screen photo viewer for both channels: dark backdrop, pinch-zoom and
 * pan (ScrollView zoom — native gesture handling), share/save, close X.
 */
export function PhotoViewer({ url, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const direct = url != null && isDirectUri(url);
  const state = useMediaDataUri(direct || url == null ? undefined : url);
  const uri = direct ? url : state.uri;

  const share = async () => {
    if (!uri) return;
    try {
      // iOS share sheet on an image offers "Save Image" — covers saving to
      // Photos without a media-library permission of our own.
      await Share.share({ url: uri });
    } catch {
      // User dismissed, or nothing to share — either way, quiet.
    }
  };

  return (
    <Modal visible={url != null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {uri ? (
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={styles.zoomContent}
            minimumZoomScale={1}
            maximumZoomScale={4}
            bouncesZoom
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            centerContent
          >
            <Image source={{ uri }} style={styles.photo} resizeMode="contain" />
          </ScrollView>
        ) : state.loading ? (
          <ActivityIndicator size="large" color="#FFFFFF" />
        ) : (
          <Pressable
            onPress={state.retry}
            accessibilityRole="button"
            accessibilityLabel="Photo failed to load. Tap to try again."
            style={styles.errorWrap}
          >
            <Ionicons name="refresh-outline" size={26} color="#FFFFFF" />
            <Text style={styles.errorText}>
              {state.error ?? 'Photo could not be loaded.'} Tap to retry.
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={[styles.circleBtn, styles.closeBtn, { top: insets.top + 10 }]}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        {uri ? (
          <Pressable
            onPress={share}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Share or save photo"
            style={[styles.circleBtn, styles.shareBtn, { top: insets.top + 10 }]}
          >
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
          </Pressable>
        ) : null}
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
  zoomContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    aspectRatio: 1,
    alignSelf: 'center',
  },
  errorWrap: { alignItems: 'center', gap: 10, paddingHorizontal: 32 },
  errorText: { color: '#FFFFFF', fontSize: 14, textAlign: 'center' },
  circleBtn: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: { right: 16 },
  shareBtn: { left: 16 },
});
