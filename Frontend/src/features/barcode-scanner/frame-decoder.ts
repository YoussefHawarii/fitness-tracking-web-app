import type { CropPixels } from './retail-decoder';

export function createFrameDecoder({
  native,
  zxing,
}: {
  native: { detect(source: unknown): Promise<string | null> } | null;
  zxing: { decode(pixels: CropPixels): string | null };
}) {
  let activeNative = native;
  return async (frame: {
    source: unknown;
    pixels(): CropPixels;
  }): Promise<string | null> => {
    if (activeNative) {
      try {
        return await activeNative.detect(frame.source);
      } catch {
        activeNative = null;
      }
    }
    return zxing.decode(frame.pixels());
  };
}
