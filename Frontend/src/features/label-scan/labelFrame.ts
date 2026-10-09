import { computeScanRegion } from '../barcode-scanner/scan-region';

// The label camera's guide frames, as fractions of its 3:4 (portrait)
// viewfinder. Nutrition tables come in two broad shapes: tall (the standard
// vertical table) and wide (tabular and bilingual side-by-side tables, and
// tables on small packs), so the user picks the frame that fits.
// The tall frame is 3:4 and the wide one 2:1 on screen.
export type LabelFrameShape = 'tall' | 'wide';

export const LABEL_FRAMES: Record<
  LabelFrameShape,
  { x: number; y: number; width: number; height: number }
> = {
  tall: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  wide: { x: 0.05, y: 0.33125, width: 0.9, height: 0.3375 },
};

// Asks for 4K: the more of the camera's detail lands inside the frame, the
// better the small print reads. Cameras that can't (iPhone Safari often
// gives 1080p) open at their best instead.
export const LABEL_CAMERA_RESOLUTION = { width: 3840, height: 2160 };

// A still of what is inside the frame, at the video's own resolution (not
// the size it is displayed at), as a PNG. Null while the video has no
// frame yet.
export async function captureFramedStill(
  video: HTMLVideoElement,
  shape: LabelFrameShape,
  createCanvas: () => HTMLCanvasElement = () =>
    document.createElement('canvas'),
): Promise<Blob | null> {
  if (
    video.readyState < 2 ||
    !video.videoWidth ||
    !video.videoHeight ||
    !video.clientWidth ||
    !video.clientHeight
  )
    return null;
  const region = computeScanRegion({
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    viewWidth: video.clientWidth,
    viewHeight: video.clientHeight,
    box: LABEL_FRAMES[shape],
  });
  if (!region.width || !region.height) return null;
  const canvas = createCanvas();
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(
    video,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
