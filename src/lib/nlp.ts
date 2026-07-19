import { addDays, todayKey, weekdayOf } from './dates';
import type { DayKey, Priority, Recurrence } from '../types';

export interface ParsedQuickAdd {
  title: string;
  date: DayKey | null;
  startMinutes: number | null;
  durationMinutes: number | null;
  priority: Priority;
  recurrence: Recurrence | null;
}

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function nextWeekday(target: number, from: DayKey): DayKey {
  const current = weekdayOf(from);
  let diff = (target - current + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(from, diff);
}

/**
 * Parse quick-add strings like:
 *   "Gym tomorrow 7am 45min"
 *   "Standup every weekday at 9:30"
 *   "Pay rent monthly on the 1st !high"  (day-of-month not parsed; date via 'tomorrow' etc.)
 *   "Read wed 8pm for 1h !2"
 * Anything unrecognized stays in the title.
 */
export function parseQuickAdd(raw: string): ParsedQuickAdd {
  let text = ' ' + raw.trim() + ' ';
  const today = todayKey();
  let date: DayKey | null = null;
  let startMinutes: number | null = null;
  let durationMinutes: number | null = null;
  let priority: Priority = 0;
  let recurrence: Recurrence | null = null;

  /**
   * Match + strip. The handler may return false to VETO the strip (e.g. an
   * out-of-range time like "at 30" in "Meet at 30 Rockefeller") so rejected
   * text stays in the title.
   */
  const eat = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = text.match(re);
    if (m && fn(m) !== false) {
      text = text.replace(re, ' ');
    }
  };

  // Priority: !high / !med / !low / !1..!3
  eat(/\s!(high|h|3)\b/i, () => { priority = 3; });
  if (priority === 0) eat(/\s!(med|medium|m|2)\b/i, () => { priority = 2; });
  if (priority === 0) eat(/\s!(low|l|1)\b/i, () => { priority = 1; });

  // Recurrence
  eat(/\severy\s?day\b|\sdaily\b/i, () => {
    recurrence = { freq: 'daily', interval: 1 };
  });
  if (!recurrence)
    eat(/\severy\s?weekday\b|\sweekdays\b/i, () => {
      recurrence = { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] };
    });
  if (!recurrence)
    eat(/\severy\s?week\b|\sweekly\b/i, () => {
      recurrence = { freq: 'weekly', interval: 1 };
    });
  if (!recurrence)
    eat(/\severy\s?month\b|\smonthly\b/i, () => {
      recurrence = { freq: 'monthly', interval: 1 };
    });
  if (!recurrence)
    eat(
      new RegExp('\\severy\\s(' + Object.keys(WEEKDAY_NAMES).join('|') + ')\\b', 'i'),
      (m) => {
        const wd = WEEKDAY_NAMES[m[1].toLowerCase()];
        recurrence = { freq: 'weekly', interval: 1, weekdays: [wd] };
      }
    );

  // Duration: "for 1h30m" / "1h" / "1.5h" / "45min" / "for 2 hours"
  eat(/\s(?:for\s)?(\d+)\s?h(?:ours?|rs?)?\s?(\d+)\s?m(?:ins?|inutes?)?\b/i, (m) => {
    durationMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  });
  if (durationMinutes == null)
    eat(/\s(?:for\s)?(\d+(?:\.\d+)?)\s?h(?:ours?|rs?)\b/i, (m) => {
      durationMinutes = Math.round(parseFloat(m[1]) * 60);
    });
  if (durationMinutes == null)
    eat(/\s(?:for\s)?(\d+(?:\.\d+)?)h\b/i, (m) => {
      durationMinutes = Math.round(parseFloat(m[1]) * 60);
    });
  if (durationMinutes == null)
    eat(/\s(?:for\s)?(\d+)\s?m(?:ins?|inutes?)\b/i, (m) => {
      durationMinutes = parseInt(m[1], 10);
    });

  // Dates
  eat(/\stoday\b/i, () => { date = today; });
  if (!date) eat(/\stomorrow\b|\stmrw?\b/i, () => { date = addDays(today, 1); });
  if (!date)
    eat(
      new RegExp(
        '\\s(?:on\\s|next\\s)?(' + Object.keys(WEEKDAY_NAMES).join('|') + ')\\b',
        'i'
      ),
      (m) => {
        date = nextWeekday(WEEKDAY_NAMES[m[1].toLowerCase()], today);
      }
    );
  if (!date) eat(/\snext week\b/i, () => { date = addDays(today, 7); });

  // Times: "at 7", "7am", "19:30", "at 7:15pm", "noon"
  eat(/\snoon\b/i, () => { startMinutes = 12 * 60; });
  if (startMinutes == null)
    eat(/\smidnight\b/i, () => { startMinutes = 0; });
  if (startMinutes == null)
    eat(/\s(?:at\s)?(\d{1,2}):(\d{2})\s?(am|pm)?\b/i, (m) => {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ap = m[3]?.toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (h >= 24 || min >= 60) return false;
      startMinutes = h * 60 + min;
    });
  if (startMinutes == null)
    eat(/\s(?:at\s)?(\d{1,2})\s?(am|pm)\b/i, (m) => {
      let h = parseInt(m[1], 10);
      const ap = m[2].toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (h >= 24) return false;
      startMinutes = h * 60;
    });
  if (startMinutes == null)
    eat(/\sat\s(\d{1,2})\b/i, (m) => {
      const h = parseInt(m[1], 10);
      if (h >= 24) return false;
      startMinutes = h * 60;
    });

  // A time or recurrence without a date implies today.
  if (!date && (startMinutes != null || recurrence)) date = today;

  const title = text.replace(/\s+/g, ' ').trim();
  return { title, date, startMinutes, durationMinutes, priority, recurrence };
}
