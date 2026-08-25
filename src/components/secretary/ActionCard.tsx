import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDayRelative, formatDuration, formatMinutes } from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import type { SecretaryAction } from '../../lib/secretaryTools';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { telegramChatTitle, useTelegram } from '../../store/telegramAccount';
import { SPACING, useTheme } from '../../theme';
import type { DayKey } from '../../types';

/**
 * Proposals the secretary made, rendered as cards under its answer.
 *
 * The model can never send a message or write a booking — it can only
 * suggest one. Every card is a shortcut to the screen that owns the real
 * action, with the suggestion pre-filled, and the user does the confirming
 * there. That is why the button says "Review": tapping it opens something,
 * it never completes anything.
 */

/** ISO day key shape — a model-supplied date is never trusted blindly. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * An unlinked thread has no client name, so the secretary's label resolves
 * back to the counterparty id itself — an E.164 number or a `tgc:` chat.
 * Those already ARE the thread route; no profile lookup needed.
 */
const COUNTERPARTY_RE = /^(\+\d{6,}|tgc:\d+)$/;
/** Lines of the suggested message shown before it clamps. */
const DRAFT_LINES = 3;

type ActionIcon =
  | 'chatbubble-outline'
  | 'paper-plane-outline'
  | 'person-outline'
  | 'calendar-outline';

/** Where a card's button goes, and what it honestly promises. */
interface Target {
  href: string;
  /** Button copy. */
  cta: string;
  icon: ActionIcon;
  /** Spoken label for the button. */
  a11y: string;
}

interface Props {
  action: SecretaryAction;
}

/** A start time the model supplied, or null when it is not a real time. */
function coerceStart(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded < 24 * 60 ? rounded : null;
}

/** A duration the model supplied, or null when it is not a real length. */
function coerceDuration(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= 24 * 60 ? rounded : null;
}

/** A day key the model supplied, or null when it is not a real date. */
function coerceDay(value: string | undefined): DayKey | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return DAY_KEY_RE.test(trimmed) ? (trimmed as DayKey) : null;
}

/**
 * One proposal. Draft messages route to the client's own thread with the
 * suggested text seeded into the composer (unsent, editable); bookings route
 * to the task editor with the slot pre-filled.
 */
export function ActionCard({ action }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const meta = useClientMeta((s) => s.meta);

  const name = action.client ?? action.label;
  // A bare `tgc:` id is not something to show a person; the imported chat's
  // own title is. Numbers read fine as themselves.
  const tgTitle = useTelegram((s) =>
    name.startsWith('tgc:') ? telegramChatTitle(s, name) : null
  );
  const display = tgTitle ?? name;
  const body = (action.text ?? '').trim();
  const day = coerceDay(action.date);
  const start = coerceStart(action.startMinutes);
  const duration = coerceDuration(action.durationMinutes);

  const target = useMemo<Target>(() => {
    if (action.kind === 'booking') {
      const params = [
        `client=${encodeURIComponent(name)}`,
        day ? `date=${day}` : null,
        start != null ? `startMinutes=${start}` : null,
      ].filter((p): p is string => p != null);
      return {
        href: `/task-editor?${params.join('&')}`,
        cta: 'Review booking',
        icon: 'calendar-outline',
        a11y: `Review a booking for ${display}. Opens the editor, nothing is booked yet`,
      };
    }

    const seed = body ? `&draft=${encodeURIComponent(body)}` : '';
    if (COUNTERPARTY_RE.test(name)) {
      return {
        href: `/thread?number=${encodeURIComponent(name)}${seed}`,
        cta: 'Review & send',
        icon: name.startsWith('tgc:') ? 'paper-plane-outline' : 'chatbubble-outline',
        a11y: `Open the thread with ${display} with this message ready to edit. Nothing is sent yet`,
      };
    }

    // Prefer the channel this client actually uses, exactly like the chips.
    const m = meta[clientMetaKey(name)];
    if (m?.phone) {
      return {
        href: `/thread?number=${encodeURIComponent(m.phone)}${seed}`,
        cta: 'Review & send',
        icon: 'chatbubble-outline',
        a11y: `Open the thread with ${display} with this message ready to edit. Nothing is sent yet`,
      };
    }
    if (m?.telegram) {
      return {
        href: `/thread?number=${encodeURIComponent(`tgc:${m.telegram}`)}${seed}`,
        cta: 'Review & send',
        icon: 'paper-plane-outline',
        a11y: `Open the Telegram thread with ${display} with this message ready to edit. Nothing is sent yet`,
      };
    }
    // No linked channel: the profile is where a number gets attached.
    return {
      href: `/client-detail?name=${encodeURIComponent(name)}`,
      cta: 'Open profile',
      icon: 'person-outline',
      a11y: `Open ${display}'s profile to link a way of messaging them`,
    };
  }, [action.kind, body, day, display, meta, name, start]);

  const detail = useMemo(() => {
    const bits = [
      day ? formatDayRelative(day) : null,
      start != null ? formatMinutes(start) : null,
      duration != null ? formatDuration(duration) : null,
    ].filter((b): b is string => b != null);
    return bits.length > 0 ? bits.join(' · ') : 'Time still to pick';
  }, [day, duration, start]);

  const go = () => {
    tapHaptic();
    router.push(target.href as never);
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.head}>
        <Ionicons
          name={action.kind === 'booking' ? 'calendar-outline' : 'chatbubble-outline'}
          size={14}
          color={theme.accent}
        />
        <Text style={[styles.kind, { color: theme.textSecondary }]} numberOfLines={1}>
          {action.kind === 'booking' ? 'Suggested booking' : 'Suggested message'}
        </Text>
      </View>

      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
        {display}
      </Text>

      {action.kind === 'booking' ? (
        <Text style={[styles.detail, { color: theme.textSecondary }]} numberOfLines={2}>
          {detail}
        </Text>
      ) : body ? (
        <Text
          style={[styles.quote, { color: theme.textSecondary, borderColor: theme.separator }]}
          numberOfLines={DRAFT_LINES}
        >
          {`“${body}”`}
        </Text>
      ) : null}

      <Pressable
        onPress={go}
        accessibilityRole="button"
        accessibilityLabel={target.a11y}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: theme.accent },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ionicons name={target.icon} size={14} color="#FFFFFF" />
        <Text style={styles.ctaLabel}>{target.cta}</Text>
      </Pressable>
    </View>
  );
}

interface GroupProps {
  actions: SecretaryAction[];
}

/**
 * Every proposal from one answer, under a caption that says plainly that
 * none of it has happened. The caption sits under the group rather than on
 * each card so it reads as one promise, not repeated small print.
 */
export function ActionCards({ actions }: GroupProps) {
  const theme = useTheme();
  if (actions.length === 0) return null;

  return (
    <View style={styles.group} accessibilityLabel="Suggestions from the secretary">
      {actions.map((a, i) => (
        <ActionCard key={`${a.kind}-${a.label}-${i}`} action={a} />
      ))}
      <Text style={[styles.caption, { color: theme.textTertiary }]}>
        Nothing is sent until you confirm.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    alignSelf: 'stretch',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: 2,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  kind: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  name: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  detail: { fontSize: 14, lineHeight: 19 },
  quote: {
    fontSize: 14,
    lineHeight: 19,
    borderLeftWidth: 2,
    paddingLeft: SPACING.sm,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 2,
  },
  ctaLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  caption: { fontSize: 11, fontWeight: '500', marginHorizontal: 2 },
});
