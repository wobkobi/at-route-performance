// Averages and shares, rounded the one way the aggregation pipelines round them,
// so a figure folded in TypeScript prints the same as one stored by a pipeline.

/**
 * Round to one decimal place, the precision every stored figure keeps.
 * @param n - The value.
 * @returns The value to a tenth.
 */
export function roundTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Weighted mean of a figure across rows, to one decimal place. A row whose
 * figure is null or missing is left out of the sum and the divisor both, so an
 * unknown figure never drags the mean towards zero.
 * @param rows - The rows to combine.
 * @param value - Reads a row's figure.
 * @param weight - Reads a row's weight (usually its arrivals).
 * @returns The mean, or null when no weighted row carries the figure.
 */
export function weightedMean<T>(
  rows: Iterable<T>,
  value: (row: T) => number | null | undefined,
  weight: (row: T) => number,
): number | null {
  let sum = 0;
  let total = 0;
  for (const row of rows) {
    const v = value(row);
    if (v == null) continue;
    const w = weight(row);
    sum += v * w;
    total += w;
  }
  return total > 0 ? roundTenth(sum / total) : null;
}

/**
 * The usual weight for {@link weightedMean}: a row's arrivals, so a busy row
 * weighs what it carried.
 * @param row - The row.
 * @param row.events - Its arrivals.
 * @returns The weight.
 */
export function byEvents(row: { events: number }): number {
  return row.events;
}
