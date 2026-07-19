// Pure layout math for the timeline: overlap clustering into side-by-side
// columns, interval merging, and free-gap detection.

/** 1 minute = 1.1 px → 1 hour ≈ 66 px. */
export const MINUTE_SCALE = 1.1;

/** Minimum rendered block height in px (short tasks stay tappable). */
export const MIN_BLOCK_HEIGHT = 30;

export interface Interval {
  start: number; // minutes from midnight
  end: number;
}

export interface ColumnPlacement {
  col: number;
  cols: number;
}

/**
 * Assign each interval a column so overlapping intervals sit side by side.
 * Input must be sorted by start ascending. Transitive overlap forms a
 * cluster; every member of a cluster shares the same column count.
 */
export function computeColumns(items: Interval[]): ColumnPlacement[] {
  const result: ColumnPlacement[] = items.map(() => ({ col: 0, cols: 1 }));
  let cluster: number[] = [];
  let colEnds: number[] = [];
  let clusterMaxEnd = -1;

  const flush = () => {
    const cols = Math.max(1, colEnds.length);
    for (const idx of cluster) result[idx].cols = cols;
    cluster = [];
    colEnds = [];
  };

  for (let i = 0; i < items.length; i++) {
    const { start, end } = items[i];
    if (cluster.length > 0 && start >= clusterMaxEnd) {
      flush();
      clusterMaxEnd = -1;
    }
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = end;
    }
    result[i].col = col;
    cluster.push(i);
    clusterMaxEnd = Math.max(clusterMaxEnd, end);
  }
  flush();
  return result;
}

/** Merge possibly-overlapping intervals (input sorted by start). */
export function mergeIntervals(items: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && it.start <= last.end) {
      last.end = Math.max(last.end, it.end);
    } else {
      merged.push({ start: it.start, end: it.end });
    }
  }
  return merged;
}

/**
 * Free gaps of at least `minLength` minutes inside [windowStart, windowEnd],
 * given already-merged occupied intervals.
 */
export function findGaps(
  occupied: Interval[],
  windowStart: number,
  windowEnd: number,
  minLength: number
): Interval[] {
  const gaps: Interval[] = [];
  let cursor = windowStart;
  for (const it of occupied) {
    if (it.start - cursor >= minLength) {
      gaps.push({ start: cursor, end: it.start });
    }
    cursor = Math.max(cursor, it.end);
  }
  if (windowEnd - cursor >= minLength) gaps.push({ start: cursor, end: windowEnd });
  return gaps;
}

/** Snap minutes to the nearest `step` (default 5). */
export function snapMinutes(minutes: number, step = 5): number {
  return Math.round(minutes / step) * step;
}
