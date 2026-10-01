export function buildCameraConstraints() {
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };
}

export function detectCameraFeatures(capabilities: Record<string, unknown>) {
  const rawZoom = capabilities.zoom;
  const zoom =
    rawZoom &&
    typeof rawZoom === 'object' &&
    'min' in rawZoom &&
    'max' in rawZoom
      ? rawZoom
      : null;
  const min = zoom && typeof zoom.min === 'number' ? zoom.min : null;
  const max = zoom && typeof zoom.max === 'number' ? zoom.max : null;
  return {
    zoom:
      min !== null && max !== null && max > min
        ? {
            min,
            max,
            step:
              zoom && 'step' in zoom && typeof zoom.step === 'number'
                ? zoom.step
                : undefined,
          }
        : null,
    torch: capabilities.torch === true,
    continuousFocus:
      Array.isArray(capabilities.focusMode) &&
      capabilities.focusMode.includes('continuous'),
  };
}

export function chooseZoom(
  features: ReturnType<typeof detectCameraFeatures>,
): number | null {
  if (!features.zoom) return null;
  const level = Math.min(features.zoom.max, Math.max(features.zoom.min, 2));
  return level > 1 ? level : null;
}
