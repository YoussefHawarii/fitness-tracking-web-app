import type { GrayImage } from './labelCleanup';

// Moves a photo between an image Blob and the grayscale pixel array the
// cleanup works on. The only browser-bound part of that cleanup: a canvas
// to read pixels out of a decoded image and to write them back as a PNG.
// Everything stays in memory on this device.
export interface GrayCodec {
  decode(image: Blob): Promise<GrayImage>;
  encode(gray: GrayImage): Promise<Blob>;
}

export const canvasCodec: GrayCodec = {
  async decode(image) {
    const bitmap = await createImageBitmap(image);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('No canvas.');
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      // The prepared photo is already gray, so one channel is the pixel.
      const gray = new Uint8Array(bitmap.width * bitmap.height);
      for (let i = 0; i < gray.length; i += 1) gray[i] = data[i * 4];
      return { width: bitmap.width, height: bitmap.height, data: gray };
    } finally {
      bitmap.close();
    }
  },

  async encode(gray) {
    const canvas = document.createElement('canvas');
    canvas.width = gray.width;
    canvas.height = gray.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas.');
    const pixels = context.createImageData(gray.width, gray.height);
    for (let i = 0; i < gray.data.length; i += 1) {
      const v = gray.data[i];
      pixels.data[i * 4] = v;
      pixels.data[i * 4 + 1] = v;
      pixels.data[i * 4 + 2] = v;
      pixels.data[i * 4 + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('No image.'))),
        'image/png',
      );
    });
  },
};
