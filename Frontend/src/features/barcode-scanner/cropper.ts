import type { CropPixels } from './retail-decoder';

type CanvasLike = {
  width: number;
  height: number;
  getContext(
    kind: '2d',
    options: { willReadFrequently: true },
  ): {
    drawImage(
      ...args: [
        CanvasImageSource,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ]
    ): void;
    getImageData(
      x: number,
      y: number,
      width: number,
      height: number,
    ): CropPixels;
  } | null;
};

export function createCropper<Canvas extends CanvasLike>(
  createCanvas: () => Canvas,
) {
  const canvas = createCanvas();
  let context: ReturnType<CanvasLike['getContext']> | undefined;
  const getContext = () => {
    if (context === undefined)
      context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context is unavailable');
    return context;
  };

  return {
    canvas,
    draw(
      video: CanvasImageSource,
      region: { x: number; y: number; width: number; height: number },
    ) {
      const context = getContext();
      const { x, y, width, height } = region;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(video, x, y, width, height, 0, 0, width, height);
    },
    pixels(): CropPixels {
      return getContext().getImageData(0, 0, canvas.width, canvas.height);
    },
  };
}
