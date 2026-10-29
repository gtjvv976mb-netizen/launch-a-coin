declare module "gifenc" {
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: {format?: string}): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
  export function GIFEncoder(options?: {initialCapacity?: number; auto?: boolean}): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: {palette?: number[][]; colorDepth?: number; delay?: number; repeat?: number; dispose?: number; transparent?: boolean; transparentIndex?: number; first?: boolean}): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  };
}
