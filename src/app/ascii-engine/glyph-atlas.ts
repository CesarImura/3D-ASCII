/**
 * Builds a Canvas2D strip texture of glyphs: one cell per character, laid
 * out left-to-right in a single row. A single row sidesteps WebGL texture
 * flipY ambiguity entirely -- the composite shader only needs to index the
 * U axis by character, and read the full V range for each glyph.
 */

export type GlyphAtlas = {
  canvas: HTMLCanvasElement;
  columns: number;
};

const CELL_PX = 64;

export function buildGlyphAtlas(
  characters: string,
  glyphSizePx: number,
  fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace",
): GlyphAtlas {
  const chars = characters.length > 0 ? characters : " ";
  const columns = chars.length;

  const canvas = document.createElement("canvas");
  canvas.width = columns * CELL_PX;
  canvas.height = CELL_PX;

  const context = canvas.getContext("2d");
  if (!context) {
    return { canvas, columns };
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = `${glyphSizePx}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let index = 0; index < chars.length; index += 1) {
    context.fillText(
      chars[index] ?? " ",
      index * CELL_PX + CELL_PX / 2,
      CELL_PX / 2,
    );
  }

  return { canvas, columns };
}
