import { canvasCodec, type GrayCodec } from './grayCodec';
import {
  boxToPhoto,
  cleanForRecognition,
  enlargeCrop,
  numberInkCrop,
  rereadScale,
  rectangleToCopy,
  type GrayImage,
  type Transform,
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
// Every pass reads a cleaned copy of the photo — straightened, its grid
// lines erased, its lighting evened out (labelCleanup.ts) — made here on
// the device from the photo and used only for recognition. Recognised
// positions are mapped back, so evidence boxes still sit on the photo. If
// the copy can't be made, the photo itself is read as before.

export type OcrProgressStage = 'loading' | 'recognizing';

export interface OcrProgress {
  stage: OcrProgressStage;
  // 0-1 within the stage.
  progress: number;
}

// How a photo is read. `region` limits both language passes to that
// rectangle (photo pixels), read as one block of text. `layout: 'sparse'`
// reads the whole photo for scattered text instead — the fallback when the
// automatic reading finds no table. With neither, the whole photo is read
// in automatic page mode.
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

// The cleaned copy of a photo and where it came from, or nothing when the
// photo can't be decoded here.
async function cleanedCopy(
  image: Blob,
  codec: GrayCodec,
): Promise<{ blob: Blob; image: GrayImage; transform: Transform } | undefined> {
  try {
    const { image: copy, transform } = cleanForRecognition(
      await codec.decode(image),
    );
    return { blob: await codec.encode(copy), image: copy, transform };
  } catch {
    return undefined;
  }
}

export async function createTesseractEngine(
  onProgress: (progress: OcrProgress) => void,
  codec: GrayCodec = canvasCodec,
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
      const cleaned = await cleanedCopy(image, codec);
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
      // words by position anyway.
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
      const words = mergeRecognitionPasses(english, arabic);

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
      async function rereadNumber(word: OcrWord): Promise<OcrWord[]> {
        const rect = cleaned && numberInkCrop(cleaned.image, word.bbox);
        if (cleaned && rect) {
          const factor = rereadScale(rect.height);
          const crop = await codec.encode(
            enlargeCrop(cleaned.image, rect, factor),
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
        words[i] = verifyNumberWord(words[i], reread);
      }
      return {
        words: cleaned
          ? words.map((word) => ({
              ...word,
              bbox: boxToPhoto(word.bbox, cleaned.transform),
            }))
          : words,
      };
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
