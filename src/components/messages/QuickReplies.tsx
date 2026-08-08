import { Ionicons } from '@expo/vector-icons';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  daysBetween,
  formatDayLong,
  formatDayRelative,
  fromDayKey,
  todayKey,
} from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import { useMediaDataUri } from '../../lib/mediaCache';
import { formatMoney, occurrenceAmount, occurrenceDeposit } from '../../lib/meetings';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { DayKey, Task } from '../../types';

/** A saved photo quick-reply (hosted URL the media layer can send). */
export interface PhotoReply {
  url: string;
  label?: string;
}

/** A composer power tool rendered as an accent chip at the front of the strip. */
export interface QuickAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

/** Half the amount, rounded to a clean multiple of 5 (never 0 for a real amount). */
function cleanHalf(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(5, Math.round(amount / 2 / 5) * 5);
}

/**
 * Deposit-request draft for the composer. With an upcoming occurrence:
 * "To lock in Friday, I ask for a $75 deposit." — the amount is the recorded
 * per-day deposit when one exists, else half the occurrence amount rounded
 * clean. Without a booking, a generic version (last known rate when we have
 * one) drops the day. Never auto-sends.
 */
export function buildDepositRequest(opts: {
  /** The client's next upcoming occurrence, when one exists. */
  occurrence: { task: Task; dateKey: DayKey } | null;
  /** Last known rate, for the generic (no-booking) variant. 0 = unknown. */
  fallbackRate: number;
  symbol: string;
}): string {
  const { occurrence, fallbackRate, symbol } = opts;
  if (occurrence) {
    const { task, dateKey } = occurrence;
    const diff = daysBetween(todayKey(), dateKey);
    const dayLabel =
      diff <= 1
        ? formatDayRelative(dateKey).toLowerCase()
        : diff < 7
          ? fromDayKey(dateKey).toLocaleDateString('en-US', { weekday: 'long' })
          : formatDayLong(dateKey);
    const existing = occurrenceDeposit(task, dateKey);
    const amount = existing > 0 ? existing : cleanHalf(occurrenceAmount(task, dateKey));
    return amount > 0
      ? `To lock in ${dayLabel}, I ask for a ${formatMoney(amount, symbol)} deposit.`
      : `To lock in ${dayLabel}, I ask for a deposit up front.`;
  }
  const amount = cleanHalf(fallbackRate);
  return amount > 0
    ? `To lock in a booking, I ask for a ${formatMoney(amount, symbol)} deposit.`
    : `To lock in a booking, I ask for a deposit up front.`;
}

interface Props {
  /** Text templates from settings.messageTemplates. */
  templates: string[];
  /** Photo quick-replies, when the media layer provides them. */
  photos?: PhotoReply[];
  /** Power tools (share availability, request deposit) shown first. */
  actions?: QuickAction[];
  /** Insert a template into the composer (never auto-sends). */
  onPickText: (text: string) => void;
  /** Send a photo quick-reply via the media send path. */
  onPickPhoto?: (photo: PhotoReply) => void;
}

/** Horizontal strip of quick replies shown above the composer. */
export function QuickReplies({
  templates,
  photos = [],
  actions = [],
  onPickText,
  onPickPhoto,
}: Props) {
  const theme = useTheme();

  if (templates.length === 0 && photos.length === 0 && actions.length === 0) {
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
      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => {
            tapHaptic();
            a.onPress();
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          style={({ pressed }) => [
            styles.actionChip,
            { backgroundColor: theme.accentSoft, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name={a.icon} size={14} color={theme.accent} />
          <Text style={[styles.actionLabel, { color: theme.accent }]} numberOfLines={1}>
            {a.label}
          </Text>
        </Pressable>
      ))}
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
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionLabel: { fontSize: 13, fontWeight: '600' },
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
