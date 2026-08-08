import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { useMediaDataUri } from '../../lib/mediaCache';
import { RADIUS, SPACING, useTheme } from '../../theme';

/** A saved photo quick-reply (hosted URL the media layer can send). */
export interface PhotoReply {
  url: string;
  label?: string;
}

interface Props {
  /** Text templates from settings.messageTemplates. */
  templates: string[];
  /** Photo quick-replies, when the media layer provides them. */
  photos?: PhotoReply[];
  /** Insert a template into the composer (never auto-sends). */
  onPickText: (text: string) => void;
  /** Send a photo quick-reply via the media send path. */
  onPickPhoto?: (photo: PhotoReply) => void;
}

/** Horizontal strip of quick replies shown above the composer. */
export function QuickReplies({ templates, photos = [], onPickText, onPickPhoto }: Props) {
  const theme = useTheme();

  if (templates.length === 0 && photos.length === 0) {
    return (
      <Text style={[styles.hint, { color: theme.textTertiary }]}>
        Add quick replies in Settings.
      </Text>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.strip}
    >
      {photos.map((p) => (
        <PhotoChip key={p.url} photo={p} onPress={onPickPhoto} />
      ))}
      {templates.map((t, i) => (
        <Pressable
          key={`${i}-${t}`}
          onPress={() => {
            tapHaptic();
            onPickText(t);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Insert quick reply: ${t}`}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: pressed ? theme.accentSoft : theme.surface },
          ]}
        >
          <Text style={[styles.chipLabel, { color: theme.text }]} numberOfLines={1}>
            {t}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function PhotoChip({
  photo,
  onPress,
}: {
  photo: PhotoReply;
  onPress?: (photo: PhotoReply) => void;
}) {
  const theme = useTheme();
  const { dataUri } = useMediaDataUri(photo.url);

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress?.(photo);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Send photo${photo.label ? `: ${photo.label}` : ''}`}
      style={({ pressed }) => [
        styles.photoChip,
        { backgroundColor: theme.surface, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {dataUri ? (
        <Image source={{ uri: dataUri }} style={styles.photoThumb} />
      ) : (
        <View style={[styles.photoThumb, { backgroundColor: theme.surface }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    alignItems: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 260,
  },
  chipLabel: { fontSize: 13, fontWeight: '500' },
  photoChip: {
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  photoThumb: { width: 48, height: 48, borderRadius: RADIUS.sm },
  hint: {
    fontSize: 12,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
});
