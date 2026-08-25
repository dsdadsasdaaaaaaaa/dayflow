/**
 * The privacy layer for the AI secretary.
 *
 * Nothing identifying ever leaves the device. Before a single byte reaches
 * Gemini, every real client name is swapped for a per-session pseudonym
 * ("Client 1", "Client 2"…) and anything phone-shaped is blanked out. The
 * model reasons over structure only — counts, gaps, dates, amounts — and its
 * reply is put back into real names locally, on device, right before display.
 *
 * The map is built fresh for every request, so labels are meaningless outside
 * a single exchange: "Client 3" this afternoon is not "Client 3" tomorrow.
 */

/** One real ↔ pseudonym pairing inside a session map. */
export interface PseudonymEntry {
  /** The real client name, as the user typed it. */
  real: string;
  /** The label sent to the model, e.g. "Client 2". */
  pseudo: string;
}

/**
 * A per-session pseudonym map. `entries` is live: `toPseudo` mints a stable
 * label for any name it hasn't seen yet (an unlinked phone thread, a client
 * created mid-conversation) and appends it here.
 */
export interface PseudonymMap {
  /** Label for a real name, minting a new one when unknown. */
  toPseudo: (name: string) => string;
  /** Real name behind a label, or null when the label is unknown. */
  toReal: (pseudo: string) => string | null;
  /** Every pairing minted so far, in allocation order. */
  entries: PseudonymEntry[];
}

/** What a redacted phone number is replaced with. */
const HIDDEN_NUMBER = '(number hidden)';
/** What a redacted email address is replaced with. */
const HIDDEN_EMAIL = '(email hidden)';
/** A run of digits this long or longer is treated as a phone number. */
const PHONE_MIN_DIGITS = 7;

/** Candidate phone runs: digits with the usual separators around them. */
const PHONE_RE = /\+?\d[\d\s().\-]{4,}\d/g;
/** Plain email shapes — never useful to the model, always identifying. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** "2026-08-24" is a date, not a phone number — dates are safe to send. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Canonical lookup key for a client name (matches clientMetaKey). */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build a session map for the given client names. Order is preserved, so
 * pass names in a stable order (most-recently-used first is fine) — labels
 * only need to hold still for the duration of one request.
 */
export function buildPseudonyms(clientNames: string[]): PseudonymMap {
  const entries: PseudonymEntry[] = [];
  const byName = new Map<string, string>();
  const byPseudo = new Map<string, string>();

  const mint = (name: string): string => {
    const real = name.trim();
    const key = nameKey(real);
    const existing = byName.get(key);
    if (existing) return existing;
    const pseudo = `Client ${entries.length + 1}`;
    byName.set(key, pseudo);
    byPseudo.set(pseudo.toLowerCase(), real);
    entries.push({ real, pseudo });
    return pseudo;
  };

  for (const name of clientNames) {
    if (name.trim()) mint(name);
  }

  return {
    entries,
    toPseudo: (name: string) => (name.trim() ? mint(name) : ''),
    toReal: (pseudo: string) => byPseudo.get(pseudo.trim().toLowerCase()) ?? null,
  };
}

/**
 * Outbound scrub: every known real name becomes its label, and every
 * phone/email shape disappears. Longest names go first so "Ann Marie" is
 * never half-replaced by an "Ann" entry.
 */
export function redactText(text: string, map: PseudonymMap): string {
  let out = text;
  const ordered = [...map.entries].sort((a, b) => b.real.length - a.real.length);
  for (const entry of ordered) {
    // Word-ish boundaries only — no lookbehind (Hermes), so the leading
    // separator is captured and put back.
    const re = new RegExp(
      `(^|[^A-Za-z0-9_])${escapeRegExp(entry.real)}(?![A-Za-z0-9_])`,
      'gi'
    );
    out = out.replace(re, `$1${entry.pseudo}`);
  }
  out = out.replace(EMAIL_RE, HIDDEN_EMAIL);
  out = out.replace(PHONE_RE, (match) => {
    const trimmed = match.trim();
    if (ISO_DATE_RE.test(trimmed)) return match;
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= PHONE_MIN_DIGITS ? HIDDEN_NUMBER : match;
  });
  return out;
}

/**
 * Inbound restore: the model's labels become real names again, on device,
 * for display and local history. Higher-numbered labels are replaced first
 * so "Client 1" never eats the front of "Client 12".
 */
export function restoreText(text: string, map: PseudonymMap): string {
  let out = text;
  const ordered = [...map.entries].sort((a, b) => b.pseudo.length - a.pseudo.length);
  for (const entry of ordered) {
    const re = new RegExp(`${escapeRegExp(entry.pseudo)}(?![0-9])`, 'gi');
    out = out.replace(re, entry.real);
  }
  return out;
}

/** True when the string carries something phone-shaped (ISO dates excluded). */
function hasPhoneShape(value: string): boolean {
  const matches = value.match(PHONE_RE);
  if (!matches) return false;
  return matches.some((m) => {
    const trimmed = m.trim();
    if (ISO_DATE_RE.test(trimmed)) return false;
    return trimmed.replace(/\D/g, '').length >= PHONE_MIN_DIGITS;
  });
}

/**
 * Cheap insurance against a future regression: throws in __DEV__ when a
 * payload about to leave the device still carries a real client name or a
 * phone-shaped string. Silent in production — a privacy bug must never
 * become a crash in the user's hands, and the redaction above already ran.
 *
 * Pass the session map to check names too; without it only phone shapes are
 * checked.
 */
export function assertNoPii(payload: unknown, map?: PseudonymMap): void {
  if (!__DEV__) return;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload) ?? '';
  if (!text) return;

  if (map) {
    for (const entry of map.entries) {
      const re = new RegExp(
        `(^|[^A-Za-z0-9_])${escapeRegExp(entry.real)}(?![A-Za-z0-9_])`,
        'i'
      );
      if (re.test(text)) {
        throw new Error(
          `secretaryPrivacy: outbound payload still contains a real client name (${entry.pseudo}). Redact it before sending.`
        );
      }
    }
  }

  if (hasPhoneShape(text)) {
    throw new Error(
      'secretaryPrivacy: outbound payload still contains a phone-shaped string. Redact it before sending.'
    );
  }
}
