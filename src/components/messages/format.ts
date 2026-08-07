import { daysBetween, formatDayShort, formatMinutes, toDayKey, todayKey, weekdayShort } from '../../lib/dates';

/** "(555) 123-4567" for +1 numbers, otherwise the raw E.164. */
export function formatPhoneDisplay(phone: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  if (us) return `(${us[1]}) ${us[2]}-${us[3]}`;
  return phone;
}

/** "2:45 PM" for an epoch-ms timestamp. */
export function formatClockTime(sentAt: number): string {
  const d = new Date(sentAt);
  return formatMinutes(d.getHours() * 60 + d.getMinutes());
}

/** Compact thread-row time: clock today, "Yesterday", weekday inside a week, else "Jul 16". */
export function formatWhenShort(sentAt: number): string {
  const d = new Date(sentAt);
  const day = toDayKey(d);
  const diff = daysBetween(day, todayKey());
  if (diff <= 0) return formatClockTime(sentAt);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return weekdayShort(d.getDay());
  // formatDayShort → "Wed, Jul 16"; keep just the date part.
  const short = formatDayShort(day);
  const comma = short.indexOf(', ');
  return comma >= 0 ? short.slice(comma + 2) : short;
}
