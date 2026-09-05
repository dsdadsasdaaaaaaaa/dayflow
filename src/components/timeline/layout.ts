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

/**
 * Share of the width a school day gets when it has to share.
 *
 * Classes are a backdrop rather than a to-do list: they are fixed, there are
 * eight of them, and their only real job is to show what the day is already
 * spent on. Packing them into the same columns as tasks made both unreadable
 * — a class squeezed to half width, a task squeezed to the other half, and
 * every title truncated to two words. Giving the timetable a narrow lane of
 * its own leaves the middle for the things a person actually acts on.
 */
export const SCHOOL_LANE_PCT = 30;

export interface LanedItem extends Interval {
  /** True for a class or other timetable entry. */
  school: boolean;
}

/**
 * Place items in two lanes: the school day down one side, everything else
 * in the space that remains.
 *
 * Each lane packs its own overlaps, so a class running long still sits beside
 * the class it overlaps rather than beside a task. When a day has only one
 * kind on it there is nothing to separate, and that kind takes the full
 * width — a Saturday should not be three-quarters of empty gutter.
 */
export function computeLanes(items: LanedItem[]): (ColumnPlacement & {
  leftPct: number;
  widthPct: number;
})[] {
  const schoolIdx = items.map((it, i) => (it.school ? i : -1)).filter((i) => i >= 0);
  const otherIdx = items.map((it, i) => (it.school ? -1 : i)).filter((i) => i >= 0);
  const split = schoolIdx.length > 0 && otherIdx.length > 0;

  const place = (idx: number[], originPct: number, spanPct: number) => {
    const cols = computeColumns(idx.map((i) => items[i]));
    return idx.map((i, n) => {
      const { col, cols: total } = cols[n];
      const gapPct = total > 1 ? 1 : 0;
      return {
        i,
        col,
        cols: total,
        leftPct: originPct + (col / total) * spanPct,
        widthPct: spanPct / total - gapPct,
      };
    });
  };

  const placed = split
    ? [
        ...place(schoolIdx, 0, SCHOOL_LANE_PCT),
        ...place(otherIdx, SCHOOL_LANE_PCT, 100 - SCHOOL_LANE_PCT),
      ]
    : place(
        items.map((_, i) => i),
        0,
        100
      );

  const out = items.map(() => ({ col: 0, cols: 1, leftPct: 0, widthPct: 100 }));
  for (const p of placed) {
    out[p.i] = { col: p.col, cols: p.cols, leftPct: p.leftPct, widthPct: p.widthPct };
  }
  return out;
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
