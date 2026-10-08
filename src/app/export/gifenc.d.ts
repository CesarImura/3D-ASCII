// Minimal types for the `gifenc` package (it ships no .d.ts).
declare module "gifenc" {
  export type GifPalette = number[][];

  export type GifFrameOptions = {
    delay?: number;
    dispose?: number;
    palette?: GifPalette;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
  };

  export type GifEncoderInstance = {
    bytes(): Uint8Array;
    finish(): void;
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
  };

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number },
  ): GifPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
