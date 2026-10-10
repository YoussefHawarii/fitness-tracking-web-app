// Prepares a label photo for on-device recognition: orientation applied
// from the photo's metadata, optionally cropped, longest side scaled down to
// ~2000 px (phone photos are often 4000+ px, which costs memory on iPhone
// without helping recognition), and converted to grayscale. Runs entirely in
// the browser.
//
// A crop is cut from the original photo before scaling, so a nutrition
// table that fills only part of the photo keeps the photo's full detail
// (up to the same ~2000 px) instead of the detail left after the whole photo
// was scaled down.

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

// A part of the photo as fractions (0 to 1) of its width and height, so it
// means the same area at any resolution of the photo.
export interface PhotoFraction {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The crop in the photo's own pixels: rounded to whole pixels, kept inside
// the photo and at least one pixel in each direction.
export function cropInPixels(
  width: number,
  height: number,
  crop: PhotoFraction,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(width - 1, Math.max(0, Math.round(crop.left * width)));
  const y = Math.min(height - 1, Math.max(0, Math.round(crop.top * height)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(crop.height * height))),
  };
}

export async function prepareLabelImage(
  file: Blob,
  crop?: PhotoFraction,
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new LabelImageDecodeError();
  }

  try {
    const source = crop
      ? cropInPixels(bitmap.width, bitmap.height, crop)
      : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const { width, height } = scaledSize(source.width, source.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new LabelImageDecodeError();
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      width,
      height,
    );

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
