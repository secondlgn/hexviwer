/**
 * Shared typography / layout metrics for the canvas-based hex views.
 * Character width is measured at runtime so rendering and hit-testing
 * always match the actual font on the user's system.
 */

export const HEX_FONT =
  '13px "Cascadia Code", "JetBrains Mono", "SF Mono", Consolas, "Courier New", monospace';

export const HEX_ROW_H = 20;

/** Extra horizontal gap inserted after every group of 4 bytes. */
export const GROUP_GAP = 8;

/** Padding on each side of the address column. */
export const ADDR_PAD = 10;

let cachedCharW: number | null = null;

/** Width of one monospace glyph in CSS pixels for {@link HEX_FONT}. */
export function hexCharW(): number {
  if (cachedCharW != null) return cachedCharW;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = HEX_FONT;
    cachedCharW = ctx.measureText("00000000").width / 8;
  } else {
    cachedCharW = 7.8;
  }
  return cachedCharW;
}

/** Horizontal pitch of one byte cell (two glyphs + intra-cell spacing). */
export function hexByteStep(): number {
  return hexCharW() * 2 + 5;
}

/** X coordinate of byte column `col` starting at `origin`. */
export function hexByteX(col: number, origin: number, step: number): number {
  return origin + col * step + Math.floor(col / 4) * GROUP_GAP;
}

/** Total pixel width of a row containing `count` bytes. */
export function hexRowWidth(count: number, origin: number, step: number): number {
  if (count <= 0) return origin;
  return hexByteX(count - 1, origin, step) + step;
}
