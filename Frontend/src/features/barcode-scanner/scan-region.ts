export const SCAN_SLOT = { x: 0.15, y: 0.4125, width: 0.7, height: 0.175 };

// ZXing needs blank quiet zones beside the guard bars when users fill the slot edge to edge.
const QUIET_ZONE_MARGIN = 0.12;
export const DECODE_REGION = {
  x: SCAN_SLOT.x - SCAN_SLOT.width * QUIET_ZONE_MARGIN,
  y: SCAN_SLOT.y,
  width: SCAN_SLOT.width * (1 + 2 * QUIET_ZONE_MARGIN),
  height: SCAN_SLOT.height,
};

type ScanBox = typeof SCAN_SLOT;

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
