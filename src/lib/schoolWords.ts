import type { Task } from '../types';
/**
 * The school's vocabulary, with nothing else attached.
 *
 * A leaf on purpose: the rules for reading a school entry's words are needed
 * both by code that amends the calendar (which reaches into the task store)
 * and by code that cleans the task store up (which the store itself calls).
 * Keeping the words here means neither has to import the other.
 */

/**
 * Marks a task as coming from a timetable or a school newsletter.
 *
 * Two things need to recognise these later: the timeline, which gives them a
 * lane of their own, and re-importing, which has to be able to replace the
 * old week rather than lay a second one on top of it. Recognising them by
 * their icon would break the moment someone picked a different icon.
 */
export const SCHOOL_TAG = 'school';

/**
 * Marks a task as a timetable class specifically — as opposed to a newsletter
 * item, which is also school. Replacing a timetable must remove the old
 * classes and nothing else, and "school" alone could not tell a class from
 * "Terry Fox Walk".
 */
export const TIMETABLE_TAG = 'timetable';

/** Is this one of ours? Icon is the fallback for anything imported before the tag existed. */
export function isSchoolTask(task: Pick<Task, 'tags' | 'icon'>): boolean {
  return task.tags?.includes(SCHOOL_TAG) === true || task.icon === 'school-outline';
}

/**
 * Did the school put this here, as opposed to the user?
 *
 * The tag only, deliberately, and this is the test to use whenever the
 * question is "is this the user's own work" — counting it, chasing them
 * about it, showing it on the widget.
 *
 * isSchoolTask above also accepts the school icon, which is right for
 * deciding how something LOOKS but dangerous for deciding whose it is: the
 * icon suggester hands out 'school-outline' for the words "study",
 * "homework", "exam" and "test prep", so a person typing "Study for the
 * Physics test" gets it automatically. Judged by the icon, their own
 * revision would stop being counted as theirs and quietly drop out of the
 * catch-up pile — the exact opposite of the complaint that school was being
 * counted as work.
 */
export function isImportedSchool(task: Pick<Task, 'tags'>): boolean {
  return task.tags?.includes(SCHOOL_TAG) === true;
}

/**
 * Fold a title down to its words.
 *
 * The newsletter and the year calendar describe the same days in the same
 * words joined by whatever punctuation each source happens to use, so
 * "Labour Day: School Closed" and "Labour Day - School Closed" are one
 * entry, and so are "Curriculum Night (7:30 PM)" and "Curriculum Night
 * 7:30 PM" — brackets are punctuation too. "First Day of School" and "First
 * Day of School: Special Schedule" stay two, because one has words the
 * other does not.
 */
export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:;,\-–—()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CLOSED =
  /\b(school closed|no school|closed|no classes|pd day|(?:winter|mid[- ]winter|march|spring) break)\b/i;
/** "Last Day of School Before Winter Break" names the break without being it. */
const NOT_CLOSED = /\b(before|after|last day|first day|resumes?)\b/i;
const DISMISSAL = /\b(dismissal|closing)\b/i;
const START = /\bstart\b/i;

export function isClosure(title: string): boolean {
  return CLOSED.test(title) && !NOT_CLOSED.test(title);
}

export function isDismissal(title: string): boolean {
  return DISMISSAL.test(title);
}

export function isStart(title: string): boolean {
  return START.test(title);
}

/**
 * Is this entry a statement about the day's hours rather than an event?
 *
 * "2:25 PM Dismissal" and "10:30 AM Start" are rules: they change when school
 * ends or begins and are applied to the timetable. They are not something to
 * attend at 2:25, so they belong on the all-day shelf as a note about the
 * day, not on the timeline as a half-hour block.
 */
/**
 * A time named inside the entry's own words.
 *
 * Rule markers are put on the all-day shelf — they are a note about the day,
 * not a half-hour block to attend — so the only place their time survives is
 * the title. "3:08 Closing" also has no am or pm, and a school does not shut
 * at eight past three in the morning, so a bare hour before seven is
 * afternoon.
 */
export function timeInTitle(title: string): number | null {
  const meridiem = /\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(title);
  if (meridiem) {
    const hour12 = Number(meridiem[1]);
    const minutes = Number(meridiem[2] ?? '0');
    const pm = /^p/i.test(meridiem[3]);
    const hour = hour12 === 12 ? (pm ? 12 : 0) : pm ? hour12 + 12 : hour12;
    return hour * 60 + minutes;
  }
  if (/\bnoon\b/i.test(title)) return 12 * 60;
  const bare = /\b(1[0-2]|0?[1-9]):([0-5][0-9])\b/.exec(title);
  if (!bare) return null;
  const hour = Number(bare[1]);
  return (hour < 7 ? hour + 12 : hour) * 60 + Number(bare[2]);
}

/** The day runs to an unusual shape, without saying what it is. */
const SPECIAL = /\bspecial\s+schedule\b/i;

export function isRuleMarker(title: string): boolean {
  return isClosure(title) || isDismissal(title) || isStart(title);
}

/**
 * What KIND of statement a rule marker makes, ignoring its wording.
 *
 * Two sources describing one early finish — "2:25 Closing" from the year
 * calendar and "2:25 PM Dismissal" from the newsletter — say the same thing
 * in words too different for any text match to pair up. Comparing the fact
 * instead of the sentence is what lets one of them be dropped.
 */
export function ruleKind(title: string, startMinutes: number | null): string | null {
  if (isClosure(title)) return 'closed';
  // The title first: a marker's real time is in its words, and its
  // startMinutes is null precisely because it was shelved as all-day.
  const at = timeInTitle(title) ?? startMinutes;
  if (isDismissal(title) && at != null) return `dismiss:${at}`;
  if (isStart(title) && at != null) return `start:${at}`;
  // "Special Schedule" and "Special schedule Blocks 1, 3, 5, 8" are one
  // announcement about one day, told twice at different levels of detail.
  if (SPECIAL.test(title)) return 'special';
  return null;
}
