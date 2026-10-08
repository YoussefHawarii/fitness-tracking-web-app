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

export type OcrProgressStage = 'loading' | 'recognizing';

export interface OcrProgress {
  stage: OcrProgressStage;
  // 0-1 within the stage.
  progress: number;
}

export interface OcrEngine {
  recognize(image: Blob): Promise<OcrLayout>;
  terminate(): Promise<void>;
}

const OEM_LSTM_ONLY = 1;
const PSM_AUTO = '3';
const PSM_SINGLE_LINE = '7';
// Upper bound on numbers re-read per photo, so a photo of dense text can't
// turn into hundreds of re-reads on a phone. Numbers beyond it stay
// unverified and are never read.
const MAX_NUMBER_CHECKS = 80;

export async function createTesseractEngine(
  onProgress: (progress: OcrProgress) => void,
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
    async recognize(image) {
      await switchLanguage('eng', PSM_AUTO);
      const english = await wordsIn(image);
      let arabic: OcrWord[] = [];
      if (__OCR_LANGUAGES__.includes('ara')) {
        await switchLanguage('ara', PSM_AUTO);
        arabic = await wordsIn(image);
      }
      const words = mergeRecognitionPasses(english, arabic);

      const photo = await createImageBitmap(image);
      const { width, height } = photo;
      photo.close();

      await switchLanguage('eng', PSM_SINGLE_LINE);
      let checks = 0;
      for (let i = 0; i < words.length; i += 1) {
        if (!hasDigit(words[i].text)) continue;
        if (checks >= MAX_NUMBER_CHECKS) {
          words[i] = { ...words[i], numberCheck: 'unverified' };
          continue;
        }
        checks += 1;
        const reread = await wordsIn(
          image,
          numberCrop(words[i].bbox, width, height),
        );
        words[i] = verifyNumberWord(words[i], reread);
      }
      return { words };
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
