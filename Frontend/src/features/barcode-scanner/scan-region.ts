export const SCAN_BOX = { x: 0.1, y: 0.35, width: 0.8, height: 0.3 };

type ScanBox = typeof SCAN_BOX;

export function computeScanRegion({
  videoWidth,
  videoHeight,
  viewWidth,
  viewHeight,
  box,
}: {
  videoWidth: number;
  videoHeight: number;
  viewWidth: number;
  viewHeight: number;
  box: ScanBox;
}) {
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
  const visibleWidth = viewWidth / scale;
  const visibleHeight = viewHeight / scale;
  const xOffset = (videoWidth - visibleWidth) / 2;
  const yOffset = (videoHeight - visibleHeight) / 2;
  const x = Math.max(
    0,
    Math.min(videoWidth, Math.round(xOffset + visibleWidth * box.x)),
  );
  const y = Math.max(
    0,
    Math.min(videoHeight, Math.round(yOffset + visibleHeight * box.y)),
  );
  return {
    x,
    y,
    width: Math.max(
      0,
      Math.min(videoWidth - x, Math.round(visibleWidth * box.width)),
    ),
    height: Math.max(
      0,
      Math.min(videoHeight - y, Math.round(visibleHeight * box.height)),
    ),
  };
}
