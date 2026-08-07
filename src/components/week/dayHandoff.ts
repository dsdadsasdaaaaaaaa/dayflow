import type { DayKey } from '../../types';

/**
 * Tiny hand-off channel between the Week screen and the Today tab.
 * The Week screen writes the tapped day with `setPendingDay` right before
 * navigating back; the Today screen calls `consumePendingDay()` on focus and,
 * if non-null, jumps its internal selectedDay there. Read-once semantics.
 */
let pending: DayKey | null = null;

export function setPendingDay(day: DayKey): void {
  pending = day;
}

/** Returns the pending day (or null) and clears it. */
export function consumePendingDay(): DayKey | null {
  const day = pending;
  pending = null;
  return day;
}
