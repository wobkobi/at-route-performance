// src/lib/label-width.ts
// Width of a diagram label before it is drawn. The layout runs on the server,
// where no text can be measured, so the widths come from the font itself.

/**
 * Advance widths of Gotham Narrow Ultra for ASCII 32 (space) to 126 (~), in
 * thousandths of an em, read from gotham-narrow-ultra.otf's hmtx table. Ultra is
 * the face the diagram's semibold and bold labels render in: the site loads 300,
 * 400, 500 and 900, and a 600 or 700 request resolves up to the 900.
 */
const ULTRA_ASCII = [
  230, 297, 492, 624, 591, 822, 633, 252, 392, 392, 391, 574, 258, 377, 258, 470, 643, 377, 548,
  543, 609, 552, 588, 532, 567, 588, 266, 266, 574, 574, 574, 485, 840, 691, 623, 615, 660, 571,
  549, 657, 667, 286, 487, 637, 527, 760, 681, 704, 598, 704, 628, 582, 580, 662, 666, 968, 633,
  635, 587, 390, 470, 390, 500, 570, 500, 540, 598, 491, 598, 538, 376, 598, 574, 271, 272, 550,
  271, 877, 574, 576, 598, 597, 386, 468, 391, 575, 572, 767, 535, 572, 493, 436, 312, 436, 453,
];

/** The ellipsis a truncated branch label ends in. */
const ELLIPSIS = 772;

/**
 * Any other character, such as a macron vowel in a Māori place name: as wide as
 * a capital, so an unlisted glyph errs wide rather than clipping.
 */
const OTHER = 700;

/**
 * Rendered width of a diagram label in Gotham Narrow Ultra.
 * @param text - The label text.
 * @param px - Font size (px).
 * @returns Width (px), ignoring kerning.
 */
export function labelWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    em += c >= 32 && c <= 126 ? ULTRA_ASCII[c - 32]! : c === 0x2026 ? ELLIPSIS : OTHER;
  }
  return (em / 1000) * px;
}
