import {
  buildCameraConstraints,
  chooseZoom,
  detectCameraFeatures,
} from './camera-capabilities';

export type ScanStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'decoded'
  | 'permission-denied'
  | 'unavailable'
  | 'camera-busy'
  | 'unsupported'
  | 'error'
  | 'interrupted';

export type TorchState = { available: boolean; on: boolean };

export type ScanState = {
  status: ScanStatus;
  barcode: string | null;
  torch: TorchState;
  zoom: number | null;
};

export const INITIAL_SCAN_STATE: ScanState = {
  status: 'idle',
  barcode: null,
  torch: { available: false, on: false },
  zoom: null,
};

export type CameraHandle = {
  capabilities: Record<string, unknown>;
  applyZoom(level: number): Promise<void>;
  setTorch(on: boolean): Promise<void>;
  // Fires when the OS takes the camera away (screen lock, app switch,
  // incoming call); returns an unsubscribe.
  onEnded?(listener: () => void): () => void;
  stop(): void;
};

export function createScanSession({
  openCamera,
  onBarcode,
  constraints = buildCameraConstraints(),
}: {
  openCamera: (
    constraints: ReturnType<typeof buildCameraConstraints>,
  ) => Promise<CameraHandle>;
  onBarcode: (text: string) => void;
  // What to ask the camera for; the barcode scanner's 1080p by default.
  constraints?: ReturnType<typeof buildCameraConstraints>;
}) {
  let state: ScanState = INITIAL_SCAN_STATE;
  let camera: CameraHandle | null = null;
  let stopListeningForEnd: (() => void) | undefined;
  let startInFlight: Promise<void> | null = null;
  let stopped = false;
  const listeners = new Set<() => void>();
  const setState = (next: ScanState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const releaseCamera = () => {
    stopListeningForEnd?.();
    stopListeningForEnd = undefined;
    camera?.stop();
    camera = null;
  };

  const openAndScan = async () => {
    setState({ ...state, status: 'starting' });
    try {
      camera = await openCamera(constraints);
    } catch (error) {
      if (stopped) return;
      const name =
        error !== null &&
        typeof error === 'object' &&
        'name' in error &&
        typeof error.name === 'string'
          ? error.name
          : '';
      const status: ScanStatus =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'permission-denied'
          : name === 'NotReadableError'
            ? 'camera-busy'
            : name === 'NotSupportedError'
              ? 'unsupported'
              : ['NotFoundError', 'OverconstrainedError'].includes(name)
                ? 'unavailable'
                : 'error';
      setState({ ...state, status });
      return;
    }
    if (stopped) {
      camera.stop();
      return;
    }
    const opened = camera;
    stopListeningForEnd = opened.onEnded?.(() => {
      if (camera !== opened) return;
      releaseCamera();
      setState({
        ...state,
        status: 'interrupted',
        torch: { available: false, on: false },
        zoom: null,
      });
    });
    const features = detectCameraFeatures(camera.capabilities);
    let zoom = chooseZoom(features);
    if (zoom !== null) {
      try {
        await camera.applyZoom(zoom);
      } catch {
        // Optional camera controls can fail even when advertised.
        zoom = null;
      }
    }
    if (stopped || camera !== opened) return;
    setState({
      ...state,
      status: 'scanning',
      torch: { available: features.torch, on: false },
      zoom,
    });
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      // A retry tap racing an attempt still in flight must not open a second
      // camera (the first stream would be orphaned with its light on).
      if (startInFlight) return startInFlight;
      if (camera) return Promise.resolve();
      startInFlight = openAndScan().finally(() => {
        startInFlight = null;
      });
      return startInFlight;
    },
    reportDecode(text: string | null) {
      if (state.status !== 'scanning' || text === null) return;
      // ZXing/native already validate check digits, so the first read confirms
      // the code. FoodLog keeps the scanner mounted while it shows the product,
      // so release the camera now rather than on unmount.
      releaseCamera();
      setState({ ...state, status: 'decoded', barcode: text });
      onBarcode(text);
    },
    async toggleTorch() {
      if (!camera || !state.torch.available) return;
      const on = !state.torch.on;
      try {
        await camera.setTorch(on);
        if (!stopped) setState({ ...state, torch: { available: true, on } });
      } catch {
        // Keep the previous state when the device rejects the setting.
      }
    },
    stop() {
      stopped = true;
      releaseCamera();
      setState({ ...state, status: 'idle' });
    },
  };
}
