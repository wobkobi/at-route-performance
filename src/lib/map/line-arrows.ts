// src/lib/map/line-arrows.ts
// Where to put the direction arrows along a drawn line. Worked in screen pixels
// rather than metres or point counts, so the arrows sit the same distance
// apart at every zoom: a point count bunches them wherever the shape is
// detailed (roundabouts, the CBD grid) and strands them on a straight motorway.

/** A point in screen pixels, y growing downwards as on the map. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** One arrow: where it sits and which way it points. */
export interface ArrowPlacement extends PixelPoint {
  /** Degrees clockwise from screen up, the rotation a north-up glyph needs. */
  angle: number;
}

/**
 * Arrows every `spacing` pixels along a line, the first `offset` pixels in. An
 * arrow landing within `clearance` pixels of a point in `avoid` (a stop
 * circle) slides forward along the line until it is clear, or is dropped if it
 * would slide past the next arrow's spot, so no arrow ever sits on a stop.
 * @param line - The line's vertices in screen pixels, in travel order.
 * @param spacing - Pixels between arrows.
 * @param offset - Pixels from the start to the first arrow; staggering this per
 *   line keeps two directions drawn down one road from stacking their arrows.
 * @param avoid - Points to keep arrows off.
 * @param clearance - Minimum pixels between an arrow and any point in `avoid`.
 * @returns The arrows, in travel order.
 */
export function arrowPlacements(
  line: readonly PixelPoint[],
  spacing: number,
  offset: number,
  avoid: readonly PixelPoint[] = [],
  clearance = 0,
): ArrowPlacement[] {
  const out: ArrowPlacement[] = [];
  if (line.length < 2 || spacing <= 0) return out;
  /**
   * Whether a spot is too close to a stop for an arrow.
   * @param p - The candidate spot.
   * @returns True when some avoided point is inside the clearance.
   */
  const blocked = (p: PixelPoint): boolean =>
    avoid.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < clearance);
  // Clear spots are searched in steps this small; a stop circle is ~12px across.
  const step = Math.max(2, clearance / 3);

  let target = offset;
  let limit = offset + spacing;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    while (target <= walked + len) {
      const t = (target - walked) / len;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (!blocked(p)) {
        // atan2(dx, -dy): 0 when the segment heads up the screen, 90 heading right.
        out.push({ ...p, angle: (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI });
        target = limit;
        limit += spacing;
      } else if (target + step < limit) {
        target += step;
      } else {
        target = limit;
        limit += spacing;
      }
    }
    walked += len;
  }
  return out;
}

/**
 * Drop an arrow that another, already kept, points the same way near. A route
 * map draws every shape variant, and variants share most of their road, so
 * without this a shared stretch carries one set of arrows per variant. Arrows
 * pointing opposite ways are both kept: that is a road run in both directions.
 * @param arrows - Arrows in priority order; earlier ones win.
 * @param radius - Pixels within which a same-way arrow counts as a repeat.
 * @param maxAngle - Degrees apart two headings may be and still be the same way.
 * @returns The arrows kept, in their original order.
 */
export function dropRepeatArrows(
  arrows: readonly ArrowPlacement[],
  radius: number,
  maxAngle = 45,
): ArrowPlacement[] {
  const kept: ArrowPlacement[] = [];
  for (const a of arrows) {
    const repeat = kept.some((k) => {
      const turn = Math.abs(((a.angle - k.angle + 540) % 360) - 180);
      return turn <= maxAngle && Math.hypot(a.x - k.x, a.y - k.y) < radius;
    });
    if (!repeat) kept.push(a);
  }
  return kept;
}
