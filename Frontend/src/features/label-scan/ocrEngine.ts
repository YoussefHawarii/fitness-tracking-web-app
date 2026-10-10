import {
  CleanupWorkerDied,
  cleanOffThread,
  type LabelCleaner,
} from './cleanupRunner';
import { canvasCodec, type GrayCodec } from './grayCodec';
import {
  boxToPhoto,
  cleanForRecognition,
  enlargeCrop,
  numberInkCrop,
  rereadScale,
  rectangleToCopy,
  touchesErasedLine,
  type CleanedLabel,
} from './labelCleanup';
import { layoutFromBlocks, type OcrLayout, type OcrWord } from './ocrLayout';
import {
  hasDigit,
  mergeRecognitionPasses,
  numberCrop,
  verifyNumberWord,
  type CropRectangle,
} from './recognitionPasses';

// The on-device OCR engine (ADR 0008). Tesseract.js is imported only when
// label scanning is opened — never part of the main bundle — and every
// runtime asset (worker, engine builds, language data) is loaded from this
// app's own origin. The photo goes only to the in-browser worker; nothing
// here sends it, or the recognised text, anywhere else.
//
// One worker holds both languages and switches between them: an English
// page pass, an Arabic page pass, then an English re-read of every number
// from its own crop (see recognitionPasses.ts for why).
//
// A photo with a table grid is read as a cleaned copy of itself —
// straightened, its grid lines erased, its lighting evened out
// (labelCleanup.ts) — made here on the device, in a worker, and used only for
// recognition. Recognised positions are mapped back, so evidence boxes still
// sit on the photo. A photo with no grid, or one whose copy can't be made, is
// read as it is, in the page mode asked for.

export type OcrProgressStage = 'loading' | 'recognizing';

export interface OcrProgress {
  stage: OcrProgressStage;
  // 0-1 within the stage.
  progress: number;
}

// How a photo is read. `region` limits both language passes to that
// rectangle (photo pixels), read as one block of text; only words inside it
// are kept. `layout: 'sparse'` reads the whole photo for scattered text
// instead — the fallback when the automatic reading finds no table. With
// neither, the whole photo is read in automatic page mode. A gridded photo is
// always read as sparse text, whatever layout is asked (see recognize).
export interface RecognizeOptions {
  region?: CropRectangle;
  layout?: 'auto' | 'block' | 'sparse';
}

export interface OcrEngine {
  recognize(image: Blob, options?: RecognizeOptions): Promise<OcrLayout>;
  terminate(): Promise<void>;
}

const OEM_LSTM_ONLY = 1;
const PSM_AUTO = '3';
const PSM_SINGLE_BLOCK = '6';
const PSM_SINGLE_LINE = '7';
const PSM_SPARSE_TEXT = '11';
// Upper bound on numbers re-read per photo, so a photo of dense text can't
// turn into hundreds of re-reads on a phone. Numbers beyond it stay
// unverified and are never read.
const MAX_NUMBER_CHECKS = 80;

// The cleaned copy of a photo, encoded for the recogniser, or nothing when the
// photo can't be decoded here or has no table grid worth cleaning for. A
// worker that died after taking the photo's pixels is retried once on the
// main thread, from a fresh decode (unless the engine was stopped meanwhile);
// a cleanup that ran and failed is not. FAILED, unlike undefined, says the
// answer is not worth remembering.
const FAILED = Symbol('no cleaned copy');

async function cleanedCopy(
  image: Blob,
  codec: GrayCodec,
  clean: LabelCleaner,
  region?: CropRectangle,
  signal?: AbortSignal,
): Promise<(CleanedLabel & { blob: Blob }) | undefined | typeof FAILED> {
  try {
    let cleaned: CleanedLabel;
    try {
      cleaned = await clean(await codec.decode(image), region, signal);
    } catch (error) {
      if (!(error instanceof CleanupWorkerDied) || signal?.aborted) throw error;
      cleaned = cleanForRecognition(await codec.decode(image), region);
    }
    if (!cleaned.hasGrid) return undefined;
    return { ...cleaned, blob: await codec.encode(cleaned.image) };
  } catch {
    return FAILED;
  }
}

export async function createTesseractEngine(
  onProgress: (progress: OcrProgress) => void,
  codec: GrayCodec = canvasCodec,
  clean: LabelCleaner = cleanOffThread,
): Promise<OcrEngine> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker([...__OCR_LANGUAGES__], OEM_LSTM_ONLY, {
    workerPath: __OCR_ASSETS__.workerPath,
    corePath: __OCR_ASSETS__.corePath,
    langPath: __OCR_ASSETS__.langPath,
    cachePath: __OCR_ASSETS__.cachePath,
    // A same-origin worker script rather than a blob: URL, so the
    // Content-Security-Policy can stay at worker-src 'self'.
    workerBlobURL: false,
    // Progress only — logger messages carry status and a fraction, never
    // recognised text. Nothing is written to the console.
    logger: (message) => {
      onProgress({
        stage:
          message.status === 'recognizing text' ? 'recognizing' : 'loading',
        progress: message.progress,
      });
    },
    errorHandler: () => undefined,
  });

  // The cleaned copy of each photo read (and of each region of it), or the
  // verdict that it has none: a second pass over the same photo — the sparse
  // fallback — reuses it instead of decoding and cleaning again. Only the most
  // recent region of a photo is kept (a copy is about 10 MB), and a failed or
  // aborted cleanup is not kept at all. Held only while the photo's Blob is.
  const copies = new WeakMap<
    Blob,
    { key: string; copy: ReturnType<typeof cleanedCopy> }
  >();
  // Terminating the engine also stops a cleanup still running in its worker.
  const cleanupAbort = new AbortController();

  async function copyOf(image: Blob, region?: CropRectangle) {
    const key = region ? JSON.stringify(region) : '';
    const kept = copies.get(image);
    if (kept?.key === key) {
      const copy = await kept.copy;
      if (copy !== FAILED) return copy;
    }
    const mine = {
      key,
      copy: cleanedCopy(image, codec, clean, region, cleanupAbort.signal),
    };
    copies.set(image, mine);
    const copy = await mine.copy;
    if (copy === FAILED) {
      if (copies.get(image) === mine) copies.delete(image);
      return undefined;
    }
    return copy;
  }

  async function switchLanguage(language: string, pageSegMode: string) {
    await worker.reinitialize(language, OEM_LSTM_ONLY);
    await worker.setParameters({ tessedit_pageseg_mode: pageSegMode as never });
  }

  async function wordsIn(
    image: Blob,
    rectangle?: CropRectangle,
  ): Promise<OcrWord[]> {
    const { data } = await worker.recognize(
      image,
      rectangle ? { rectangle } : {},
      { blocks: true, text: false },
    );
    return layoutFromBlocks(data.blocks).words;
  }

  return {
    async recognize(image, options = {}) {
      const { layout } = options;
      const cleaned = await copyOf(image, options.region);
      const target = cleaned?.blob ?? image;
      const region =
        options.region && cleaned
          ? rectangleToCopy(options.region, cleaned.transform)
          : options.region;
      // A region is read as one block; the sparse layout is for the whole
      // photo. Page mode is set after every switch, which resets it. A
      // cleaned copy is always read as sparse text: a table is not a block,
      // and read as one (or as automatic columns) its cells run together —
      // on the label measured, sparse mode found every row label and most
      // values where block mode found half the labels. The reader regroups
      // words by position anyway. A photo with no grid is read as before,
      // in the mode asked for.
      const pageMode = cleaned
        ? PSM_SPARSE_TEXT
        : region
          ? PSM_SINGLE_BLOCK
          : layout === 'sparse'
            ? PSM_SPARSE_TEXT
            : layout === 'block'
              ? PSM_SINGLE_BLOCK
              : PSM_AUTO;
      await switchLanguage('eng', pageMode);
      const english = await wordsIn(target, region);
      let arabic: OcrWord[] = [];
      if (__OCR_LANGUAGES__.includes('ara')) {
        await switchLanguage('ara', pageMode);
        arabic = await wordsIn(target, region);
      }
      let words = mergeRecognitionPasses(english, arabic);

      // A rectangle read from the copy is the bounding box of the tilted
      // region, so it may hold words of a row the user cropped out: only
      // words whose centre, on the photo, is in the region are kept.
      const chosen = options.region;
      if (cleaned && chosen) {
        words = words.filter((word) => {
          const box = boxToPhoto(word.bbox, cleaned.transform);
          const x = (box.x0 + box.x1) / 2;
          const y = (box.y0 + box.y1) / 2;
          return (
            x >= chosen.left &&
            x <= chosen.left + chosen.width &&
            y >= chosen.top &&
            y <= chosen.top + chosen.height
          );
        });
      }

      let { width, height } = cleaned?.transform.copy ?? {
        width: 0,
        height: 0,
      };
      if (!cleaned) {
        const photo = await createImageBitmap(image);
        ({ width, height } = photo);
        photo.close();
      }

      // A number is re-read from its own crop. From a cleaned copy that is a
      // tight, enlarged crop of its ink, read as its own small image; its
      // words come back in the copy's coordinates, where the page words are.
      // The crop is cut from the copy before its grid lines were erased, so
      // the second reading does not share the erasure's damage with the
      // first; and a number whose ink the erasure touched is not re-read at
      // all (undefined): both readings of a cut digit would agree on the cut.
      async function rereadNumber(
        word: OcrWord,
      ): Promise<OcrWord[] | undefined> {
        const rect = cleaned && numberInkCrop(cleaned.image, word.bbox);
        if (cleaned && rect) {
          const { width: w, height: h } = cleaned.image;
          if (touchesErasedLine(cleaned.erased, w, h, rect.ink)) {
            return undefined;
          }
          const factor = rereadScale(rect.height);
          const crop = await codec.encode(
            enlargeCrop(cleaned.reread, rect, factor),
          );
          return (await wordsIn(crop)).map((w) => ({
            ...w,
            bbox: {
              x0: rect.left + w.bbox.x0 / factor,
              y0: rect.top + w.bbox.y0 / factor,
              x1: rect.left + w.bbox.x1 / factor,
              y1: rect.top + w.bbox.y1 / factor,
            },
          }));
        }
        return wordsIn(target, numberCrop(word.bbox, width, height));
      }

      await switchLanguage('eng', PSM_SINGLE_LINE);
      let checks = 0;
      for (let i = 0; i < words.length; i += 1) {
        if (!hasDigit(words[i].text)) continue;
        if (checks >= MAX_NUMBER_CHECKS) {
          words[i] = { ...words[i], numberCheck: 'unverified' };
          continue;
        }
        checks += 1;
        const reread = await rereadNumber(words[i]);
        words[i] = reread
          ? verifyNumberWord(words[i], reread)
          : { ...words[i], numberCheck: 'unverified' };
      }
      return {
        sparse: pageMode === PSM_SPARSE_TEXT,
        words: cleaned
          ? words.map((word) => ({
              ...word,
              bbox: boxToPhoto(word.bbox, cleaned.transform),
              layoutBox: word.bbox,
            }))
          : words,
      };
    },
    async terminate() {
      cleanupAbort.abort();
      await worker.terminate();
    },
  };
}
