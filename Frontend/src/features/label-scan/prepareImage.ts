// Prepares a label photo for on-device recognition: orientation applied
// from the photo's metadata, longest side scaled down to ~2000 px (phone
// photos are often 4000+ px, which costs memory on iPhone without helping
// recognition), and converted to grayscale. Runs entirely in the browser.

export const LABEL_IMAGE_MAX_SIDE = 2000;

export class LabelImageDecodeError extends Error {
  constructor() {
    super('This photo format can’t be read here.');
    this.name = 'LabelImageDecodeError';
  }
}

export function scaledSize(
  width: number,
  height: number,
  maxSide = LABEL_IMAGE_MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareLabelImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new LabelImageDecodeError();
  }

  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new LabelImageDecodeError();
    context.drawImage(bitmap, 0, 0, width, height);

    const image = context.getImageData(0, 0, width, height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = Math.round(
        0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2],
      );
      pixels[i] = luma;
      pixels[i + 1] = luma;
      pixels[i + 2] = luma;
    }
    context.putImageData(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new LabelImageDecodeError())),
        'image/png',
      );
    });
  } finally {
    bitmap.close();
  }
}
