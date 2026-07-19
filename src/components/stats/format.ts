/** Compact duration formatting shared by the stats components. */

/** "45m" | "1.5h" | "12h" — single-token compact duration. */
export function fmtHoursCompact(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${h % 1 === 0 ? Math.round(h) : h}h`;
}

/** "0m" | "45m" | "3h" | "3h 20m" — hero-tile friendly duration. */
export function fmtClockCompact(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}
