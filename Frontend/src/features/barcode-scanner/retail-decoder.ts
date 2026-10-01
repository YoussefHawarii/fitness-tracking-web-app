import {
  BarcodeFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HybridBinarizer,
  InvertedLuminanceSource,
  LuminanceSource,
  MultiFormatOneDReader,
  NotFoundException,
} from '@zxing/library';

export type CropPixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

class RgbaLuminanceSource extends LuminanceSource {
  private readonly rgba: Uint8ClampedArray;

  constructor(rgba: Uint8ClampedArray, width: number, height: number) {
    super(width, height);
    this.rgba = rgba;
  }

  getRow(y: number, row?: Uint8ClampedArray): Uint8ClampedArray {
    const width = this.getWidth();
    if (y < 0 || y >= this.getHeight())
      throw new RangeError('Luminance row is outside the image');
    const output =
      row && row.length >= width ? row : new Uint8ClampedArray(width);
    for (let x = 0, offset = y * width * 4; x < width; x++, offset += 4) {
      output[x] =
        (this.rgba[offset] +
          2 * this.rgba[offset + 1] +
          this.rgba[offset + 2]) /
        4;
    }
    return output;
  }

  getMatrix(): Uint8ClampedArray {
    const width = this.getWidth();
    const matrix = new Uint8ClampedArray(width * this.getHeight());
    for (let y = 0; y < this.getHeight(); y++) {
      this.getRow(y, matrix.subarray(y * width, (y + 1) * width));
    }
    return matrix;
  }

  invert(): LuminanceSource {
    return new InvertedLuminanceSource(this);
  }
}

export function createRetailDecoder() {
  const hints = new Map<DecodeHintType, BarcodeFormat[]>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ],
    ],
  ]);
  const reader = new MultiFormatOneDReader(hints);
  const ErrorWithStackTraceLimit = Error as ErrorConstructor & {
    stackTraceLimit?: number;
  };

  return {
    decode(pixels: CropPixels): string | null {
      const { data, width, height } = pixels;
      const bitmap = new BinaryBitmap(
        new HybridBinarizer(new RgbaLuminanceSource(data, width, height)),
      );
      let previousLimit: number | undefined;
      let limitChanged = false;
      try {
        previousLimit = ErrorWithStackTraceLimit.stackTraceLimit;
        ErrorWithStackTraceLimit.stackTraceLimit = 0;
        limitChanged = true;
      } catch {
        // A browser may expose this V8 option as read-only or not at all.
      }
      try {
        return reader.decode(bitmap, hints).getText();
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ChecksumException ||
          error instanceof FormatException
        ) {
          return null;
        }
        throw error;
      } finally {
        if (limitChanged) {
          try {
            ErrorWithStackTraceLimit.stackTraceLimit = previousLimit;
          } catch {
            // Restoring the optional setting must not replace a decode result.
          }
        }
      }
    },
  };
}
