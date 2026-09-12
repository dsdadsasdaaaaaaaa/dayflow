/**
 * Clock times, as written.
 *
 * Every schedule this app reads arrives as a picture or an email, and until
 * now the model was asked for the answer in minutes from midnight: it read
 * "3:31 PM" and returned 931. Two jobs in one step — transcribe a digit, then
 * do arithmetic on it — and no way afterwards to tell which half went wrong.
 * The period-eight row of the timetable came back as 911, school ended at
 * 4:10 for two days, and nothing in the app could see anything amiss because
 * 911 is a perfectly ordinary number.
 *
 * So the models are now asked for the time the way the page prints it, and
 * the arithmetic happens here, where it can be tested. A misread digit is
 * still a misread digit — no parser fixes that — but it arrives as "3:11 PM"
 * next to an end of "4:30 PM", and a period that claims to run 79 minutes
 * when every other period runs 59 is something a checker can catch.
 *
 * Strict on purpose: this reads a field that is supposed to BE a time, not
 * prose that might mention one. Searching text for a time is a different job
 * with different failure modes, and it lives in schoolWords.
 */

/** Minutes from midnight, or null when the text is not a clock time. */
export function parseClock(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const clean = text
    .trim()
    .toLowerCase()
    // Non-breaking and hair spaces arrive from HTML email constantly.
    .replace(/[\u00a0\u2000-\u200f\u202f\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ');
  if (!clean) return null;
  if (/^(12 )?noon$/.test(clean)) return 12 * 60;
  if (/^midnight$/.test(clean)) return 0;

  const m = /^(\d{1,2})[:.]?(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(clean);
  if (!m) return null;
  const hour = Number(m[1]);
  const minutes = m[2] == null ? 0 : Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minutes)) return null;
  if (minutes > 59) return null;

  const meridiem = m[3]?.[0];
  if (meridiem === 'p') {
    if (hour < 1 || hour > 12) return null;
    return (hour === 12 ? 12 : hour + 12) * 60 + minutes;
  }
  if (meridiem === 'a') {
    if (hour < 1 || hour > 12) return null;
    return (hour === 12 ? 0 : hour) * 60 + minutes;
  }
  // No am or pm. A 24-hour clock says so by its hour; anything else is
  // ambiguous and the caller decides, because a school's "3:08 Closing"
  // means the afternoon and a generic reader cannot know that.
  if (hour > 23) return null;
  return hour * 60 + minutes;
}

/**
 * The same, for a page that never means the small hours.
 *
 * A school day runs roughly seven in the morning to ten at night, so a bare
 * "3:08" on a bell sheet is twenty past fifteen, not the middle of the night.
 * Only applied where that assumption is the school's own.
 */
export function parseSchoolClock(text: unknown): number | null {
  const at = parseClock(text);
  if (at == null) return null;
  if (typeof text === 'string' && /[ap]\.?m\.?/i.test(text)) return at;
  // A bare hour before seven on a school page is the afternoon.
  return at < 7 * 60 ? at + 12 * 60 : at;
}

export interface ClockRange {
  start: number;
  end: number;
}

/**
 * "3:31 PM - 4:30 PM", "8:30 AM – 9:29 AM", "10:30-11:14".
 *
 * A range carries its own consistency check: the end must follow the start.
 * Where only one side names a meridiem, it lends it to the other, which is
 * how these pages are actually printed ("11:41 - 12:40 PM").
 */
export function parseClockRange(text: unknown, school = false): ClockRange | null {
  if (typeof text !== 'string') return null;
  const parts = text.split(/\s*(?:-|–|—|to|until)\s*/i).filter(Boolean);
  if (parts.length < 2) return null;
  const read = school ? parseSchoolClock : parseClock;

  let start = read(parts[0]);
  let end = read(parts[1]);
  // "11:41 - 12:40 PM": the meridiem on the right governs both.
  const rightMeridiem = /([ap])\.?m\.?/i.exec(parts[1])?.[1];
  if (start != null && end != null && start > end && rightMeridiem) {
    const lent = read(`${parts[0]} ${rightMeridiem}m`);
    if (lent != null && lent <= end) start = lent;
  }
  // "8:30 AM - 9:29": the meridiem on the left governs both.
  const leftMeridiem = /([ap])\.?m\.?/i.exec(parts[0])?.[1];
  if (start != null && end != null && end < start && leftMeridiem) {
    const lent = read(`${parts[1]} ${leftMeridiem}m`);
    if (lent != null && lent >= start) end = lent;
  }
  if (start == null || end == null) return null;
  if (end <= start) return null;
  return { start, end };
}

/** "8:30 AM", for putting a time back in front of a person. */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
