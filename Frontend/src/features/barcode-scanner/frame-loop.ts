type VideoFrameSource = {
  currentTime: number;
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: unknown) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function createFrameLoop({
  video,
  requestAnimationFrame,
  cancelAnimationFrame,
  onFrame,
  onError,
}: {
  video: VideoFrameSource;
  requestAnimationFrame: (callback: (now: number) => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  onFrame: () => void | Promise<unknown>;
  onError?: (error: unknown) => void;
}) {
  const useVideoFrames =
    typeof video.requestVideoFrameCallback === 'function' &&
    typeof video.cancelVideoFrameCallback === 'function';
  let running = false;
  let generation = 0;
  let pending: number | null = null;
  let lastTime: number | null = null;

  const stop = () => {
    running = false;
    generation++;
    if (pending !== null) {
      if (useVideoFrames) video.cancelVideoFrameCallback?.(pending);
      else cancelAnimationFrame(pending);
      pending = null;
    }
  };

  const requestNext = (token: number) => {
    if (!running || token !== generation) return;
    if (useVideoFrames) {
      pending =
        video.requestVideoFrameCallback?.(() => handleFrame(token)) ?? null;
    } else {
      pending = requestAnimationFrame(() => handleFrame(token));
    }
  };

  const handleFrame = (token: number) => {
    pending = null;
    if (!running || token !== generation) return;
    if (!useVideoFrames && lastTime === video.currentTime) {
      requestNext(token);
      return;
    }
    lastTime = video.currentTime;
    try {
      Promise.resolve(onFrame()).then(
        () => requestNext(token),
        (error: unknown) => fail(error, token),
      );
    } catch (error) {
      fail(error, token);
    }
  };

  const fail = (error: unknown, token: number) => {
    if (!running || token !== generation) return;
    stop();
    onError?.(error);
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation++;
      lastTime = null;
      requestNext(generation);
    },
    stop,
  };
}
