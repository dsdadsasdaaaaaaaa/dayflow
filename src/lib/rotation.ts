/**
 * Number rotation: the wording that goes in the composer when we open a chat
 * from a number the other person has never seen.
 *
 * Rotating a work number is a deliberate, recurring practice here, not an
 * accident to recover from. The only awkward part is social: everyone still
 * has the retired number saved, so an unexplained text from a stranger's
 * number is easy to ignore, block or report. This is the one paragraph that
 * fixes that, pre-filled so it is never something to remember or retype.
 *
 * Nothing here sends. It only ever fills the box.
 */

/** Below this, "sorry for the wait" would be untrue and a bit odd. */
const OWED_REPLY_AFTER_MS = 12 * 60 * 60_000;

const OPENERS = ["Hey, it's Drew!", 'Hi, Drew here.', 'Hey, Drew again.'];

const BODIES = [
  'I rotate my number every so often, it keeps things private for both of us.',
  'I change numbers now and then for privacy, mine and yours.',
  'I switch numbers periodically, it keeps things discreet on both ends.',
];

const CLOSERS = [
  'This is my current one, so save it and delete the old one. Same me, nothing else changes.',
  'Save this one over the old one. Everything else is exactly the same.',
  'Worth saving this one and clearing the old. Nothing else changes on my end.',
];

/**
 * Stable per contact: the same person always gets the same wording, so the
 * box never looks different from one visit to the next, while the text is not
 * byte-identical across everyone. Long runs of identical outbound is one of
 * the things carriers score a number on, and a number getting scored badly is
 * the whole reason we are rotating in the first place.
 */
function variantIndex(contactNumber: string): number {
  let h = 0;
  for (let i = 0; i < contactNumber.length; i++) {
    h = (h * 31 + contactNumber.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export interface RotationNoticeOptions {
  /**
   * When their last message came in, if we still owe them a reply. A long
   * silence from us followed by "here's my new number" reads badly without
   * acknowledging it first.
   */
  owedReplySince?: number;
  now?: number;
}

/**
 * The explainer for one contact: who this is and why the number changed.
 * Editable in the composer like any other draft.
 */
export function rotationNotice(
  contactNumber: string,
  opts: RotationNoticeOptions = {}
): string {
  const { owedReplySince, now = Date.now() } = opts;
  const i = variantIndex(contactNumber);
  const opener = OPENERS[i % OPENERS.length];
  const apologize =
    owedReplySince != null && now - owedReplySince >= OWED_REPLY_AFTER_MS;
  const head = apologize
    ? `Sorry for the wait, ${opener.charAt(0).toLowerCase()}${opener.slice(1)}`
    : opener;
  return [head, BODIES[i % BODIES.length], CLOSERS[i % CLOSERS.length]].join(' ');
}
