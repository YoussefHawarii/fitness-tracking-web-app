import { useRef, useState } from 'react';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import type { ReviewImage } from './labelScanSession';
import type { CropRectangle } from './recognitionPasses';

// The crop step of label scanning: the chosen photo with an adjustable box,
// so the user can read just the nutrition table (which the engine reads far
// better than the whole photo) or the whole photo. The box is kept in
// prepared-photo pixels, whatever size the photo is displayed at; only the
// pointer's movement is converted from displayed pixels.

// The smallest box a drag can leave, in photo pixels.
const MIN_SIZE = 40;

type DragMode = 'move' | 'resize';

interface Drag {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  start: CropRectangle;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

// The box after dragging by (dx, dy) photo pixels: moved, or its bottom-right
// corner pulled, and either way kept inside the photo and at least MIN_SIZE.
function dragBox(
  { mode, start }: Drag,
  dx: number,
  dy: number,
  image: ReviewImage,
): CropRectangle {
  if (mode === 'move') {
    return {
      ...start,
      left: Math.round(clamp(start.left + dx, 0, image.width - start.width)),
      top: Math.round(clamp(start.top + dy, 0, image.height - start.height)),
    };
  }
  const minWidth = Math.min(MIN_SIZE, image.width - start.left);
  const minHeight = Math.min(MIN_SIZE, image.height - start.top);
  return {
    ...start,
    width: Math.round(
      clamp(start.width + dx, minWidth, image.width - start.left),
    ),
    height: Math.round(
      clamp(start.height + dy, minHeight, image.height - start.top),
    ),
  };
}

const percent = (value: number, of: number) => `${(value / of) * 100}%`;

interface Props {
  image: ReviewImage;
  onReadRegion: (region: CropRectangle) => void;
  onReadWhole: () => void;
}

// Mount it with a key per photo so a new photo starts with the box over the
// whole photo again.
export function CropStep({ image, onReadRegion, onReadWhole }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<CropRectangle>({
    left: 0,
    top: 0,
    width: image.width,
    height: image.height,
  });

  function startDrag(mode: DragMode, e: React.PointerEvent<HTMLElement>) {
    // The handle sits inside the box; it must not also start a move.
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      start: box,
    };
  }

  function onMove(e: React.PointerEvent<HTMLElement>) {
    const current = drag.current;
    const displayed = frame.current?.getBoundingClientRect().width;
    if (!current || current.pointerId !== e.pointerId || !displayed) return;
    e.stopPropagation();
    // Displayed pixels to photo pixels.
    const scale = image.width / displayed;
    setBox(
      dragBox(
        current,
        (e.clientX - current.startX) * scale,
        (e.clientY - current.startY) * scale,
        image,
      ),
    );
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    e.stopPropagation();
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-text-muted">
        Drag the box over the nutrition table, then read it. Or read the whole
        photo.
      </p>
      <div
        ref={frame}
        className="relative w-full select-none overflow-hidden rounded-xl border border-border"
      >
        <img
          src={image.url}
          alt="Chosen label photo"
          draggable={false}
          className="block h-auto w-full"
        />
        <div
          aria-label="Crop area"
          className="absolute cursor-move touch-none border-2 border-accent"
          style={{
            left: percent(box.left, image.width),
            top: percent(box.top, image.height),
            width: percent(box.width, image.width),
            height: percent(box.height, image.height),
            // Dims the photo outside the box.
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)',
          }}
          onPointerDown={(e) => startDrag('move', e)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Inside the corner: the frame clips anything outside the photo,
              and the box starts over the whole photo. */}
          <div
            aria-label="Resize crop area from bottom right corner"
            className="absolute bottom-0 right-0 h-8 w-8 cursor-nwse-resize touch-none rounded-tl-xl border-2 border-bg bg-accent"
            onPointerDown={(e) => startDrag('resize', e)}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <PrimaryButton type="button" onClick={() => onReadRegion(box)}>
          Read selected area
        </PrimaryButton>
        <SecondaryButton type="button" onClick={onReadWhole}>
          Read whole photo
        </SecondaryButton>
      </div>
    </div>
  );
}
